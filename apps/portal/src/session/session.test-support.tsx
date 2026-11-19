import { DEFAULT_LIMITS, type Role } from '@tinnox/contracts';
import { permissionsOf } from '@tinnox/domain';
import { useMemo, type ReactNode } from 'react';
import { AuthenticatedProvider, type AuthenticatedSession } from './AuthenticatedSession.tsx';

/** The membership id of every test session. */
export const TEST_MEMBERSHIP_ID = '99999999-9999-4999-8999-999999999999';
const TEST_ORG_ID = '88888888-8888-4888-8888-888888888888';

/** A signed-in session for `role`, with that role's keys; `overrides` replaces top-level fields. */
export function sessionFor(
  role: Role,
  overrides: Partial<AuthenticatedSession> = {},
): AuthenticatedSession {
  return {
    authenticated: true,
    user: {
      membershipId: TEST_MEMBERSHIP_ID,
      displayName: 'Test person',
      role,
      permissions: permissionsOf(role),
    },
    organization: { id: TEST_ORG_ID, name: 'Test organisation' },
    csrfToken: 'csrf-token-test-aaaaaaaaaaaa',
    expiresAt: '2026-11-14T10:00:00.000Z',
    limits: DEFAULT_LIMITS,
    ...overrides,
  };
}

/** Renders `children` signed in as `role`. Every component test of a gated component uses it. */
export function WithSession({
  role,
  children,
}: {
  readonly role: Role;
  readonly children: ReactNode;
}) {
  const session = useMemo(() => sessionFor(role), [role]);
  return <AuthenticatedProvider session={session}>{children}</AuthenticatedProvider>;
}
