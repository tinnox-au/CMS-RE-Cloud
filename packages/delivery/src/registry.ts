import type { DeliveryRouteId } from '@tinnox/contracts';
import { createBrowserRoute, type BrowserRouteOptions } from './browser/browser-route.ts';
import type { DeliveryRoute } from './port.ts';

export interface DeliveryRegistryOptions {
  readonly browser?: BrowserRouteOptions;
}

export interface DeliveryRegistry {
  /** Returns the route for a display. Throws for an id that has no implementation. */
  get(routeId: DeliveryRouteId): DeliveryRoute;
  ids(): readonly DeliveryRouteId[];
}

/**
 * The routes that exist in the product. M0 implements `browser` only; no
 * LED-controller route is registered, and no stand-in for one may be added here.
 */
export function createDeliveryRegistry(options: DeliveryRegistryOptions = {}): DeliveryRegistry {
  const routes = new Map<DeliveryRouteId, DeliveryRoute>([
    ['browser', createBrowserRoute(options.browser)],
  ]);
  return Object.freeze({
    get(routeId: DeliveryRouteId): DeliveryRoute {
      const route = routes.get(routeId);
      if (route === undefined) {
        throw new Error(`no delivery route is implemented for "${String(routeId)}"`);
      }
      return route;
    },
    ids(): readonly DeliveryRouteId[] {
      return [...routes.keys()];
    },
  });
}
