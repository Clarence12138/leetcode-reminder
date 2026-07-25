import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DailySummary, ProblemRecord, SubmissionReview } from '../../src/domain/types';
import { sendExtensionRequest } from '../../src/shared/messaging';
import { Brand, Button, DifficultyBadge, EmptyState, InlineNotice, LoadingState } from '../../src/ui/components';
import { formatDateTime, problemName } from '../../src/ui/format';
import { Icon } from '../../src/ui/Icon';
import { RatingButtons } from '../../src/ui/rating';
import { openDashboard } from '../../src/ui/runtime';

const RECENT_LIMIT = 4;
const PENDING_LIMIT = 2;

export function PopupApp(): React.ReactElement {
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (): Promise<void> => {
    try {
      setSummary(await fetchSummary());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取复习数据');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchSummary().then(
      (result) => { if (active) { setSummary(result); setError(null); } },
      (cause: unknown) => { if (active) setError(toLoadError(cause)); },
    );
    return () => { active = false; };
  }, []);

  if (!summary && !error) return <PopupFrame><LoadingState /></PopupFrame>;
  if (!summary) return <PopupFrame><LoadError message={error ?? '未知错误'} onRetry={load} /></PopupFrame>;
  return <PopupFrame><PopupContent onRefresh={load} summary={summary} /></PopupFrame>;
}

function PopupFrame({ children }: React.PropsWithChildren): React.ReactElement {
  return (
    <main className="popup-shell">
      <header className="popup-header">
        <Brand />
        <button aria-label="打开完整面板" className="icon-button" onClick={() => openDashboard()} type="button">
          <Icon name="external" size={17} />
        </button>
      </header>
      {children}
    </main>
  );
}

function PopupContent({ onRefresh, summary }: { readonly onRefresh: () => Promise<void>; readonly summary: DailySummary }): React.ReactElement {
  const problemMap = useMemo(() => new Map(summary.problems.map((problem) => [problem.problemId, problem])), [summary.problems]);
  const dueCount = summary.dueProblems.length;
  const pendingCount = summary.pendingReviews.length;
  const unreadIssueCount = summary.issues.filter((issue) => issue.readAt === null).length;
  return (
    <>
      <ReviewHero dueCount={dueCount} pendingCount={pendingCount} />
      {pendingCount > 0 && (
        <PopupSection actionLabel="查看全部" onAction={() => openDashboard('#queue')} title="待评估">
          <div className="popup-list">
            {summary.pendingReviews.slice(0, PENDING_LIMIT).map((review) => (
              <PendingReviewItem key={review.submissionId} onRefresh={onRefresh} problem={problemMap.get(review.problemId)} review={review} />
            ))}
          </div>
        </PopupSection>
      )}
      <PopupSection actionLabel="完整记录" onAction={() => openDashboard('#history')} title="最近记录">
        <RecentList problemMap={problemMap} reviews={summary.recentReviews} />
      </PopupSection>
      {unreadIssueCount > 0 && (
        <InlineNotice tone="error">有 {unreadIssueCount} 条检测异常待查看</InlineNotice>
      )}
      <footer className="popup-footer">
        <span>数据仅保存在当前浏览器</span>
        <button onClick={() => openDashboard('#settings')} type="button">设置</button>
      </footer>
    </>
  );
}

function ReviewHero({ dueCount, pendingCount }: { readonly dueCount: number; readonly pendingCount: number }): React.ReactElement {
  const allClear = dueCount === 0 && pendingCount === 0;
  return (
    <section className={`review-hero ${allClear ? 'review-hero--clear' : ''}`}>
      <span className="review-hero__eyebrow"><Icon name={allClear ? 'sparkle' : 'calendar'} size={15} /> 今日学习</span>
      {allClear ? (
        <><h1>今天的复习已完成</h1><p>很好，下次到期时我会提醒你。</p></>
      ) : (
        <><div className="review-hero__numbers"><strong>{dueCount}</strong><span>题待复习</span><i /><strong>{pendingCount}</strong><span>条待评估</span></div><p>先处理到期题目，再为新通过的提交选择掌握程度。</p></>
      )}
      <Button icon="chevron" onClick={() => openDashboard('#queue')} tone="primary">去复习</Button>
    </section>
  );
}

function PendingReviewItem({ onRefresh, problem, review }: { readonly onRefresh: () => Promise<void>; readonly problem: ProblemRecord | undefined; readonly review: SubmissionReview }): React.ReactElement {
  return (
    <article className="pending-item">
      <div><strong>{problemName(problem, review)}</strong><time>{formatDateTime(review.acceptedAt)} 通过</time></div>
      <RatingButtons onRated={onRefresh} submissionId={review.submissionId} />
    </article>
  );
}

function RecentList({ problemMap, reviews }: { readonly problemMap: ReadonlyMap<string, ProblemRecord>; readonly reviews: readonly SubmissionReview[] }): React.ReactElement {
  if (reviews.length === 0) return <EmptyState description="在力扣中通过题目后，记录会出现在这里。" icon="history" title="还没有复习记录" />;
  return (
    <div className="recent-list">
      {reviews.slice(0, RECENT_LIMIT).map((review) => {
        const problem = problemMap.get(review.problemId);
        return (
          <article className="recent-item" key={review.submissionId}>
            <span className="recent-item__check"><Icon name="check" size={14} /></span>
            <div><strong>{problemName(problem, review)}</strong><time>{formatDateTime(review.acceptedAt)}</time></div>
            {problem && <DifficultyBadge difficulty={problem.difficulty} />}
          </article>
        );
      })}
    </div>
  );
}

function PopupSection({ actionLabel, children, onAction, title }: React.PropsWithChildren<{ readonly actionLabel: string; readonly onAction: () => void; readonly title: string }>): React.ReactElement {
  return (
    <section className="popup-section">
      <header><h2>{title}</h2><button onClick={onAction} type="button">{actionLabel} <Icon name="chevron" size={13} /></button></header>
      {children}
    </section>
  );
}

function LoadError({ message, onRetry }: { readonly message: string; readonly onRetry: () => Promise<void> }): React.ReactElement {
  return (
    <div className="load-error">
      <InlineNotice tone="error">{message}</InlineNotice>
      <Button onClick={() => void onRetry()}>重试</Button>
    </div>
  );
}

async function fetchSummary(): Promise<DailySummary> {
  return sendExtensionRequest({ type: 'dashboard.query' });
}

function toLoadError(cause: unknown): string {
  return cause instanceof Error ? cause.message : '无法读取复习数据';
}
