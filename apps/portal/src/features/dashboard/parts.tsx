import { useEffect, useState, type ReactNode } from 'react';
import { isApiRequestError } from '../../api/client.ts';
import { Banner, Button, Skeleton, SkeletonGroup } from '../../ui/index.ts';
import { RefreshCw } from '../../ui/icons.ts';

/**
 * The wall clock, read again every `intervalMs`. Audit times are wall-clock times, so they
 * are compared with `Date.now()`, not with `performance.now()`.
 */
export function useWallClock(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

/** The message of whatever was thrown, and its API error code when it has one. */
export function errorText(error: unknown): {
  readonly message: string;
  readonly code: string | null;
} {
  if (isApiRequestError(error)) return { message: error.message, code: error.code };
  if (error instanceof Error) return { message: error.message, code: null };
  return { message: 'An unexpected error occurred.', code: null };
}

interface StaleNoticeProps {
  /** The first error of a refresh that did not complete. */
  readonly error: unknown;
  /** "45 seconds ago": when the oldest figure on the page was read. */
  readonly age: string | null;
  readonly onRetry: () => void;
}

/**
 * Says that a refresh did not complete while the last figures stay on the page. A warning,
 * not an alert: nothing was lost, the figures are only older than they look.
 */
export function StaleNotice({ error, age, onRetry }: StaleNoticeProps) {
  const { message, code } = errorText(error);
  return (
    <Banner
      tone="warn"
      live="polite"
      title="Some figures may be out of date"
      className="tx-dashboard-stale"
      actions={
        <Button size="sm" icon={RefreshCw} onClick={onRetry} data-testid="dashboard-stale-retry">
          Try again
        </Button>
      }
    >
      <p data-testid="dashboard-stale">
        The last refresh did not complete: {message}{' '}
        {code !== null && <span className="tx-code">{code}</span>}
        {age !== null && <> The figures shown were read {age}.</>}
      </p>
    </Banner>
  );
}

/** Skeleton lines for a card that is still loading. */
export function CardSkeleton({
  label,
  lines = 3,
  children,
}: {
  readonly label: string;
  readonly lines?: number;
  readonly children?: ReactNode;
}) {
  return (
    <SkeletonGroup label={label} className="tx-stack tx-stack--tight">
      {children}
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index % 2 === 0 ? '88%' : '64%'} />
      ))}
    </SkeletonGroup>
  );
}
