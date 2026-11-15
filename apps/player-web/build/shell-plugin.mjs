// Build helper for the browser player. Plain Node code; no dependencies beyond Vite.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_API_ORIGIN = 'http://localhost:4000';
const HTML_PLACEHOLDER = '__API_ORIGIN__';
const SW_PLACEHOLDER = '__TINNOX_SHELL_MANIFEST__';
const SW_FILE = 'sw.js';

/**
 * Reads VITE_API_BASE_URL (process environment or apps/player-web/.env*) and returns
 * its origin. Refuses anything that is not a plain http(s) origin, because the value
 * is written into the Content-Security-Policy.
 */
export function resolveApiOrigin(mode) {
  const env = loadEnv(mode, APP_DIR, 'VITE_');
  const raw = env.VITE_API_BASE_URL ?? DEFAULT_API_ORIGIN;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`VITE_API_BASE_URL is not a URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use http or https');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('VITE_API_BASE_URL must not contain credentials');
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      'VITE_API_BASE_URL must be an origin only, for example https://api.example.test',
    );
  }
  if (mode === 'production' && url.protocol === 'http:' && !isLoopback(url.hostname)) {
    throw new Error('VITE_API_BASE_URL must use https unless it is a loopback address');
  }
  return url.origin;
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Throws when the HTML contains a script element without a src attribute. The player's
 * Content-Security-Policy (script-src 'self') would block it anyway; the build refuses it
 * so the policy never has to be loosened to make one work.
 */
export function assertNoInlineScript(html) {
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
    throw new Error('The built index.html must not contain an inline script');
  }
}

/** Response headers for `vite dev` and `vite preview` (a production proxy must send the same). */
export const SECURITY_HEADERS = Object.freeze({
  // frame-ancestors cannot be set from a <meta> policy; this header adds only that directive,
  // so it never loosens the meta policy.
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
});

function listFiles(dir, root = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, root));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

export function shellPlugin({ apiOrigin }) {
  let outDir = join(APP_DIR, 'dist');
  let isBuild = false;
  return {
    name: 'tinnox-player-shell',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      isBuild = config.command === 'build';
    },
    transformIndexHtml(html) {
      if (!html.includes(HTML_PLACEHOLDER)) {
        throw new Error(
          `index.html must contain ${HTML_PLACEHOLDER} in its Content-Security-Policy`,
        );
      }
      return html.replaceAll(HTML_PLACEHOLDER, apiOrigin);
    },
    closeBundle() {
      if (!isBuild) return;
      const files = listFiles(outDir).filter((file) => file !== SW_FILE && !file.endsWith('.map'));
      if (!files.includes('index.html')) throw new Error('build produced no index.html');
      assertNoInlineScript(readFileSync(join(outDir, 'index.html'), 'utf8'));
      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(file);
        hash.update('\0');
        hash.update(readFileSync(join(outDir, file)));
        hash.update('\0');
      }
      const swPath = join(outDir, SW_FILE);
      const source = readFileSync(swPath, 'utf8');
      const occurrences = source.split(SW_PLACEHOLDER).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `expected exactly one ${SW_PLACEHOLDER} in ${SW_FILE}, found ${occurrences}`,
        );
      }
      hash.update(source);
      const manifest = {
        version: hash.digest('hex').slice(0, 16),
        files: files.map((file) => `/${file}`),
      };
      writeFileSync(
        swPath,
        source.replace(SW_PLACEHOLDER, encodeURIComponent(JSON.stringify(manifest))),
      );
    },
  };
}
