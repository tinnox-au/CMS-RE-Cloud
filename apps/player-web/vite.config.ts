import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { resolveApiOrigin, SECURITY_HEADERS, shellPlugin } from './build/shell-plugin.mjs';

// Browser player. A separate origin from the portal (prototype-m0.md D7, D17):
// http://localhost:5174. It calls the API cross-origin with its device token;
// nothing is proxied, so operator cookies never reach this origin.
export default defineConfig(({ mode }) => {
  const apiOrigin = resolveApiOrigin(mode);
  return {
    plugins: [shellPlugin({ apiOrigin })],
    // Every `zod` import goes through src/zodJitless.ts (no `new Function` probe, see there).
    resolve: {
      alias: [
        {
          find: /^zod$/,
          replacement: fileURLToPath(new URL('./src/zodJitless.ts', import.meta.url)),
        },
      ],
    },
    define: { __API_ORIGIN__: JSON.stringify(apiOrigin) },
    server: { host: '127.0.0.1', port: 5174, strictPort: true, headers: { ...SECURITY_HEADERS } },
    preview: { host: '127.0.0.1', port: 5174, strictPort: true, headers: { ...SECURITY_HEADERS } },
    build: {
      sourcemap: true,
      target: 'es2023',
      rolldownOptions: {
        // The service worker is a second, self-contained entry with a fixed name: /sw.js.
        input: { index: 'index.html', sw: 'sw/sw.ts' },
        output: {
          entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
        },
      },
    },
  };
});
