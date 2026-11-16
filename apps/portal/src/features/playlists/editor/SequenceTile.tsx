import type { FitMode } from '@tinnox/contracts';
import type { DragEvent } from 'react';
import { mediaFailureText } from '../../../lib/mediaDetailFacts.ts';
import { mediaDisplayName, presentMediaStatus } from '../../../lib/mediaName.ts';
import type { DraftItem } from '../../../lib/playlistDraft.ts';
import {
  FIT_CHOICES,
  fitLabel,
  itemNotReadyMessage,
  libraryMetaLabel,
  videoLengthLabel,
} from '../../../lib/playlistEditor.ts';
import { ArrowLeft, ArrowRight, ChevronDown, GripVertical, Trash } from '../../../ui/icons.ts';
import {
  Button,
  cx,
  Field,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  StatusPill,
  Stepper,
  VisuallyHidden,
} from '../../../ui/index.ts';
import { MediaThumb } from '../../shared/index.ts';
import './playlistEditor.css';

/** The controls of a tile that keep focus across a move; marked with `data-action`. */
export type TileAction = 'earlier' | 'later' | 'remove';

export interface SequenceTileProps {
  /** The item, with the media record as the library holds it now. */
  readonly item: DraftItem;
  readonly index: number;
  readonly count: number;
  readonly error: string | undefined;
  readonly bounds: { readonly min: number; readonly max: number };
  /** A dragged item would land just before this tile, or (for the last tile) just after it. */
  readonly dropBefore: boolean;
  readonly dropAfter: boolean;
  /** This tile is the one being dragged. */
  readonly dragging: boolean;
  readonly onMove: (delta: -1 | 1) => void;
  readonly onRemove: () => void;
  readonly onChange: (change: Partial<Pick<DraftItem, 'durationText' | 'fit'>>) => void;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
  readonly onDragEnd: (event: DragEvent<HTMLElement>) => void;
}

/**
 * One item of the filmstrip: the picture (the drag handle), its place in the play order, its
 * name, how long it shows, how it fits the screen, and buttons to move or remove it. The
 * buttons are the keyboard and assistive-technology equivalent of dragging.
 */
export function SequenceTile({
  item,
  index,
  count,
  error,
  bounds,
  dropBefore,
  dropAfter,
  dragging,
  onMove,
  onRemove,
  onChange,
  onDragStart,
  onDragEnd,
}: SequenceTileProps) {
  const { media } = item;
  const name = mediaDisplayName(media);
  const position = index + 1;
  const notReady = itemNotReadyMessage(media);
  const failure = media.status === 'failed' ? mediaFailureText(media) : null;
  const status = presentMediaStatus(media.status);

  return (
    <li
      className={cx(
        'tx-playlist-editor-tile',
        dropBefore && 'tx-playlist-editor-tile--drop-before',
        dropAfter && 'tx-playlist-editor-tile--drop-after',
        dragging && 'tx-playlist-editor-tile--dragging',
        (error !== undefined || notReady !== null) && 'tx-playlist-editor-tile--invalid',
      )}
      data-tile=""
      data-item-key={item.key}
      data-media-id={media.id}
      data-position={position}
      data-testid="playlist-editor-item"
    >
      <div
        className="tx-playlist-editor-tile__handle"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <MediaThumb media={media} size="fill" ratio="wide" />
        <span className="tx-playlist-editor-tile__position tx-num" aria-hidden="true">
          {position}
        </span>
        <span className="tx-playlist-editor-tile__grip" aria-hidden="true">
          <Icon icon={GripVertical} size={16} />
        </span>
      </div>

      <div className="tx-playlist-editor-tile__body">
        <h3 className="tx-playlist-editor-tile__name">
          <VisuallyHidden>{`Item ${position} of ${count}: `}</VisuallyHidden>
          <span className="tx-truncate">{name}</span>
        </h3>
        <p className="tx-playlist-editor-tile__meta tx-truncate">{libraryMetaLabel(media)}</p>

        {notReady !== null && (
          <div className="tx-playlist-editor-tile__problem">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <p>{notReady}</p>
            {failure !== null && (
              <p>
                {failure.message}{' '}
                {failure.code !== null && <span className="tx-code">{failure.code}</span>}
              </p>
            )}
          </div>
        )}

        {media.kind === 'image' ? (
          <Field label="Seconds on screen" error={error} className="tx-playlist-editor-tile__field">
            {(control) => (
              <Stepper
                {...control}
                value={item.durationText}
                min={bounds.min}
                max={bounds.max}
                unit="s"
                stepLabel={`time on screen of ${name}`}
                data-testid="playlist-editor-item-duration"
                onChange={(durationText) => {
                  onChange({ durationText });
                }}
              />
            )}
          </Field>
        ) : (
          <div className="tx-playlist-editor-tile__fixed">
            <span className="tx-playlist-editor-tile__label">Length</span>
            <span className="tx-playlist-editor-tile__value">
              <span className="tx-num" data-testid="playlist-editor-item-length">
                {videoLengthLabel(media)}
              </span>
              <span className="tx-muted">· plays in full</span>
            </span>
          </div>
        )}

        <div className="tx-playlist-editor-tile__fit">
          <span className="tx-playlist-editor-tile__label" aria-hidden="true">
            Fit
          </span>
          <Menu
            placement="bottom-start"
            trigger={(props) => (
              <Button
                {...props}
                size="sm"
                variant="secondary"
                trailingIcon={ChevronDown}
                aria-label={`Fit for ${name}: ${fitLabel(item.fit)}`}
                className="tx-playlist-editor-tile__fit-button"
                data-testid="playlist-editor-item-fit"
              >
                {fitLabel(item.fit)}
              </Button>
            )}
          >
            {FIT_CHOICES.map((choice) => (
              <MenuItem
                key={choice.label}
                type="radio"
                checked={choice.value === item.fit}
                hint={choice.hint}
                onSelect={() => {
                  const fit: FitMode | null = choice.value;
                  onChange({ fit });
                }}
              >
                {choice.label}
              </MenuItem>
            ))}
          </Menu>
        </div>
      </div>

      <div className="tx-playlist-editor-tile__actions">
        <IconButton
          icon={ArrowLeft}
          size="sm"
          label={`Move ${name} earlier`}
          aria-disabled={index === 0 || undefined}
          data-action="earlier"
          data-testid="playlist-editor-item-earlier"
          onClick={() => {
            onMove(-1);
          }}
        />
        <IconButton
          icon={ArrowRight}
          size="sm"
          label={`Move ${name} later`}
          aria-disabled={index === count - 1 || undefined}
          data-action="later"
          data-testid="playlist-editor-item-later"
          onClick={() => {
            onMove(1);
          }}
        />
        <span className="tx-playlist-editor-tile__spacer" />
        <IconButton
          icon={Trash}
          size="sm"
          variant="danger"
          label={`Remove ${name} from position ${position}`}
          data-action="remove"
          data-testid="playlist-editor-item-remove"
          onClick={onRemove}
        />
      </div>
    </li>
  );
}
