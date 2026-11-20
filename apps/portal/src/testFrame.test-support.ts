import { userEvent } from 'vitest/browser';

/** What the Playwright provider throws while its view of the test frames is out of date. */
const FRAME_NOT_READY = ['Frame was detached', 'Cannot find "vitest-iframe"'];

/**
 * Waits until the browser provider reaches this test file's frame. Registered for every
 * component test file by componentTests.setup.ts (vitest.config.ts, `setupFiles`).
 *
 * Component test files run one after another in the same browser page, each in a new frame.
 * Before every click and key, the Playwright provider looks the test frame up by its name
 * (`focusIframe` in @vitest/browser-playwright). Just after a file starts, and more often when
 * the machine is busy, that lookup can still find the previous file's frame, which is going
 * away ("frame.evaluate: Frame was detached"), or no frame of that name yet. The file's first
 * click or key then fails, whatever the test is about. A Shift press runs the same lookup and
 * changes nothing on a page with nothing rendered yet, so it is tried until the lookup works.
 */
export async function settleTestFrame(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await userEvent.keyboard('{Shift}');
      return;
    } catch (error) {
      const text = String(error);
      if (attempt >= 10 || !FRAME_NOT_READY.some((part) => text.includes(part))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
