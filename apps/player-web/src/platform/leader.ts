/**
 * Only one tab of this origin may run the player (sync, heartbeat, playback,
 * storage writes). The others wait and take over when the running tab goes away.
 *
 * Preferred mechanism: the Web Locks API (the lock is released by the browser when
 * the tab closes or crashes). Fallback: an election over BroadcastChannel. Without
 * either, the tab runs alone and says so in the diagnostics.
 */
export type LeadershipMode = 'web-locks' | 'broadcast-channel' | 'unguarded';

const LOCK_NAME = 'tinnox-player-leader';
const CHANNEL_NAME = 'tinnox-player-leader';
const WAITING_NOTICE_MS = 400;
const ELECTION_WINDOW_MS = 500;
const ELECTION_RETRY_MS = 4_000;

type ElectionMessage =
  | { readonly type: 'claim'; readonly id: string }
  | { readonly type: 'leader'; readonly id: string }
  | { readonly type: 'released'; readonly id: string };

function isElectionMessage(value: unknown): value is ElectionMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; id?: unknown };
  return (
    typeof candidate.id === 'string' &&
    (candidate.type === 'claim' || candidate.type === 'leader' || candidate.type === 'released')
  );
}

/** Resolves when this tab is the one that runs the player. `onWaiting` fires if it has to wait. */
export async function acquireLeadership(onWaiting: () => void): Promise<LeadershipMode> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    await new Promise<void>((resolve) => {
      const notice = setTimeout(onWaiting, WAITING_NOTICE_MS);
      void navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, () => {
        clearTimeout(notice);
        resolve();
        // Hold the lock for the life of the page.
        return new Promise<never>(() => undefined);
      });
    });
    return 'web-locks';
  }
  if (typeof BroadcastChannel !== 'undefined') {
    await electOverBroadcastChannel(onWaiting);
    return 'broadcast-channel';
  }
  return 'unguarded';
}

function electOverBroadcastChannel(onWaiting: () => void): Promise<void> {
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const id = crypto.randomUUID();
  let leader = false;
  let sawLeader = false;
  let sawStrongerClaim = false;
  let retry: ReturnType<typeof setTimeout> | null = null;

  return new Promise<void>((resolve) => {
    const attempt = (): void => {
      sawLeader = false;
      sawStrongerClaim = false;
      channel.postMessage({ type: 'claim', id } satisfies ElectionMessage);
      setTimeout(() => {
        if (leader) return;
        if (!sawLeader && !sawStrongerClaim) {
          leader = true;
          channel.postMessage({ type: 'leader', id } satisfies ElectionMessage);
          resolve();
          return;
        }
        onWaiting();
        retry = setTimeout(attempt, ELECTION_RETRY_MS + Math.random() * 1_000);
      }, ELECTION_WINDOW_MS);
    };

    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isElectionMessage(message) || message.id === id) return;
      if (leader) {
        if (message.type === 'claim') {
          channel.postMessage({ type: 'leader', id } satisfies ElectionMessage);
        }
        return;
      }
      if (message.type === 'leader') sawLeader = true;
      else if (message.type === 'claim' && message.id < id) sawStrongerClaim = true;
      else if (message.type === 'released') {
        if (retry !== null) clearTimeout(retry);
        retry = setTimeout(attempt, Math.random() * 300);
      }
    });

    addEventListener('pagehide', () => {
      if (leader) channel.postMessage({ type: 'released', id } satisfies ElectionMessage);
    });

    attempt();
  });
}
