import { partitionDueProblems, type DailyQuotaSummary } from '../../../src/domain/queue-policy';
import type { DailySummary, ProblemRecord, Settings } from '../../../src/domain/types';
import { Button, EmptyState, PageHeading, StatCard } from '../../../src/ui/components';
import type { ViewKey } from '../navigation';
import { Panel, ProblemRow, ReviewRow } from './ViewParts';

const PREVIEW_LIMIT = 5;
const MORNING_END_HOUR = 11;
const EVENING_START_HOUR = 18;

interface HomeViewProps {
  readonly onNavigate: (view: ViewKey) => void;
  readonly resetCodeOnReview?: boolean;
  readonly settings?: Settings;
  readonly summary: DailySummary;
}

export function HomeView({ onNavigate, resetCodeOnReview = false, settings, summary }: HomeViewProps): React.ReactElement {
  const problemMap = new Map(summary.problems.map((problem) => [problem.problemId, problem]));
  const ratedCount = summary.recentReviews.filter((review) => review.rating !== null).length;
  const unreadIssues = summary.issues.filter((issue) => issue.readAt === null).length;
  const partitioned = settings
    ? partitionDueProblems({ dueProblems: summary.dueProblems, reviews: summary.recentReviews, settings })
    : null;
  const todayProblems = partitioned ? partitioned.todayProblems : summary.dueProblems;
  const quota = partitioned?.quota ?? null;
  return (
    <div className="view-content">
      <PageHeading
        action={<Button icon="calendar" onClick={() => onNavigate('queue')} tone="primary">开始复习</Button>}
        description="按照 FSRS 安排今天的学习，每次通过都会成为一次复习。"
        title={`${greeting()}，今天也稳稳推进`}
      />
      <div className="stats-grid">
        <StatCard icon="calendar" label={dueStatLabel(quota)} tone="orange" value={quota ? quota.remainingDue : summary.dueProblems.length} />
        <StatCard icon="clock" label="待评估提交" tone="violet" value={summary.pendingReviews.length} />
        <StatCard icon="book" label="已记录题目" tone="green" value={summary.problems.length} />
        <StatCard icon="history" label="已评分记录" tone="blue" value={ratedCount} />
      </div>
      <div className="home-grid">
        <HomeDuePanel
          onNavigate={onNavigate}
          problems={todayProblems}
          quota={quota}
          resetCodeOnReview={resetCodeOnReview}
          settings={settings}
        />
        <Panel action={<button className="text-action" onClick={() => onNavigate('history')} type="button">复习历史</button>} title="最近活动">
          {summary.recentReviews.length === 0
            ? <EmptyState description="你在力扣中通过的题目会出现在这里。" icon="history" title="还没有记录" />
            : <div className="rows">{summary.recentReviews.slice(0, PREVIEW_LIMIT).map((review) => <ReviewRow key={review.submissionId} problem={problemMap.get(review.problemId)} review={review} />)}</div>}
        </Panel>
      </div>
      {unreadIssues > 0 && (
        <button className="issue-banner" onClick={() => onNavigate('issues')} type="button">
          <span>有 {unreadIssues} 条提交检测异常需要查看</span><span>打开异常记录 →</span>
        </button>
      )}
    </div>
  );
}

function HomeDuePanel({
  onNavigate,
  problems,
  quota,
  resetCodeOnReview,
  settings,
}: {
  readonly onNavigate: (view: ViewKey) => void;
  readonly problems: readonly ProblemRecord[];
  readonly quota: DailyQuotaSummary | null;
  readonly resetCodeOnReview: boolean;
  readonly settings?: Settings | undefined;
}): React.ReactElement {
  const hasQuotaOverflow = quota !== null && quota.overflowDue > 0;
  const title = quota && quota.limit !== null ? `今日推荐复习（${problems.length}）` : '今日复习';
  const emptyTitle = hasQuotaOverflow ? '今日配额已完成' : '复习已清空';
  const emptyDescription = hasQuotaOverflow
    ? `今日配额（${quota.limit} 题）已完成，另有 ${quota.overflowDue} 道积压题可在队列中随时查看。`
    : '今天没有到期题目，可以学一道新题。';
  return (
    <Panel action={<button className="text-action" onClick={() => onNavigate('queue')} type="button">查看全部</button>} title={title}>
      {problems.length === 0
        ? <EmptyState description={emptyDescription} icon="sparkle" title={emptyTitle} />
        : (
          <div className="rows">
            {problems.slice(0, PREVIEW_LIMIT).map((problem) => (
              <ProblemRow compact key={problem.problemId} problem={problem} reviewJump={resetCodeOnReview} settings={settings} />
            ))}
          </div>
        )}
    </Panel>
  );
}

function dueStatLabel(quota: DailyQuotaSummary | null): string {
  return quota && quota.limit !== null ? `今日配额 (${quota.completedToday}/${quota.limit})` : '今日 / 逾期';
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour <= MORNING_END_HOUR) return '早上好';
  if (hour >= EVENING_START_HOUR) return '晚上好';
  return '下午好';
}
