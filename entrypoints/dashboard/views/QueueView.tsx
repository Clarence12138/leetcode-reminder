import { useState } from 'react';
import { partitionDueProblems, type DailyQuotaSummary } from '../../../src/domain/queue-policy';
import type {
  DailySummary,
  ProblemRecord,
  QueueSortStrategy,
  Settings,
  SubmissionReview,
} from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, EmptyState, InlineNotice, PageHeading } from '../../../src/ui/components';
import { formatDateTime, problemName } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';
import { RatingButtons } from '../../../src/ui/rating';
import { Panel, ProblemRow } from './ViewParts';

export function QueueView({
  refresh,
  resetCodeOnReview = false,
  settings,
  summary,
}: {
  readonly refresh: () => Promise<void>;
  readonly resetCodeOnReview?: boolean;
  readonly settings?: Settings;
  readonly summary: DailySummary;
}): React.ReactElement {
  const [showBacklog, setShowBacklog] = useState(false);
  const sortControl = useQueueSortUpdate(refresh);
  const problemMap = new Map(summary.problems.map((problem) => [problem.problemId, problem]));
  const viewData = buildQueueViewData(summary, settings);
  return (
    <div className="view-content">
      <PageHeading
        action={settings && (
          <QueueSortSelect
            disabled={sortControl.saving}
            onChange={(strategy) => void sortControl.update(strategy)}
            value={settings.queueSortStrategy}
          />
        )}
        description={queueDescription(viewData.quota)}
        title="待处理队列"
      />
      {sortControl.error && <InlineNotice tone="error">{sortControl.error}</InlineNotice>}
      {summary.pendingReviews.length > 0 && (
        <PendingPanel onRated={refresh} problemMap={problemMap} reviews={summary.pendingReviews} />
      )}
      <QueueDuePanel
        problems={viewData.todayProblems}
        quota={viewData.quota}
        resetCodeOnReview={resetCodeOnReview}
        settings={settings}
      />
      {viewData.backlogProblems.length > 0 && (
        <BacklogPanel
          expanded={showBacklog}
          onToggle={() => setShowBacklog((current) => !current)}
          problems={viewData.backlogProblems}
          resetCodeOnReview={resetCodeOnReview}
          settings={settings}
        />
      )}
    </div>
  );
}

function useQueueSortUpdate(refresh: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (strategy: QueueSortStrategy): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await sendExtensionRequest({ type: 'settings.update', payload: { queueSortStrategy: strategy } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新排序策略失败');
    } finally {
      setSaving(false);
    }
  };
  return { error, saving, update };
}

function PendingPanel({
  onRated,
  problemMap,
  reviews,
}: {
  readonly onRated: () => Promise<void>;
  readonly problemMap: ReadonlyMap<string, ProblemRecord>;
  readonly reviews: readonly SubmissionReview[];
}): React.ReactElement {
  return (
    <Panel className="pending-panel" title={`待评估 · ${reviews.length}`}>
      <p className="panel__hint">待评估记录尚未创建复习排期。请根据本次解题的真实感受选择掌握程度，或丢弃不需要记录的提交。</p>
      <div className="pending-grid">
        {reviews.map((review) => (
          <PendingCard key={review.submissionId} onRated={onRated} problem={problemMap.get(review.problemId)} review={review} />
        ))}
      </div>
    </Panel>
  );
}

function QueueDuePanel({
  problems,
  quota,
  resetCodeOnReview,
  settings,
}: {
  readonly problems: readonly ProblemRecord[];
  readonly quota: DailyQuotaSummary | null;
  readonly resetCodeOnReview: boolean;
  readonly settings?: Settings | undefined;
}): React.ReactElement {
  const hasOverflow = quota !== null && quota.overflowDue > 0;
  const emptyTitle = hasOverflow ? '今日配额已完成' : '队列已清空';
  const emptyDescription = hasOverflow
    ? `今天的 ${quota.limit} 题配额已全部完成！如需多刷，可展开下方其余积压题目。`
    : '目前没有需要复习的题目。下次到期后，我会在每日提醒中告诉你。';
  return (
    <Panel title={duePanelTitle(problems.length, quota)}>
      {problems.length === 0
        ? <EmptyState description={emptyDescription} icon="sparkle" title={emptyTitle} />
        : (
          <div className="rows due-rows">
            {problems.map((problem) => (
              <ProblemRow key={problem.problemId} problem={problem} reviewJump={resetCodeOnReview} settings={settings} />
            ))}
          </div>
        )}
    </Panel>
  );
}

