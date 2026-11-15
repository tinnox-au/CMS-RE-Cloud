import type { Plugin } from 'vite';

/** Origin of the player API for this build (VITE_API_BASE_URL, default http://localhost:4000). */
export function resolveApiOrigin(mode: string): string;

/**
 * - Puts the API origin into the Content-Security-Policy of index.html.
 * - After the build, writes the list of shell files and a content hash into sw.js.
 */
export function shellPlugin(options: { apiOrigin: string }): Plugin;
export function assertNoInlineScript(html: string): void;
export const SECURITY_HEADERS: Readonly<Record<string, string>>;
