import type { Pool } from '@tinnox/db';
import type { DeliveryRegistry } from '@tinnox/delivery';
import type { ObjectStorage } from '@tinnox/storage';
import type { IdentityProvider } from './auth/oidc.ts';
import type { AppConfig } from './config.ts';
import type { MediaPipeline } from './media/pipeline.ts';

/** Everything a route needs. Built once in main.ts (or by a test) and passed to buildApp. */
export interface AppContext {
  readonly config: AppConfig;
  readonly pool: Pool;
  readonly storage: ObjectStorage;
  readonly delivery: DeliveryRegistry;
  readonly idp: IdentityProvider;
  readonly media: MediaPipeline;
  /** Server clock. Injected so staleness and expiry can be tested with real time arithmetic. */
  readonly now: () => Date;
  /**
   * Multiplies every request rate limit. 1 in the running service. Integration tests
   * that fire many requests from one address raise it; one test keeps 1 to prove limits work.
   */
  readonly rateLimitScale?: number;
}

/** Route-level rate limit configuration: `max` requests per minute, scaled by the context. */
export function perMinute(ctx: AppContext, max: number): { max: number; timeWindow: string } {
  return { max: Math.ceil(max * (ctx.rateLimitScale ?? 1)), timeWindow: '1 minute' };
}
