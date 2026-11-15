import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Operator portal. Its own origin (prototype-m0.md D7, D17): http://localhost:5173.
// /api is proxied to the API so the session cookie is same-origin with the portal.
// No CDN, remote font or analytics may be added (D18).

/**
 * Response headers for `vite dev` and `vite preview`. A production reverse proxy must send
 * the same (docs/security/operations-and-release-checklist.md). frame-ancestors cannot be
 * expressed in a <meta> policy, so the header carries only that directive and never
 * loosens the meta policy. Without it any site could frame the portal (clickjacking).
 */
const SECURITY_HEADERS = {
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;

/** Policy used only by `vite dev`: hot reload needs inline script, inline style and a websocket. */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob:",
  "media-src 'self' blob:",
  "connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * index.html carries the strict production policy. In development it is replaced by DEV_CSP.
 * The build keeps the strict policy and fails if it is missing or if an inline script appears.
 */
function contentSecurityPolicy(): Plugin {
  let serving = false;
  return {
    name: 'tinnox-portal-csp',
    configResolved(config) {
      serving = config.command === 'serve' && !config.isProduction;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!CSP_META.test(html)) {
          throw new Error('index.html must contain the Content-Security-Policy meta element');
        }
        if (serving) {
          return html.replace(CSP_META, (_all, open: string, _policy: string, close: string) => {
            return `${open}${DEV_CSP}${close}`;
          });
        }
        if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
          throw new Error('The built index.html must not contain an inline script');
        }
        return html;
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: SECURITY_HEADERS,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false, xfwd: false },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: SECURITY_HEADERS,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false, xfwd: false },
    },
  },
  build: { sourcemap: true, target: 'es2023' },
});
