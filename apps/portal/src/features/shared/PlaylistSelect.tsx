import type { PlaylistSummaryDto } from '@tinnox/contracts';
import { ExternalLink } from '../../ui/icons.ts';
import { ButtonLink, Select, type FieldControlProps } from '../../ui/index.ts';
import './shared.css';

export interface PlaylistSelectProps {
  /** The ids and ARIA attributes a `Field` hands to its control. */
  readonly control: FieldControlProps;
  /** The chosen playlist id; '' while none is chosen. */
  readonly value: string;
  /** Every playlist, by name. */
  readonly playlists: readonly PlaylistSummaryDto[];
  /** Names of playlists the schedule or layout uses, for one that is not in `playlists`. */
  readonly knownNames: ReadonlyMap<string, string>;
  readonly disabled: boolean;
  readonly testId: string;
  /** The "Open playlist" link's test id. */
  readonly openTestId: string;
  readonly onChange: (playlistId: string) => void;
}

/**
 * A native select of every playlist with, beside it, a link to the chosen one. The link is
 * how an operator reaches the playlist a push issue names; the leave guard covers unsaved
 * changes.
 */
// shortcut: native selects list every playlist; switch to PlaylistPickerDialog when organisations have hundreds of playlists.
export function PlaylistSelect({
  control,
  value,
  playlists,
  knownNames,
  disabled,
  testId,
  openTestId,
  onChange,
}: PlaylistSelectProps) {
  const listed = value === '' || playlists.some((playlist) => playlist.id === value);
  return (
    <div className="tx-playlist-select">
      <Select
        {...control}
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">Choose a playlist</option>
        {/* The list is capped; a playlist the schedule or layout already uses stays choosable. */}
        {!listed && <option value={value}>{knownNames.get(value) ?? 'Unknown playlist'}</option>}
        {playlists.map((playlist) => (
          <option key={playlist.id} value={playlist.id}>
            {playlist.name}
          </option>
        ))}
      </Select>
      {value !== '' && (
        <ButtonLink
          size="sm"
          variant="ghost"
          icon={ExternalLink}
          to={`/playlists/${value}`}
          data-testid={openTestId}
        >
          Open playlist
        </ButtonLink>
      )}
    </div>
  );
}
