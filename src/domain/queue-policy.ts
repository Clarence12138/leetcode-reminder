import { FSRS_REQUEST_RETENTION } from './constants';
import { isSlugInBuiltinList } from './problem-lists';
import type {
  Difficulty,
  ProblemRecord,
  QueueSortStrategy,
  ReviewGroup,
  Settings,
  SubmissionReview,
} from './types';

export interface DailyQuotaSummary {
  readonly limit: number | null;
  readonly completedToday: number;
  readonly remainingDue: number;
  readonly overflowDue: number;
  readonly reached: boolean;
}

export interface PartitionedDueProblems {
  readonly sorted: readonly ProblemRecord[];
  readonly todayProblems: readonly ProblemRecord[];
  readonly backlogProblems: readonly ProblemRecord[];
  readonly quota: DailyQuotaSummary;
}

const DIFFICULTY_RANK: Readonly<Record<Difficulty, number>> = {
  HARD: 3,
  MEDIUM: 2,
  EASY: 1,
};

const RETENTION_EPSILON = 0.0001;

export function isProblemPaused(problem: Pick<ProblemRecord, 'pausedAt'>): boolean {
  return problem.pausedAt !== null && problem.pausedAt !== undefined;
}

export function resolveProblemGroup(
  problem: Pick<ProblemRecord, 'groupId'>,
  settings: Pick<Settings, 'reviewGroups'>,
): ReviewGroup | null {
  if (!problem.groupId) return null;
  return settings.reviewGroups.find((group) => group.id === problem.groupId) ?? null;
}

export function resolveRequestRetention(
  problem: Pick<ProblemRecord, 'groupId'>,
  settings?: Pick<Settings, 'defaultRequestRetention' | 'reviewGroups'>,
): number {
  if (!settings) return FSRS_REQUEST_RETENTION;
  const group = resolveProblemGroup(problem, settings);
  return group ? group.requestRetention : settings.defaultRequestRetention;
}

export function resolveAutoGroupId(
  slug: string,
  settings: Pick<Settings, 'reviewGroups' | 'autoGroupRules'>,
): string | null {
  const validGroupIds = new Set(settings.reviewGroups.map((group) => group.id));
  for (const rule of settings.autoGroupRules) {
    if (validGroupIds.has(rule.groupId) && isSlugInBuiltinList(slug, rule.listId)) {
      return rule.groupId;
    }
  }
  return null;
}

export function sortDueProblems(
  dueProblems: readonly ProblemRecord[],
  settings: Pick<Settings, 'queueSortStrategy' | 'defaultRequestRetention' | 'reviewGroups'>,
): ProblemRecord[] {
  const strategy: QueueSortStrategy = settings.queueSortStrategy;
  return [...dueProblems].sort((left, right) => {
    if (strategy === 'due_asc') return compareDueAsc(left, right);
    if (strategy === 'stability_asc') return compareStabilityAsc(left, right);
    return comparePriority(left, right, settings);
  });
}

export function countReviewedToday(
  reviews: readonly SubmissionReview[],
  options: { readonly now: number; readonly timezone: string },
): number {
  const earliestByProblem = collectEarliestRated(reviews);
  const today = formatLocalDay(options.now, options.timezone);
  const reviewedProblemIds = new Set<string>();

  for (const review of reviews) {
    if (review.rating === null) continue;
    if (formatLocalDay(review.acceptedAt, options.timezone) !== today) continue;
    if (earliestByProblem.get(review.problemId) === review.submissionId) continue;
    reviewedProblemIds.add(review.problemId);
  }
  return reviewedProblemIds.size;
}

