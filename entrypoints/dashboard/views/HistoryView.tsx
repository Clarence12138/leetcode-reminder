import type { DailySummary, MasteryRating, ProblemRecord, SubmissionReview } from '../../../src/domain/types';
import { EmptyState, PageHeading } from '../../../src/ui/components';
import { formatDateTime, problemName, ratingLabel } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';

export function HistoryView({ summary }: { readonly summary: DailySummary }): React.ReactElement {
  const problemMap = new Map(summary.problems.map((problem) => [problem.problemId, problem]));
  return (
    <div className="view-content">
      <PageHeading description="每个 Accepted 提交会保留一条记录，晚评分也会按通过时间正确重放。" title="复习历史" />
      <section className="history-list">
        {summary.recentReviews.length === 0
          ? <EmptyState description="在力扣中通过题目并选择掌握程度后，就会留下复习记录。" icon="history" title="还没有历史记录" />
          : summary.recentReviews.map((review) => <HistoryItem key={review.submissionId} problem={problemMap.get(review.problemId)} review={review} />)}
      </section>
    </div>
  );
}

function HistoryItem({ problem, review }: { readonly problem: ProblemRecord | undefined; readonly review: SubmissionReview }): React.ReactElement {
  return (
    <article className="history-item">
      <span className={`history-item__mark ${review.rating ? 'is-rated' : ''}`}><Icon name={review.rating ? 'check' : 'clock'} size={17} /></span>
      <div className="history-item__main">
        <strong>{problemName(problem, review)}</strong>
        <span>{review.trigger === 'keyboard' ? 'Command / Ctrl + Enter' : '点击提交'} · 提交 {review.submissionId}</span>
      </div>
      <RatingPill rating={review.rating} />
      <time>{formatDateTime(review.acceptedAt)}</time>
    </article>
  );
}

function RatingPill({ rating }: { readonly rating: MasteryRating | null }): React.ReactElement {
  if (rating === null) return <span className="rating-pill rating-pill--pending">待评估</span>;
  return <span className={`rating-pill rating-pill--${rating.toLowerCase()}`}>{ratingLabel[rating]}</span>;
}
