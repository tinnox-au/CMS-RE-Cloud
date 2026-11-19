import type { AuditEventDto, DisplayDto, MemberNameDto } from '@tinnox/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.ts';
import {
  activityKindsToLoad,
  activityRefs,
  type ActivityNames,
  type ActivityObjectKind,
} from '../../lib/activity.ts';

/** The kinds whose names are read on demand; screens come from the dashboard's own list. */
type LoadedKind = Exclude<ActivityObjectKind, 'display'>;

type Names = ReadonlyMap<string, string>;
type Members = ReadonlyMap<string, MemberNameDto>;

function byId(items: readonly { readonly id: string; readonly name: string }[]): Names {
  return new Map(items.map((item) => [item.id.toLowerCase(), item.name]));
}

async function loadNames(kind: LoadedKind, signal: AbortSignal): Promise<Names> {
  switch (kind) {
    case 'playlist':
      return byId(await api.listPlaylists(signal));
    case 'media':
      return byId((await api.listMedia(signal)).items);
    case 'tag':
      return byId(await api.listTags(undefined, signal));
    case 'folder':
      return byId(await api.listFolders(signal));
    case 'schedule':
      return byId(await api.listSchedules(signal));
    case 'layout':
      return byId(await api.listLayouts(signal));
  }
}

/**
 * The names of the objects that the recent events are about. An audit event names its
 * object by id only, so a list is read for each kind of object the events mention, and only
 * when an event names an object of that kind that is not known yet. An id that is still
 * missing after its list was read belongs to an object deleted since; it does not cause the
 * list to be read again until another unknown id turns up. A list that could not be read is
 * left out, so its objects are shown without a name rather than called deleted.
 *
 * The members name the people who acted. Their list is read once per `generation` (the page
 * load, then each Refresh, since people may have been named or renamed), and again within it
 * only when an event's actor is a person the list does not know yet. No person acted, no read.
 * The names on screen stay until the new list arrives. Until it is read, or when it could not
 * be read, a person is shown as "Person".
 */
export function useActivityNames(
  events: readonly AuditEventDto[] | null,
  displays: readonly DisplayDto[] | null,
  generation = 0,
): ActivityNames {
  const [loaded, setLoaded] = useState<{ readonly [K in LoadedKind]?: Names }>({});
  // Ids each kind was last read for, so an object that is gone is not asked for again.
  const asked = useRef<{ [K in LoadedKind]?: ReadonlySet<string> }>({});

  const [members, setMembers] = useState<
    { readonly generation: number; readonly map: Members } | undefined
  >(undefined);
  // Actor ids the member list was read for in a generation, so a list that failed is not asked
  // again until someone new acts or the page is refreshed.
  const askedMembers = useRef<
    { readonly generation: number; readonly ids: ReadonlySet<string> } | undefined
  >(undefined);

  const displayNames = useMemo(() => (displays === null ? undefined : byId(displays)), [displays]);

  const memberMap = members?.map;
  const names = useMemo<ActivityNames>(
    () => ({
      ...loaded,
      ...(displayNames === undefined ? {} : { display: displayNames }),
      ...(memberMap === undefined ? {} : { member: memberMap }),
    }),
    [loaded, displayNames, memberMap],
  );

  const refs = useMemo(() => (events === null ? [] : activityRefs(events)), [events]);

  const actorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const event of events ?? []) {
      if (event.actorType === 'operator' && event.actorId !== null) {
        ids.add(event.actorId.toLowerCase());
      }
    }
    return [...ids];
  }, [events]);

  useEffect(() => {
    if (members?.generation === generation && actorIds.every((id) => members.map.has(id))) {
      return;
    }
    const before = askedMembers.current;
    const askedNow = before?.generation === generation ? before.ids : undefined;
    if (
      actorIds.length === 0 ||
      (askedNow !== undefined && actorIds.every((id) => askedNow.has(id)))
    ) {
      return;
    }
    askedMembers.current = { generation, ids: new Set([...(askedNow ?? []), ...actorIds]) };
    const controller = new AbortController();
    let answered = false;
    api.listMemberNames(controller.signal).then(
      (list) => {
        answered = true;
        setMembers({
          generation,
          map: new Map(list.map((item) => [item.id.toLowerCase(), item])),
        });
      },
      () => {
        // Unknown stays unknown: people read "Person" (or the names read before the Refresh).
        // A new actor or the next Refresh asks again.
        answered = true;
      },
    );
    return () => {
      controller.abort();
      // A read cut short never answered: the next run asks for it again.
      if (!answered) askedMembers.current = before;
    };
  }, [actorIds, members, generation]);

  useEffect(() => {
    const controller = new AbortController();
    // The same object for the life of the component; read once, so the cleanup uses it too.
    const askedFor = asked.current;
    // Kinds being read by this run, with what had been asked before it.
    const pending = new Map<LoadedKind, ReadonlySet<string> | undefined>();
    for (const kind of activityKindsToLoad(refs, names)) {
      if (kind === 'display') continue;
      const wanted = refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);
      const before = askedFor[kind];
      if (before !== undefined && wanted.every((id) => before.has(id))) continue;
      askedFor[kind] = new Set([...(before ?? []), ...wanted]);
      pending.set(kind, before);
      loadNames(kind, controller.signal).then(
        (map) => {
          pending.delete(kind);
          setLoaded((previous) => ({ ...previous, [kind]: map }));
        },
        () => {
          // A list that could not be read stays unknown: its objects are shown without a
          // name, and nothing is called deleted. It is asked for again with a new id.
          pending.delete(kind);
        },
      );
    }
    return () => {
      controller.abort();
      // A read cut short never answered: the next run asks for it again.
      for (const [kind, before] of pending) askedFor[kind] = before;
    };
  }, [refs, names]);

  return names;
}
