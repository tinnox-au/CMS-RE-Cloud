/**
 * Recent activity in plain words (docs/portal-v2/stage-a.md, 3.1). Pure functions, no DOM:
 * an audit event becomes a short sentence ("Playlist updated"), the object it is about, and
 * where that object can be opened.
 *
 * An audit event names its object by id only, never by name, so the name is looked up in the
 * lists the portal already has. An object that is no longer in its list has been deleted: it
 * gets no name and no link, and nothing is invented for it.
 *
 * In code the object is a `display`, as in the API and the contracts; every string an
 * operator sees says "screen" (P2-03).
 */
import {
  ASSIGNMENT_KEYS,
  AUDIT_ACTIONS,
  auditCategoryOf,
  type AssignmentKey,
  type AuditAction,
  type AuditActorType,
  type AuditEventDto,
  type AuditResult,
  type MemberNameDto,
} from '@tinnox/contracts';
import { CONTENT_KIND_LABEL, type ContentKind } from './assignedContent.ts';
import { formatAge } from './format.ts';
import { memberName } from './users.ts';

/** The kinds of object an activity sentence can name. */
export const ACTIVITY_OBJECT_KINDS = [
  'display',
  'playlist',
  'schedule',
  'layout',
  'media',
  'tag',
  'folder',
] as const;
export type ActivityObjectKind = (typeof ACTIVITY_OBJECT_KINDS)[number];

export interface ActivityRef {
  readonly kind: ActivityObjectKind;
  /** Lower case, as the API stores identifiers. */
  readonly id: string;
}

/** Which picture stands next to the sentence. The page maps these to icons. */
export type ActivityIcon =
  | 'screen'
  | 'player'
  | 'media'
  | 'playlist'
  | 'push'
  | 'tag'
  | 'folder'
  | 'account'
  | 'security'
  | 'other';

/** What an event says, before any name is looked up. */
export interface ActivityDescription {
  /** The plain words, without the object's name: "Playlist updated", "Upload refused". */
  readonly text: string;
  /** The object the sentence is about; its name follows the text after a colon. */
  readonly subject: ActivityRef | null;
  /** A second object worth naming: the playlist, schedule or layout of a push, or the one that was assigned. */
  readonly related: ActivityRef | null;
  /** What the related object is to the event: "Playlist", "Schedule", "Layout", "Copied from". Null without one. */
  readonly relatedLabel: string | null;
  readonly icon: ActivityIcon;
  /** False when the action is not one this portal knows; the raw action is then shown too. */
  readonly known: boolean;
  /** True when the event removed its subject, which can therefore never be named or opened. */
  readonly removesSubject: boolean;
  /** Short machine codes that say why something failed or was refused: `playlist_empty`. */
  readonly reasonCodes: readonly string[];
}

interface Wording {
  /** What happened, when the event succeeded: "Playlist updated". */
  readonly done: string;
  /** The attempt as a noun phrase; "failed" or "refused" is put after it: "Playlist update". */
  readonly attempt: string;
  readonly icon: ActivityIcon;
}

