import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from 'vitest-browser-react';
import { REFRESH_RETRY_MAX_MS, REFRESH_RETRY_MS, useLoad } from './useLoad.ts';

interface Data {
  readonly processing: boolean;
}

type Poll = number | null | ((data: Data) => number | null);

const POLL_MS = 2_000;
const IDLE: Data = { processing: false };
const BUSY: Data = { processing: true };
const pollWhileProcessing = (data: Data) => (data.processing ? POLL_MS : null);

const load = vi.fn<(signal: AbortSignal) => Promise<Data>>();

async function mount(poll: Poll) {
  const hook = await renderHook(() => useLoad(load, poll));
  await advance(hook, 0);
  return hook;
}

/** Moves the fake clock on and lets the reads it starts settle. */
async function advance(hook: { act: (callback: () => unknown) => Promise<void> }, ms: number) {
  await hook.act(() => vi.advanceTimersByTimeAsync(ms));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(async () => {
  await cleanup();
  vi.useRealTimers();
  load.mockReset();
});

describe('useLoad: a failed first read after reload() with a function poll', () => {
  it('retries after the back-off and polls again while something is processing', async () => {
    load.mockResolvedValueOnce(IDLE).mockRejectedValueOnce(new Error('read failed'));
    const hook = await mount(pollWhileProcessing);
    await hook.act(() => hook.result.current.reload());
    await advance(hook, 0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(hook.result.current.state).toMatchObject({
      status: 'ready',
      data: IDLE,
      refreshError: expect.any(Error) as Error,
    });

    // A retry that fails again doubles the back-off.
    load.mockRejectedValueOnce(new Error('read failed'));
    await advance(hook, REFRESH_RETRY_MS - 1);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(hook, 1);
    expect(load).toHaveBeenCalledTimes(3);

    load.mockResolvedValueOnce(BUSY);
    await advance(hook, REFRESH_RETRY_MS * 2 - 1);
    expect(load).toHaveBeenCalledTimes(3);
    await advance(hook, 1);
    expect(load).toHaveBeenCalledTimes(4);
    expect(hook.result.current.state).toMatchObject({ data: BUSY, refreshError: null });

    load.mockResolvedValueOnce(IDLE);
    await advance(hook, POLL_MS);
    expect(load).toHaveBeenCalledTimes(5);
    await advance(hook, 60_000);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('stops after the retry when nothing is processing', async () => {
    load
      .mockResolvedValueOnce(IDLE)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(IDLE);
    const hook = await mount(pollWhileProcessing);
    await hook.act(() => hook.result.current.reload());
    await advance(hook, REFRESH_RETRY_MS);
    expect(load).toHaveBeenCalledTimes(3);
    expect(hook.result.current.state).toMatchObject({ data: IDLE, refreshError: null });
    await advance(hook, 60_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('also retries when the data shown came from setData', async () => {
    load.mockRejectedValueOnce(new Error('read failed')).mockRejectedValueOnce(new Error('again'));
    const hook = await mount(pollWhileProcessing);
    await hook.act(() => hook.result.current.setData(IDLE));
    await hook.act(() => hook.result.current.reload());
    await advance(hook, 0);
    expect(load).toHaveBeenCalledTimes(2);
    load.mockResolvedValueOnce(IDLE);
    await advance(hook, REFRESH_RETRY_MS);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe('useLoad: the retry back-off', () => {
  it('doubles while re-reads keep failing, up to the maximum', async () => {
    load.mockResolvedValueOnce(IDLE).mockRejectedValue(new Error('read failed'));
    const hook = await mount(pollWhileProcessing);
    await hook.act(() => hook.result.current.reload());
    await advance(hook, 0);
    let calls = 2;
    for (const wait of [
      5_000,
      10_000,
      20_000,
      40_000,
      REFRESH_RETRY_MAX_MS,
      REFRESH_RETRY_MAX_MS,
    ]) {
      await advance(hook, wait - 1);
      expect(load).toHaveBeenCalledTimes(calls);
      await advance(hook, 1);
      calls += 1;
      expect(load).toHaveBeenCalledTimes(calls);
    }
  });
});

describe('useLoad: behaviour the retry leaves alone', () => {
  it('keeps a known function-poll rhythm after a failed routine tick', async () => {
    load
      .mockResolvedValueOnce(BUSY)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValue(BUSY);
    const hook = await mount(pollWhileProcessing);
    await advance(hook, POLL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(hook.result.current.state).toMatchObject({ refreshError: expect.any(Error) as Error });
    await advance(hook, POLL_MS);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not retry a failed first load with a function or no poll', async () => {
    for (const poll of [pollWhileProcessing, null]) {
      load.mockReset();
      load.mockRejectedValueOnce(new Error('read failed'));
      const hook = await mount(poll);
      expect(hook.result.current.state).toMatchObject({ status: 'error' });
      await advance(hook, 60_000);
      expect(load).toHaveBeenCalledTimes(1);
      await hook.unmount();
    }
  });

  it('keeps a fixed poll at its own interval after a failed read, even a first one', async () => {
    load.mockRejectedValueOnce(new Error('read failed')).mockResolvedValue(IDLE);
    const hook = await mount(1_000);
    expect(hook.result.current.state).toMatchObject({ status: 'error' });
    await advance(hook, 1_000);
    expect(load).toHaveBeenCalledTimes(2);

    load.mockRejectedValueOnce(new Error('read failed'));
    await hook.act(() => hook.result.current.reload());
    await advance(hook, 0);
    expect(load).toHaveBeenCalledTimes(3);
    await advance(hook, 1_000);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('does not poll or retry without a poll', async () => {
    load.mockResolvedValueOnce(IDLE).mockRejectedValueOnce(new Error('read failed'));
    const hook = await mount(null);
    await hook.act(() => hook.result.current.reload());
    await advance(hook, 60_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(hook.result.current.state).toMatchObject({ status: 'ready', data: IDLE });
  });
});
