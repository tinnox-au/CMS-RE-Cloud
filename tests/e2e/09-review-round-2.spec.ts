/**
 * Frontend review round 2 (docs/reviews/2026-11-17-frontend-round-2): the findings fixed after
 * that round, checked in a real browser. The portal cases run against the real API; a request is
 * held or failed with Playwright interception to produce the orderings the review traced. The
 * player screens and the app renderer are drawn from their own sources at the sizes the review
 * measured.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import type * as AppRenderModule from '@tinnox/app-render';
import { buildSync } from 'esbuild';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import { createAppInPortal, openScreenPage } from './support/portal.ts';
import { API_URL, PORTAL_URL, repoRoot } from './support/stack.ts';

const runId = randomUUID().slice(0, 8);

/**
 * Holds the next request matching `url` and `method` until `release` (sends it on, or with
 * `answerNow` delivers the answer the server gave when it was held) or `fail` (aborts it). Later matching requests pass through. The route stays registered until the held
 * request is settled: removing it earlier lets Playwright send the held request on by itself.
 */
async function hold(
  page: Page,
  url: string | RegExp,
  method: string,
  { answerNow = false }: { readonly answerNow?: boolean } = {},
): Promise<{ held: Promise<Route>; release: () => Promise<void>; fail: () => Promise<void> }> {
  let resolveHeld!: (route: Route) => void;
  const held = new Promise<Route>((resolve) => (resolveHeld = resolve));
  let taken = false;
  let settle: () => void = () => undefined;
  let answer: Awaited<ReturnType<Route['fetch']>> | null = null;
  await page.route(url, async (route) => {
    if (taken || route.request().method() !== method) return route.fallback();
    taken = true;
    // answerNow: the server answers at once and the answer is delivered late, so it is the
    // state from before anything the test does meanwhile (a stale read).
    if (answerNow) answer = await route.fetch();
    resolveHeld(route);
    // Keep this handler pending until the test settles the route.
    await new Promise<void>((resolve) => (settle = resolve));
  });
  const finish = async (action: (route: Route) => Promise<void>): Promise<void> => {
    const route = await held;
    await action(route);
    settle();
    await page.unroute(url);
  };
  return {
    held,
    release: () =>
      finish((route) => (answer === null ? route.continue() : route.fulfill({ response: answer }))),
    fail: () => finish((route) => route.abort('failed')),
  };
}

/* ------------------------------------------------------------------------- portal */

