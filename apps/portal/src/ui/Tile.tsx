import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Checkbox } from './Checkbox.tsx';
import { cssVars } from './cssVars.ts';
import { cx } from './cx.ts';
import { Skeleton } from './Skeleton.tsx';

export interface TileGridProps {
  /** Accessible name of the list: "Media". */
  readonly label: string;
  /** Tile elements. */
  readonly children: ReactNode;
  /** Smallest tile width in pixels before the grid drops a column. Default 220. */
  readonly minTileWidth?: number;
  readonly className?: string;
}

/** The grid view of a list page: as many equal columns as fit. */
export function TileGrid({ label, children, minTileWidth, className }: TileGridProps) {
  return (
    <ul
      className={cx('tx-tile-grid', className)}
      role="list"
      aria-label={label}
      style={
        minTileWidth === undefined ? undefined : cssVars({ '--tx-tile-min': `${minTileWidth}px` })
      }
    >
      {children}
    </ul>
  );
}

export interface TileProps {
  /** The object's name: a link when `to` is set. */
  readonly name: string;
  readonly to?: string;
  /** The picture: a Thumb, or a canvas-shaped preview. */
  readonly media: ReactNode;
  /** A line under the name: a kind icon, a status pill, a size. */
  readonly meta?: ReactNode;
  /** A Menu behind a three-dot IconButton. */
  readonly actions?: ReactNode;
  /** Adds the checkbox that shows on hover and focus and stays once ticked. */
  readonly selection?: {
    readonly selected: boolean;
    readonly onChange: (selected: boolean) => void;
    /** Names the object for the checkbox: "Foyer loop" gives "Select Foyer loop". */
    readonly label: string;
  };
  /** `data-testid` for the tile. */
  readonly testId?: string;
}

/** One card of a grid view. Render tiles inside a TileGrid. */
export function Tile({ name, to, media, meta, actions, selection, testId }: TileProps) {
  return (
    <li
      className="tx-tile"
      data-selected={selection?.selected === true ? '' : undefined}
      data-testid={testId}
    >
      <div className="tx-tile__media">
        {media}
        {selection !== undefined && (
          <span className="tx-tile__select">
            <Checkbox
              checked={selection.selected}
              aria-label={`Select ${selection.label}`}
              onChange={selection.onChange}
            />
          </span>
        )}
      </div>
      <div className="tx-tile__body">
        <div className="tx-tile__text">
          {to === undefined ? (
            <span className="tx-tile__name" title={name}>
              {name}
            </span>
          ) : (
            <Link className="tx-tile__name" to={to} title={name}>
              {name}
            </Link>
          )}
          {meta !== undefined && <div className="tx-tile__meta">{meta}</div>}
        </div>
        {actions !== undefined && <div className="tx-tile__actions">{actions}</div>}
      </div>
    </li>
  );
}

/**
 * A placeholder tile for a grid that is loading. Render a handful inside a TileGrid, and say
 * "Loading" once next to it (SkeletonGroup, or a visually hidden status).
 */
export function TileSkeleton() {
  return (
    <li className="tx-tile tx-tile--skeleton" aria-hidden="true">
      <Skeleton variant="block" className="tx-tile__skeleton" />
      <div className="tx-tile__body">
        <div className="tx-tile__text">
          <Skeleton width="68%" />
          <Skeleton width="40%" />
        </div>
      </div>
    </li>
  );
}