const WORDING: { readonly [K in AuditAction]: Wording } = {
  'auth.login': { done: 'Person signed in', attempt: 'Sign-in', icon: 'account' },
  'auth.logout': { done: 'Person signed out', attempt: 'Sign-out', icon: 'account' },
  'auth.session_expired': { done: 'Session expired', attempt: 'Session expiry', icon: 'account' },
  'display.create': { done: 'Screen added', attempt: 'Adding a screen', icon: 'screen' },
  'display.update': { done: 'Screen updated', attempt: 'Screen update', icon: 'screen' },
  // The recorded transition, not delivery: the row is written before any e-mail goes out (DEC-33).
  'display.offline_alert': {
    done: 'Not-reporting alert recorded for screen',
    attempt: 'Not-reporting alert for screen',
    icon: 'screen',
  },
  'display.online_alert': {
    done: 'Reporting-again alert recorded for screen',
    attempt: 'Reporting-again alert for screen',
    icon: 'screen',
  },
  'pairing.create': {
    done: 'Player asked for a pairing code',
    attempt: 'Pairing code request',
    icon: 'player',
  },
  'pairing.claim': {
    done: 'Pairing code accepted for screen',
    attempt: 'Pairing code for screen',
    icon: 'player',
  },
  'pairing.complete': {
    done: 'Player paired with screen',
    attempt: 'Player pairing',
    icon: 'player',
  },
  // Written without an organisation, so it is not in an organisation's activity today.
  'pairing.lock': {
    done: 'Pairing request locked after wrong answers',
    attempt: 'Pairing request',
    icon: 'security',
  },
  // Written by migration 0012 for claims left from before migration 0010.
  'pairing.cancel': {
    done: 'Pending pairing cancelled for screen',
    attempt: 'Pending pairing cancellation',
    icon: 'player',
  },
  'player.revoke': {
    done: 'Player revoked on screen',
    attempt: 'Player revocation',
    icon: 'player',
  },
  'player.auth_rejected': {
    done: 'Player credential check recorded',
    attempt: 'Player credential',
    icon: 'security',
  },
  'media.upload': { done: 'Media uploaded', attempt: 'Upload', icon: 'media' },
  'media.validate': { done: 'Media checked and ready', attempt: 'Media check', icon: 'media' },
  'media.update': { done: 'Media updated', attempt: 'Media update', icon: 'media' },
  'media.delete': { done: 'Media deleted', attempt: 'Media deletion', icon: 'media' },
  'tag.create': { done: 'Tag created', attempt: 'Tag creation', icon: 'tag' },
  'tag.update': { done: 'Tag updated', attempt: 'Tag update', icon: 'tag' },
  'tag.delete': { done: 'Tag deleted', attempt: 'Tag deletion', icon: 'tag' },
  'folder.create': { done: 'Folder created', attempt: 'Folder creation', icon: 'folder' },
  'folder.update': { done: 'Folder renamed', attempt: 'Folder rename', icon: 'folder' },
  'folder.delete': { done: 'Folder deleted', attempt: 'Folder deletion', icon: 'folder' },
  'app.create': { done: 'App created', attempt: 'App creation', icon: 'other' },
  'app.update': { done: 'App updated', attempt: 'App update', icon: 'other' },
  'app.delete': { done: 'App deleted', attempt: 'App deletion', icon: 'other' },
  'playlist.create': { done: 'Playlist created', attempt: 'Playlist creation', icon: 'playlist' },
  'playlist.update': { done: 'Playlist updated', attempt: 'Playlist update', icon: 'playlist' },
  'playlist.delete': { done: 'Playlist deleted', attempt: 'Playlist deletion', icon: 'playlist' },
  'schedule.create': { done: 'Schedule created', attempt: 'Schedule creation', icon: 'other' },
  'schedule.update': { done: 'Schedule updated', attempt: 'Schedule update', icon: 'other' },
  'schedule.delete': { done: 'Schedule deleted', attempt: 'Schedule deletion', icon: 'other' },
  'layout.create': { done: 'Layout created', attempt: 'Layout creation', icon: 'other' },
  'layout.update': { done: 'Layout updated', attempt: 'Layout update', icon: 'other' },
  'layout.delete': { done: 'Layout deleted', attempt: 'Layout deletion', icon: 'other' },
  'publication.create': { done: 'Pushed to screen', attempt: 'Push to screen', icon: 'push' },
  'invite.create': { done: 'Invite requested', attempt: 'Invite request', icon: 'account' },
  'invite.cancel': { done: 'Invite cancelled', attempt: 'Invite cancellation', icon: 'account' },
  'membership.create': {
    done: 'Person added by TINNOX',
    attempt: 'Adding a person',
    icon: 'account',
  },
  'membership.role_change': { done: 'Role changed', attempt: 'Role change', icon: 'account' },
  'membership.update': { done: 'Name corrected', attempt: 'Name correction', icon: 'account' },
  'membership.remove': { done: 'Person removed', attempt: 'Removing a person', icon: 'account' },
  'membership.sessions_end': {
    done: 'Signed out everywhere',
    attempt: 'Signing out everywhere',
    icon: 'account',
  },
  'membership.mfa_reset': {
    done: 'Sign-in reset by TINNOX',
    attempt: 'Sign-in reset',
    icon: 'account',
  },
  'alert_recipient.add': {
    done: 'Alert address added',
    attempt: 'Adding an alert address',
    icon: 'account',
  },
  'alert_recipient.remove': {
    done: 'Alert address removed',
    attempt: 'Removing an alert address',
    icon: 'account',
  },
  'alert_recipient.confirm': {
    done: 'Alert address confirmed by its owner',
    attempt: 'Alert address confirmation',
    icon: 'account',
  },
  'security.cross_org_denied': {
    done: 'Cross-organisation request recorded',
    attempt: 'Access to another organisation’s data',
    icon: 'security',
  },
  'security.csrf_rejected': {
    done: 'Security token check recorded',
    attempt: 'Request without a valid security token',
    icon: 'security',
  },
  'security.permission_denied': {
    done: 'Refused by role',
    // Every such row is 'denied', so this is what people read, with " refused" after it.
    attempt: 'Request outside the person’s role',
    icon: 'security',
  },
};

