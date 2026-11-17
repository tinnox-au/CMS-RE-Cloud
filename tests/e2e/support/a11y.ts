import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Runs axe on the page as it is now and fails on serious or critical problems (missing names,
 * wrong roles, broken ARIA references, low contrast); minor and moderate findings do not fail
 * it. An automated check finds a share of what a screen reader user meets, not all of it; the
 * listening pass stays a manual step.
 */
export async function expectAccessible(page: Page, where: string): Promise<void> {
  // Measure the settled page: a dialog or menu that is still fading in has blended colours.
  // Only short entrance animations are waited for, not long or endless ones (a ticker
  // preview, a busy spinner).
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      const end = animation.effect?.getComputedTiming().endTime;
      return animation.playState !== 'running' || typeof end !== 'number' || end > 2_000;
    }),
  );
  const result = await new AxeBuilder({ page })
    // WCAG 2.2 A and AA, the level the portal aims at (docs/portal-v2/design-system.md).
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const report = blocking.map(
    (v) =>
      `${v.id} (${v.impact ?? 'unknown'}): ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(' ')} — ${n.failureSummary?.split('\n').join(' ') ?? ''}`)
        .join('\n'),
  );
  expect(report, `accessibility problems on ${where}`).toEqual([]);
}
