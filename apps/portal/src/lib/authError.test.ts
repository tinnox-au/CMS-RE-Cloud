import { AUTH_ERROR_CODES } from '@tinnox/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authErrorMessage, takeAuthError } from './authError.ts';

/** A stand-in for the browser's `window`: the address and `history.replaceState`. */
function stubAddress(href: string) {
  const replaceState = vi.fn((_state: unknown, _unused: string, url: URL) => {
    location.href = url.toString();
  });
  const location = { href };
  vi.stubGlobal('window', { location, history: { state: null, replaceState } });
  return { location, replaceState };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authErrorMessage', () => {
  it('has a message for every sign-in failure code', () => {
    for (const code of AUTH_ERROR_CODES) {
      const message = authErrorMessage(code);
      expect(message.length).toBeGreaterThan(20);
      expect(message).toMatch(/\.$/);
      expect(message).not.toMatch(/operator/i);
    }
  });

  it('tells a removed or new person whom to ask', () => {
    expect(authErrorMessage('no_membership')).toContain('ask the Owner or an Admin');
    expect(authErrorMessage('reauth_failed')).toContain('password and one-time code');
  });
});

describe('takeAuthError', () => {
  it('reads a known code and removes only the parameter from the address', () => {
    const { location, replaceState } = stubAddress(
      'https://cms.example/?keep=1&authError=no_membership#top',
    );
    expect(takeAuthError()).toBe('no_membership');
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(location.href).toBe('https://cms.example/?keep=1#top');
  });

  it('ignores an unknown value but still removes it', () => {
    const { location } = stubAddress('https://cms.example/?authError=%3Cscript%3E');
    expect(takeAuthError()).toBeNull();
    expect(location.href).toBe('https://cms.example/');
  });

  it('leaves an address without the parameter alone', () => {
    const { replaceState } = stubAddress('https://cms.example/dashboard?state=abc');
    expect(takeAuthError()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
