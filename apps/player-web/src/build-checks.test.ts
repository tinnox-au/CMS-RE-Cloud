import { describe, expect, it } from 'vitest';
import { assertNoInlineScript, SECURITY_HEADERS } from '../build/shell-plugin.mjs';

describe('player build checks', () => {
  it('refuses an inline script in the built page, and accepts external ones', () => {
    expect(() => {
      assertNoInlineScript('<html><script>alert(1)</script></html>');
    }).toThrow(/inline script/);
    expect(() => {
      assertNoInlineScript('<script type="module">import "./x.js"</script>');
    }).toThrow(/inline script/);
    expect(() => {
      assertNoInlineScript(
        '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
      );
    }).not.toThrow();
  });

  it('serves anti-framing and no-sniff headers in dev and preview', () => {
    expect(SECURITY_HEADERS).toMatchObject({
      'Content-Security-Policy': "frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    });
  });
});