export function computeDailyQuota(options: {
  readonly dueCount: number;
  readonly completedToday: number;
  readonly dailyReviewLimit: number | null;
}): DailyQuotaSummary {
  const { dueCount, completedToday, dailyReviewLimit } = options;
  if (dailyReviewLimit === null) {
    return {
      limit: null,
      completedToday,
      remainingDue: dueCount,
      overflowDue: 0,
      reached: false,
    };
  }
  const remainingQuota = Math.max(0, dailyReviewLimit - completedToday);
  const remainingDue = Math.min(dueCount, remainingQuota);
  return {
    limit: dailyReviewLimit,
    completedToday,
    remainingDue,
    overflowDue: Math.max(0, dueCount - remainingDue),
    reached: remainingQuota === 0,
  };
}

export function partitionDueProblems(options: {
  readonly dueProblems: readonly ProblemRecord[];
  readonly reviews: readonly SubmissionReview[];
  readonly settings: Pick<
    Settings,
    'dailyReviewLimit' | 'queueSortStrategy' | 'defaultRequestRetention' | 'reviewGroups' | 'timezone'
  >;
  readonly now?: number;
}): PartitionedDueProblems {
  const sorted = sortDueProblems(options.dueProblems, options.settings);
  const completedToday = countReviewedToday(options.reviews, {
    now: options.now ?? Date.now(),
    timezone: options.settings.timezone,
  });
  const quota = computeDailyQuota({
    dueCount: sorted.length,
    completedToday,
    dailyReviewLimit: options.settings.dailyReviewLimit,
  });
  return {
    sorted,
    todayProblems: sorted.slice(0, quota.remainingDue),
    backlogProblems: sorted.slice(quota.remainingDue),
    quota,
  };
}

function compareDueAsc(left: ProblemRecord, right: ProblemRecord): number {
  const byDue = (left.nextReviewAt ?? 0) - (right.nextReviewAt ?? 0);
  return byDue === 0 ? left.problemId.localeCompare(right.problemId) : byDue;
}

function compareStabilityAsc(left: ProblemRecord, right: ProblemRecord): number {
  const byStability = stabilityValue(left) - stabilityValue(right);
  if (Math.abs(byStability) > RETENTION_EPSILON) return byStability;
  const byLapses = lapsesValue(right) - lapsesValue(left);
  if (byLapses !== 0) return byLapses;
  return compareDueAsc(left, right);
}

function comparePriority(
  left: ProblemRecord,
  right: ProblemRecord,
  settings: Pick<Settings, 'defaultRequestRetention' | 'reviewGroups'>,
): number {
  const retentionDiff =
    resolveRequestRetention(right, settings) - resolveRequestRetention(left, settings);
  if (Math.abs(retentionDiff) > RETENTION_EPSILON) return retentionDiff;
  const byStability = stabilityValue(left) - stabilityValue(right);
  if (Math.abs(byStability) > RETENTION_EPSILON) return byStability;
  const byLapses = lapsesValue(right) - lapsesValue(left);
  if (byLapses !== 0) return byLapses;
  const byDifficulty = DIFFICULTY_RANK[right.difficulty] - DIFFICULTY_RANK[left.difficulty];
  if (byDifficulty !== 0) return byDifficulty;
  return compareDueAsc(left, right);
}

function stabilityValue(problem: ProblemRecord): number {
  return problem.fsrsCard?.stability ?? Number.POSITIVE_INFINITY;
}

function lapsesValue(problem: ProblemRecord): number {
  return problem.fsrsCard?.lapses ?? 0;
}

function collectEarliestRated(reviews: readonly SubmissionReview[]): Map<string, string> {
  const earliest = new Map<string, SubmissionReview>();
  for (const review of reviews) {
    if (review.rating === null) continue;
    const current = earliest.get(review.problemId);
    if (!current || isEarlierReview(review, current)) {
      earliest.set(review.problemId, review);
    }
  }
  return new Map([...earliest.entries()].map(([problemId, review]) => [problemId, review.submissionId]));
}

function isEarlierReview(left: SubmissionReview, right: SubmissionReview): boolean {
  if (left.acceptedAt !== right.acceptedAt) return left.acceptedAt < right.acceptedAt;
  return left.submissionId.localeCompare(right.submissionId) < 0;
}

function formatLocalDay(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}
