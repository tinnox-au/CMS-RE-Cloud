import type {
  Canvas,
  CapabilityProfile,
  DeliveryRouteId,
  FitMode,
  MediaKind,
  MediaMimeType,
  MediaStatus,
  PublishRejectionCode,
  Rect,
  Rotation,
  Transition,
  WorkingHours,
} from '@tinnox/contracts';

/** The facts about a display that publishing needs. */
export interface DisplayTarget {
  readonly id: string;
  readonly canvas: Canvas;
  readonly contentRect: Rect | null;
  readonly defaultFit: FitMode;
  readonly route: DeliveryRouteId;
  readonly rotation: Rotation;
  readonly workingHours: WorkingHours | null;
  /** IANA zone of the display's site. */
  readonly timeZone: string;
}

/** The facts about a media record that playlist rules need (a subset of MediaDto). */
export interface MediaRecord {
  readonly id: string;
  readonly kind: MediaKind;
  readonly status: MediaStatus;
  readonly mimeType: MediaMimeType | null;
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
  readonly codec: string | null;
  /** Availability window, wall clock YYYY-MM-DDTHH:mm in each screen's site zone. */
  readonly availableFrom: string | null;
  readonly availableUntil: string | null;
}

export interface DraftItem {
  readonly mediaId: string;
  readonly durationMs: number | null;
  readonly fit: FitMode | null;
}

/** One problem found while validating or publishing. `index` is the playlist position, or null for a whole-playlist problem. */
export interface PublishIssue {
  readonly index: number | null;
  readonly code: PublishRejectionCode;
  /** Complete sentence suitable for an operator. */
  readonly message: string;
}

/** A fully resolved playlist entry: everything a route needs to judge and deliver it. */
export interface ResolvedItem {
  readonly assetId: string;
  readonly kind: MediaKind;
  readonly mediaType: MediaMimeType;
  readonly codec: string | null;
  readonly bytes: number;
  readonly sha256: string;
  readonly durationMs: number;
  readonly fit: FitMode;
  readonly width: number;
  readonly height: number;
  readonly availableFrom: string | null;
  readonly availableUntil: string | null;
}

/** Playlist options carried into a publication. */
export interface PlaybackOptions {
  readonly transition: Transition;
  readonly shuffle: boolean;
}

/**
 * Vendor-neutral description of what is about to be published. It carries no
 * route-specific data; a delivery route validates it against its capability profile.
 */
export interface PublicationDraft {
  readonly displayId: string;
  readonly canvas: Canvas;
  readonly contentRect: Rect | null;
  /** M0 publishes single-region, muted playlists only. Modelled explicitly so a route can refuse otherwise. */
  readonly regions: 1;
  readonly audio: false;
  readonly items: readonly ResolvedItem[];
  readonly transition: Transition;
  readonly shuffle: boolean;
  readonly rotation: Rotation;
  readonly workingHours: WorkingHours | null;
  readonly timeZone: string;
}

/**
 * The part of a delivery route that publishing depends on. Declared here so
 * that the domain never imports a delivery implementation; every DeliveryRoute
 * in @tinnox/delivery satisfies it structurally.
 */
export interface PublicationValidator {
  capabilities(): CapabilityProfile;
  validate(draft: PublicationDraft): readonly PublishIssue[];
}
