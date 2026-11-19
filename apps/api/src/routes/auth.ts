/**
 * Sign-in, callback, sign-out and the session document.
 *
 * Login state: `state`, `nonce` and the PKCE verifier are stored server-side
 * (table login_state, one-time, 10 minutes). They are keyed by a hash of the
 * `state` value together with a short-lived random pre-auth cookie, so an
 * authorization response can only be redeemed by the browser that started it.
 *
 * After a member's sessions were ended (removal, demotion, sign out everywhere), a sign-in the
 * provider authenticated before that is refused (sec.session_create answers `reauth`), and the
 * browser is sent back once with `prompt=login`. That forced sign-in is stored under its own
 * key, so a provider that does not re-authenticate ends at `reauth_failed` instead of a loop.
 */
import { createHmac } from 'node:crypto';
import {
  LoginQuerySchema,
  ROUTES,
  type AuthErrorCode,
  type LogoutResponse,
  type SessionResponse,
} from '@tinnox/contracts';
import {
  auditScoped,
  auditUnscoped,
  loginStatePut,
  loginStateTake,
  poolAsTx,
  sessionCreate,
  sessionRevoke,
  sha256,
  withOrg,
  withResolvedOrg,
  type SessionCreateResult,
} from '@tinnox/db';
import { permissionsOf } from '@tinnox/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IdentityProviderError, mfaSatisfied } from '../auth/oidc.ts';
import { parseRole } from '../auth/permissions.ts';
import {
  clearSessionCookie,
  operatorOf,
  readSession,
  requireOperator,
  sessionCookieOptions,
} from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { HttpError, parseInput, pgErrorCode } from '../errors.ts';
import { randomToken } from '../security.ts';

const LOGIN_STATE_TTL_SECONDS = 600;

/**
 * The login_state key of a sign-in. A forced re-login (`prompt=login`) uses its own label, so
 * the callback knows it already asked once: the loop guard.
 */
function loginStateKey(
  ctx: AppContext,
  preAuthCookie: string,
  state: string,
  kind: 'normal' | 'reauth',
): Buffer {
  const label = kind === 'normal' ? 'login-state' : 'login-state-reauth';
  return createHmac('sha256', ctx.config.sessionSecret)
    .update(`${label}\n${preAuthCookie}\n${state}`)
    .digest();
}

function portalUrl(ctx: AppContext, path: string): string {
  return `${ctx.config.portalOrigin}${path}`;
}

function failureRedirect(ctx: AppContext, reply: FastifyReply, code: AuthErrorCode): FastifyReply {
  return reply.redirect(portalUrl(ctx, `/?authError=${code}`), 303);
}

