import { Card, Skeleton, SkeletonGroup } from '../../../ui/index.ts';
import './playlistEditor.css';

const TILES = [0, 1, 2, 3];
const CARDS = [0, 1, 2, 3, 4, 5];

/** The shape of the editor while the playlist loads: no spinner, the cards in their places. */
export function EditorSkeleton() {
  return (
    <SkeletonGroup label="Loading playlist" className="tx-playlist-editor">
      <div className="tx-playlist-editor__layout">
        <Card className="tx-stack">
          <Skeleton width="120px" height="24px" />
          <Skeleton width="60%" />
          <div className="tx-playlist-editor__skeleton-strip">
            {TILES.map((tile) => (
              <Skeleton key={tile} variant="block" height="292px" />
            ))}
          </div>
        </Card>
        <div className="tx-playlist-editor__side">
          <Card className="tx-stack">
            <Skeleton width="96px" height="24px" />
            <Skeleton variant="block" height="44px" />
            <Skeleton variant="block" height="80px" />
          </Card>
          <Card className="tx-stack">
            <Skeleton width="72px" height="24px" />
            <Skeleton width="80%" />
            <Skeleton variant="block" height="48px" />
          </Card>
        </div>
      </div>
      <Card className="tx-stack">
        <Skeleton width="160px" height="24px" />
        <Skeleton variant="pill" width="280px" height="40px" />
        <div className="tx-playlist-editor__library-grid">
          {CARDS.map((card) => (
            <Skeleton key={card} variant="block" height="150px" />
          ))}
        </div>
      </Card>
    </SkeletonGroup>
  );
}
