import { Card, Skeleton, SkeletonGroup } from '../../../ui/index.ts';

/** The page's shape while the screen loads: the summary card, the details and the tabs. */
export function ScreenDetailSkeleton() {
  return (
    <SkeletonGroup label="Loading screen" className="tx-editor tx-screen-detail">
      <Card className="tx-screen-detail-skeleton">
        <Skeleton width="45%" height="14px" />
        <Skeleton variant="block" height="180px" />
        <Skeleton width="70%" />
        <Skeleton variant="pill" width="120px" height="24px" />
        <Skeleton width="100%" />
        <Skeleton variant="pill" width="100%" height="36px" />
      </Card>
      <div className="tx-screen-detail__column">
        <Card className="tx-screen-detail-skeleton">
          <Skeleton width="20%" height="14px" />
          <Skeleton variant="block" height="36px" />
          <Skeleton variant="block" height="72px" />
        </Card>
        <Card className="tx-screen-detail-skeleton">
          <Skeleton width="20%" height="14px" />
          <Skeleton variant="block" height="64px" />
        </Card>
        <Card className="tx-screen-detail-skeleton">
          <Skeleton width="60%" height="20px" />
          <Skeleton width="100%" />
          <Skeleton width="90%" />
          <Skeleton width="80%" />
        </Card>
      </div>
    </SkeletonGroup>
  );
}
