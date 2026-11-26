import { isProblemPaused, partitionDueProblems, pickNextDueProblem } from '../../src/domain/queue-policy';
import {
  computeRetention,
  computeStreak,
  computeTodayProgress,
  dayKeyDiff,
  localDayKey,
  type TodayProgress,
} from '../../src/domain/stats';
import type { DailySummary, ProblemRecord, Settings, SubmissionReview } from '../../src/domain/types';
import { withReviewResetIntent } from '../../src/leetcode/url';
import { sendExtensionRequest } from '../../src/shared/messaging';

/** 新用户引导里「去力扣做题」打开的页面。 */
export const LEETCODE_PROBLEMSET_URL = 'https://leetcode.cn/problemset/';

export type Reload = () => Promise<void>;

export interface PopupData {
  readonly summary: DailySummary;
  readonly settings: Settings;
}

/** 弹窗要展示的内容，全部由 dashboard.query + settings.get 推导。 */
export interface PopupModel {
  readonly progress: TodayProgress;
  /** 「开始复习」要打开的题。 */
  readonly next: ProblemRecord | null;
  /** 今日队列（受配额限制、按排序策略），第一题即 next。 */
  readonly todayProblems: readonly ProblemRecord[];
  readonly streakDays: number;
  /** 近 30 天记住率 0–1；没有样本时为 null。 */
  readonly retention: number | null;
  readonly pending: readonly SubmissionReview[];
  readonly problemMap: ReadonlyMap<string, ProblemRecord>;
  readonly unreadIssues: number;
  /** 今天没有到期题时，下一道题的到期时间；没有任何排期时为 null。 */
  readonly nextDueAt: number | null;
  /** 一道题、一条提交都还没有：新用户。 */
  readonly isEmpty: boolean;
}

export async function fetchPopupData(): Promise<PopupData> {
  const [summary, settings] = await Promise.all([
    sendExtensionRequest({ type: 'dashboard.query' }),
    sendExtensionRequest({ type: 'settings.get' }),
  ]);
  return { summary, settings };
}

export function buildPopupModel({ settings, summary }: PopupData, now = Date.now()): PopupModel {
  const reviews = summary.recentReviews;
  const dueProblems = summary.dueProblems.filter((problem) => !isProblemPaused(problem));
  const { todayProblems } = partitionDueProblems({ dueProblems, reviews, settings, now });
  return {
    progress: computeTodayProgress({ dueProblems, reviews, settings, now }),
    next: pickNextDueProblem({ dueProblems, reviews, settings, now }).problem,
    todayProblems,
    streakDays: computeStreak(reviews, { timezone: settings.timezone, now }).current,
    retention: computeRetention(reviews, { now }).rate,
    pending: summary.pendingReviews,
    problemMap: new Map(summary.problems.map((problem) => [problem.problemId, problem])),
    unreadIssues: summary.issues.filter((issue) => issue.readAt === null).length,
    nextDueAt: earliestUpcomingDue(summary.problems, now),
    isEmpty: summary.problems.length === 0 && summary.pendingReviews.length === 0,
  };
}

function earliestUpcomingDue(problems: readonly ProblemRecord[], now: number): number | null {
  let earliest: number | null = null;
  for (const problem of problems) {
    const due = problem.nextReviewAt;
    if (due === null || due <= now || isProblemPaused(problem)) continue;
    if (earliest === null || due < earliest) earliest = due;
  }
  return earliest;
}

/** 已逾期几天（按设置的时区分天）；今天到期或未到期为 0。 */
export function overdueDays(problem: Pick<ProblemRecord, 'nextReviewAt'>, timezone: string, now = Date.now()): number {
  if (problem.nextReviewAt === null) return 0;
  return Math.max(0, dayKeyDiff(localDayKey(problem.nextReviewAt, timezone), localDayKey(now, timezone)));
}

/** 复习用的题目链接：开启“复习时还原代码”时带上还原标记。 */
export function reviewUrl(problem: Pick<ProblemRecord, 'url'>, settings: Pick<Settings, 'resetCodeOnReview'>): string {
  return settings.resetCodeOnReview ? withReviewResetIntent(problem.url) : problem.url;
}

/** 在新标签打开链接，然后关掉弹窗。 */
export async function openInNewTab(url: string): Promise<void> {
  const tabs = (globalThis.chrome as typeof chrome | undefined)?.tabs;
  try {
    if (typeof tabs?.create === 'function') await tabs.create({ url });
    else window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  window.close();
}

/** 通过时间的短写法：今天 14:32 / 昨天 / 11/23（按设置的时区分天）。 */
export function formatShortTime(timestamp: number, timezone: string, now = Date.now()): string {
  const days = dayKeyDiff(localDayKey(timestamp, timezone), localDayKey(now, timezone));
  if (days <= 0) return format(timestamp, timezone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (days === 1) return '昨天';
  return format(timestamp, timezone, { month: 'numeric', day: 'numeric' });
}

/** 顶部日期：11月25日 周三。 */
export function formatHeaderDate(timezone: string | undefined, now = Date.now()): string {
  return `${format(now, timezone, { month: 'long', day: 'numeric' })} ${format(now, timezone, { weekday: 'short' })}`;
}

function format(timestamp: number, timezone: string | undefined, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', timezone ? { ...options, timeZone: timezone } : options).format(timestamp);
  } catch {
    // 时区无效时退回本地时区
    return new Intl.DateTimeFormat('zh-CN', options).format(timestamp);
  }
}
