/**
 * TEST-ONLY delivery route. It exists to show that publishing rules in
 * @tinnox/domain work against any route and do not depend on browser code.
 * It is not exported from the package, is not registered anywhere, and does
 * not represent NovaStar, Huidu or any other real controller.
 */
import { CapabilityProfileSchema, type CapabilityProfile, type Manifest } from '@tinnox/contracts';
import { checkCapabilities, type PublicationDraft, type PublishIssue } from '@tinnox/domain';
import type { DeliveryRoute, NormalizeStatusResult } from '../src/port.ts';

export interface FakePrepared {
  readonly kind: 'fake-package';
  readonly lines: readonly string[];
}

export function createFakeStillImageRoute(): DeliveryRoute<FakePrepared> & {
  readonly prepared: Manifest[];
} {
  const profile: CapabilityProfile = CapabilityProfileSchema.parse({
    // The contract only knows real route ids; the fake borrows one because it is never registered.
    routeId: 'browser',
    profileVersion: 1,
    label: 'The test-only still-image target',
    mediaTypes: ['image/png'],
    videoCodecs: [],
    fitModes: ['contain'],
    maxRegions: 1,
    audio: false,
    supportsContentRect: false,
    maxCanvas: { width: 1024, height: 1024 },
    maxVideoWidthPx: 1,
    maxVideoHeightPx: 1,
    maxAssetBytes: 1_000_000,
    maxItems: 3,
  });
  const prepared: Manifest[] = [];
  return {
    id: 'browser',
    prepared,
    capabilities: () => profile,
    validate: (draft: PublicationDraft): readonly PublishIssue[] =>
      checkCapabilities(draft, profile),
    prepare(manifest: Manifest): FakePrepared {
      prepared.push(manifest);
      return {
        kind: 'fake-package',
        lines: manifest.assets.map((a) => `${a.sha256} ${a.durationMs}`),
      };
    },
    normalizeStatus: (): NormalizeStatusResult => ({
      ok: false,
      message: 'the test-only target reports no status',
    }),
  };
}
