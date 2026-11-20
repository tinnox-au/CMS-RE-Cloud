/**
 * The /api routes the application serves, written out for the boundary tests
 * (session-csrf.test.ts, roles-matrix.test.ts). Not read from the API's own tables, so a route
 * the API adds or drops shows up here as a test failure.
 */
import { ROUTES } from '@tinnox/contracts';

/**
 * Every route of the operator API, as registered (`:id` is a UUID): the 51 of portal v2 and the
 * 8 people routes of stage C (CMS-13). session-csrf.test.ts fails when the application serves
 * an operator route that is not listed here, so a new route cannot skip the session, CSRF,
 * Origin and role checks unnoticed.
 */
export const OPERATOR_ROUTE_PATTERNS: readonly (readonly [string, string])[] = [
  ['GET', '/api/sites'],
  ['GET', '/api/displays'],
  ['POST', '/api/displays'],
  ['GET', '/api/displays/status'],
  ['GET', '/api/displays/:id'],
  ['PATCH', '/api/displays/:id'],
  ['POST', '/api/displays/:id/claim'],
  ['POST', '/api/displays/:id/revoke-player'],
  ['GET', '/api/displays/:id/status'],
  ['GET', '/api/media'],
  ['POST', '/api/media'],
  ['GET', '/api/media/:id'],
  ['PATCH', '/api/media/:id'],
  ['DELETE', '/api/media/:id'],
  ['GET', '/api/media/:id/preview'],
  ['GET', '/api/media/:id/thumbnail'],
  ['GET', '/api/media/:id/usage'],
  ['GET', '/api/apps'],
  ['POST', '/api/apps'],
  ['GET', '/api/apps/:id'],
  ['PATCH', '/api/apps/:id'],
  ['DELETE', '/api/apps/:id'],
  ['GET', '/api/schedules'],
  ['POST', '/api/schedules'],
  ['GET', '/api/schedules/:id'],
  ['PUT', '/api/schedules/:id'],
  ['DELETE', '/api/schedules/:id'],
  ['GET', '/api/layouts'],
  ['POST', '/api/layouts'],
  ['GET', '/api/layouts/:id'],
  ['PUT', '/api/layouts/:id'],
  ['DELETE', '/api/layouts/:id'],
  ['GET', '/api/tags'],
  ['POST', '/api/tags'],
  ['PATCH', '/api/tags/:id'],
  ['DELETE', '/api/tags/:id'],
  ['GET', '/api/folders'],
  ['POST', '/api/folders'],
  ['PATCH', '/api/folders/:id'],
  ['DELETE', '/api/folders/:id'],
  ['GET', '/api/playlists'],
  ['POST', '/api/playlists'],
  ['GET', '/api/playlists/:id'],
  ['PUT', '/api/playlists/:id'],
  ['DELETE', '/api/playlists/:id'],
  ['POST', '/api/playlists/:id/duplicate'],
  ['POST', '/api/playlists/:id/publish'],
  ['GET', '/api/push'],
  ['POST', '/api/push'],
  ['GET', '/api/overview'],
  ['GET', '/api/audit'],
  ['GET', '/api/members'],
  ['GET', '/api/members/names'],
  ['PATCH', '/api/members/:id'],
  ['POST', '/api/members/:id/remove'],
  ['POST', '/api/members/:id/sign-out'],
  ['GET', '/api/invites'],
  ['POST', '/api/invites'],
  ['POST', '/api/invites/:id/cancel'],
];

/** Routes under /api that deliberately work without an operator session. */
export const PUBLIC_API_ROUTES: readonly (readonly [string, string])[] = [
  ['GET', ROUTES.authLogin],
  ['GET', ROUTES.authCallback],
  ['GET', ROUTES.session],
];

/** Signing out needs the session, the token and the Origin, but is not in the operator plugin. */
export const LOGOUT: readonly [string, string] = ['POST', ROUTES.authLogout];

/** The operator routes with `:id` replaced by `id`. */
export function operatorRoutes(id: string): [string, string][] {
  return OPERATOR_ROUTE_PATTERNS.map(([method, pattern]) => [method, pattern.replace(':id', id)]);
}