/** The actions whose subject is gone once the event has happened. */
const REMOVALS: ReadonlySet<string> = new Set<AuditAction>([
  'media.delete',
  'tag.delete',
  'folder.delete',
  'playlist.delete',
  'schedule.delete',
  'layout.delete',
]);

const CATEGORY_ICONS: { readonly [category: string]: ActivityIcon } = {
  auth: 'account',
  display: 'screen',
  pairing: 'player',
  player: 'player',
  media: 'media',
  tag: 'tag',
  folder: 'folder',
  playlist: 'playlist',
  publication: 'push',
  invite: 'account',
  membership: 'account',
  alert_recipient: 'account',
  security: 'security',
};

/** What an operator calls a category. `display` is never shown: it reads "Screen". */
const CATEGORY_LABELS: { readonly [category: string]: string } = {
  auth: 'Sign-in',
  display: 'Screen',
  pairing: 'Pairing',
  player: 'Player',
  media: 'Media',
  tag: 'Tag',
  folder: 'Folder',
  app: 'App',
  playlist: 'Playlist',
  schedule: 'Schedule',
  layout: 'Layout',
  publication: 'Push',
  invite: 'Invites',
  membership: 'People',
  alert_recipient: 'Alert addresses',
  security: 'Security',
};

const OBJECT_KIND_OF_TYPE: { readonly [objectType: string]: ActivityObjectKind } = {
  display: 'display',
  playlist: 'playlist',
  schedule: 'schedule',
  layout: 'layout',
  media: 'media',
  tag: 'tag',
  folder: 'folder',
};

function isKnownAction(action: string): action is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(action);
}

function ref(kind: ActivityObjectKind, id: unknown): ActivityRef | null {
  return typeof id === 'string' && id !== '' ? { kind, id: id.toLowerCase() } : null;
}

/** The event's own object, when it is of a kind that has a name. */
function objectRef(event: AuditEventDto): ActivityRef | null {
  if (event.objectType === null) return null;
  const kind = OBJECT_KIND_OF_TYPE[event.objectType];
  return kind === undefined ? null : ref(kind, event.objectId);
}

function detailValue(event: AuditEventDto, key: string): unknown {
  return event.detail === null ? undefined : event.detail[key];
}

function isCode(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,60}$/i.test(value);
}

/** Codes from `detail.reason`, `detail.errorCode` and `detail.reasons`, without repeats. */
function reasonCodesOf(event: AuditEventDto): readonly string[] {
  if (event.result === 'success') return [];
  const codes: string[] = [];
  for (const key of ['reason', 'errorCode']) {
    const value = detailValue(event, key);
    if (isCode(value)) codes.push(value);
  }
  const reasons = detailValue(event, 'reasons');
  if (Array.isArray(reasons)) {
    for (const value of reasons) if (isCode(value)) codes.push(value);
  }
  return [...new Set(codes)].slice(0, 3);
}

