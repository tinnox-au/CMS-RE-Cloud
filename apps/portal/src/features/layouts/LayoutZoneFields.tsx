import type { PlaylistSummaryDto } from '@tinnox/contracts';
import { Field } from '../../ui/index.ts';
import { PlaylistSelect } from '../shared/index.ts';
import './layouts.css';

export interface LayoutZoneFieldsProps {
  /** Position in the layout, from 0; 0 is the main zone. */
  readonly index: number;
  /** "Main zone", "Band", "Zone 3" (`zoneLabel`). */
  readonly label: string;
  /** True for the band of the preset, which gets the hint about text apps. */
  readonly band: boolean;
  /** The chosen playlist id; '' while none is chosen. */
  readonly playlistId: string;
  readonly error: string | undefined;
  readonly playlists: readonly PlaylistSummaryDto[];
  readonly knownNames: ReadonlyMap<string, string>;
  /** A save is running: nothing can be changed. */
  readonly disabled: boolean;
  readonly onChange: (playlistId: string) => void;
}

/**
 * One zone of the layout editor: a fieldset named after the zone, so its Playlist select and
 * the link beside it have a name of their own however many zones the layout has.
 */
export function LayoutZoneFields({
  index,
  label,
  band,
  playlistId,
  error,
  playlists,
  knownNames,
  disabled,
  onChange,
}: LayoutZoneFieldsProps) {
  const testId = `layout-zone-${String(index)}`;
  return (
    <div className="tx-layout-zone">
      <fieldset className="tx-layout-zone__fields" data-testid={testId}>
        <legend className="tx-layout-zone__legend">{label}</legend>
        <Field
          label="Playlist"
          error={error}
          hint={
            band
              ? 'Put a Ticker or Text app in the band; its text is sized to the band.'
              : undefined
          }
          required
        >
          {(control) => (
            <PlaylistSelect
              control={control}
              value={playlistId}
              playlists={playlists}
              knownNames={knownNames}
              disabled={disabled}
              testId={`${testId}-playlist`}
              openTestId={`${testId}-open`}
              onChange={onChange}
            />
          )}
        </Field>
      </fieldset>
    </div>
  );
}
