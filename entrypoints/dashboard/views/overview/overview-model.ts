import { partitionDueProblems, pickNextDueProblem } from '../../../../src/domain/queue-policy';
import {
  computeForecast,
  computeMasteryDistribution,
  computeRetention,
  computeStreak,
  computeTodayProgress,
  dayKeyDiff,
  localDayKey,
  type ForecastSummary,
  type MasteryDistribution,
  type RetentionSummary,
  type StreakSummary,
  type TodayProgress,
} from '../../../../src/domain/stats';
import type {
  DailySummary,
  MasteryRating,
  ProblemRecord,
  Settings,
  SubmissionReview,
} from '../../../../src/domain/types';
import { withReviewResetIntent } from '../../../../src/leetcode/url';

/** 概览页用到的全部数据，由 dashboard.query + settings.get 在前端推导。 */
export interface OverviewModel {
  readonly now: number;
  readonly timezone: string;
  readonly problemMap: ReadonlyMap<string, ProblemRecord>;
  readonly progress: TodayProgress;
  readonly streak: StreakSummary;
  readonly retention: RetentionSummary;
  readonly mastery: MasteryDistribution;
  readonly forecast: ForecastSummary;
  /** 今日配额内的题（已按排序策略排好）。 */
  readonly todayProblems: readonly ProblemRecord[];
  /** 超出配额的积压。 */
  readonly backlogProblems: readonly ProblemRecord[];
  /** 「开始复习」要打开的题。 */
  readonly next: ProblemRecord | null;
  /** 每道题最近一次评分。 */
  readonly lastRatings: ReadonlyMap<string, MasteryRating>;
  readonly unreadIssues: number;
  /** 新用户：还没有题目，或还没有任何评分记录。 */
  readonly cold: boolean;
  readonly onboarding: OnboardingState;
}

export interface OnboardingState {
  readonly solved: boolean;
  readonly rated: boolean;
  readonly imported: boolean;
  readonly doneCount: number;
  /** 最早记录的几道题名，用于“已记录 …”。 */
  readonly recordedNames: readonly string[];
  /** 使用第几天（按最早的记录算）；没有任何记录时为 null。 */
  readonly dayOfUse: number | null;
}

export function buildOverviewModel(summary: DailySummary, settings: Settings, now = Date.now()): OverviewModel {
  const reviews = summary.recentReviews;
  const { timezone } = settings;
  const partition = partitionDueProblems({ dueProblems: summary.dueProblems, reviews, settings, now });
  return {
    now,
    timezone,
    problemMap: new Map(summary.problems.map((problem) => [problem.problemId, problem])),
    progress: computeTodayProgress({ dueProblems: summary.dueProblems, reviews, settings, now }),
    streak: computeStreak(reviews, { timezone, now }),
    retention: computeRetention(reviews, { now }),
    mastery: computeMasteryDistribution(summary.problems, { reviews, now }),
    forecast: computeForecast(summary.problems, { timezone, now }),
    todayProblems: partition.todayProblems,
    backlogProblems: partition.backlogProblems,
    next: pickNextDueProblem({ dueProblems: summary.dueProblems, reviews, settings, now }).problem,
    lastRatings: collectLastRatings(reviews),
    unreadIssues: summary.issues.filter((issue) => issue.readAt === null).length,
    cold: summary.problems.length === 0 || reviews.length === 0,
    onboarding: buildOnboarding(summary, timezone, now),
  };
}

/** 复习用的题目链接：开启“复习时还原代码”时带上还原标记。 */
export function reviewUrl(problem: Pick<ProblemRecord, 'url'>, settings: Pick<Settings, 'resetCodeOnReview'>): string {
  return settings.resetCodeOnReview ? withReviewResetIntent(problem.url) : problem.url;
}

export function problemLabel(problem: Pick<ProblemRecord, 'frontendId' | 'title'>): string {
  return `${problem.frontendId}. ${problem.title}`;
}

function collectLastRatings(reviews: readonly SubmissionReview[]): ReadonlyMap<string, MasteryRating> {
  const latest = new Map<string, { readonly at: number; readonly rating: MasteryRating }>();
  for (const review of reviews) {
    if (review.rating === null) continue;
    const current = latest.get(review.problemId);
    if (!current || review.acceptedAt > current.at) latest.set(review.problemId, { at: review.acceptedAt, rating: review.rating });
  }
  return new Map([...latest].map(([problemId, entry]) => [problemId, entry.rating]));
}

const RECORDED_NAME_LIMIT = 3;

function buildOnboarding(summary: DailySummary, timezone: string, now: number): OnboardingState {
  const allReviews = [...summary.pendingReviews, ...summary.recentReviews];
  const solved = summary.problems.length > 0 || summary.pendingReviews.length > 0;
  const rated = summary.recentReviews.length > 0;
  const imported = allReviews.some((review) => review.trigger === 'import');
  const earliestProblems = [...summary.problems].sort((left, right) => left.createdAt - right.createdAt);
  return {
    solved,
    rated,
    imported,
    doneCount: [solved, rated, imported].filter(Boolean).length,
    recordedNames: earliestProblems.slice(0, RECORDED_NAME_LIMIT).map(problemLabel),
    dayOfUse: computeDayOfUse(summary, allReviews, { timezone, now }),
  };
}

function computeDayOfUse(
  summary: DailySummary,
  reviews: readonly SubmissionReview[],
  { now, timezone }: { readonly now: number; readonly timezone: string },
): number | null {
  const times = [
    ...summary.problems.map((problem) => problem.createdAt),
    ...reviews.map((review) => review.detectedAt),
  ].filter((time) => time <= now);
  if (times.length === 0) return null;
  return dayKeyDiff(localDayKey(Math.min(...times), timezone), localDayKey(now, timezone)) + 1;
}
