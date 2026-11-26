/**
 * 复习记录页的纯函数：合并已评分 / 待评估记录、按天分组、本周评分分布、日期文案。
 * 分天一律按 settings.timezone；间隔变化只用 computeIntervalChanges（FSRS 日志的 scheduled_days 是评分前的间隔）。
 */
import {
  computeIntervalChanges,
  dayKeyDiff,
  dayKeyWeekday,
  localDayKey,
  shiftDayKey,
  type IntervalChange,
} from '../../../../src/domain/stats';
import type { DailySummary, MasteryRating, ProblemRecord, SubmissionReview, SubmissionTrigger } from '../../../../src/domain/types';

export const RATINGS: readonly MasteryRating[] = ['AGAIN', 'HARD', 'GOOD', 'EASY'];

export const triggerLabel: Readonly<Record<SubmissionTrigger, string>> = {
  button: '按钮提交',
  keyboard: '快捷键提交',
  import: '从力扣导入',
};

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

export interface TimelineEntry {
  readonly review: SubmissionReview;
  readonly problem: ProblemRecord | undefined;
  /** 待评估的记录为 null。 */
  readonly change: IntervalChange | null;
  /** 通过时间所在的本地日期 `YYYY-MM-DD`。 */
  readonly day: string;
  /** 通过时间 `HH:mm`（按设置的时区）。 */
  readonly clock: string;
}

export interface TimelineDay {
  readonly day: string;
  readonly entries: readonly TimelineEntry[];
}

/** 已评分与待评估记录合在一起，按通过时间从新到旧。 */
export function buildTimelineEntries(
  summary: Pick<DailySummary, 'pendingReviews' | 'problems' | 'recentReviews'>,
  timezone: string,
): TimelineEntry[] {
  const problems = new Map(summary.problems.map((problem) => [problem.problemId, problem]));
  const changes = computeIntervalChanges(summary.recentReviews, summary.problems);
  return [...summary.pendingReviews, ...summary.recentReviews]
    .sort((left, right) => right.acceptedAt - left.acceptedAt || right.submissionId.localeCompare(left.submissionId))
    .map((review) => ({
      review,
      problem: problems.get(review.problemId),
      change: changes.get(review.submissionId) ?? null,
      day: localDayKey(review.acceptedAt, timezone),
      clock: formatClock(review.acceptedAt, timezone),
    }));
}

/** 隐藏某几档评分；有隐藏时待评估的记录也不显示（它们不属于任何一档）。 */
export function filterEntries(entries: readonly TimelineEntry[], hidden: ReadonlySet<MasteryRating>): readonly TimelineEntry[] {
  if (hidden.size === 0) return entries;
  return entries.filter(({ review }) => review.rating !== null && !hidden.has(review.rating));
}

/** 相邻且同一天的记录归成一组（输入已按时间排序）。 */
export function groupByDay(entries: readonly TimelineEntry[]): TimelineDay[] {
  const days: { day: string; entries: TimelineEntry[] }[] = [];
  for (const entry of entries) {
    const last = days.at(-1);
    if (last?.day === entry.day) last.entries.push(entry);
    else days.push({ day: entry.day, entries: [entry] });
  }
  return days;
}

export function countByDay(entries: readonly TimelineEntry[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.day, (counts.get(entry.day) ?? 0) + 1);
  return counts;
}

/** 分组标题：今天 / 昨天 / 一周内写星期 / 更早写日期（跨年带年份）。 */
export function describeDay(day: string, today: string): { readonly title: string; readonly detail: string } {
  const ago = dayKeyDiff(day, today);
  const weekday = WEEKDAYS[dayKeyWeekday(day)] ?? '';
  const date = formatDayKey(day, today);
  if (ago === 0) return { title: '今天', detail: `${date} ${weekday}` };
  if (ago === 1) return { title: '昨天', detail: `${date} ${weekday}` };
  if (ago > 1 && ago < 7) return { title: weekday, detail: date };
  return { title: date, detail: weekday };
}

export type RatingCounts = Readonly<Record<MasteryRating, number>>;

export interface WeekRatings {
  readonly today: string;
  /** 本周（周一到今天）各档评分次数。 */
  readonly counts: RatingCounts;
  readonly total: number;
  /** 上周同期（上周一到上周的今天）的评分次数。 */
  readonly previousTotal: number;
  /** 「掌握 + 熟练」占比 0–1；没有评分时为 null。 */
  readonly share: number | null;
  readonly previousShare: number | null;
}

export function computeWeekRatings(
  reviews: readonly SubmissionReview[],
  options: { readonly timezone: string; readonly now?: number },
): WeekRatings {
  const today = localDayKey(options.now ?? Date.now(), options.timezone);
  const start = shiftDayKey(today, -dayKeyWeekday(today));
  const previousStart = shiftDayKey(start, -7);
  const previousEnd = shiftDayKey(today, -7);
  const counts = emptyCounts();
  const previous = emptyCounts();
  for (const review of reviews) {
    if (review.rating === null) continue;
    const day = localDayKey(review.acceptedAt, options.timezone);
    if (day >= start && day <= today) counts[review.rating] += 1;
    else if (day >= previousStart && day <= previousEnd) previous[review.rating] += 1;
  }
  return {
    today,
    counts,
    total: sumCounts(counts),
    previousTotal: sumCounts(previous),
    share: goodShare(counts),
    previousShare: goodShare(previous),
  };
}

export function toggleRating(hidden: ReadonlySet<MasteryRating>, rating: MasteryRating): ReadonlySet<MasteryRating> {
  const next = new Set(hidden);
  if (next.has(rating)) next.delete(rating);
  else next.add(rating);
  return next;
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatClock(timestamp: number, timezone: string): string {
  let formatter = clockFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    clockFormatters.set(timezone, formatter);
  }
  return formatter.format(timestamp);
}

function formatDayKey(day: string, today: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const monthDay = `${month ?? ''}月${date ?? ''}日`;
  return day.slice(0, 4) === today.slice(0, 4) ? monthDay : `${year ?? ''}年${monthDay}`;
}

function emptyCounts(): Record<MasteryRating, number> {
  return { AGAIN: 0, HARD: 0, GOOD: 0, EASY: 0 };
}

function sumCounts(counts: RatingCounts): number {
  return counts.AGAIN + counts.HARD + counts.GOOD + counts.EASY;
}

function goodShare(counts: RatingCounts): number | null {
  const total = sumCounts(counts);
  return total === 0 ? null : (counts.GOOD + counts.EASY) / total;
}
