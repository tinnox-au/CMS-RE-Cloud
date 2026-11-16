import { Card, Skeleton, SkeletonGroup } from '../../../ui/index.ts';
import './media-detail.css';

const FORM_ROWS = ['name', 'description', 'duration', 'folder', 'tags'] as const;

/** The cards of the page in outline while the file is read. */
export function MediaDetailSkeleton() {
  return (
    <SkeletonGroup label="Loading the file" className="tx-editor">
      <div className="tx-media-detail-aside" data-testid="media-detail-loading">
        <Card className="tx-media-detail-part tx-media-detail-part--preview">
          <Skeleton variant="block" height="200px" />
          <Skeleton width="30%" />
        </Card>
        <Card className="tx-media-detail-skeleton">
          <Skeleton width="45%" height="20px" />
          <div className="tx-media-detail-skeleton__row">
            <Skeleton width="85%" />
            <Skeleton width="70%" />
            <Skeleton width="78%" />
            <Skeleton width="60%" />
          </div>
        </Card>
      </div>
      <Card className="tx-media-detail-skeleton">
        <Skeleton width="20%" />
        {FORM_ROWS.map((row) => (
          <div key={row} className="tx-media-detail-skeleton__field">
            <Skeleton width="120px" />
            <Skeleton variant="block" height={row === 'description' ? '84px' : '36px'} />
          </div>
        ))}
      </Card>
    </SkeletonGroup>
  );
}
