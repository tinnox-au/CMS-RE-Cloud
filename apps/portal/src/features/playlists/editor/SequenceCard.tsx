import type { Limits, MediaDto } from '@tinnox/contracts';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from 'react';
import { mediaDisplayName } from '../../../lib/mediaName.ts';
import type { DraftItem } from '../../../lib/playlistDraft.ts';
import {
  dropSlotAt,
  durationRuleText,
  durationStepperBounds,
  edgeScrollSpeed,
  keptAnnouncement,
  loopLengthLabel,
  sequenceCountLabel,
  slotKeepsPlace,
  withCurrentMedia,
  type EditorDraft,
  type EditorErrors,
  type Span,
} from '../../../lib/playlistEditor.ts';
import { ListVideo } from '../../../ui/icons.ts';
import { Banner, Card, CardHeader, cx, Icon } from '../../../ui/index.ts';
import { ITEM_DRAG_TYPE, type DragSource } from './dragSource.ts';
import { SequenceTile, type TileAction } from './SequenceTile.tsx';
import './playlistEditor.css';

type DraftLimits = Pick<
  Limits,
  'minImageItemDurationMs' | 'maxImageItemDurationMs' | 'maxPlaylistItems'
>;

export interface SequenceCardProps {
  readonly draft: EditorDraft;
  readonly errors: EditorErrors;
  readonly limits: DraftLimits;
  readonly mediaById: ReadonlyMap<string, MediaDto>;
  readonly dragSource: RefObject<DragSource | null>;
  /** Adds a library item at a drop position; returns its index, or null when refused. */
  readonly onAdd: (media: MediaDto, slot?: number) => number | null;
  readonly onMove: (index: number, delta: number) => void;
  readonly onMoveToSlot: (fromIndex: number, slot: number) => void;
  readonly onRemove: (key: string) => void;
  readonly onChangeItem: (
    key: string,
    change: Partial<Pick<DraftItem, 'durationText' | 'fit'>>,
  ) => void;
  readonly onAnnounce: (text: string) => void;
}

type FocusRequest =
  | { readonly kind: 'tile'; readonly key: string; readonly action: TileAction }
  | { readonly kind: 'empty' };

function selectorFor(key: string, action: TileAction): string {
  return `[data-item-key="${CSS.escape(key)}"] [data-action="${action}"]`;
}

/**
 * The play order as a horizontal filmstrip. Tiles move with their buttons or by dragging
 * (the HTML drag-and-drop API); library cards can be dropped between tiles. While something
 * is dragged a bar shows where it would land, and the strip scrolls when the pointer nears
 * either edge. Escape cancels a drag; the browser then drops nothing.
 */
