import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_RESULTS,
  auditCategoryOf,
  TAG_SCOPES,
  type AuditActorType,
  type AuditCategory,
  type AuditEventDto,
  type AuditResult,
  type MemberNameDto,
  type TagScope,
} from '@tinnox/contracts';
import { visibleAuditCategories } from '@tinnox/domain';
import {
  activityActorKindLabel,
  activityActorLabel,
  activityActorMember,
  describeActivity,
} from './activity.ts';
import { memberName } from './users.ts';

/**
 * The audit log as the portal shows it: the plain words for an action, the filters, the
 * time in the viewer's zone with the exact UTC time, what an event is about and where that
 * can be opened, and the structured detail as text. Pure functions, no DOM.
 *
 * An operator reads "screen" for the object the code calls `display`. The raw action string
 * (`display.update`, `publication.create`) is data and is shown as it was recorded.
 */

/* ---------- Filters ---------- */

export interface AuditFilter {
  readonly category: AuditCategory | null;
  readonly result: AuditResult | null;
}

export const NO_AUDIT_FILTER: AuditFilter = { category: null, result: null };

/** What an operator reads for a category in the filter. */
export const AUDIT_CATEGORY_LABELS: { readonly [K in AuditCategory]: string } = {
  auth: 'Sign-in and sign-out',
  display: 'Screens',
  pairing: 'Pairing',
  player: 'Players',
  media: 'Media',
  tag: 'Tags',
  folder: 'Folders',
  app: 'Apps',
  playlist: 'Playlists',
  schedule: 'Schedules',
  layout: 'Layouts',
  publication: 'Pushes to screens',
  invite: 'Invites',
  membership: 'People',
  alert_recipient: 'Alert addresses',
  security: 'Security',
};

/** The categories in the order of the filter: by label. */
export const AUDIT_CATEGORY_OPTIONS: readonly {
  readonly value: AuditCategory;
  readonly label: string;
}[] = AUDIT_CATEGORIES.map((value) => ({ value, label: AUDIT_CATEGORY_LABELS[value] })).sort(
  (a, b) => a.label.localeCompare(b.label, 'en-AU'),
);

/**
 * The categories a member may filter by: every one with the full log (`audit.read`), else the
 * activity categories the API returns without it (section 1.5).
 */
export function auditCategoryOptionsFor(fullLog: boolean): typeof AUDIT_CATEGORY_OPTIONS {
  const visible = visibleAuditCategories(fullLog);
  return AUDIT_CATEGORY_OPTIONS.filter((option) => visible.includes(option.value));
}

/**
 * A category from the address bar; anything the API would refuse reads as "no filter", and so
 * does a category outside the member's view (a bookmarked `?category=auth` without the full
 * log shows the whole filtered log, not "No event matches").
 */
export function parseAuditCategory(
  value: string | null | undefined,
  fullLog = true,
): AuditCategory | null {
  return visibleAuditCategories(fullLog).find((category) => category === value) ?? null;
}

/** A result from the address bar; anything the API would refuse reads as "no filter". */
export function parseAuditResult(value: string | null | undefined): AuditResult | null {
  return AUDIT_RESULTS.find((result) => result === value) ?? null;
}

export function isAuditFiltered(filter: AuditFilter): boolean {
  return filter.category !== null || filter.result !== null;
}

/** One string per filter, to tell which filter a loaded page of events belongs to. */
export function auditFilterKey(filter: AuditFilter): string {
  return `${filter.category ?? '*'}|${filter.result ?? '*'}`;
}

/* ---------- Result ---------- */

export type AuditResultTone = 'neutral' | 'warn' | 'danger';

export interface AuditResultPresentation {
  readonly label: string;
  readonly tone: AuditResultTone;
}

/**
 * A success is the ordinary case and stays quiet, so the refusals and failures are what
 * stands out in a long list.
 */
