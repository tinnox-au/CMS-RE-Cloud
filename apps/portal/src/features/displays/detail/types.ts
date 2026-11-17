import type { DisplayDto, SiteDto } from '@tinnox/contracts';

export interface ScreenDetailData {
  readonly display: DisplayDto;
  /** Null when the screen's site is not among the organisation's sites. */
  readonly site: SiteDto | null;
}

/** Where a revocation was started; its outcome is shown there. */
export type RevokeOrigin = 'summary' | 'pairing';

export interface RevokeState {
  readonly origin: RevokeOrigin;
  /** The confirmation dialog is open. */
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly error: unknown;
  /** What the API answered, in words, once the revocation is done. */
  readonly result: string | null;
}

/**
 * The save state of one settings tab. The page keeps it, not the tab, because switching tabs
 * unmounts the tab: a save still running when its tab comes back must still hold the form
 * read-only, so the answer replaces only the draft it saved (FCX-03 in
 * docs/reviews/2026-11-17-frontend-round-2), and a failure must still be shown.
 */
export interface SectionSave {
  readonly saving: boolean;
  readonly error: unknown;
  readonly setSaving: (saving: boolean) => void;
  readonly setError: (error: unknown) => void;
}
