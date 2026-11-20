/**
 * Roles and people (CMS-13, docs/portal-v2/stage-c.md section 9.6; acceptance test ISO-05),
 * with the seeded Owner (`operator`, in the run's saved session when it is still live) and
 * fresh sign-ins of the seeded Admin, Editor and Viewer of "TINNOX Internal", each through
 * Keycloak with their own one-time code. A Viewer sees no
 * control that changes anything and the API refuses their writes; an Editor works with
 * content but not with people; an Admin manages Editors and Viewers only. The Owner demotes
 * the Editor while their playlist is open, and later signs them out everywhere: each time the
 * Editor's next request meets an ended session, and Keycloak asks for the password and a
 * fresh one-time code although its own session is alive. The tests run in order and end with
 * the seeded roles restored.
 */
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIResponse, type Page, type Request } from '@playwright/test';
import { inviteReference, type InviteDto, type MemberDto, type Role } from '@tinnox/contracts';
import { encodePng } from '../support/png.ts';
import { operatorSession, type OperatorSession } from './support/contexts.ts';
import { reauthenticate, type OperatorApi } from './support/operator.ts';
import {
  addToPlaylist,
  assignFromEditor,
  changeRole,
  closeAddMedia,
  createPlaylistInPortal,
  cspViolations,
  expectNoWebStorage,
  invitePerson,
  mediaRow,
  mediaStatus,
  notifications,
  openScreenPage,
  openUsers,
  pageHeading,
  pushFromHeader,
  savePlaylistDraft,
  scrollsSideways,
  signOutEverywhere,
  signOutFromAccountMenu,
  uploadInLibrary,
  watchCspViolations,
} from './support/portal.ts';
import { PORTAL_URL, runDir } from './support/stack.ts';

test.describe.configure({ mode: 'serial' });

const runId = randomUUID().slice(0, 8);

/** The seeded people of "TINNOX Internal" and their roles (scripts/seed.ts, `SEED.primary`). */
const OWNER = 'Dev Owner';
const ADMIN = 'Dev Admin';
const EDITOR = 'Dev Editor';
const VIEWER = 'Dev Viewer';
const SEEDED_ROLES: readonly (readonly [string, Role])[] = [
  [OWNER, 'owner'],
  [ADMIN, 'admin'],
  [EDITOR, 'editor'],
  [VIEWER, 'viewer'],
];

/** Audit categories only the full log (`audit.read`) offers (section 1.5). */
const FULL_LOG_ONLY = ['Sign-in and sign-out', 'Security', 'Invites', 'People'];
/** The guard page's title (shell/ForbiddenPage.tsx). */
const ROLE_PAGE = "Your role doesn't allow this";
/** The sign-in screen after a 401 (shell/Screens.tsx). */
const SESSION_ENDED = 'Your session has ended. Sign in again to continue.';

const imageName = `E2E roles ${runId}.png`;
const viewPlaylistName = `E2E roles view ${runId}`;
const waitingScreenName = `E2E roles waiting ${runId}`;
const pushScreenName = `E2E roles push ${runId}`;
const editorImageName = `E2E roles editor ${runId}.png`;
const editorPlaylistName = `E2E roles editor ${runId}`;

let owner: OperatorSession;
let admin: OperatorSession;
let editor: OperatorSession;
let viewer: OperatorSession;
let viewPlaylistId = '';
let waitingScreenId = '';
let pushScreenId = '';
let editorPlaylistId = '';
/** Names of the invites this run requests; the last test cancels those still waiting. */
const inviteNames: string[] = [];

async function listMembers(api: OperatorApi): Promise<MemberDto[]> {
  const response = await api.get('/api/members');
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { items: MemberDto[] }).items;
}

async function listInvites(api: OperatorApi): Promise<InviteDto[]> {
  const response = await api.get('/api/invites');
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { items: InviteDto[] }).items;
}

