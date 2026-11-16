/*
 * The portal's `zod`: the real package with one setting applied first. vite.config.ts maps
 * the bare specifier `zod` to this module for everything in the portal bundle, the shared
 * contracts included, so no object schema can be built before the setting is in place,
 * however the bundler splits the code into chunks.
 *
 * zod speeds up object parsing with generated code when the page allows `new Function`, and
 * finds out by trying it once, when the first object schema is built. The portal's
 * Content-Security-Policy refuses that (it has no 'unsafe-eval'), so zod already ran without
 * generated code; but the attempt itself is reported by the browser as a policy violation.
 * `jitless` skips the attempt. Parsing results are the same either way.
 */
import { config } from 'zod/v4';

config({ jitless: true });

export * from 'zod/v4';
export { default } from 'zod/v4';
