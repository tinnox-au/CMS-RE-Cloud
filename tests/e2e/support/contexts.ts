import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import type { DevUserName } from '../../support/dev-identity.ts';
import { OperatorApi, signIn } from './operator.ts';
import { runDir } from './stack.ts';

export interface OperatorSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly api: OperatorApi;
}

function statePath(name: DevUserName): string {
  return join(runDir, `state-${name}.json`);
}

/** Saved browser states of this run (they hold live session and identity-provider cookies). */
export function savedStateFiles(): string[] {
  if (!existsSync(runDir)) return [];
  return readdirSync(runDir)
    .filter((name) => /^state-.+\.json$/.test(name))
    .map((name) => join(runDir, name));
}

export function removeSavedStates(): void {
  for (const path of savedStateFiles()) rmSync(path, { force: true });
}

/**
 * A signed-in operator browser context. With `fresh` the whole Keycloak sign-in is
 * performed; otherwise a session saved by an earlier spec of the same run is reused when
 * the server still accepts it (Keycloak accepts each one-time code once, so signing the
 * same user in again costs up to 30 s). The saved state holds live session and Keycloak
 * cookies: it is written owner-only into a gitignored directory, and global teardown signs
 * the sessions out and deletes the files.
 */
export async function operatorSession(
  browser: Browser,
  name: DevUserName,
  options: { fresh?: boolean } = {},
): Promise<OperatorSession> {
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  chmodSync(runDir, 0o700);
  const viewport = { width: 1280, height: 900 };
  if (options.fresh !== true && existsSync(statePath(name))) {
    const context = await browser.newContext({ viewport, storageState: statePath(name) });
    const api = new OperatorApi(context);
    if ((await api.session()).authenticated) {
      return { context, page: await context.newPage(), api };
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await signIn(page, name);
  await context.storageState({ path: statePath(name) });
  chmodSync(statePath(name), 0o600);
  return { context, page, api: new OperatorApi(context) };
}