async function inviteNamed(api: OperatorApi, name: string): Promise<InviteDto> {
  const invite = (await listInvites(api)).find((item) => item.name === name);
  if (invite === undefined) throw new Error(`no invite for "${name}" is waiting`);
  return invite;
}

/** The answer to a request the role does not allow (section 1.6). */
async function expectRefusedByRole(response: APIResponse, what: string): Promise<void> {
  expect(response.status(), `${what}: ${await response.text()}`).toBe(403);
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error, what).toMatchObject({
    code: 'forbidden',
    message: "Your role doesn't allow this.",
  });
}

/** Opens the audit page and returns the labels of its category filter. */
async function auditCategories(page: Page): Promise<string[]> {
  await page.goto(`${PORTAL_URL}/audit`);
  await expect(pageHeading(page, 'Audit log')).toBeVisible();
  const select = page.getByTestId('audit-filter-category');
  await expect(select).toBeVisible();
  return (await select.locator('option').allTextContents()).map((label) => label.trim());
}

/** Opens the account menu, checks whether it offers Users, and closes it again. */
async function expectUsersInAccountMenu(page: Page, offered: boolean): Promise<void> {
  await page.getByTestId('account-menu').click();
  await expect(page.getByRole('menuitem', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Users', exact: true })).toHaveCount(
    offered ? 1 : 0,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem', { name: 'Audit log' })).toBeHidden();
}

/**
 * Saves the Editor's browser state again after a re-authentication, owner-only as
 * operatorSession() does. The state saved in beforeAll holds a session the demotion ended,
 * so without this global teardown would skip the live one if a later test failed.
 */
async function saveEditorState(): Promise<void> {
  const path = join(runDir, 'state-editor.json');
  await editor.context.storageState({ path });
  chmodSync(path, 0o600);
}

/**
 * Puts back what the seed made: each seeded person in their seeded role, and no invite of
 * this run waiting. The last test runs it and checks the outcome; afterAll runs it again, so
 * a run that failed half-way still leaves the seeded roles for the next one.
 */
async function restoreSeededState(): Promise<void> {
  const members = await listMembers(owner.api);
  for (const [name, role] of SEEDED_ROLES) {
    const member = members.find((item) => item.displayName === name);
    if (member === undefined || member.removedAt !== null || member.role === role) continue;
    const response = await owner.api.patch(`/api/members/${member.id}`, { role });
    expect(response.status(), await response.text()).toBe(200);
  }
  for (const invite of await listInvites(owner.api)) {
    if (!inviteNames.includes(invite.name)) continue;
    const response = await owner.api.post(`/api/invites/${invite.id}/cancel`);
    expect(response.status(), await response.text()).toBe(204);
  }
}

test.beforeAll(async ({ browser }) => {
  // The Owner reuses the run's saved session, so global teardown still signs that one out.
  // The others sign in afresh with their own one-time code: the Editor's re-authentications
  // below need Keycloak's own session cookie in this browser context.
  owner = await operatorSession(browser, 'operator');
  admin = await operatorSession(browser, 'admin', { fresh: true });
  editor = await operatorSession(browser, 'editor', { fresh: true });
  viewer = await operatorSession(browser, 'viewer', { fresh: true });
  for (const session of [owner, admin, editor, viewer]) await watchCspViolations(session.page);

  // Made by the Owner through the API: a playlist with one image, assigned to a screen that
  // was never pushed (so at least one screen waits), and a screen for the Editor's push.
  const png = encodePng(64, 36, (x, y) => [x * 4, y * 7, 90]);
  const image = await owner.api.uploadReady(imageName, 'image/png', png);
  viewPlaylistId = (await owner.api.createPlaylist(viewPlaylistName)).id;
  await owner.api.savePlaylist(viewPlaylistId, viewPlaylistName, [
    { mediaId: image.id, durationMs: 8_000, fit: null },
  ]);
  waitingScreenId = (
    await owner.api.createDisplay({
      name: waitingScreenName,
      canvas: { width: 1920, height: 1080 },
    })
  ).id;
  const assigned = await owner.api.patch(`/api/displays/${waitingScreenId}`, {
    assignedPlaylistId: viewPlaylistId,
  });
  expect(assigned.status(), await assigned.text()).toBe(200);
  pushScreenId = (
    await owner.api.createDisplay({ name: pushScreenName, canvas: { width: 1280, height: 720 } })
  ).id;
});

test.afterAll(async () => {
  try {
    await restoreSeededState();
  } catch (error) {
    console.warn(
      `could not restore the seeded roles: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
  // beforeAll may have failed before every person signed in.
  for (const session of [owner, admin, editor, viewer] as (OperatorSession | undefined)[]) {
    await session?.context.close();
  }
});

test('a Viewer sees no control that changes anything, and the API refuses their writes', async () => {
  const page = viewer.page;

  // Dashboard: no "Push to screens"; the waiting screens are a chip that leads to the list.
  const plan = (await (await viewer.api.get('/api/push')).json()) as { pendingCount: number };
  expect(plan.pendingCount).toBeGreaterThan(0);
  await page.goto(`${PORTAL_URL}/dashboard`);
  await expect(pageHeading(page, 'Dashboard')).toBeVisible();
  const chip = page.getByTestId('push-waiting');
  await expect(chip).toHaveText(new RegExp(`\\b${plan.pendingCount} screens? waiting`));
  await expect(chip).toHaveAttribute('href', '/dashboard');
  await expect(page.getByTestId('push-button')).toHaveCount(0);
  await expect(page.getByTestId('dashboard-push')).toBeVisible();
  await expect(page.getByTestId('dashboard-push-review')).toHaveCount(0);

  // Media: the file is listed, with no "Add media" and no row menu. (The lists are searched:
  // earlier specs of the run leave more than a page of media and screens.)
  await page.goto(`${PORTAL_URL}/media`);
  await page.getByTestId('media-library-search').fill(imageName);
  const imageRow = mediaRow(page, imageName);
  await expect(imageRow).toHaveCount(1);
  await expect(page.getByTestId('media-library-add')).toHaveCount(0);
  await expect(imageRow.getByTestId('media-library-row-menu')).toHaveCount(0);

  // Screens: the screens are listed (so the empty text does not show), with no "Add screen".
  await page.goto(`${PORTAL_URL}/screens`);
  await page.getByTestId('screens-search').fill(waitingScreenName);
  const screenRow = page.getByTestId(`screens-row-${waitingScreenId}`);
  await expect(screenRow).toContainText(waitingScreenName);
  await expect(page.getByTestId('screens-add')).toHaveCount(0);
  await expect(screenRow.getByTestId('screens-row-menu')).toHaveCount(0);

  // A playlist opens read-only: the note, no save bar, no library, no "Push now".
  await page.goto(`${PORTAL_URL}/playlists/${viewPlaylistId}`);
  await expect(page.getByTestId('playlist-editor')).toBeVisible();
  await expect(page.getByText('You can view this playlist. Editors make changes.')).toBeVisible();
  await expect(page.getByTestId('playlist-editor-name')).not.toBeEditable();
  await expect(page.getByTestId('playlist-editor-save')).toHaveCount(0);
  await expect(page.getByTestId('playlist-editor-library')).toHaveCount(0);
  await expect(page.getByTestId('playlist-editor-push-now')).toHaveCount(0);

  // Canvas tab: locked, and neither Enter in Width nor a direct submit sends a PATCH. (The
  // playlist editor has no form, so this is where a submission could have sent a request.)
  await openScreenPage(page, waitingScreenId, 'canvas');
  await expect(page.getByText('Editors change the canvas.')).toBeVisible();
  await expect(page.getByTestId('screen-detail-canvas-save')).toHaveCount(0);
  const width = page.getByTestId('screen-detail-canvas-width');
  await expect(width).not.toBeEditable();
  const patches: string[] = [];
  const recordPatch = (request: Request): void => {
    if (request.method() === 'PATCH') patches.push(request.url());
  };
  page.on('request', recordPatch);
  await width.press('Enter');
  // Enter alone cannot submit: the read-only form has no submit button and two text fields.
  // Submitting it directly leaves the handler's read-only guard as the only thing in the way.
  await page.getByTestId('screen-detail-canvas-form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
  await page.waitForTimeout(1_500);
  page.off('request', recordPatch);
  expect(patches).toEqual([]);

  // Pages the role does not open, and the account menu without Users.
  for (const path of ['/screens/new', '/users']) {
    await page.goto(`${PORTAL_URL}${path}`);
    await expect(pageHeading(page, ROLE_PAGE), path).toBeVisible();
  }
  await expectUsersInAccountMenu(page, false);

  // Audit: the content and screen categories only.
  const categories = await auditCategories(page);
  expect(categories).toContain('Screens');
  for (const label of FULL_LOG_ONLY) expect(categories).not.toContain(label);
  await expect(
    page.getByText('Content and screen events in this organisation: who changed what, and when.'),
  ).toBeVisible();

  // The API refuses the writes the page hides, with the Viewer's own session and CSRF token.
  await expectRefusedByRole(
    await viewer.api.post('/api/playlists', { name: `E2E refused ${runId}` }),
    'POST /api/playlists',
  );
  await expectRefusedByRole(
    await viewer.api.put(`/api/playlists/${viewPlaylistId}`, { name: 'Taken', items: [] }),
    'PUT /api/playlists/:id',
  );
  await expectRefusedByRole(
    await viewer.api.patch(`/api/displays/${waitingScreenId}`, { name: 'Taken' }),
    'PATCH /api/displays/:id',
  );
  await expectRefusedByRole(
    await viewer.api.post(
      '/api/push',
      { displayIds: [waitingScreenId] },
      { 'idempotency-key': randomUUID() },
    ),
    'POST /api/push',
  );
  await expectRefusedByRole(
    await viewer.api.post('/api/invites', {
      name: `E2E refused ${runId}`,
      email: `refused-${runId}@example.com`,
      role: 'viewer',
    }),
    'POST /api/invites',
  );
  expect(await (await viewer.api.get('/api/playlists')).text()).not.toContain(
    `E2E refused ${runId}`,
  );
  const kept = (await (await viewer.api.get(`/api/playlists/${viewPlaylistId}`)).json()) as {
    name: string;
    items: unknown[];
  };
  expect(kept.name).toBe(viewPlaylistName);
  expect(kept.items).toHaveLength(1);

  // The refusal is in the Owner's full log, and never in the Viewer's activity.
  const ownLog = (await (await viewer.api.get('/api/audit?category=security')).json()) as {
    items: unknown[];
  };
  expect(ownLog.items).toEqual([]);
  const viewerId = await owner.api.memberIdByName(VIEWER);
  const fullLog = (await (
    await owner.api.get('/api/audit?category=security&limit=200')
  ).json()) as {
    items: { action: string; actorId: string | null; result: string }[];
  };
  expect(
    fullLog.items.some(
      (event) =>
        event.action === 'security.permission_denied' &&
        event.actorId === viewerId &&
        event.result === 'denied',
    ),
  ).toBe(true);
  await owner.page.goto(`${PORTAL_URL}/audit?category=security`);
  await expect(
    owner.page.getByTestId('audit-raw-action').filter({ hasText: 'security.permission_denied' }),
  ).not.toHaveCount(0);
  await expect(
    owner.page.getByText('Request outside the person’s role refused').first(),
  ).toBeVisible();
});

test('an Editor uploads, builds a playlist and pushes it, but people stay closed to them', async () => {
  const page = editor.page;
  await uploadInLibrary(page, [
    {
      name: editorImageName,
      mimeType: 'image/png',
      buffer: encodePng(64, 36, (x, y) => [y * 7, x * 4, 160]),
    },
  ]);
  await closeAddMedia(page);
  await expect(mediaStatus(mediaRow(page, editorImageName))).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 90_000 },
  );
  editorPlaylistId = await createPlaylistInPortal(page, editorPlaylistName);
  await addToPlaylist(page, editorImageName);
  await savePlaylistDraft(page);
  await assignFromEditor(page, pushScreenName);
  // The editors have no push button; the list page's header does.
  await page.goto(`${PORTAL_URL}/playlists`);
  expect(await pushFromHeader(page, [pushScreenId])).toMatch(/Pushed to 1 screen/);
  expect((await editor.api.status(pushScreenId)).desired).not.toBeNull();

  // Users, its account-menu entry and the people categories of the audit log are not theirs.
  await page.goto(`${PORTAL_URL}/users`);
  await expect(pageHeading(page, ROLE_PAGE)).toBeVisible();
  await expectUsersInAccountMenu(page, false);
  const categories = await auditCategories(page);
  expect(categories).toContain('Playlists');
  for (const label of FULL_LOG_ONLY) expect(categories).not.toContain(label);

  // The API agrees.
  await expectRefusedByRole(await editor.api.get('/api/members'), 'GET /api/members');
  await expectRefusedByRole(
    await editor.api.post('/api/invites', {
      name: `E2E refused ${runId}`,
      email: `refused-${runId}@example.com`,
      role: 'viewer',
    }),
    'POST /api/invites',
  );
});

test('an Admin manages Editors and Viewers only, and requests and cancels an invite', async () => {
  const page = admin.page;
  await page.goto(`${PORTAL_URL}/dashboard`);
  await expect(pageHeading(page, 'Dashboard')).toBeVisible();
  await expectUsersInAccountMenu(page, true);
  await page.getByTestId('account-menu').click();
  await page.getByRole('menuitem', { name: 'Users', exact: true }).click();
  await page.waitForURL(/\/users$/);
  await expect(pageHeading(page, 'Users')).toBeVisible();

  // The four seeded people.
  await expect(page.getByTestId('users-count')).toHaveText('4 people');
  const row = (id: string) => page.getByTestId(`users-row-${id}`);
  const ids = new Map<string, string>();
  for (const [name] of SEEDED_ROLES) {
    const id = await admin.api.memberIdByName(name);
    ids.set(name, id);
    await expect(row(id)).toContainText(name);
  }
  const idOf = (name: string): string => ids.get(name) ?? '';
  // The Owner is beyond an Admin's rank, and nobody changes themselves.
  await expect(row(idOf(OWNER)).getByTestId('users-row-actions')).toHaveCount(0);
  await expect(row(idOf(OWNER))).toContainText('Managed by an Owner');
  await expect(row(idOf(ADMIN)).getByTestId('users-row-actions')).toHaveCount(0);
  await expect(row(idOf(ADMIN))).toContainText('You');
  await expect(row(idOf(EDITOR)).getByTestId('users-row-actions')).toBeVisible();
  await expect(row(idOf(VIEWER)).getByTestId('users-row-actions')).toBeVisible();
  await expect(
    page.getByText('Only an Owner can change or remove Admins and Owners.'),
  ).toBeVisible();

  // The invite dialog offers Viewer (chosen) and Editor only.
  await page.getByTestId('users-invite').click();
  const dialog = page.getByTestId('users-invite-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId(/^users-invite-role-/)).toHaveCount(2);
  await expect(dialog.getByTestId('users-invite-role-viewer')).toBeVisible();
  await expect(dialog.getByTestId('users-invite-role-editor')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Viewer', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();

  // A Viewer is invited: the request waits for TINNOX, with its reference.
  const inviteeName = `E2E invitee ${runId}`;
  const inviteeEmail = `invitee-${runId}@example.com`;
  inviteNames.push(inviteeName);
  await invitePerson(page, inviteeName, inviteeEmail, 'viewer');
  const invite = await inviteNamed(admin.api, inviteeName);
  expect(invite.role).toBe('viewer');
  const inviteRow = page.getByTestId(`users-invite-row-${invite.id}`);
  await expect(inviteRow).toContainText('Waiting for TINNOX');
  await expect(inviteRow).toContainText(inviteReference(invite.id));
  await expect(inviteRow).toContainText(inviteeEmail);

  // "Keep invite" leaves it waiting; "Cancel invite" cancels it.
  const confirm = page.getByTestId('users-invite-cancel-dialog');
  await inviteRow.getByTestId('users-invite-row-cancel').click();
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(`Cancel the invite for ${inviteeName}?`);
  await confirm.getByRole('button', { name: 'Keep invite', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(inviteRow).toBeVisible();
  await inviteRow.getByTestId('users-invite-row-cancel').click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel invite', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(notifications(page).getByText(`Invite for ${inviteeName} cancelled`)).toBeVisible();
  await expect(inviteRow).toHaveCount(0);
  expect((await listInvites(admin.api)).map((item) => item.name)).not.toContain(inviteeName);

  // The full audit log is theirs.
  const categories = await auditCategories(page);
  for (const label of FULL_LOG_ONLY) expect(categories).toContain(label);
});

test('the Owner demotes the Editor while their playlist is open: the next save ends at sign-in', async () => {
  const page = owner.page;
  await openUsers(page);

  // An Owner may invite an Admin; nobody is invited as an Owner.
  await page.getByTestId('users-invite').click();
  const dialog = page.getByTestId('users-invite-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId(/^users-invite-role-/)).toHaveCount(3);
  await expect(dialog.getByTestId('users-invite-role-admin')).toBeVisible();
  await expect(
    dialog.getByText(
      'To make someone an Owner, invite them as an Admin and promote them after their first sign-in.',
    ),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  const adminInviteeName = `E2E admin invitee ${runId}`;
  inviteNames.push(adminInviteeName);
  await invitePerson(page, adminInviteeName, `admin-invitee-${runId}@example.com`, 'admin');
  const adminInvite = await inviteNamed(owner.api, adminInviteeName);
  expect(adminInvite.role).toBe('admin');
  await expect(page.getByTestId(`users-invite-row-${adminInvite.id}`)).toContainText(
    'Waiting for TINNOX',
  );

  // The Editor has their playlist open, with a change not saved yet.
  const editorPage = editor.page;
  await editorPage.goto(`${PORTAL_URL}/playlists/${editorPlaylistId}`);
  await expect(editorPage.getByTestId('playlist-editor-save')).toBeVisible();
  await editorPage.getByTestId('playlist-editor-description').fill('Changed before the demotion');
  await expect(editorPage.getByTestId('playlist-editor-save-state')).toHaveAttribute(
    'data-state',
    'unsaved',
  );
  // The header's push-plan poll (every 30 s) must not meet the ended session first: the save
  // is to be the Editor's next request. Failed polls only leave the plan as it was.
  const plan = `${PORTAL_URL}/api/push`;
  await editorPage.route(plan, (route) => route.abort());

  // A demotion ends every session the person has.
  await changeRole(page, EDITOR, 'viewer');
  await expect(notifications(page).getByText(/[1-9]\d* sessions? ended/)).toBeVisible();

  const saveAnswer = editorPage.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url() === `${PORTAL_URL}/api/playlists/${editorPlaylistId}`,
  );
  await editorPage.getByTestId('playlist-editor-save').click();
  expect((await saveAnswer).status()).toBe(401);
  await expect(editorPage.getByText(SESSION_ENDED)).toBeVisible();
  await expect(
    editorPage.getByRole('heading', { level: 1, name: 'Sign in to TINNOX CMS' }),
  ).toBeVisible();
  await editorPage.unroute(plan);

  // Signing in again asks for the password and a fresh one-time code, and returns to the
  // playlist, which now opens read-only.
  await reauthenticate(editorPage, 'editor');
  await saveEditorState();
  await expect(editorPage).toHaveURL(new RegExp(`/playlists/${editorPlaylistId}$`));
  const session = (await (await editor.api.get('/api/session')).json()) as {
    authenticated: boolean;
    user?: { role: string };
  };
  expect(session.user?.role).toBe('viewer');
  await expect(editorPage.getByTestId('playlist-editor')).toBeVisible();
  await expect(
    editorPage.getByText('You can view this playlist. Editors make changes.'),
  ).toBeVisible();
  await expect(editorPage.getByTestId('playlist-editor-save')).toHaveCount(0);
  await expect(editorPage.getByTestId('playlist-editor-push-now')).toHaveCount(0);

  // A list page's header shows the waiting screens instead of the push button (the editor
  // pages' header has none either way).
  await editorPage.goto(`${PORTAL_URL}/playlists`);
  await expect(pageHeading(editorPage, 'Playlists')).toBeVisible();
  await expect(editorPage.getByTestId('push-waiting')).toHaveText(/\d+ screens? waiting/);
  await expect(editorPage.getByTestId('push-button')).toHaveCount(0);

  // A promotion ends no session: the same browser carries on, and a reload brings the push
  // button back.
  await changeRole(page, EDITOR, 'editor');
  expect((await editor.api.session()).authenticated).toBe(true);
  await editorPage.reload();
  await expect(editorPage.getByTestId('push-button')).toBeVisible();
  await expect(editorPage.getByTestId('push-waiting')).toHaveCount(0);
});

test('the Owner signs the Editor out everywhere: their next request ends at sign-in', async () => {
  const page = owner.page;
  const editorPage = editor.page;
  await openUsers(page);
  // As in the demotion: the next request is to be the Editor's own click, not the plan poll.
  const plan = `${PORTAL_URL}/api/push`;
  await editorPage.route(plan, (route) => route.abort());

  await signOutEverywhere(page, EDITOR);
  await editorPage
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Apps', exact: true })
    .click();
  await expect(editorPage.getByText(SESSION_ENDED)).toBeVisible();
  await editorPage.unroute(plan);

  // Keycloak's session is alive, yet it shows the password form, then asks for a code.
  await reauthenticate(editorPage, 'editor');
  await saveEditorState();
  await expect(editorPage).toHaveURL(/\/apps$/);
  await expect(pageHeading(editorPage, 'Apps')).toBeVisible();
  // Their role did not change.
  await expect(editorPage.getByTestId('push-button')).toBeVisible();
});

test('Users fits a phone, and no page broke the CSP or used web storage', async () => {
  const page = owner.page;
  await page.setViewportSize({ width: 375, height: 812 });
  try {
    await openUsers(page);
    expect(await scrollsSideways(page), 'Users at 375 px').toBe(false);
  } finally {
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  for (const session of [owner, admin, editor, viewer]) {
    await expectNoWebStorage(session.page);
    expect(await cspViolations(session.page)).toEqual([]);
  }
});

test('the seeded roles are restored and no invite of this run waits', async () => {
  await restoreSeededState();
  const members = await listMembers(owner.api);
  for (const [name, role] of SEEDED_ROLES) {
    const member = members.find((item) => item.displayName === name);
    expect(member?.removedAt ?? null, name).toBeNull();
    expect(member?.role, name).toBe(role);
  }
  const waiting = (await listInvites(owner.api)).filter((invite) =>
    inviteNames.includes(invite.name),
  );
  expect(waiting).toEqual([]);

  // The Editor's last session came from reauthenticate(): sign it out here. (Its saved state
  // is only global teardown's fallback for a run that stopped earlier.)
  await editor.page.goto(`${PORTAL_URL}/dashboard`);
  await expect(pageHeading(editor.page, 'Dashboard')).toBeVisible();
  await signOutFromAccountMenu(editor.page);
  await expect
    .poll(async () => (await editor.api.session()).authenticated, { timeout: 30_000 })
    .toBe(false);
});
