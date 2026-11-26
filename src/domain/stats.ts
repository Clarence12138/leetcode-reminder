/**
 * 概览、记录页用的统计（纯函数）。数据来自 `dashboard.query` 返回的全部题目与评分记录，
 * 按 `settings.timezone` 分天，`now` 可注入便于测试。
 * 掌握分布、间隔变化、记忆概率在 ./mastery.ts，这里一并导出。
 */
import { dayKeyDiff, dayKeyWeekday, localDayKey, shiftDayKey } from './day-keys';
import { orderRated } from './mastery';
import { computeDailyQuota, countReviewedToday, isProblemPaused } from './queue-policy';
import type { ProblemRecord, Settings, SubmissionReview } from './types';

export * from './day-keys';
export * from './mastery';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 热力图分档时把最大值至少当成 4，避免只复习过 1 次也显示成最深色。 */
const HEATMAP_MIN_SCALE = 4;

interface DayOptions {
  readonly timezone: string;
  readonly now?: number;
}

// ---------- 今日进度 ----------

export interface TodayProgress {
  /** 今天已复习的题数（与配额同口径：不含每道题的首次评分）。 */
  readonly completed: number;
  /** 今天还要复习的题数（受配额限制）。 */
  readonly remaining: number;
  /** 超出配额的积压题数；没设配额时为 0。 */
  readonly backlog: number;
  /** 进度条的分母：completed + remaining。 */
  readonly target: number;
  readonly limit: number | null;
  /** 0–1；target 为 0 时为 0。 */
  readonly ratio: number;
  /** 今天的配额（或全部到期）已经清空。 */
  readonly done: boolean;
}

export function computeTodayProgress(options: {
  /** 已到期的题（`summary.dueProblems`）；暂停的会被忽略。 */
  readonly dueProblems: readonly ProblemRecord[];
  readonly reviews: readonly SubmissionReview[];
  readonly settings: Pick<Settings, 'dailyReviewLimit' | 'timezone'>;
  readonly now?: number;
}): TodayProgress {
  const now = options.now ?? Date.now();
  const completed = countReviewedToday(options.reviews, { now, timezone: options.settings.timezone });
  const quota = computeDailyQuota({
    dueCount: options.dueProblems.filter((problem) => !isProblemPaused(problem)).length,
    completedToday: completed,
    dailyReviewLimit: options.settings.dailyReviewLimit,
  });
  const target = completed + quota.remainingDue;
  return {
    completed,
    remaining: quota.remainingDue,
    backlog: quota.overflowDue,
    target,
    limit: quota.limit,
    ratio: target === 0 ? 0 : completed / target,
    done: quota.remainingDue === 0,
  };
}

// ---------- 连续天数 ----------

export interface StreakDay {
  readonly day: string;
  readonly active: boolean;
  readonly isToday: boolean;
}

export interface StreakSummary {
  /** 当前连续天数；今天还没复习时算到昨天为止。 */
  readonly current: number;
  readonly longest: number;
  readonly activeToday: boolean;
  readonly lastActiveDay: string | null;
  /** 最近 7 天（含今天），从早到晚。 */
  readonly week: readonly StreakDay[];
}

/** 有评分记录（按通过时间）的日子算“复习过”。 */
export function computeStreak(reviews: readonly SubmissionReview[], options: DayOptions): StreakSummary {
  const now = options.now ?? Date.now();
  const today = localDayKey(now, options.timezone);
  const activeDays = collectActiveDays(reviews, options.timezone, now);
  const activeToday = activeDays.has(today);
  let current = 0;
  for (let day = activeToday ? today : shiftDayKey(today, -1); activeDays.has(day); day = shiftDayKey(day, -1)) {
    current += 1;
  }
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = shiftDayKey(today, index - 6);
    return { day, active: activeDays.has(day), isToday: day === today };
  });
  const sorted = [...activeDays].sort();
  return { current, longest: longestRun(sorted), activeToday, lastActiveDay: sorted.at(-1) ?? null, week };
}

// ---------- 热力图 ----------

export interface HeatmapCell {
  readonly day: string;
  readonly count: number;
  /** 0 = 没复习，1–4 越大越多。 */
  readonly level: 0 | 1 | 2 | 3 | 4;
  /** 0 = 周一 … 6 = 周日。 */
  readonly weekday: number;
  readonly isToday: boolean;
  /** 本周里今天之后的日子。 */
  readonly isFuture: boolean;
}

export interface HeatmapSummary {
  readonly weeks: number;
  /** 按列排：每周一列，周一到周日；最后一列是本周。长度 = weeks × 7。 */
  readonly cells: readonly HeatmapCell[];
  /** 区间内的评分次数。 */
  readonly total: number;
  readonly activeDays: number;
  readonly max: number;
}

