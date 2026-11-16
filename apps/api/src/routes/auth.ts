/**
 * Sign-in, callback, sign-out and the session document.
 *
 * Login state: `state`, `nonce` and the PKCE verifier are stored server-side
 * (table login_state, one-time, 10 minutes). They are keyed by a hash of the
 * `state` value together with a short-lived random pre-auth cookie, so an
 * authorization response can only be redeemed by the browser that started it.
 */
import { createHmac } from 'node:crypto';
import {
  LoginQuerySchema,
  ROUTES,
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
  withResolvedOrg,
} from '@tinnox/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { IdentityProviderError, mfaSatisfied } from '../auth/oidc.ts';
import {
  clearSessionCookie,
  operatorOf,
  readSession,
  requireOperator,
  sessionCookieOptions,
} from '../auth/session.ts';
import { perMinute, type AppContext } from '../context.ts';
import { HttpError, parseInput } from '../errors.ts';
import { randomToken } from '../security.ts';

const LOGIN_STATE_TTL_SECONDS = 600;

/** Reasons the portal may show after a failed sign-in (`?authError=` on the portal root). */
export type AuthErrorCode =
  'state' | 'provider' | 'provider_unavailable' | 'no_membership' | 'mfa_required';

function loginStateKey(ctx: AppContext, preAuthCookie: string, state: string): Buffer {
  return createHmac('sha256', ctx.config.sessionSecret)
    .update(`login-state\n${preAuthCookie}\n${state}`)
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
        stateHash: loginStateKey(ctx, preAuth, begin.state),
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
      const stored = await loginStateTake(unscoped, loginStateKey(ctx, preAuth, state));
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
      const created = await withResolvedOrg(ctx.pool, async (tx, enterOrg) => {
        if (typeof previous === 'string' && previous.length <= 100) {
          await sessionRevoke(tx, sha256(previous));
        }
        const session = await sessionCreate(tx, {
          idHash: sha256(sessionId),
          oidcSub: identity.sub,
          csrfToken,
          ttlSeconds: ctx.config.sessionTtlSeconds,
          idToken,
        });
        if (session === null) {
          await auditUnscoped(tx, {
            actorType: 'anonymous',
            actorId: null,
            action: 'auth.login',
            objectType: null,
            objectId: null,
            result: 'denied',
            detail: { reason: 'no_membership' },
          });
          return null;
        }
        await enterOrg(session.orgId);
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
      if (created === null) {
        clearSessionCookie(ctx, reply);
        return failureRedirect(ctx, reply, 'no_membership');
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
    return {
      authenticated: true,
      // No name or e-mail address is stored by the API (data minimisation); the role is shown instead.
      user: { displayName: 'Operator', role: 'operator' },
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
      const revoked = await withResolvedOrg(ctx.pool, async (tx, enterOrg) => {
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
      if (revoked === null) {
        throw new HttpError(401, 'unauthenticated', 'Sign in to continue.');
      }
      // The portal should navigate to this URL so the identity provider's own session ends too.
      return { redirectTo: await ctx.idp.endSessionUrl(revoked.idToken) };
    },
  );
}