function capitalise(text: string): string {
  return text === '' ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function resultSuffix(result: AuditResult): string {
  if (result === 'failure') return ' failed';
  if (result === 'denied') return ' refused';
  return '';
}

/**
 * Words for an action this portal does not know: the category an operator knows, then the
 * rest of the action as words. "media.transcode_started" reads "Media: transcode started".
 */
function fallbackText(event: AuditEventDto): string {
  const category = auditCategoryOf(event.action);
  const rest = event.action
    .slice(category.length + 1)
    .replace(/[._-]+/g, ' ')
    // The object keeps its code name in actions; an operator reads "screen".
    .replace(/\bdisplay(s?)\b/gi, 'screen$1')
    .trim();
  const known = Object.hasOwn(CATEGORY_LABELS, category) ? CATEGORY_LABELS[category] : undefined;
  const label = known ?? capitalise(category.replace(/[_-]+/g, ' ').trim() || 'Activity');
  const text = rest === '' ? label : `${label}: ${rest}`;
  if (event.result === 'failure') return `${text} (failed)`;
  if (event.result === 'denied') return `${text} (refused)`;
  return text;
}

/** The screen an event is about when the event's own object is something else. */
function displayOf(event: AuditEventDto): ActivityRef | null {
  return (
    ref('display', detailValue(event, 'displayId')) ??
    (event.objectType === 'display' ? ref('display', event.objectId) : null)
  );
}

/** The kind of content each assignment key of a display patch names. */
const ASSIGNMENT_KIND: { readonly [K in AssignmentKey]: ContentKind } = {
  assignedPlaylistId: 'playlist',
  assignedScheduleId: 'schedule',
  assignedLayoutId: 'layout',
};

function isAssignmentKey(key: unknown): key is AssignmentKey {
  return ASSIGNMENT_KEYS.some((known) => known === key);
}

/**
 * The fields a `display.update` patch named, when they are assignment keys and nothing else;
 * else null. `fields` holds the keys of the patch; the detail's values may also carry a null
 * for each kind the API cleared (a screen has one of a playlist, a schedule or a layout).
 */
function assignmentFields(event: AuditEventDto): readonly AssignmentKey[] | null {
  const fields: unknown = detailValue(event, 'fields');
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const keys: readonly unknown[] = fields;
  return keys.every(isAssignmentKey) ? keys : null;
}

/**
 * What an audit event says in plain words. Every action of `AUDIT_ACTIONS` has its own
 * wording; anything else gets a readable fallback and `known: false`.
 */
export function describeActivity(event: AuditEventDto): ActivityDescription {
  const reasonCodes = reasonCodesOf(event);
  if (!isKnownAction(event.action)) {
    return {
      text: fallbackText(event),
      subject: objectRef(event),
      related: null,
      relatedLabel: null,
      icon: CATEGORY_ICONS[auditCategoryOf(event.action)] ?? 'other',
      known: false,
      removesSubject: false,
      reasonCodes,
    };
  }

  const action = event.action;
  const wording = WORDING[action];
  const succeeded = event.result === 'success';
  let done = wording.done;
  let attempt = wording.attempt;
  let subject = objectRef(event);
  let related: ActivityRef | null = null;
  let relatedLabel: string | null = null;

  switch (action) {
    case 'display.update': {
      // A change of the assignment alone is worth its own words: nothing else was edited.
      // What was assigned decides first, so a playlist that replaced a schedule or a layout
      // (the detail then carries null for the kind it cleared) reads as the assignment it was.
      const fields = assignmentFields(event);
      const [only] = fields ?? [];
      if (fields === null || only === undefined) break;
      // A value that was not recorded (an attempt that failed) reads as an assignment.
      const assigned =
        ASSIGNMENT_KEYS.find((key) => typeof detailValue(event, key) === 'string') ??
        (fields.length === 1 && detailValue(event, only) === undefined ? only : undefined);
      if (assigned !== undefined) {
        const kind = ASSIGNMENT_KIND[assigned];
        done = `${CONTENT_KIND_LABEL[kind]} assigned to screen`;
        attempt = `${CONTENT_KIND_LABEL[kind]} assignment`;
        related = ref(kind, detailValue(event, assigned));
        relatedLabel = CONTENT_KIND_LABEL[kind];
      } else if (fields.length > 1) {
        done = 'Content removed from screen';
        attempt = 'Removing the content from a screen';
      } else {
        const kind = ASSIGNMENT_KIND[only];
        done = `${CONTENT_KIND_LABEL[kind]} removed from screen`;
        attempt = `Removing the ${kind} from a screen`;
      }
      break;
    }
    case 'display.offline_alert':
    case 'display.online_alert':
      // No confirmed address on the list when the transition was recorded: nothing was mailed.
      if (detailValue(event, 'recipients') === 0) {
        done = done.replace(' for screen', ' (no confirmed address received it) for screen');
      }
      break;
    case 'pairing.complete':
      subject = displayOf(event);
      break;
    case 'player.revoke': {
      subject = displayOf(event);
      const reason = detailValue(event, 'reason');
      if (reason === 'replaced') done = 'Player replaced on screen';
      else if (reason === 'player_reset') done = 'Player unpaired itself from screen';
      break;
    }
    case 'tag.create':
    case 'tag.delete': {
      const scope = detailValue(event, 'scope');
      const kind = scope === 'media' ? 'Media tag' : scope === 'display' ? 'Screen tag' : null;
      if (kind !== null) {
        const verb = action === 'tag.create' ? 'created' : 'deleted';
        done = `${kind} ${verb}`;
        attempt = `${kind} ${action === 'tag.create' ? 'creation' : 'deletion'}`;
      }
      break;
    }
    case 'playlist.create': {
      const source = ref('playlist', detailValue(event, 'duplicatedFrom'));
      if (source !== null) {
        done = 'Playlist duplicated';
        attempt = 'Playlist duplication';
        related = source;
        relatedLabel = 'Copied from';
      }
      break;
    }
    case 'publication.create': {
      // A push is about a screen; the event's own object is the publication, the playlist,
      // the schedule or the layout. A push of a layout or a schedule names it: its
      // `playlistId` is only the main zone's or the default playlist.
      subject = displayOf(event);
      related =
        ref('layout', detailValue(event, 'layoutId')) ??
        (event.objectType === 'layout' ? ref('layout', event.objectId) : null);
      relatedLabel = 'Layout';
      if (related === null) {
        related =
          ref('schedule', detailValue(event, 'scheduleId')) ??
          (event.objectType === 'schedule' ? ref('schedule', event.objectId) : null);
        relatedLabel = 'Schedule';
      }
      if (related === null) {
        related =
          ref('playlist', detailValue(event, 'playlistId')) ??
          (event.objectType === 'playlist' ? ref('playlist', event.objectId) : null);
        relatedLabel = 'Playlist';
      }
      break;
    }
    default:
      break;
  }

  return {
    text: succeeded ? done : `${attempt}${resultSuffix(event.result)}`,
    subject,
    related,
    relatedLabel: related === null ? null : relatedLabel,
    icon: wording.icon,
    known: true,
    removesSubject: succeeded && REMOVALS.has(action),
    reasonCodes,
  };
}

/**
 * Names by object kind and id. A kind that is missing has not been loaded, so nothing is
 * known about its objects; a kind that is present lists every object that exists now.
 * `member` holds every member of the organisation, removed ones included, by membership id.
 */
export type ActivityNames = {
  readonly [K in ActivityObjectKind]?: ReadonlyMap<string, string>;
} & { readonly member?: ReadonlyMap<string, MemberNameDto> };

/** Where an object can be opened, or null when it has no page of its own. */
export function activityHref(target: ActivityRef): string | null {
  switch (target.kind) {
    case 'display':
      return `/screens/${target.id}`;
    case 'playlist':
      return `/playlists/${target.id}`;
    case 'schedule':
      return `/schedules/${target.id}`;
    case 'layout':
      return `/layouts/${target.id}`;
    case 'media':
      return `/media/${target.id}`;
    case 'tag':
      return '/settings/tags';
    case 'folder':
      return null;
  }
}

export interface ActivityObject {
  readonly kind: ActivityObjectKind;
  readonly id: string;
  readonly name: string;
  /** The object's page, or null when it has none. */
  readonly href: string | null;
}

export type ActivityTone = 'neutral' | 'warn' | 'danger';

/** One row of the recent activity list, ready to draw. */
export interface ActivityItem {
  readonly id: string;
  /** The event's time as the API sent it. */
  readonly occurredAt: string;
  readonly text: string;
  /** The named object, or null when the event has none or its name is not known. */
  readonly subject: ActivityObject | null;
  readonly related: ActivityObject | null;
  /** What `related` is to the event: "Playlist", "Schedule", "Layout", "Copied from". */
  readonly relatedLabel: string | null;
  /**
   * True when the event is about an object that existed then and is in no list now: it was
   * deleted since. False while the lists are not loaded, when nothing can be said.
   */
  readonly subjectGone: boolean;
  readonly icon: ActivityIcon;
  readonly result: AuditResult;
  /** "Failed" or "Refused"; null for a success, which needs no label. */
  readonly resultLabel: string | null;
  readonly tone: ActivityTone;
  /**
   * Who did it: a member's name when the member list knows them, else the kind of actor.
   * An event never carries a name; it comes from the member list at read time.
   */
  readonly actor: string;
  readonly reasonCodes: readonly string[];
  /** The raw action, shown as text when `known` is false. */
  readonly action: string;
  readonly known: boolean;
}

/** `operator` is a customer's person; "Operator" is a TINNOX staff role, so it is never shown. */
const ACTOR_LABELS: { readonly [K in AuditActorType]: string } = {
  operator: 'Person',
  player: 'Player software',
  system: 'System',
  anonymous: 'Not signed in',
};

/** Who acted, by kind only: "Person", "Player software". */
export function activityActorKindLabel(actorType: AuditActorType): string {
  return ACTOR_LABELS[actorType];
}

/** The member who acted, when the member list is known and has them. */
export function activityActorMember(
  event: Pick<AuditEventDto, 'actorType' | 'actorId'>,
  members: ReadonlyMap<string, MemberNameDto> | null | undefined,
): MemberNameDto | null {
  if (event.actorType !== 'operator' || event.actorId === null) return null;
  return members?.get(event.actorId.toLowerCase()) ?? null;
}

/**
 * Who acted: for a person, the member's name when the member list knows them ("Unnamed person"
 * until TINNOX names them), "Person" when the list is unknown or lacks the id; any other actor
 * by kind. Nothing is guessed.
 */
export function activityActorLabel(
  event: Pick<AuditEventDto, 'actorType' | 'actorId'>,
  names: { readonly member?: ReadonlyMap<string, MemberNameDto> | null },
): string {
  const member = activityActorMember(event, names.member);
  return member === null ? ACTOR_LABELS[event.actorType] : memberName(member);
}

const RESULT_LABELS: { readonly [K in AuditResult]: string | null } = {
  success: null,
  failure: 'Failed',
  denied: 'Refused',
};

const RESULT_TONES: { readonly [K in AuditResult]: ActivityTone } = {
  success: 'neutral',
  failure: 'danger',
  denied: 'warn',
};

function resolve(target: ActivityRef | null, names: ActivityNames): ActivityObject | null {
  if (target === null) return null;
  const name = names[target.kind]?.get(target.id);
  if (name === undefined || name === '') return null;
  return { kind: target.kind, id: target.id, name, href: activityHref(target) };
}

/** An audit event as a row of the activity list, with the names that are known. */
export function presentActivity(event: AuditEventDto, names: ActivityNames): ActivityItem {
  const description = describeActivity(event);
  // What an event removed is in no list; a name left over from before must not be linked.
  const subject = description.removesSubject ? null : resolve(description.subject, names);
  const subjectGone =
    description.subject !== null &&
    subject === null &&
    !description.removesSubject &&
    names[description.subject.kind] !== undefined;
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    text: description.text,
    subject,
    related: resolve(description.related, names),
    relatedLabel: description.relatedLabel,
    subjectGone,
    icon: description.icon,
    result: event.result,
    resultLabel: RESULT_LABELS[event.result],
    tone: RESULT_TONES[event.result],
    actor: activityActorLabel(event, names),
    reasonCodes: description.reasonCodes,
    action: event.action,
    known: description.known,
  };
}

