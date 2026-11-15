import type {
  CapabilityProfile,
  DeliveryRouteId,
  HeartbeatV1,
  ManifestV1,
} from '@tinnox/contracts';
import type { PublicationDraft, PublicationValidator, PublishIssue } from '@tinnox/domain';

/**
 * Route-neutral status report. In M0 the neutral form is the heartbeat v1
 * document; a later route maps whatever its target exposes onto the same fields.
 */
export type NormalizedDeliveryReport = HeartbeatV1;

export type NormalizeStatusResult =
  | {
      readonly ok: true;
      readonly report: NormalizedDeliveryReport;
      /**
       * What kind of evidence the report is. `player_software` means the player
       * program said so; it is never proof of what a physical panel shows.
       */
      readonly evidence: 'player_software';
    }
  | { readonly ok: false; readonly message: string };

/**
 * Delivery port (prototype-m0.md D15): how a publication reaches one kind of
 * target and what that target can acknowledge. Deliberately small. Controller
 * commands (brightness, power, hardware configuration) are not part of it.
 *
 * TPrepared is the route-specific form of a publication, produced by `prepare`.
 */
export interface DeliveryRoute<TPrepared = unknown> extends PublicationValidator {
  readonly id: DeliveryRouteId;
  /** What this route can show. Static for a given route version. */
  capabilities(): CapabilityProfile;
  /** Reasons this route cannot deliver the draft; empty when it can. Must not have side effects. */
  validate(draft: PublicationDraft): readonly PublishIssue[];
  /** Converts an immutable manifest into what this route hands to its target. Must not mutate the manifest. */
  prepare(manifest: ManifestV1): TPrepared;
  /** Validates and converts an untrusted status report from the target into the neutral form. */
  normalizeStatus(report: unknown): NormalizeStatusResult;
}