function QueueSortSelect({
  disabled,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly onChange: (strategy: QueueSortStrategy) => void;
  readonly value: QueueSortStrategy;
}): React.ReactElement {
  return (
    <label className="queue-sort-control">
      <span>排序</span>
      <select aria-label="队列排序策略" disabled={disabled} onChange={(event) => onChange(event.target.value as QueueSortStrategy)} value={value}>
        <option value="due_asc">最早到期优先（默认）</option>
        <option value="priority">智能优先（高保持率 / 薄弱 / 难题）</option>
        <option value="stability_asc">薄弱与新题优先</option>
      </select>
    </label>
  );
}

function BacklogPanel({
  expanded,
  onToggle,
  problems,
  resetCodeOnReview,
  settings,
}: {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly problems: readonly ProblemRecord[];
  readonly resetCodeOnReview: boolean;
  readonly settings?: Settings | undefined;
}): React.ReactElement {
  return (
    <Panel
      action={<Button onClick={onToggle} tone="ghost">{expanded ? '收起积压' : `展开其余 ${problems.length} 题`}</Button>}
      className="backlog-panel"
      title={`其余逾期积压 · ${problems.length}`}
    >
      {expanded
        ? (
          <div className="rows due-rows">
            {problems.map((problem) => (
              <ProblemRow key={problem.problemId} problem={problem} reviewJump={resetCodeOnReview} settings={settings} />
            ))}
          </div>
        )
        : <p className="panel__hint">这些题目已超出今日配额，默认折叠保护刷题节奏；想多刷时随时展开。</p>}
    </Panel>
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
        <button aria-label={`${confirming ? '确认丢弃' : '丢弃'}${title}`} className={`pending-card__discard${confirming ? ' is-confirming' : ''}`} disabled={discarding} onBlur={() => setConfirming(false)} onClick={() => void discard()} type="button">
          <Icon name="trash" size={14} /><span>{confirming ? '再点一次确认' : '丢弃'}</span>
        </button>
      </div>
      <RatingButtons disabled={discarding} onRated={onRated} submissionId={review.submissionId} />
      {error && <span className="field-error" role="alert">{error}</span>}
    </article>
  );
}

function buildQueueViewData(summary: DailySummary, settings?: Settings) {
  if (!settings) {
    return {
      todayProblems: [...summary.dueProblems].sort(compareDueDate),
      backlogProblems: [] as readonly ProblemRecord[],
      quota: null,
    };
  }
  const partitioned = partitionDueProblems({ dueProblems: summary.dueProblems, reviews: summary.recentReviews, settings });
  return {
    todayProblems: partitioned.todayProblems,
    backlogProblems: partitioned.backlogProblems,
    quota: partitioned.quota,
  };
}

function queueDescription(quota: DailyQuotaSummary | null): string {
  if (!quota || quota.limit === null) return '先为新通过的提交评分，再完成今日和逾期的复习。';
  const suffix = quota.overflowDue > 0 ? `（另有 ${quota.overflowDue} 题积压）` : '';
  return `今日配额：已完成 ${quota.completedToday} / ${quota.limit} 题，剩余 ${quota.remainingDue} 题待复习${suffix}。`;
}

function duePanelTitle(count: number, quota: DailyQuotaSummary | null): string {
  return quota && quota.limit !== null ? `今日配额复习 · ${count}` : `今日 / 逾期 · ${count}`;
}

function compareDueDate(left: ProblemRecord, right: ProblemRecord): number {
  return (left.nextReviewAt ?? 0) - (right.nextReviewAt ?? 0);
}