test.describe('portal', () => {
  test.describe.configure({ mode: 'serial' });
  let operator: OperatorSession;

  test.beforeAll(async ({ browser }) => {
    operator = await operatorSession(browser, 'operator');
  });
  test.afterAll(async () => {
    await operator.context.close();
  });

  test('FCX-03: a save that is still running when its tab comes back keeps the form read-only', async () => {
    const page = operator.page;
    const { id } = await operator.api.createDisplay({
      name: `E2E round 2 canvas ${runId}`,
      canvas: { width: 1920, height: 1080 },
    });
    await openScreenPage(page, id, 'canvas');
    const width = page.getByTestId('screen-detail-canvas-width');
    await width.fill('1280');
    const patch = await hold(page, `${PORTAL_URL}/api/displays/${id}`, 'PATCH');
    await page.getByTestId('screen-detail-canvas-save').click();
    await patch.held;

    // Away and back while the save is pending: the form is still the one that is saving.
    await page.getByRole('tab', { name: 'Overview' }).click();
    await page.getByRole('tab', { name: 'Canvas' }).click();
    await expect(width).toHaveValue('1280');
    await expect(width).not.toBeEditable();
    await expect(page.getByTestId('screen-detail-canvas-save')).toHaveAttribute(
      'aria-busy',
      'true',
    );

    await patch.release();
    await expect(width).toBeEditable();
    await expect(width).toHaveValue('1280');
    await expect(page.getByTestId('screen-detail-unsaved')).toHaveCount(0);
    const response = await operator.context.request.get(`${PORTAL_URL}/api/displays/${id}`);
    const stored = (await response.json()) as { canvas: { width: number } };
    expect(stored.canvas.width).toBe(1280);
  });

  test('FCX-04: leaving while a save is pending asks first, and a failed save keeps the draft', async () => {
    const page = operator.page;
    const name = `E2E round 2 clock ${runId}`;
    const appId = await createAppInPortal(page, 'clock', name);
    const field = page.getByTestId('app-editor').getByLabel('Name', { exact: true });
    await field.fill(`${name} renamed`);
    const patch = await hold(page, `${PORTAL_URL}/api/apps/${appId}`, 'PATCH');
    await page.getByTestId('app-editor-save').click();
    await patch.held;

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Playlists' })
      .click();
    const leave = page.getByTestId('leave-dialog');
    await expect(leave).toBeVisible();
    await expect(leave).toContainText('still being saved');
    await leave.getByRole('button', { name: 'Stay on this page' }).click();
    await expect(page).toHaveURL(new RegExp(`/apps/${appId}$`));

    await patch.fail();
    await expect(page.getByTestId('app-editor-save-state')).toHaveAttribute('data-dirty', 'true');
    await expect(field).toHaveValue(`${name} renamed`);
  });

  test('FCX-05: a screen read that started before a save cannot put the old name back', async () => {
    const page = operator.page;
    const before = `E2E round 2 lobby ${runId}`;
    const after = `E2E round 2 reception ${runId}`;
    const { id } = await operator.api.createDisplay({
      name: before,
      canvas: { width: 1920, height: 1080 },
    });
    await openScreenPage(page, id, 'pairing');

    // Pairing reads the screen again; that read is held until the rename has been saved.
    const pairing = (await (
      await fetch(`${API_URL}/player/pairing`, { method: 'POST' })
    ).json()) as {
      code: string;
    };
    const read = await hold(page, `${PORTAL_URL}/api/displays/${id}`, 'GET', { answerNow: true });
    await page.getByTestId('screen-detail-pairing-code').fill(pairing.code);
    await page.getByTestId('screen-detail-pair').click();
    await read.held;

    await page.getByTestId('screen-detail-name').fill(after);
    await page.getByTestId('screen-detail-details-save').click();
    await expect(page.getByRole('heading', { level: 1, name: after })).toBeVisible();

    await read.release();
    // Give the stale answer time to arrive and be (wrongly) applied.
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1, name: after })).toBeVisible();
    await expect(page.getByTestId('screen-detail-name')).toHaveValue(after);
  });

  test('FCU-03: a long screen name cut short in the page title can be read with the pointer', async () => {
    const page = operator.page;
    const name = `${'W'.repeat(100)}${runId}`;
    const { id } = await operator.api.createDisplay({
      name,
      canvas: { width: 1920, height: 1080 },
    });
    await openScreenPage(page, id);
    await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('title', name);
  });

  test('FCU-04: at 390 px every screen settings tab is on screen without scrolling the tab list', async () => {
    const page = operator.page;
    const { id } = await operator.api.createDisplay({
      name: `E2E round 2 narrow ${runId}`,
      canvas: { width: 1920, height: 1080 },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await openScreenPage(page, id);
      const list = page.getByRole('tablist', { name: 'Screen settings' });
      const { scroll, client } = await list.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
      // Every tab lies within the window's width (the page itself may scroll down to them).
      const outside = await list.evaluate(
        (el) =>
          [...el.querySelectorAll('[role="tab"]')]
            .map((tab) => tab.getBoundingClientRect())
            .filter((box) => box.left < 0 || box.right > window.innerWidth).length,
      );
      expect(outside).toBe(0);
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });

  test('FCU-05: the wordmark is inside a landmark', async () => {
    const page = operator.page;
    await page.goto(`${PORTAL_URL}/`);
    const inLandmark = await page
      .locator('.tx-sidebar .tx-wordmark__name')
      .evaluate(
        (el) =>
          el.closest(
            'aside, nav, main, header, footer, [role="region"], [role="complementary"]',
          ) !== null,
      );
    expect(inLandmark).toBe(true);
  });

  test('FCU-06: Tab stays inside an open dialog', async () => {
    const page = operator.page;
    await page.goto(`${PORTAL_URL}/media`);
    await page.getByTestId('media-library-add').click();
    const dialog = page.getByTestId('media-library-add-dialog');
    await expect(dialog).toBeVisible();
    for (const key of [...Array<string>(15).fill('Tab'), ...Array<string>(15).fill('Shift+Tab')]) {
      await page.keyboard.press(key);
      const inside = await page.evaluate(
        () => document.activeElement?.closest('dialog[open]') !== null,
      );
      expect(inside, `focus after ${key}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

/*
 * Player screens and the app renderer: drawn from their sources, no stack needed. Run alone with
 *   npx playwright test -c tests/playwright.layout.config.ts
 */
test.describe('player and app renderer', () => {
  test('FCU-01: player information screens keep a 120-letter name and the pairing code on screen', async ({
    browser,
  }) => {
    const css = readFileSync(join(repoRoot, 'apps', 'player-web', 'src', 'styles.css'), 'utf8');
    const name = 'W'.repeat(120);
    const screens: Record<string, string> = {
      slate: `<p class="brand">TINNOX Player</p><h1>${name}</h1><p>Nothing is scheduled.</p>`,
      revoked: `<p class="brand">TINNOX Player</p><h1>This player was unregistered</h1><p>The server no longer accepts this player for "${name}".</p><button>Reset this player</button>`,
      pairing: `<p class="brand">TINNOX Player</p><h1>Pair this screen</h1><p>In the TINNOX portal, open the display and enter this code:</p><div class="code">ABCD-EFGH</div><p>This code expires in 9:41.</p><p class="note"></p>`,
    };
    for (const [width, height] of [
      [1920, 1080],
      [1280, 384],
      [390, 844],
      [192, 96],
      [3840, 2160],
    ] as const) {
      const page = await browser.newPage({ viewport: { width, height } });
      for (const [label, html] of Object.entries(screens)) {
        await page.setContent(
          `<!doctype html><style>${css}</style><div id="screen"><div class="card">${html}</div></div>`,
        );
        const problems = await page.evaluate(() => {
          const found: string[] = [];
          for (const el of document.querySelectorAll<HTMLElement>('.card > *')) {
            if (getComputedStyle(el).display === 'none') continue;
            const box = el.getBoundingClientRect();
            if (
              el.scrollWidth > el.clientWidth + 1 ||
              box.left < -0.5 ||
              box.right > innerWidth + 0.5
            )
              found.push(`${el.tagName} cut sideways`);
          }
          const code = document.querySelector('.code')?.getBoundingClientRect();
          if (
            code !== undefined &&
            (code.top < 0 || code.bottom > innerHeight || code.left < 0 || code.right > innerWidth)
          )
            found.push('pairing code not fully on screen');
          return found;
        });
        expect(problems, `${label} at ${String(width)}×${String(height)}`).toEqual([]);
      }
      await page.close();
    }
  });

  test('FCU-02: app text with an unbroken token is shown whole, also as a still ticker', async ({
    browser,
  }) => {
    const bundle = buildSync({
      entryPoints: [join(repoRoot, 'packages', 'app-render', 'src', 'index.ts')],
      bundle: true,
      format: 'iife',
      globalName: 'AppRender',
      write: false,
      logLevel: 'silent',
    }).outputFiles[0]?.text;
    expect(bundle).toBeDefined();
    const colours = { textColour: '#ffffff', backgroundColour: '#102030' };
    const contents = {
      text: {
        type: 'text',
        settings: {
          ...colours,
          heading: 'H'.repeat(60),
          body: `Visit us online at\nhttps://cdn.example.com/${'a'.repeat(237)}`,
        },
      },
      qr: {
        type: 'qr',
        settings: { ...colours, content: 'https://example.com/', caption: 'C'.repeat(80) },
      },
      ticker: {
        type: 'ticker',
        settings: { ...colours, text: `NOW SHOWING —${'S'.repeat(287)}`, speed: 'medium' },
      },
    };
    const page = await browser.newPage({ viewport: { width: 3900, height: 2200 } });
    await page.setContent('<!doctype html><body style="margin:0"></body>');
    await page.addScriptTag({ content: bundle ?? '' });
    for (const [width, height] of [
      [1920, 1080],
      [1280, 384],
      [1080, 1920],
      [3840, 2160],
    ] as const) {
      for (const [label, content] of Object.entries(contents)) {
        const cut = await page.evaluate(
          async ({ content, width, height }) => {
            document.body.replaceChildren();
            const frame = document.createElement('div');
            frame.style.cssText = `position:relative;width:${String(width)}px;height:${String(height)}px`;
            document.body.append(frame);
            const { renderApp } = (window as unknown as { AppRender: typeof AppRenderModule })
              .AppRender;
            const view = renderApp(content as never, {
              now: () => Date.UTC(2026, 10, 16, 3),
              timeZone: 'Australia/Melbourne',
              reducedMotion: true,
            });
            frame.append(view.element);
            await view.ready;
            const box = view.element.getBoundingClientRect();
            let lines = 0;
            const walker = document.createTreeWalker(view.element, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
              const range = document.createRange();
              range.selectNodeContents(node);
              for (const rect of range.getClientRects()) {
                if (
                  rect.left < box.left - 1 ||
                  rect.right > box.right + 1 ||
                  rect.top < box.top - 1 ||
                  rect.bottom > box.bottom + 1
                )
                  lines += 1;
              }
            }
            view.dispose();
            return lines;
          },
          { content, width, height },
        );
        expect(cut, `${label} at ${String(width)}×${String(height)}: lines cut`).toBe(0);
      }
    }
    await page.close();
  });
});
