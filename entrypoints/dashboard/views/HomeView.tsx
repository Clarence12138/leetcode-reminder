import type { DailySummary } from '../../../src/domain/types';
import { Button, EmptyState, PageHeading, StatCard } from '../../../src/ui/components';
import type { ViewKey } from '../navigation';
import { Panel, ProblemRow, ReviewRow } from './ViewParts';

const PREVIEW_LIMIT = 5;
const MORNING_END_HOUR = 11;
const EVENING_START_HOUR = 18;

export function HomeView({
  onNavigate,
  summary,
}: {
  readonly onNavigate: (view: ViewKey) => void;
  readonly summary: DailySummary;
}): React.ReactElement {
  const problemMap = new Map(summary.problems.map((problem) => [problem.problemId, problem]));
  const ratedCount = summary.recentReviews.filter((review) => review.rating !== null).length;
  const unreadIssues = summary.issues.filter((issue) => issue.readAt === null).length;
  return (
    <div className="view-content">
      <PageHeading
        action={<Button icon="calendar" onClick={() => onNavigate('queue')} tone="primary">开始复习</Button>}
        description="按照 FSRS 安排今天的学习，每次通过都会成为一次复习。"
        title={`${greeting()}，今天也稳稳推进`}
      />
      <div className="stats-grid">
        <StatCard icon="calendar" label="今日 / 逾期" tone="orange" value={summary.dueProblems.length} />
        <StatCard icon="clock" label="待评估提交" tone="violet" value={summary.pendingReviews.length} />
        <StatCard icon="book" label="已记录题目" tone="green" value={summary.problems.length} />
        <StatCard icon="history" label="已评分记录" tone="blue" value={ratedCount} />
      </div>
      <div className="home-grid">
        <Panel
          action={<button className="text-action" onClick={() => onNavigate('queue')} type="button">查看全部</button>}
          title="今日复习"
        >
          {summary.dueProblems.length === 0
            ? <EmptyState description="今天没有到期题目，可以学一道新题。" icon="sparkle" title="复习已清空" />
            : <div className="rows">{summary.dueProblems.slice(0, PREVIEW_LIMIT).map((problem) => <ProblemRow compact key={problem.problemId} problem={problem} />)}</div>}
        </Panel>
        <Panel
          action={<button className="text-action" onClick={() => onNavigate('history')} type="button">复习历史</button>}
          title="最近活动"
        >
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

function greeting(): string {
  const hour = new Date().getHours();
  if (hour <= MORNING_END_HOUR) return '早上好';
  if (hour >= EVENING_START_HOUR) return '晚上好';
  return '下午好';
}
