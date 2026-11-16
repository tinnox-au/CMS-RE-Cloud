import { Card, Skeleton, SkeletonGroup } from '../../../ui/index.ts';
import './playlistEditor.css';

const TILES = [0, 1, 2, 3];
const CARDS = [0, 1, 2, 3, 4, 5];

/** The shape of the editor while the playlist loads: no spinner, the cards in their places. */
export function EditorSkeleton() {
  return (
    <SkeletonGroup label="Loading playlist" className="tx-playlist-editor">
      <div className="tx-playlist-editor__top">
        <Card className="tx-stack">
          <Skeleton width="72px" height="14px" />
          <Skeleton variant="block" height="36px" />
          <Skeleton variant="block" height="72px" />
        </Card>
        <Card className="tx-stack">
          <Skeleton width="56px" height="14px" />
          <Skeleton width="80%" />
          <Skeleton variant="block" height="48px" />
        </Card>
      </div>
      <Card className="tx-stack">
        <Skeleton width="96px" height="14px" />
        <div className="tx-playlist-editor__skeleton-strip">
          {TILES.map((tile) => (
            <Skeleton key={tile} variant="block" height="292px" />
          ))}
        </div>
      </Card>
      <Card className="tx-stack">
        <Skeleton width="140px" height="18px" />
        <Skeleton variant="pill" width="280px" height="36px" />
        <div className="tx-playlist-editor__library-grid">
          {CARDS.map((card) => (
            <Skeleton key={card} variant="block" height="150px" />
          ))}
        </div>
      </Card>
    </SkeletonGroup>
  );
}