const RESULTS: { readonly [K in AuditResult]: AuditResultPresentation } = {
  success: { label: 'Succeeded', tone: 'neutral' },
  failure: { label: 'Failed', tone: 'danger' },
  denied: { label: 'Refused', tone: 'warn' },
};

export function presentAuditResult(result: AuditResult): AuditResultPresentation {
  return RESULTS[result];
}

export const AUDIT_RESULT_OPTIONS: readonly {
  readonly value: AuditResult;
  readonly label: string;
}[] = AUDIT_RESULTS.map((value) => ({ value, label: RESULTS[value].label }));

/* ---------- Action in plain words ---------- */

/**
 * The subject of a category in the singular, for actions this portal has no words for. The
 * wording of known actions comes from `lib/activity.ts`, so the audit log and the dashboard's
 * recent activity say the same thing about the same event.
 */
const CATEGORY_SUBJECTS: { readonly [K in AuditCategory]: string } = {
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
  invite: 'Invite',
  membership: 'Person',
  alert_recipient: 'Alert address',
  security: 'Security',
};

function sentenceCase(text: string): string {
  const words = text.replace(/[_\-.]+/g, ' ').trim();
  return words === '' ? '' : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function isKnownAction(action: string): boolean {
  return (AUDIT_ACTIONS as readonly string[]).includes(action);
}

/** Words for an action that is not in the table: "Screen: archive", "Billing: invoice sent". */
function unknownActionLabel(action: string): string {
  const categoryName = auditCategoryOf(action);
  const category = parseAuditCategory(categoryName);
  const subject = category === null ? sentenceCase(categoryName) : CATEGORY_SUBJECTS[category];
  const rest = action.length > categoryName.length ? action.slice(categoryName.length + 1) : '';
  const verb = rest
    .replace(/[_\-.]+/g, ' ')
    // The object keeps its code name in actions; an operator reads "screen".
    .replace(/\bdisplay(s?)\b/gi, 'screen$1')
    .trim();
  if (subject === '') return 'Unnamed action';
  return verb === '' ? subject : `${subject}: ${verb}`;
}

/**
 * What happened, in plain words. The result is part of it: a refused upload does not read
 * "Media uploaded". The raw action stays next to it on the page. Known actions use the
 * wording of the recent-activity list (`describeActivity`); anything else gets readable words
 * built from the action itself.
 */
export function auditActionLabel(event: AuditEventDto): string {
  if (isKnownAction(event.action)) return describeActivity(event).text;
  const label = unknownActionLabel(event.action);
  return event.result === 'success'
    ? label
    : `${label} (${RESULTS[event.result].label.toLowerCase()})`;
}

/** Short codes that say why an attempt failed or was refused (`playlist_empty`). */
export function auditReasonCodes(event: AuditEventDto): readonly string[] {
  return describeActivity(event).reasonCodes;
}

/* ---------- Time ---------- */

export interface AuditTime {
  /** "16 Nov 2026" in the viewer's zone. */
  readonly date: string;
  /** "2:31:14 pm" in the viewer's zone. */
  readonly time: string;
  /** "16 Nov 2026, 2:31:14 pm AEDT": date, time and the name of the zone. */
  readonly local: string;
  /** "2026-11-16 03:31:14.250 UTC": the recorded instant, exactly. */
  readonly utc: string;
  /** For the `dateTime` attribute; null when the recorded text is not a time. */
  readonly iso: string | null;
}

function formatters(timeZone: string | undefined) {
  const zone = timeZone === undefined ? {} : { timeZone };
  return {
    date: new Intl.DateTimeFormat('en-AU', {
      ...zone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }),
    time: new Intl.DateTimeFormat('en-AU', {
      ...zone,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }),
    zoneName: new Intl.DateTimeFormat('en-AU', { ...zone, hour: 'numeric', timeZoneName: 'short' }),
  };
}

let viewerFormatters: ReturnType<typeof formatters> | null = null;

/** Intl writes a narrow no-break space before "pm"; an ordinary one copies and compares better. */
function plainSpaces(text: string): string {
  return text.replace(/[\u202f\u00a0]/g, ' ');
}

/**
 * The time of an event: local date and time in Australian English, and the exact UTC time.
 * `timeZone` is for tests; without it the viewer's own zone is used. A text that is not a
 * time is returned as it is, so nothing is hidden.
 */
export function auditTime(iso: string, timeZone?: string): AuditTime {
  const instant = Date.parse(iso);
  if (Number.isNaN(instant)) {
    return { date: iso, time: '', local: iso, utc: iso, iso: null };
  }
  const format =
    timeZone === undefined ? (viewerFormatters ??= formatters(undefined)) : formatters(timeZone);
  const date = plainSpaces(format.date.format(instant));
  const time = plainSpaces(format.time.format(instant));
  const zoneName =
    format.zoneName.formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value ??
    '';
  const exact = new Date(instant).toISOString();
  return {
    date,
    time,
    local: `${date}, ${time}${zoneName === '' ? '' : ` ${zoneName}`}`,
    utc: `${exact.slice(0, 10)} ${exact.slice(11, 23)} UTC`,
    iso: exact,
  };
}

/* ---------- Actor ---------- */

/** Who acted, by kind: the same words as the recent-activity list ("Person", "System"). */
export function auditActorLabel(actorType: AuditActorType): string {
  return activityActorKindLabel(actorType);
}

export interface AuditActor {
  /** The member's name, "Unnamed person", or the kind of actor when no name is known. */
  readonly name: string;
  /** The member was removed since; their name stays readable. */
  readonly removed: boolean;
  /** The member's name was changed after the event, so the event happened under another name. */
  readonly renamed: boolean;
}

/** Who acted, named from the member list, with the marks the log shows next to the name. */
export function auditActor(
  event: Pick<AuditEventDto, 'actorType' | 'actorId' | 'occurredAt'>,
  names: Pick<AuditNames, 'member'>,
): AuditActor {
  const member = activityActorMember(event, names.member);
  const renamedAt =
    member === null || member.renamedAt === null ? Number.NaN : Date.parse(member.renamedAt);
  const occurredAt = Date.parse(event.occurredAt);
  return {
    name: activityActorLabel(event, names),
    removed: member?.removed === true,
    renamed: !Number.isNaN(renamedAt) && !Number.isNaN(occurredAt) && renamedAt > occurredAt,
  };
}

/** "Dana Lee (removed) (renamed)": the name and its marks as one text. */
export function auditActorText(actor: AuditActor): string {
  return `${actor.name}${actor.removed ? ' (removed)' : ''}${actor.renamed ? ' (renamed)' : ''}`;
}

/** What the id next to an actor is, for the details view. */
export function auditActorIdLabel(actorType: AuditActorType): string {
  if (actorType === 'operator') return 'Membership ID';
  if (actorType === 'player') return 'Player registration ID';
  return 'Actor ID';
}

/* ---------- Object ---------- */

const OBJECT_TYPE_LABELS: Readonly<Record<string, string>> = {
  display: 'Screen',
  media: 'Media',
  playlist: 'Playlist',
  tag: 'Tag',
  folder: 'Folder',
  app: 'App',
  schedule: 'Schedule',
  layout: 'Layout',
  publication: 'Publication',
  player_registration: 'Player',
  pairing: 'Pairing',
  membership: 'Person',
  invite: 'Invite',
  route: 'Request',
  session: 'Session',
};

/** The kind of object an event is about, as an operator reads it; null when it has none. */
export function auditObjectTypeLabel(objectType: string | null): string | null {
  if (objectType === null || objectType.trim() === '') return null;
  return Object.hasOwn(OBJECT_TYPE_LABELS, objectType)
    ? (OBJECT_TYPE_LABELS[objectType] ?? null)
    : sentenceCase(objectType);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first block of a UUID; any other identifier whole, shortened only when it is long. */
export function shortAuditId(id: string): string {
  if (UUID.test(id)) return id.slice(0, 8);
  return id.length > 16 ? `${id.slice(0, 15)}…` : id;
}

/** The kinds of object the portal can name, and for most of them open. */
export type AuditTargetKind =
  | 'display'
  | 'media'
  | 'playlist'
  | 'tag'
  | 'folder'
  | 'app'
  | 'schedule'
  | 'layout'
  | 'membership';

export interface AuditTarget {
  readonly kind: AuditTargetKind;
  /** Lower case, as the API writes identifiers into the audit trail. */
  readonly id: string;
}

const TARGET_KINDS: readonly AuditTargetKind[] = [
  'display',
  'media',
  'playlist',
  'tag',
  'folder',
  'app',
  'schedule',
  'layout',
  'membership',
];

const TARGET_LABELS: { readonly [K in AuditTargetKind]: string } = {
  display: 'Screen',
  media: 'Media',
  playlist: 'Playlist',
  tag: 'Tag',
  folder: 'Folder',
  app: 'App',
  schedule: 'Schedule',
  layout: 'Layout',
  membership: 'Person',
};

export function auditTargetLabel(kind: AuditTargetKind): string {
  return TARGET_LABELS[kind];
}

/** The detail keys that name another object, and what kind of object that is. */
const RELATED_KEYS: readonly { readonly key: string; readonly kind: AuditTargetKind }[] = [
  { key: 'displayId', kind: 'display' },
  { key: 'playlistId', kind: 'playlist' },
  { key: 'assignedPlaylistId', kind: 'playlist' },
  { key: 'scheduleId', kind: 'schedule' },
  { key: 'assignedScheduleId', kind: 'schedule' },
  // The default playlist in the detail of `schedule.create` and `schedule.update`.
  { key: 'defaultPlaylistId', kind: 'playlist' },
  { key: 'layoutId', kind: 'layout' },
  { key: 'assignedLayoutId', kind: 'layout' },
  // The main zone's playlist in the detail of `layout.create` and `layout.update`.
  { key: 'mainPlaylistId', kind: 'playlist' },
  { key: 'duplicatedFrom', kind: 'playlist' },
  { key: 'mediaId', kind: 'media' },
  { key: 'folderId', kind: 'folder' },
];

function targetOf(kind: AuditTargetKind, id: unknown): AuditTarget | null {
  return typeof id === 'string' && UUID.test(id) ? { kind, id: id.toLowerCase() } : null;
}

export interface AuditTargets {
  /** The object of the event, when it is of a kind the portal can name. */
  readonly primary: AuditTarget | null;
  /** Other objects the detail names: the screen of a push, the playlist that was assigned. */
  readonly related: readonly AuditTarget[];
}

/**
 * The objects an event points at. Only well-formed identifiers count: an event is data from
 * a log, and nothing from it goes into an address unchecked.
 */
export function auditTargets(
  event: Pick<AuditEventDto, 'objectType' | 'objectId' | 'detail'>,
): AuditTargets {
  const kind = TARGET_KINDS.find((candidate) => candidate === event.objectType);
  const primary = kind === undefined ? null : targetOf(kind, event.objectId);
  const related: AuditTarget[] = [];
  const detail = event.detail;
  if (detail !== null) {
    for (const { key, kind: relatedKind } of RELATED_KEYS) {
      const target = Object.hasOwn(detail, key) ? targetOf(relatedKind, detail[key]) : null;
      if (target === null) continue;
      if (primary !== null && primary.kind === target.kind && primary.id === target.id) continue;
      if (related.some((other) => other.kind === target.kind && other.id === target.id)) continue;
      related.push(target);
    }
  }
  return { primary, related };
}

/**
 * The object an event is about, for the Object column: the object the plain words are about
 * (the screen of a push, the screen a player was paired with), else the event's own object.
 * Only a well-formed identifier counts. Null when the event names nothing the portal can name.
 */
export function auditSubject(event: AuditEventDto): AuditTarget | null {
  const subject = describeActivity(event).subject;
  const fromWords = subject === null ? null : targetOf(subject.kind, subject.id);
  return fromWords ?? auditTargets(event).primary;
}

/** Every object an event names, the subject first, each once. */
export function auditAllTargets(event: AuditEventDto): readonly AuditTarget[] {
  const all: AuditTarget[] = [];
  const subject = auditSubject(event);
  const { primary, related } = auditTargets(event);
  for (const target of [subject, primary, ...related]) {
    if (target === null) continue;
    if (all.some((other) => other.kind === target.kind && other.id === target.id)) continue;
    all.push(target);
  }
  return all;
}

/** A tag scope written into an event's detail, when it is one. */
export function auditTagScope(detail: AuditEventDto['detail']): TagScope | null {
  if (detail === null || !Object.hasOwn(detail, 'scope')) return null;
  return TAG_SCOPES.find((scope) => scope === detail.scope) ?? null;
}

/**
 * The portal address where an object can be opened; a folder opens the media library
 * filtered on it. A tag opens the tags page on its scope. A person has no page of their own.
 */
export function auditTargetPath(
  target: AuditTarget,
  tagScope: TagScope | null = null,
): string | null {
  const id = encodeURIComponent(target.id);
  switch (target.kind) {
    case 'display':
      return `/screens/${id}`;
    case 'media':
      return `/media/${id}`;
    case 'playlist':
      return `/playlists/${id}`;
    case 'tag':
      return tagScope === null ? '/settings/tags' : `/settings/tags?scope=${tagScope}`;
    case 'folder':
      // A folder has no page of its own: the media library filtered on it.
      return `/media?folder=${id}`;
    case 'app':
      return `/apps/${id}`;
    case 'schedule':
      return `/schedules/${id}`;
    case 'layout':
      return `/layouts/${id}`;
    case 'membership':
      return null;
  }
}

/**
 * The names of the objects that exist now, by kind and id; each tag's scope; and every member
 * of the organisation, removed ones included, by membership id (actors and people events).
 */
export interface AuditNames {
  readonly display: ReadonlyMap<string, string> | null;
  readonly media: ReadonlyMap<string, string> | null;
  readonly playlist: ReadonlyMap<string, string> | null;
  readonly tag: ReadonlyMap<string, string> | null;
  readonly folder: ReadonlyMap<string, string> | null;
  readonly app: ReadonlyMap<string, string> | null;
  readonly schedule: ReadonlyMap<string, string> | null;
  readonly layout: ReadonlyMap<string, string> | null;
  readonly tagScopes: ReadonlyMap<string, TagScope> | null;
  readonly member: ReadonlyMap<string, MemberNameDto> | null;
}

export const NO_AUDIT_NAMES: AuditNames = {
  display: null,
  media: null,
  playlist: null,
  tag: null,
  folder: null,
  app: null,
  schedule: null,
  layout: null,
  tagScopes: null,
  member: null,
};

export type ResolvedAuditTarget =
  /** The object exists now: its name, and where it opens (null for a folder). */
  | { readonly state: 'found'; readonly name: string; readonly path: string | null }
  /** The list of its kind was read and the object is not in it: deleted since. */
  | { readonly state: 'gone' }
  /** The list of its kind is not known (still loading, or it could not be read). */
  | { readonly state: 'unknown'; readonly path: string | null };

/**
 * What the page can say about an object named by an event. A link is offered only to an
 * object that is known to exist, or whose list could not be read (its page then answers).
 * `scopeHint` is the tag scope the event itself recorded.
 */
export function resolveAuditTarget(
  target: AuditTarget,
  names: AuditNames,
  scopeHint: TagScope | null = null,
): ResolvedAuditTarget {
  if (target.kind === 'membership') {
    // Members are never deleted (a removed one keeps their row), so a missing id is unknown.
    const member = names.member?.get(target.id);
    return member === undefined
      ? { state: 'unknown', path: null }
      : { state: 'found', name: memberName(member), path: null };
  }
  const list = names[target.kind];
  const scope = target.kind === 'tag' ? (names.tagScopes?.get(target.id) ?? scopeHint) : null;
  if (list === null) return { state: 'unknown', path: auditTargetPath(target, scope) };
  const name = list.get(target.id);
  if (name === undefined) return { state: 'gone' };
  return { state: 'found', name, path: auditTargetPath(target, scope) };
}

/* ---------- Detail ---------- */

/** The longest text the details view draws; the audit trail keeps details small. */
export const MAX_DETAIL_TEXT = 20_000;

/**
 * The structured context of an event as indented JSON text, or '' when there is none. It is
 * only ever put on the page as text.
 */
export function auditDetailJson(detail: AuditEventDto['detail']): string {
  if (detail === null) return '';
  let text: string;
  try {
    text = JSON.stringify(detail, null, 2);
  } catch {
    return '';
  }
  return text.length > MAX_DETAIL_TEXT ? `${text.slice(0, MAX_DETAIL_TEXT)}\n… (shortened)` : text;
}

function detailValueText(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' || typeof item === 'number')
  ) {
    return value.length === 0 ? 'none' : value.join(', ');
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

export interface AuditDetailPair {
  readonly key: string;
  readonly value: string;
}

/** The top-level entries of a detail as short texts, in the order they were recorded. */
export function auditDetailPairs(detail: AuditEventDto['detail']): AuditDetailPair[] {
  if (detail === null) return [];
  return Object.keys(detail).map((key) => ({ key, value: detailValueText(detail[key]) }));
}

/**
 * One line for the list: "via: push · items: 1 · route: browser". Shortened to `maxLength`
 * characters; the details view shows everything.
 */
export function auditDetailSummary(detail: AuditEventDto['detail'], maxLength = 160): string {
  return auditDetailSummaryParts(detail, maxLength).join(DETAIL_SEPARATOR);
}

const DETAIL_SEPARATOR = ' · ';

/**
 * The same summary as `auditDetailSummary`, one `key: value` text per entry, so the list can
 * keep each entry whole on its line (a key is never split in the middle). Together they are
 * at most `maxLength` characters; the entry where the limit falls is cut and ends with "…",
 * and the entries after it are left out.
 */
export function auditDetailSummaryParts(
  detail: AuditEventDto['detail'],
  maxLength = 160,
): string[] {
  const texts = auditDetailPairs(detail).map((pair) => `${pair.key}: ${pair.value}`);
  const limit = Math.max(1, Math.floor(maxLength));
  if (texts.join(DETAIL_SEPARATOR).length <= limit) return texts;
  // Room for the text before the closing "…".
  const room = limit - 1;
  const parts: string[] = [];
  let used = 0;
  for (const text of texts) {
    const start = parts.length === 0 ? used : used + DETAIL_SEPARATOR.length;
    if (start + text.length <= room) {
      parts.push(text);
      used = start + text.length;
      continue;
    }
    const fits = room - start;
    if (fits > 0) parts.push(`${text.slice(0, fits)}…`);
    else if (parts.length > 0) parts[parts.length - 1] = `${parts[parts.length - 1] ?? ''}…`;
    else parts.push('…');
    break;
  }
  return parts;
}

/* ---------- Counting ---------- */

/** "No events", "1 event", "50 events"; with older pages still on the server, "Newest 50 events". */
export function auditCountLabel(count: number, hasOlder: boolean): string {
  if (count === 0) return 'No events';
  const events = `${count} ${count === 1 ? 'event' : 'events'}`;
  return hasOlder ? `Newest ${events}` : events;
}

/** While searching: "3 of 50 events", "3 of the newest 50 events", "1 of 1 event". */
export function auditSearchCountLabel(matched: number, count: number, hasOlder: boolean): string {
  const events = `${count} ${count === 1 ? 'event' : 'events'}`;
  return `${matched} of ${hasOlder ? `the newest ${events}` : events}`;
}

/* ---------- Search ---------- */

/** What an event's object is called in the list, or null when it has none. */
export function auditObjectText(event: AuditEventDto, names: AuditNames): string | null {
  const subject = auditSubject(event);
  if (subject !== null) {
    const resolved = resolveAuditTarget(subject, names, auditTagScope(event.detail));
    if (resolved.state === 'found') return resolved.name;
    return `${auditTargetLabel(subject.kind).toLowerCase()} ${shortAuditId(subject.id)}`;
  }
  const kind = auditObjectTypeLabel(event.objectType);
  if (event.objectId === null) return kind === null ? null : kind.toLowerCase();
  return `${(kind ?? 'object').toLowerCase()} ${shortAuditId(event.objectId)}`;
}

/**
 * The accessible name of a row's details button. Events recorded in the same second by one
 * bulk change share their action and time, so the object tells the buttons apart:
 * Details of “Media deleted” for clip.mp4, 16 Nov 2026, 8:54:34 am AEDT.
 */
export function auditDetailsButtonLabel(
  event: AuditEventDto,
  names: AuditNames,
  timeZone?: string,
): string {
  const object = auditObjectText(event, names);
  const time = auditTime(event.occurredAt, timeZone).local;
  return `Details of “${auditActionLabel(event)}”${object === null ? '' : ` for ${object}`}, ${time}`;
}

/**
 * The texts the audit log's search looks in: the action in words and as recorded, the
 * object's name (or kind and identifier), every other object the event names, the actor and
 * the detail. The search covers the events loaded so far; older ones are loaded on request.
 */
export function auditSearchTexts(event: AuditEventDto, names: AuditNames): string[] {
  const texts = [
    auditActionLabel(event),
    event.action,
    auditActorLabel(event.actorType),
    auditActorText(auditActor(event, names)),
  ];
  const object = auditObjectText(event, names);
  if (object !== null) texts.push(object);
  for (const target of auditAllTargets(event)) {
    const resolved = resolveAuditTarget(target, names, auditTagScope(event.detail));
    if (resolved.state === 'found') texts.push(resolved.name);
    texts.push(target.id);
  }
  if (event.objectId !== null) texts.push(event.objectId);
  if (event.actorId !== null) texts.push(event.actorId);
  texts.push(auditDetailSummary(event.detail, MAX_DETAIL_TEXT));
  return texts;
}

/* ---------- Load older ---------- */

/** The older events loaded below the first page, and what they were read for. */
export interface AuditOlderPages<T> {
  /** The filter the events were read with (`auditFilterKey`). */
  readonly key: string;
  /**
   * The first page they continue. It changes with every Refresh and filter change, so an
   * answer read from a cursor of an earlier first page is never joined to a newer one.
   */
  readonly generation: number;
  readonly items: readonly T[];
  readonly nextBefore: string | null;
}

/**
 * Adds an answer of "Load older events" to the older events already shown. An answer to a
 * request made for another first page (a Refresh or a filter change came in between, even
 * one that went back to the same filter) is dropped: joined to the new first page it would
 * leave out, without a word, the events between the two.
 */
export function appendOlderAuditPage<T>(
  previous: AuditOlderPages<T> | null,
  request: { readonly key: string; readonly generation: number },
  currentGeneration: number,
  page: { readonly items: readonly T[]; readonly nextBefore: string | null },
): AuditOlderPages<T> | null {
  if (request.generation !== currentGeneration) return previous;
  const continues =
    previous !== null && previous.key === request.key && previous.generation === request.generation;
  return {
    key: request.key,
    generation: request.generation,
    items: [...(continues ? previous.items : []), ...page.items],
    nextBefore: page.nextBefore,
  };
}
