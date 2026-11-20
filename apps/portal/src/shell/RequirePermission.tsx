import type { PermissionKey } from '@tinnox/contracts';
import type { ReactNode } from 'react';
import { useCan } from '../session/AuthenticatedSession.tsx';
import { ForbiddenPage } from './ForbiddenPage.tsx';

/**
 * Renders a page only for a member whose role holds `permission`, and the "Your role doesn't
 * allow this" page otherwise. A convenience: the API refuses the page's requests anyway.
 */
export function RequirePermission({
  permission,
  children,
}: {
  readonly permission: PermissionKey;
  readonly children: ReactNode;
}) {
  return useCan(permission) ? children : <ForbiddenPage />;
}
