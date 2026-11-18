import { ABSOLUTE, type LayoutZoneInput } from '@tinnox/contracts';
import { effectiveContentRect } from '@tinnox/domain';
import { useId, useState } from 'react';
import { api } from '../../api/index.ts';
import { useLoad } from '../../hooks/useLoad.ts';
import { previewShapes } from '../../lib/apps.ts';
import { zoneLabel, zoneSizes, zoneSizeSentence } from '../../lib/layouts.ts';
import { Banner, Card, CardHeader, cssVars, Field, Select } from '../../ui/index.ts';
import { CanvasFrame } from '../displays/detail/CanvasFrame.tsx';
import './layouts.css';

const loadDisplays = (signal: AbortSignal) => api.listDisplays(signal);

function percent(part: number, whole: number): string {
  return `${String((part / whole) * 100)}%`;
}

export interface LayoutPreviewProps {
  /** The zones the draft stands for (`draftZones`); null while the band height is not valid. */
  readonly zones: readonly LayoutZoneInput[] | null;
  /** True for the preset: zone 1 is called "Band". */
  readonly preset: boolean;
  /** Playlist names by id, for the zone labels. */
  readonly playlistNames: ReadonlyMap<string, string>;
}

/**
 * The zones of the draft drawn on a screen shape: landscape or portrait full HD, or one of
 * the organisation's screens with its content rectangle. Each zone is an outline placed from
 * the pixel rectangle a push would give it (`zoneSizes`), so the preview rounds as the player
 * does. The frame is a picture: its accessible description gives the pixel sizes, and a zone
 * under 16 px is named in a warning, never shown by colour alone.
 */
// shortcut: zone outlines only, no live content or 1:1 zoom in the preview.
export function LayoutPreview({ zones, preset, playlistNames }: LayoutPreviewProps) {
  const titleId = useId();
  const [shapeValue, setShapeValue] = useState('landscape');
  const displays = useLoad(loadDisplays);
  const shapes = previewShapes(displays.state.status === 'ready' ? displays.state.data : []);
  const option = shapes.find((candidate) => candidate.value === shapeValue) ?? shapes[0];
  const shape = option?.shape ?? null;
  const shown = zones === null ? null : shape;

  const labels = (zones ?? []).map((_zone, index) => zoneLabel(index, preset));
  const sizes = shown === null || zones === null ? [] : zoneSizes(shown, zones);
  const area =
    shown === null
      ? null
      : effectiveContentRect(shown.canvas, shown.contentRectOutOfBounds ? null : shown.contentRect);
  const small = sizes.flatMap((size, index) => (size.tooSmall ? [{ index, rect: size.rect }] : []));

  return (
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader id={titleId} title="Preview" size="title" />
      <div className="tx-layout-preview">
        <Field label="Preview on">
          {(control) => (
            <Select
              {...control}
              value={option?.value ?? 'landscape'}
              data-testid="layout-preview-shape"
              onChange={(event) => {
                setShapeValue(event.target.value);
              }}
            >
              {shapes.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <CanvasFrame
          shape={shown}
          size="xl"
          description={
            shown === null || zones === null ? undefined : zoneSizeSentence(shown, zones, labels)
          }
          emptyText="Enter a band height from 5 to 50 to see the zones."
          testId="layout-preview"
        >
          {area !== null &&
            sizes.map(({ rect }, index) => {
              const playlistId = zones?.[index]?.playlistId ?? '';
              const name =
                playlistId === ''
                  ? 'no playlist chosen'
                  : (playlistNames.get(playlistId) ?? 'Unknown playlist');
              return (
                <div
                  key={index}
                  className="tx-layout-preview__zone"
                  data-testid={`layout-preview-zone-${String(index)}`}
                  style={cssVars({
                    '--tx-zone-left': percent(rect.x - area.x, area.width),
                    '--tx-zone-top': percent(rect.y - area.y, area.height),
                    '--tx-zone-width': percent(rect.width, area.width),
                    '--tx-zone-height': percent(rect.height, area.height),
                  })}
                >
                  <span className="tx-layout-preview__label">
                    {labels[index]}: {name}
                  </span>
                </div>
              );
            })}
        </CanvasFrame>
        {option !== undefined && small.length > 0 && (
          <div data-testid="layout-preview-warning">
            <Banner tone="warn" live="polite">
              {small.map(({ index, rect }) => (
                <p key={index}>
                  {`On ${option.label}, the ${(labels[index] ?? '').toLowerCase()} is ${String(rect.width)} × ${String(rect.height)} px.`}{' '}
                  {`A zone needs at least ${String(ABSOLUTE.minCanvasSidePx)} px each way, so screens of this shape cannot show this layout. Make it larger.`}
                </p>
              ))}
            </Banner>
          </div>
        )}
      </div>
    </Card>
  );
}
