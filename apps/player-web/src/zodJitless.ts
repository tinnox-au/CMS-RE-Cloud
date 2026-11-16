/*
 * The player's `zod`, set up as the portal's is (apps/portal/src/zodJitless.ts): vite.config.ts
 * maps the bare specifier `zod` here, so `jitless` is set before any schema is built. Without
 * it zod tries `new Function` once, and the player's Content-Security-Policy (no
 * 'unsafe-eval') reports that attempt as a violation.
 */
import { config } from 'zod/v4';

config({ jitless: true });

export * from 'zod/v4';
export { default } from 'zod/v4';
