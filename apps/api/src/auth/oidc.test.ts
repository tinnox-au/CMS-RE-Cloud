import { LOGOUT_REDIRECT_MAX_LENGTH } from '@tinnox/contracts';
import * as oidc from 'openid-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config.ts';
import { createIdentityProvider, SIGNED_OUT_STATE } from './oidc.ts';

// Discovery is replaced so no provider is needed; URL building stays the library's own.
vi.mock('openid-client', async (importOriginal) => {
  const actual = await importOriginal<typeof oidc>();
  return { ...actual, discovery: vi.fn() };
});

const ISSUER = 'https://id.signage.example/realms/tinnox';
const END_SESSION = `${ISSUER}/protocol/openid-connect/logout`;

const config = {
  oidc: {
    issuer: ISSUER,
    clientId: 'tinnox-portal',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:3000/api/auth/callback',
    postLogoutRedirectUri: 'http://localhost:5173/',
    mfaAcrValues: [],
    mfaAmrValues: [],
    allowInsecureRequests: false,
  },
} as unknown as AppConfig;

function providerWith(metadata: Partial<oidc.ServerMetadata>) {
  vi.mocked(oidc.discovery).mockResolvedValue(
    new oidc.Configuration({ issuer: ISSUER, ...metadata }, config.oidc.clientId),
  );
  return createIdentityProvider(config);
}

describe('endSessionUrl', () => {
  beforeEach(() => {
    vi.mocked(oidc.discovery).mockReset();
  });

  it('asks the provider to return to the portal with state=signed_out', async () => {
    const href = await providerWith({ end_session_endpoint: END_SESSION }).endSessionUrl('id.tok');
    expect(href).not.toBeNull();
    const url = new URL(href ?? '');
    expect(`${url.origin}${url.pathname}`).toBe(END_SESSION);
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/');
    expect(url.searchParams.get('state')).toBe('signed_out');
    expect(SIGNED_OUT_STATE).toBe('signed_out');
    expect(url.searchParams.get('id_token_hint')).toBe('id.tok');
  });

  it('names the client instead when there is no ID token', async () => {
    const href = await providerWith({ end_session_endpoint: END_SESSION }).endSessionUrl(null);
    const url = new URL(href ?? '');
    expect(url.searchParams.get('client_id')).toBe('tinnox-portal');
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(url.searchParams.get('state')).toBe('signed_out');
  });

  it('keeps id_token_hint while the URL fits the portal limit', async () => {
    const provider = providerWith({ end_session_endpoint: END_SESSION });
    const base = (await provider.endSessionUrl(''))?.length ?? 0;
    const token = 'x'.repeat(LOGOUT_REDIRECT_MAX_LENGTH - base);
    const href = (await provider.endSessionUrl(token)) ?? '';
    expect(href.length).toBe(LOGOUT_REDIRECT_MAX_LENGTH);
    expect(new URL(href).searchParams.get('id_token_hint')?.length).toBe(token.length);
    // One character more and the hint is left out.
    const over = new URL((await provider.endSessionUrl(`${token}x`)) ?? '');
    expect(over.searchParams.has('id_token_hint')).toBe(false);
  });

  it('drops id_token_hint when the token would push the URL past the portal limit', async () => {
    const href = await providerWith({ end_session_endpoint: END_SESSION }).endSessionUrl(
      'x'.repeat(1900),
    );
    expect(href).not.toBeNull();
    expect(href?.length).toBeLessThanOrEqual(LOGOUT_REDIRECT_MAX_LENGTH);
    const url = new URL(href ?? '');
    expect(url.searchParams.has('id_token_hint')).toBe(false);
    expect(url.searchParams.get('client_id')).toBe('tinnox-portal');
    expect(url.searchParams.get('state')).toBe('signed_out');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/');
  });

  it('answers null when even the URL without a token is past the portal limit', async () => {
    const endpoint = `${END_SESSION}?pad=${'p'.repeat(LOGOUT_REDIRECT_MAX_LENGTH)}`;
    expect(
      await providerWith({ end_session_endpoint: endpoint }).endSessionUrl('id.tok'),
    ).toBeNull();
  });

  it('answers null when the provider has no end-session endpoint', async () => {
    expect(await providerWith({}).endSessionUrl('id.tok')).toBeNull();
  });
});
