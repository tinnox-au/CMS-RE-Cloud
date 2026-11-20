/**
 * Identity provider access (D5). The API is a confidential OIDC client using
 * the authorization code flow with PKCE (S256). All protocol work - discovery,
 * token exchange, signature, issuer, audience, nonce and state checks - is done
 * by the maintained `openid-client` library. Nothing here handles passwords or
 * one-time codes: those stay with the identity provider.
 *
 * The provider is replaceable: only this file knows about it, behind the
 * IdentityProvider interface.
 */
import { LOGOUT_REDIRECT_MAX_LENGTH } from '@tinnox/contracts';
import * as oidc from 'openid-client';
import type { AppConfig } from '../config.ts';

export interface VerifiedIdentity {
  readonly sub: string;
  /** Authentication context class reported by the provider, if any. */
  readonly acr: string | null;
  /** Authentication methods reported by the provider, if any. */
  readonly amr: readonly string[];
  /** Raw ID token, kept server-side only, for RP-initiated logout. */
  readonly idToken: string | null;
  /**
   * When the person last authenticated at the provider (`auth_time`, seconds since the epoch),
   * verified with the token. Null when the token has none. Compared with the member's session
   * cut-off at sign-in (sec.session_create).
   */
  readonly authTime: number | null;
}

export interface AuthorizationRequest {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly url: string;
}

export class IdentityProviderError extends Error {
  readonly reason: 'unavailable' | 'rejected';
  constructor(reason: 'unavailable' | 'rejected', message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IdentityProviderError';
    this.reason = reason;
  }
}

export interface IdentityProvider {
  /**
   * Creates state, nonce and PKCE verifier and the provider URL to send the browser to.
   * `reauthenticate` asks the provider to sign the person in again even when it still has a
   * session for them (`prompt=login`), after their sessions were ended.
   */
  beginLogin(options?: { readonly reauthenticate?: boolean }): Promise<AuthorizationRequest>;
  /** Redeems the authorization response. `query` is the callback's query string as received. */
  completeLogin(
    query: URLSearchParams,
    expected: { state: string; nonce: string; codeVerifier: string },
  ): Promise<VerifiedIdentity>;
  /**
   * Provider end-session URL for RP-initiated logout. Null when the provider has none, when
   * discovery fails, or when no URL fits the portal's limit (LOGOUT_REDIRECT_MAX_LENGTH).
   */
  endSessionUrl(idToken: string | null): Promise<string | null>;
  /** True when provider metadata has been loaded. */
  check(): Promise<boolean>;
}

/**
 * Decides whether the verified ID token shows multi-factor sign-in.
 * - When neither list is configured the API does not judge MFA from claims; the
 *   provider's own sign-in policy is then the only enforcement. That is the case
 *   for the development realm, whose ID token carries no usable acr or amr.
 * - When a list is configured, a token that does not satisfy it is refused.
 *   Production start-up requires at least one list (config.ts).
 */
export function mfaSatisfied(
  identity: Pick<VerifiedIdentity, 'acr' | 'amr'>,
  required: { acrValues: readonly string[]; amrValues: readonly string[] },
): { ok: true; checked: boolean } | { ok: false } {
  const checksAcr = required.acrValues.length > 0;
  const checksAmr = required.amrValues.length > 0;
  if (!checksAcr && !checksAmr) return { ok: true, checked: false };
  if (checksAcr && (identity.acr === null || !required.acrValues.includes(identity.acr))) {
    return { ok: false };
  }
  if (checksAmr && !identity.amr.some((method) => required.amrValues.includes(method))) {
    return { ok: false };
  }
  return { ok: true, checked: true };
}

/**
 * The `state` the provider sends back to the post-logout URI after RP-initiated logout.
 * The portal looks for this exact value; keep the two in step.
 */
export const SIGNED_OUT_STATE = 'signed_out';