export function computeHeatmap(
  reviews: readonly SubmissionReview[],
  options: DayOptions & { readonly weeks?: number },
): HeatmapSummary {
  const now = options.now ?? Date.now();
  const weeks = options.weeks ?? 43;
  const today = localDayKey(now, options.timezone);
  const firstDay = shiftDayKey(today, -dayKeyWeekday(today) - (weeks - 1) * 7);
  const counts = countRatedByDay(reviews, options.timezone, now);
  const days = Array.from({ length: weeks * 7 }, (_, index) => shiftDayKey(firstDay, index));
  const inRange = days.filter((day) => day <= today).map((day) => counts.get(day) ?? 0);
  const max = Math.max(0, ...inRange);
  const scale = Math.max(max, HEATMAP_MIN_SCALE);
  const cells = days.map((day, index) => {
    const count = day <= today ? (counts.get(day) ?? 0) : 0;
    const level = (count === 0 ? 0 : Math.min(4, Math.ceil((count / scale) * 4))) as HeatmapCell['level'];
    return { day, count, level, weekday: index % 7, isToday: day === today, isFuture: day > today };
  });
  return {
    weeks,
    cells,
    total: inRange.reduce((sum, count) => sum + count, 0),
    activeDays: inRange.filter((count) => count > 0).length,
    max,
  };
}

// ---------- 未来负载 ----------

export interface ForecastDay {
  readonly day: string;
  readonly count: number;
  readonly weekday: number;
  readonly isToday: boolean;
}

export interface ForecastSummary {
  /** 今天之前就到期、还没复习的题数。 */
  readonly overdue: number;
  /** 从今天起连续 N 天，每天到期的题数（今天包含今天早些时候已到期的）。 */
  readonly days: readonly ForecastDay[];
  /** days 内的合计（不含 overdue）。 */
  readonly total: number;
  readonly max: number;
}

export function computeForecast(
  problems: readonly ProblemRecord[],
  options: DayOptions & { readonly days?: number },
): ForecastSummary {
  const now = options.now ?? Date.now();
  const length = options.days ?? 14;
  const today = localDayKey(now, options.timezone);
  const buckets = new Array<number>(length).fill(0);
  let overdue = 0;
  for (const problem of problems) {
    if (problem.nextReviewAt === null || isProblemPaused(problem)) continue;
    const offset = dayKeyDiff(today, localDayKey(problem.nextReviewAt, options.timezone));
    if (offset < 0) overdue += 1;
    else if (offset < length) buckets[offset]! += 1;
  }
  const days = buckets.map((count, index) => {
    const day = shiftDayKey(today, index);
    return { day, count, weekday: dayKeyWeekday(day), isToday: index === 0 };
  });
  return { overdue, days, total: buckets.reduce((sum, count) => sum + count, 0), max: Math.max(0, ...buckets) };
}

// ---------- 记住率 ----------

export interface RetentionSummary {
  /** 0–1；窗口内没有样本时为 null。 */
  readonly rate: number | null;
  /** 窗口内的复习次数（不含每道题的首次评分）。 */
  readonly sample: number;
  /** 其中没评「未掌握」的次数。 */
  readonly remembered: number;
  /** 再往前一个窗口的记住率，用于“较上月”；没有样本时为 null。 */
  readonly previousRate: number | null;
  readonly previousSample: number;
}

/** 近 N 天（滚动窗口，按通过时间）复习中没评「未掌握」的比例；每道题的首次评分是学习不是复习，不计入。 */
export function computeRetention(
  reviews: readonly SubmissionReview[],
  options: { readonly now?: number; readonly days?: number } = {},
): RetentionSummary {
  const now = options.now ?? Date.now();
  const windowMs = (options.days ?? 30) * DAY_MS;
  const repeats = excludeFirstRatings(reviews);
  const current = summarizeWindow(repeats, now - windowMs, now);
  const previous = summarizeWindow(repeats, now - 2 * windowMs, now - windowMs);
  return {
    rate: current.rate,
    sample: current.sample,
    remembered: current.remembered,
    previousRate: previous.rate,
    previousSample: previous.sample,
  };
}

// ---------- 内部工具 ----------

/** 每天的评分次数（按通过时间分天，忽略未来时间）。 */
export function countRatedByDay(
  reviews: readonly SubmissionReview[],
  timezone: string,
  now: number = Date.now(),
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const review of reviews) {
    if (review.rating === null || review.acceptedAt > now) continue;
    const day = localDayKey(review.acceptedAt, timezone);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

function collectActiveDays(reviews: readonly SubmissionReview[], timezone: string, now: number): Set<string> {
  return new Set(countRatedByDay(reviews, timezone, now).keys());
}

function longestRun(sortedDays: readonly string[]): number {
  let longest = 0;
  let run = 0;
  sortedDays.forEach((day, index) => {
    run = index > 0 && dayKeyDiff(sortedDays[index - 1]!, day) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return longest;
}

function excludeFirstRatings(reviews: readonly SubmissionReview[]): SubmissionReview[] {
  const seen = new Set<string>();
  return orderRated(reviews).filter((review) => {
    if (seen.has(review.problemId)) return true;
    seen.add(review.problemId);
    return false;
  });
}

function summarizeWindow(reviews: readonly SubmissionReview[], from: number, to: number) {
  const inWindow = reviews.filter((review) => review.acceptedAt > from && review.acceptedAt <= to);
  const remembered = inWindow.filter((review) => review.rating !== 'AGAIN').length;
  return { sample: inWindow.length, remembered, rate: inWindow.length === 0 ? null : remembered / inWindow.length };
}
