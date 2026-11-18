import type { AuditEventDto, DisplayDto } from '@tinnox/contracts';
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
 */
export function useActivityNames(
  events: readonly AuditEventDto[] | null,
  displays: readonly DisplayDto[] | null,
): ActivityNames {
  const [loaded, setLoaded] = useState<{ readonly [K in LoadedKind]?: Names }>({});
  // Ids each kind was last read for, so an object that is gone is not asked for again.
  const asked = useRef<{ [K in LoadedKind]?: ReadonlySet<string> }>({});

  const displayNames = useMemo(() => (displays === null ? undefined : byId(displays)), [displays]);

  const names = useMemo<ActivityNames>(
    () => ({ ...loaded, ...(displayNames === undefined ? {} : { display: displayNames }) }),
    [loaded, displayNames],
  );

  const refs = useMemo(() => (events === null ? [] : activityRefs(events)), [events]);

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
