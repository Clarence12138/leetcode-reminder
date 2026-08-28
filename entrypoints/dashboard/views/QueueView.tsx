import { useState } from 'react';
import type { DailySummary, ProblemRecord, SubmissionReview } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { EmptyState, PageHeading } from '../../../src/ui/components';
import { formatDateTime, problemName } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';
import { RatingButtons } from '../../../src/ui/rating';
import { Panel, ProblemRow } from './ViewParts';

export function QueueView({ summary, refresh }: { readonly refresh: () => Promise<void>; readonly summary: DailySummary }): React.ReactElement {
  const problemMap = new Map(summary.problems.map((problem) => [problem.problemId, problem]));
  const dueProblems = [...summary.dueProblems].sort(compareDueDate);
  return (
    <div className="view-content">
      <PageHeading description="先为新通过的提交评分，再完成今日和逾期的复习。" title="待处理队列" />
      {summary.pendingReviews.length > 0 && (
        <Panel className="pending-panel" title={`待评估 · ${summary.pendingReviews.length}`}>
          <p className="panel__hint">待评估记录尚未创建复习排期。请根据本次解题的真实感受选择掌握程度，或丢弃不需要记录的提交。</p>
          <div className="pending-grid">
            {summary.pendingReviews.map((review) => (
              <PendingCard key={review.submissionId} onRated={refresh} problem={problemMap.get(review.problemId)} review={review} />
            ))}
          </div>
        </Panel>
      )}
      <Panel title={`今日 / 逾期 · ${dueProblems.length}`}>
        {dueProblems.length === 0
          ? <EmptyState description="目前没有需要复习的题目。下次到期后，我会在每日提醒中告诉你。" icon="sparkle" title="队列已清空" />
          : <div className="rows due-rows">{dueProblems.map((problem) => <ProblemRow key={problem.problemId} problem={problem} />)}</div>}
      </Panel>
    </div>
  );
}

function PendingCard({ onRated, problem, review }: { readonly onRated: () => Promise<void>; readonly problem: ProblemRecord | undefined; readonly review: SubmissionReview }): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = problem?.title ?? review.problemId;
  const discard = async (): Promise<void> => {
    if (!confirming) { setConfirming(true); return; }
    setDiscarding(true);
    setError(null);
    try {
      await sendExtensionRequest({ type: 'submission.discard', payload: { submissionId: review.submissionId } });
      await onRated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '丢弃失败');
      setDiscarding(false);
    }
  };
  return (
    <article className="pending-card">
      <div className="pending-card__top">
        <span><Icon name="check" size={15} /></span>
        <div><strong>{problemName(problem, review)}</strong><time>{formatDateTime(review.acceptedAt)} 通过</time></div>
        <button
          aria-label={`${confirming ? '确认丢弃' : '丢弃'}${title}`}
          className={`pending-card__discard${confirming ? ' is-confirming' : ''}`}
          disabled={discarding}
          onBlur={() => setConfirming(false)}
          onClick={() => void discard()}
          type="button"
        >
          <Icon name="trash" size={14} />
          <span>{confirming ? '再点一次确认' : '丢弃'}</span>
        </button>
      </div>
      <RatingButtons disabled={discarding} onRated={onRated} submissionId={review.submissionId} />
      {error && <span className="field-error" role="alert">{error}</span>}
    </article>
  );
}

function compareDueDate(left: ProblemRecord, right: ProblemRecord): number {
  return (left.nextReviewAt ?? 0) - (right.nextReviewAt ?? 0);
}
