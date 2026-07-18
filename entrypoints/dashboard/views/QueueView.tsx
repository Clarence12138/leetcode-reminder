import type { DailySummary, ProblemRecord, SubmissionReview } from '../../../src/domain/types';
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
          <p className="panel__hint">待评估记录尚未创建复习排期。请根据本次解题的真实感受选择掌握程度。</p>
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
  return (
    <article className="pending-card">
      <div className="pending-card__top">
        <span><Icon name="check" size={15} /></span>
        <div><strong>{problemName(problem, review)}</strong><time>{formatDateTime(review.acceptedAt)} 通过</time></div>
      </div>
      <RatingButtons onRated={onRated} submissionId={review.submissionId} />
    </article>
  );
}

function compareDueDate(left: ProblemRecord, right: ProblemRecord): number {
  return (left.nextReviewAt ?? 0) - (right.nextReviewAt ?? 0);
}