/** The sentence as one string: "Playlist updated: Reception loop". */
export function activitySentence(item: ActivityItem): string {
  return item.subject === null ? item.text : `${item.text}: ${item.subject.name}`;
}

/** Every object the events name, once each, for looking the names up. */
export function activityRefs(events: readonly AuditEventDto[]): readonly ActivityRef[] {
  const seen = new Set<string>();
  const refs: ActivityRef[] = [];
  for (const event of events) {
    const description = describeActivity(event);
    // An object that the event removed is in no list; there is nothing to look up.
    const subject = description.removesSubject ? null : description.subject;
    for (const target of [subject, description.related]) {
      if (target === null) continue;
      const key = `${target.kind}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(target);
    }
  }
  return refs;
}

/**
 * The kinds whose names are worth loading: those with an object the events name that is not
 * in the names already at hand.
 */
export function activityKindsToLoad(
  refs: readonly ActivityRef[],
  names: ActivityNames,
): readonly ActivityObjectKind[] {
  return ACTIVITY_OBJECT_KINDS.filter((kind) =>
    refs.some((target) => target.kind === kind && names[kind]?.has(target.id) !== true),
  );
}

const DAY_MS = 86_400_000;

const dayFormat = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

const yearFormat = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * When an event happened, for a short list: "12 seconds ago" within a day, then the day and
 * time, then the date with its year once it is more than about a year old. A time in the
 * future (clocks differ) reads "just now".
 */
export function activityTimeLabel(occurredAt: string, nowMs: number): string {
  const time = Date.parse(occurredAt);
  if (Number.isNaN(time)) return occurredAt;
  const age = nowMs - time;
  if (age < DAY_MS) return formatAge(age / 1000);
  if (age < 330 * DAY_MS) return dayFormat.format(time);
  return yearFormat.format(time);
}
