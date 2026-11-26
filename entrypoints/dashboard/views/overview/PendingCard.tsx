import { useState } from 'react';
import type { ProblemRecord, SubmissionReview } from '../../../../src/domain/types';
import { sendExtensionRequest } from '../../../../src/shared/messaging';
import { Card, IconButton } from '../../../../src/ui/components';
import { formatDateTime } from '../../../../src/ui/format';
import { RatingButtons } from '../../../../src/ui/rating';
import { problemLabel } from './overview-model';

const COLLAPSE_MS = 320;

export function PendingCard({ problemMap, refresh, reviews }: {
  readonly problemMap: ReadonlyMap<string, ProblemRecord>;
  readonly refresh: () => Promise<void>;
  readonly reviews: readonly SubmissionReview[];
}): React.ReactElement {
  return (
    <Card aside="评完才会生成排期" className="ov-pending" id="pending-reviews" title={<>待评估 <span className="num">{reviews.length}</span></>}>
      {reviews.length === 0
        ? <p className="ov-ok">都评完了，没有待评估的提交。</p>
        : reviews.map((review) => (
          <PendingItem key={review.submissionId} problem={problemMap.get(review.problemId)} refresh={refresh} review={review} />
        ))}
    </Card>
  );
}

function PendingItem({ problem, refresh, review }: {
  readonly problem: ProblemRecord | undefined;
  readonly refresh: () => Promise<void>;
  readonly review: SubmissionReview;
}): React.ReactElement {
  const [gone, setGone] = useState(false);
  const { confirming, discard, discarding, error, setConfirming } = useDiscard(review.submissionId, refresh);
  const name = problem ? problemLabel(problem) : review.problemId;
  const title = problem?.title ?? review.problemId;
  /** 评完先收起这一行，动画播完再刷新数据。 */
  const handleRated = async (): Promise<void> => {
    setGone(true);
    await new Promise((resolve) => setTimeout(resolve, COLLAPSE_MS));
    await refresh();
  };

  /** 撤销后这一行必须重新可见、可评分。 */
  const handleUndone = async (): Promise<void> => {
    setGone(false);
    await refresh();
  };

  return (
    <div className={gone ? 'pend gone' : 'pend'}>
      <div className="pend-top">
        <b>{name}</b>
        <span className="pend-meta">
          <small>{formatDateTime(review.acceptedAt)} 通过</small>
          <IconButton
            bare
            disabled={discarding}
            icon="trash"
            label={`${confirming ? '确认丢弃' : '丢弃'}${title}`}
            onBlur={() => setConfirming(false)}
            onClick={() => void discard()}
            size="sm"
            title={confirming ? '再点一次确认丢弃' : '丢弃这次提交'}
          />
          {confirming && <small className="pend-confirm" role="status">再点一次确认</small>}
        </span>
      </div>
      <RatingButtons
        disabled={discarding}
        onRated={handleRated}
        onUndone={handleUndone}
        problemId={review.problemId}
        submissionId={review.submissionId}
      />
      {error && <span className="ov-error" role="alert">{error}</span>}
    </div>
  );
}

function useDiscard(submissionId: string, refresh: () => Promise<void>): {
  readonly confirming: boolean;
  readonly discard: () => Promise<void>;
  readonly discarding: boolean;
  readonly error: string | null;
  readonly setConfirming: (value: boolean) => void;
} {
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const discard = async (): Promise<void> => {
    if (!confirming) { setConfirming(true); return; }
    setDiscarding(true);
    setError(null);
    try {
      await sendExtensionRequest({ type: 'submission.discard', payload: { submissionId } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '丢弃失败');
      setDiscarding(false);
    }
  };
  return { confirming, discard, discarding, error, setConfirming };
}
