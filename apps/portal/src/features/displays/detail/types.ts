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