export function SequenceCard({
  draft,
  errors,
  limits,
  mediaById,
  dragSource,
  onAdd,
  onMove,
  onMoveToSlot,
  onRemove,
  onChangeItem,
  onAnnounce,
}: SequenceCardProps) {
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<FocusRequest | null>(null);
  const speed = useRef(0);
  const frame = useRef<number | null>(null);
  const knownKeys = useRef<ReadonlySet<string>>(new Set(draft.items.map((item) => item.key)));

  const items = draft.items;
  const nameOf = (item: DraftItem) => mediaDisplayName(mediaById.get(item.media.id) ?? item.media);
  const bounds = durationStepperBounds(limits);

  // After a move or a removal by button, focus goes where the reader expects it.
  // After an item is added from the library, the strip scrolls sideways to show it.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const request = focusRequest.current;
    focusRequest.current = null;
    if (request?.kind === 'empty') {
      emptyRef.current?.focus();
    } else if (request?.kind === 'tile' && scroller !== null) {
      const target = scroller.querySelector<HTMLElement>(selectorFor(request.key, request.action));
      if (target !== null) {
        if (document.activeElement !== target) target.focus({ preventScroll: true });
        target.closest('li')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
    const added = items.filter((item) => !knownKeys.current.has(item.key));
    knownKeys.current = new Set(items.map((item) => item.key));
    if (added.length === 1 && scroller !== null && request === null) {
      const [first] = added;
      const tile =
        first === undefined
          ? null
          : scroller.querySelector<HTMLElement>(`[data-item-key="${CSS.escape(first.key)}"]`);
      if (tile !== null) {
        // Sideways only: the reader stays where they are on the page.
        const box = tile.getBoundingClientRect();
        const view = scroller.getBoundingClientRect();
        const delta =
          box.left < view.left
            ? box.left - view.left - 16
            : box.right > view.right
              ? box.right - view.right + 16
              : 0;
        if (delta !== 0) scroller.scrollBy({ left: delta, behavior: 'smooth' });
      }
    }
  }, [items]);

  const stopScrolling = () => {
    speed.current = 0;
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  };

  const scrollStep = () => {
    const scroller = scrollerRef.current;
    if (scroller === null || speed.current === 0) {
      frame.current = null;
      return;
    }
    scroller.scrollLeft += speed.current;
    frame.current = window.requestAnimationFrame(scrollStep);
  };

  const endDrag = () => {
    stopScrolling();
    setDropSlot(null);
    setDraggingKey(null);
    dragSource.current = null;
  };

  // Whatever ends a drag (a drop anywhere, Escape, a drop outside the window), the bar goes.
  useEffect(() => {
    const onEnd = () => {
      dragSource.current = null;
      speed.current = 0;
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      setDropSlot(null);
      setDraggingKey(null);
    };
    document.addEventListener('dragend', onEnd);
    document.addEventListener('drop', onEnd);
    return () => {
      document.removeEventListener('dragend', onEnd);
      document.removeEventListener('drop', onEnd);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [dragSource]);

  const slotAt = (clientX: number): number => {
    const scroller = scrollerRef.current;
    if (scroller === null) return 0;
    const spans: Span[] = [];
    for (const tile of scroller.querySelectorAll<HTMLElement>('[data-tile]')) {
      const box = tile.getBoundingClientRect();
      spans.push({ start: box.left, end: box.right });
    }
    return dropSlotAt(spans, clientX);
  };

  const full = items.length >= limits.maxPlaylistItems;

  /** Accepts the drags of this editor only, and nothing more once the playlist is full. */
  const acceptDrag = (event: DragEvent<HTMLElement>): DragSource | null => {
    const source = dragSource.current;
    if (source === null) return null;
    if (source.kind === 'media' && full) {
      event.dataTransfer.dropEffect = 'none';
      return null;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = source.kind === 'item' ? 'move' : 'copy';
    return source;
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    const source = acceptDrag(event);
    if (source === null) return;
    const slot = slotAt(event.clientX);
    setDropSlot((previous) => (previous === slot ? previous : slot));
    const scroller = scrollerRef.current;
    if (scroller !== null) {
      const view = scroller.getBoundingClientRect();
      speed.current = edgeScrollSpeed(event.clientX, view.left, view.right);
      if (speed.current !== 0 && frame.current === null) {
        frame.current = window.requestAnimationFrame(scrollStep);
      }
    }
  };

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    stopScrolling();
    setDropSlot(null);
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    const source = acceptDrag(event);
    if (source === null) return;
    const slot = slotAt(event.clientX);
    if (source.kind === 'item') {
      const from = items.findIndex((item) => item.key === source.key);
      if (from >= 0) {
        if (slotKeepsPlace(from, slot)) {
          const item = items[from];
          if (item !== undefined) onAnnounce(keptAnnouncement(nameOf(item), from + 1));
        } else {
          onMoveToSlot(from, slot);
        }
      }
    } else {
      onAdd(source.media, slot);
    }
    endDrag();
  };

  const startTileDrag = (item: DraftItem, event: DragEvent<HTMLElement>) => {
    dragSource.current = { kind: 'item', key: item.key };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(ITEM_DRAG_TYPE, item.key);
    // The browser needs some plain data to start a drag in every engine.
    event.dataTransfer.setData('text/plain', nameOf(item));
    const tile = event.currentTarget.closest('li');
    if (tile !== null) event.dataTransfer.setDragImage(tile, 40, 40);
    setDraggingKey(item.key);
  };

  const endTileDrag = (item: DraftItem, index: number, event: DragEvent<HTMLElement>) => {
    if (event.dataTransfer.dropEffect === 'none') {
      onAnnounce(`Move cancelled. ${keptAnnouncement(nameOf(item), index + 1)}`);
    }
    endDrag();
  };

  const moveBy = (index: number, delta: -1 | 1) => {
    const item = items[index];
    if (item === undefined) return;
    focusRequest.current = { kind: 'tile', key: item.key, action: delta < 0 ? 'earlier' : 'later' };
    onMove(index, delta);
  };

  const removeAt = (index: number) => {
    const item = items[index];
    if (item === undefined) return;
    const neighbour = items[index + 1] ?? items[index - 1];
    focusRequest.current =
      neighbour === undefined
        ? { kind: 'empty' }
        : { kind: 'tile', key: neighbour.key, action: 'remove' };
    onRemove(item.key);
  };

  // A dragged tile dropped beside itself goes nowhere, so no bar is drawn there.
  const draggingIndex =
    draggingKey === null ? -1 : items.findIndex((item) => item.key === draggingKey);
  const shownSlot =
    dropSlot !== null && draggingIndex >= 0 && slotKeepsPlace(draggingIndex, dropSlot)
      ? null
      : dropSlot;

  return (
    <Card
      as="section"
      aria-labelledby="tx-playlist-editor-sequence"
      className="tx-playlist-editor-sequence"
      data-testid="playlist-editor-sequence"
    >
      <CardHeader
        id="tx-playlist-editor-sequence"
        title="Sequence"
        size="title"
        description={durationRuleText(limits)}
        actions={
          <p className="tx-playlist-editor-sequence__totals">
            <span data-testid="playlist-editor-item-count">{sequenceCountLabel(draft)}</span>
            <span aria-hidden="true">·</span>
            <span className="tx-num" data-testid="playlist-editor-loop-length">
              {loopLengthLabel(draft, limits)}
            </span>
          </p>
        }
      />

      {errors.form !== null && (
        <Banner tone="danger" className="tx-playlist-editor-sequence__error">
          {errors.form}
        </Banner>
      )}

      <div
        ref={scrollerRef}
        className={cx(
          'tx-playlist-editor-strip',
          dropSlot !== null && 'tx-playlist-editor-strip--target',
        )}
        onDragEnter={(event) => {
          acceptDrag(event);
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="playlist-editor-strip"
      >
        {items.length === 0 ? (
          <div
            ref={emptyRef}
            tabIndex={-1}
            className={cx(
              'tx-playlist-editor-empty',
              dropSlot !== null && 'tx-playlist-editor-empty--active',
            )}
            data-testid="playlist-editor-empty"
          >
            <span className="tx-playlist-editor-empty__icon">
              <Icon icon={ListVideo} />
            </span>
            <p className="tx-playlist-editor-empty__title">This playlist is empty</p>
            <p className="tx-playlist-editor-empty__text">
              Add ready media from the library below: choose a file, or drag it here. A playlist
              needs at least one item before it can be pushed.
            </p>
          </div>
        ) : (
          <ol className="tx-playlist-editor-strip__list" aria-label="Items in play order">
            {items.map((item, index) => {
              const current = withCurrentMedia(item, mediaById);
              return (
                <SequenceTile
                  key={item.key}
                  item={current}
                  index={index}
                  count={items.length}
                  error={errors.items[item.key]}
                  bounds={bounds}
                  dropBefore={shownSlot === index}
                  dropAfter={shownSlot === items.length && index === items.length - 1}
                  dragging={draggingKey === item.key}
                  onMove={(delta) => {
                    moveBy(index, delta);
                  }}
                  onRemove={() => {
                    removeAt(index);
                  }}
                  onChange={(change) => {
                    onChangeItem(item.key, change);
                  }}
                  onDragStart={(event) => {
                    startTileDrag(item, event);
                  }}
                  onDragEnd={(event) => {
                    endTileDrag(item, index, event);
                  }}
                />
              );
            })}
          </ol>
        )}
      </div>
      {items.length > 1 && (
        <p className="tx-playlist-editor-sequence__hint">
          Drag a picture to change the order, or use the arrow buttons under it.
        </p>
      )}
    </Card>
  );
}