function clearLoginCookie(ctx: AppContext, reply: FastifyReply): void {
  void reply.clearCookie(ctx.config.loginCookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    path: '/',
  });
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authRateLimit = { rateLimit: perMinute(ctx, 30) };
  const unscoped = poolAsTx(ctx.pool);

  app.get(
    ROUTES.authLogin,
    { config: authRateLimit },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = parseInput(LoginQuerySchema, request.query, 'query');
      let begin;
      try {
        begin = await ctx.idp.beginLogin();
      } catch (error) {
        request.log.error({ err: error }, 'identity provider unavailable at sign-in');
        return failureRedirect(ctx, reply, 'provider_unavailable');
      }
      const preAuth = randomToken();
      await loginStatePut(unscoped, {
        stateHash: loginStateKey(ctx, preAuth, begin.state, 'normal'),
        codeVerifier: begin.codeVerifier,
        nonce: begin.nonce,
        returnTo: query.returnTo ?? null,
        ttlSeconds: LOGIN_STATE_TTL_SECONDS,
      });
      void reply.setCookie(
        ctx.config.loginCookieName,
        preAuth,
        sessionCookieOptions(ctx, LOGIN_STATE_TTL_SECONDS),
      );
      return reply.header('cache-control', 'no-store').redirect(begin.url, 303);
    },
  );

  app.get(
    ROUTES.authCallback,
    { config: authRateLimit },
    async (request: FastifyRequest, reply: FastifyReply) => {
      void reply.header('cache-control', 'no-store');
      const preAuth = request.cookies[ctx.config.loginCookieName];
      clearLoginCookie(ctx, reply);

      const rawQuery = request.raw.url?.split('?')[1] ?? '';
      if (rawQuery.length > 8192) return failureRedirect(ctx, reply, 'state');
      const query = new URLSearchParams(rawQuery);
      const state = query.get('state');
      if (
        typeof preAuth !== 'string' ||
        preAuth.length > 100 ||
        state === null ||
        state.length > 500
      ) {
        return failureRedirect(ctx, reply, 'state');
      }
      // The forced re-login's key first: its answer must never start another one.
      const reauthStored = await loginStateTake(
        unscoped,
        loginStateKey(ctx, preAuth, state, 'reauth'),
      );
      const stored =
        reauthStored ??
        (await loginStateTake(unscoped, loginStateKey(ctx, preAuth, state, 'normal')));
      const forced = reauthStored !== null;
      if (stored === null) {
        await auditUnscoped(unscoped, {
          actorType: 'anonymous',
          actorId: null,
          action: 'auth.login',
          objectType: null,
          objectId: null,
          result: 'denied',
          detail: { reason: 'unknown_or_expired_state' },
        });
        return failureRedirect(ctx, reply, 'state');
      }

      let identity;
      try {
        identity = await ctx.idp.completeLogin(query, {
          state,
          nonce: stored.nonce,
          codeVerifier: stored.codeVerifier,
        });
      } catch (error) {
        const unavailable =
          error instanceof IdentityProviderError && error.reason === 'unavailable';
        request.log.warn(
          { reason: error instanceof Error ? error.message : 'unknown' },
          'sign-in was not completed',
        );
        await auditUnscoped(unscoped, {
          actorType: 'anonymous',
          actorId: null,
          action: 'auth.login',
          objectType: null,
          objectId: null,
          result: 'failure',
          detail: { reason: unavailable ? 'provider_unavailable' : 'provider_rejected' },
        });
        return failureRedirect(ctx, reply, unavailable ? 'provider_unavailable' : 'provider');
      }

      const mfa = mfaSatisfied(identity, {
        acrValues: ctx.config.oidc.mfaAcrValues,
        amrValues: ctx.config.oidc.mfaAmrValues,
      });
      if (!mfa.ok) {
        await auditUnscoped(unscoped, {
          actorType: 'anonymous',
          actorId: null,
          action: 'auth.login',
          objectType: null,
          objectId: null,
          result: 'denied',
          detail: { reason: 'mfa_evidence_missing', acr: identity.acr, amr: identity.amr },
        });
        return failureRedirect(ctx, reply, 'mfa_required');
      }

      // Session rotation: whatever session the browser had is ended; a new id is issued.
      // One transaction: the rotation, the new session and the audit event commit together.
      const previous = request.cookies[ctx.config.sessionCookieName];
      const sessionId = randomToken();
      const csrfToken = randomToken();
      const idToken =
        identity.idToken !== null && identity.idToken.length <= 8192 ? identity.idToken : null;
      let created: SessionCreateResult;
      try {
        created = await withResolvedOrg(ctx.pool, async (tx, enterOrg) => {
          // The member row is locked first (sec.session_create), the previous session row after
          // it: the order a member change uses (stage-c.md 6.8). The other way round, a removal
          // or sign-out of the member whose old cookie the browser still sends deadlocks.
          const session = await sessionCreate(tx, {
            idHash: sha256(sessionId),
            oidcSub: identity.sub,
            csrfToken,
            ttlSeconds: ctx.config.sessionTtlSeconds,
            idToken,
            authTime: identity.authTime === null ? null : new Date(identity.authTime * 1000),
          });
          // The rotation commits whatever the outcome.
          if (typeof previous === 'string' && previous.length <= 100) {
            await sessionRevoke(tx, sha256(previous));
          }
          if (session.outcome === 'no_membership') {
            await auditUnscoped(tx, {
              actorType: 'anonymous',
              actorId: null,
              action: 'auth.login',
              objectType: null,
              objectId: null,
              result: 'denied',
              detail: { reason: 'no_membership' },
            });
            return session;
          }
          await enterOrg(session.orgId);
          if (session.outcome === 'reauth') {
            await auditScoped(tx, {
              actorType: 'operator',
              actorId: session.membershipId,
              action: 'auth.login',
              objectType: 'membership',
              objectId: session.membershipId,
              result: 'denied',
              detail: { reason: forced ? 'reauth_failed' : 'reauth_required' },
            });
            return session;
          }
          await auditScoped(tx, {
            actorType: 'operator',
            actorId: session.membershipId,
            action: 'auth.login',
            objectType: 'membership',
            objectId: session.membershipId,
            result: 'success',
            detail: {
              acr: identity.acr,
              amr: identity.amr,
              mfaVerifiedFromClaims: mfa.checked,
            },
          });
          return session;
        });
      } catch (error) {
        // A member change held the member row past lock_timeout: nothing was committed.
        if (pgErrorCode(error) === '55P03') {
          request.log.warn({ pgCode: '55P03' }, 'sign-in waited too long for the member row');
          return failureRedirect(ctx, reply, 'provider_unavailable');
        }
        throw error;
      }

      if (created.outcome === 'no_membership') {
        clearSessionCookie(ctx, reply);
        return failureRedirect(ctx, reply, 'no_membership');
      }
      if (created.outcome === 'reauth') {
        clearSessionCookie(ctx, reply);
        // Asked once already: the provider did not sign the person in again.
        if (forced) return failureRedirect(ctx, reply, 'reauth_failed');
        let begin;
        try {
          begin = await ctx.idp.beginLogin({ reauthenticate: true });
        } catch (error) {
          request.log.error({ err: error }, 'identity provider unavailable at re-authentication');
          return failureRedirect(ctx, reply, 'provider_unavailable');
        }
        const nextPreAuth = randomToken();
        await loginStatePut(unscoped, {
          stateHash: loginStateKey(ctx, nextPreAuth, begin.state, 'reauth'),
          codeVerifier: begin.codeVerifier,
          nonce: begin.nonce,
          returnTo: stored.returnTo,
          ttlSeconds: LOGIN_STATE_TTL_SECONDS,
        });
        // Replaces the clearing of the pre-auth cookie above (one Set-Cookie per name and path).
        void reply.setCookie(
          ctx.config.loginCookieName,
          nextPreAuth,
          sessionCookieOptions(ctx, LOGIN_STATE_TTL_SECONDS),
        );
        return reply.redirect(begin.url, 303);
      }

      void reply.setCookie(
        ctx.config.sessionCookieName,
        sessionId,
        sessionCookieOptions(ctx, ctx.config.sessionTtlSeconds),
      );
      return reply.redirect(portalUrl(ctx, stored.returnTo ?? '/'), 303);
    },
  );

  app.get(ROUTES.session, async (request, reply): Promise<SessionResponse> => {
    void reply.header('cache-control', 'no-store');
    const session = await readSession(ctx, request);
    if (session === null) return { authenticated: false };
    // The role is read live from the member row on every request (sec.session_by_id_hash).
    const role = parseRole(session.role);
    if (role === null) {
      request.log.error('session with an unknown role');
      return { authenticated: false };
    }
    const name = await withOrg(ctx.pool, session.orgId, (tx) =>
      tx.query<{ display_name: string | null }>(
        'SELECT display_name FROM membership WHERE id = $1 AND org_id = app_org_id()',
        [session.membershipId],
      ),
    );
    return {
      authenticated: true,
      user: {
        membershipId: session.membershipId,
        // The name TINNOX recorded for the member (provision-member); no e-mail address is
        // stored (D3 a).
        displayName: name.rows[0]?.display_name ?? null,
        role,
        permissions: permissionsOf(role),
      },
      organization: { id: session.orgId, name: session.orgName },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      limits: ctx.config.limits,
    };
  });

  app.post(
    ROUTES.authLogout,
    { config: authRateLimit, preHandler: requireOperator(ctx) },
    async (request, reply): Promise<LogoutResponse> => {
      const session = operatorOf(request);
      // The browser forgets the session whatever happens next.
      clearSessionCookie(ctx, reply);
      // One transaction: the revocation and its audit event commit together.
      let revoked;
      try {
        revoked = await withResolvedOrg(ctx.pool, async (tx, enterOrg) => {
          const ended = await sessionRevoke(tx, session.idHash);
          if (ended === null) return null;
          await enterOrg(ended.orgId);
          await auditScoped(tx, {
            actorType: 'operator',
            actorId: ended.membershipId,
            action: 'auth.logout',
            objectType: 'membership',
            objectId: ended.membershipId,
            result: 'success',
            detail: null,
          });
          return ended;
        });
      } catch (error) {
        // Ending a session is the safe direction, so a sign-out that cannot be audited still
        // ends it. Sign-in and pairing do the opposite: no audit event, no credential.
        const ended = await sessionRevoke(unscoped, session.idHash).then(
          () => true,
          (revokeError: unknown) => {
            request.log.error({ err: revokeError }, 'sign-out could not end the session either');
            return false;
          },
        );
        request.log.error(
          { err: error },
          ended
            ? 'sign-out was not audited; the session was ended anyway'
            : 'sign-out was not audited and the session may still be active',
        );
        throw error;
      }
      if (revoked === null) {
        throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
      }
      // The portal should navigate to this URL so the identity provider's own session ends too.
      return { redirectTo: await ctx.idp.endSessionUrl(revoked.idToken) };
    },
  );
}