export function createIdentityProvider(config: AppConfig): IdentityProvider {
  let cached: Promise<oidc.Configuration> | null = null;

  // Discovery is lazy and retried, so the API can start before the provider is up.
  async function configuration(): Promise<oidc.Configuration> {
    if (cached === null) {
      const attempt = oidc
        .discovery(
          new URL(config.oidc.issuer),
          config.oidc.clientId,
          { client_secret: config.oidc.clientSecret },
          oidc.ClientSecretBasic(config.oidc.clientSecret),
          {
            timeout: 10,
            ...(config.oidc.allowInsecureRequests ? { execute: [oidc.allowInsecureRequests] } : {}),
          },
        )
        .catch((error: unknown) => {
          if (cached === attempt) cached = null;
          throw new IdentityProviderError('unavailable', 'identity provider is not reachable', {
            cause: error,
          });
        });
      cached = attempt;
    }
    return cached;
  }

  return {
    async beginLogin(options = {}): Promise<AuthorizationRequest> {
      const cfg = await configuration();
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      const url = oidc.buildAuthorizationUrl(cfg, {
        redirect_uri: config.oidc.redirectUri,
        response_type: 'code',
        scope: 'openid',
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        // No max_age: it would oblige a maxAge check on the token exchange. The callback compares
        // auth_time with the member's cut-off itself.
        ...(options.reauthenticate === true ? { prompt: 'login' } : {}),
      });
      return { state, nonce, codeVerifier, url: url.href };
    },

    async completeLogin(query, expected): Promise<VerifiedIdentity> {
      const cfg = await configuration();
      // The library derives redirect_uri from this URL, so it is built from configuration,
      // never from the request's Host header.
      const callbackUrl = new URL(config.oidc.redirectUri);
      callbackUrl.search = query.toString();
      let tokens;
      try {
        tokens = await oidc.authorizationCodeGrant(cfg, callbackUrl, {
          pkceCodeVerifier: expected.codeVerifier,
          expectedState: expected.state,
          expectedNonce: expected.nonce,
          idTokenExpected: true,
        });
      } catch (error) {
        throw new IdentityProviderError('rejected', 'authorization response was not accepted', {
          cause: error,
        });
      }
      const claims = tokens.claims();
      if (claims === undefined || typeof claims.sub !== 'string' || claims.sub === '') {
        throw new IdentityProviderError('rejected', 'identity provider returned no subject');
      }
      const acr = typeof claims.acr === 'string' ? claims.acr : null;
      const amr = Array.isArray(claims.amr)
        ? claims.amr.filter((value): value is string => typeof value === 'string')
        : [];
      const authTime = typeof claims.auth_time === 'number' ? claims.auth_time : null;
      return { sub: claims.sub, acr, amr, idToken: tokens.id_token ?? null, authTime };
    },

    async endSessionUrl(idToken): Promise<string | null> {
      let cfg: oidc.Configuration;
      try {
        cfg = await configuration();
      } catch {
        return null;
      }
      if (cfg.serverMetadata().end_session_endpoint === undefined) return null;
      const build = (hint: string | null): string =>
        oidc.buildEndSessionUrl(cfg, {
          post_logout_redirect_uri: config.oidc.postLogoutRedirectUri,
          // Returned on the redirect back, so the portal can say "You have signed out."
          // (SessionContext.tsx). A fixed marker, not a secret: it is not checked as a CSRF state.
          state: SIGNED_OUT_STATE,
          ...(hint === null ? { client_id: config.oidc.clientId } : { id_token_hint: hint }),
        }).href;
      // The portal refuses a longer answer (LogoutResponseSchema), so a large ID token is left
      // out: Keycloak then asks the user to confirm the logout but still ends its session.
      let href = build(idToken);
      if (href.length > LOGOUT_REDIRECT_MAX_LENGTH && idToken !== null) href = build(null);
      // Still too long only with an absurd issuer or redirect URI: the portal then shows its
      // own signed-out notice instead of failing.
      return href.length <= LOGOUT_REDIRECT_MAX_LENGTH ? href : null;
    },

    async check(): Promise<boolean> {
      try {
        await configuration();
        return true;
      } catch {
        return false;
      }
    },
  };
}
