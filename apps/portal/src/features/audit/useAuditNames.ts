import type { TagScope } from '@tinnox/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.ts';
import { isAbort } from '../../api/client.ts';
import type { AuditNames, AuditTargetKind } from '../../lib/auditView.ts';
import { mediaDisplayName } from '../../lib/mediaName.ts';

interface Loaded {
  readonly names: ReadonlyMap<string, string>;
  readonly tagScopes?: ReadonlyMap<string, TagScope>;
}

async function loadKind(kind: AuditTargetKind, signal: AbortSignal): Promise<Loaded> {
  switch (kind) {
    case 'display': {
      const list = await api.listDisplays(signal);
      return { names: new Map(list.map((item) => [item.id.toLowerCase(), item.name])) };
    }
    case 'media': {
      const list = await api.listMedia(signal);
      return {
        names: new Map(list.items.map((item) => [item.id.toLowerCase(), mediaDisplayName(item)])),
      };
    }
    case 'playlist': {
      const list = await api.listPlaylists(signal);
      return { names: new Map(list.map((item) => [item.id.toLowerCase(), item.name])) };
    }
    case 'tag': {
      const list = await api.listTags(undefined, signal);
      return {
        names: new Map(list.map((item) => [item.id.toLowerCase(), item.name])),
        tagScopes: new Map(list.map((item) => [item.id.toLowerCase(), item.scope])),
      };
    }
    case 'folder': {
      const list = await api.listFolders(signal);
      return { names: new Map(list.map((item) => [item.id.toLowerCase(), item.name])) };
    }
    case 'app': {
      const list = await api.listApps(signal);
      return { names: new Map(list.map((item) => [item.id.toLowerCase(), item.name])) };
    }
    case 'schedule': {
      const list = await api.listSchedules(signal);
      return { names: new Map(list.map((item) => [item.id.toLowerCase(), item.name])) };
    }
    case 'layout': {
      const list = await api.listLayouts(signal);
      return { names: new Map(list.map((item) => [item.id.toLowerCase(), item.name])) };
    }
  }
}

/**
 * The names of the objects the audit events point at. An event names its object by id only,
 * so each kind's list is read once, and only for the kinds the events on the page need. A
 * list that cannot be read stays unknown (null): the page then shows the id, never a guess.
 * `generation` reads the lists again (the page's Refresh), as objects may have been renamed
 * or deleted since.
 */
export function useAuditNames(kinds: readonly AuditTargetKind[], generation: number): AuditNames {
  const [loaded, setLoaded] = useState<{
    readonly generation: number;
    readonly byKind: ReadonlyMap<AuditTargetKind, Loaded>;
  }>({ generation, byKind: new Map() });
  const requested = useRef<{ generation: number; kinds: Set<AuditTargetKind> }>({
    generation,
    kinds: new Set(),
  });
  const controllers = useRef<AbortController[]>([]);

  useEffect(() => {
    if (requested.current.generation !== generation) {
      requested.current = { generation, kinds: new Set() };
    }
    for (const kind of kinds) {
      if (requested.current.kinds.has(kind)) continue;
      requested.current.kinds.add(kind);
      const controller = new AbortController();
      controllers.current.push(controller);
      loadKind(kind, controller.signal)
        .then((result) => {
          setLoaded((previous) => {
            const byKind = new Map(previous.generation === generation ? previous.byKind : []);
            byKind.set(kind, result);
            return { generation, byKind };
          });
        })
        .catch((error: unknown) => {
          // Unknown stays unknown; a later Refresh asks again.
          if (!isAbort(error)) requested.current.kinds.delete(kind);
        });
    }
  }, [kinds, generation]);

  useEffect(
    () => () => {
      for (const controller of controllers.current) controller.abort();
      controllers.current = [];
      // Mounted again (React's development double run): ask afresh.
      requested.current = { generation: Number.NaN, kinds: new Set() };
    },
    [],
  );

  return useMemo(() => {
    // Names of an earlier generation stay on screen until the new lists arrive.
    const byKind = loaded.byKind;
    const names = (kind: AuditTargetKind) => byKind.get(kind)?.names ?? null;
    return {
      display: names('display'),
      media: names('media'),
      playlist: names('playlist'),
      tag: names('tag'),
      folder: names('folder'),
      app: names('app'),
      schedule: names('schedule'),
      layout: names('layout'),
      tagScopes: byKind.get('tag')?.tagScopes ?? null,
    };
  }, [loaded]);
}
