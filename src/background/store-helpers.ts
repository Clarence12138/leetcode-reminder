import {
  FSRS_ALGORITHM,
  FSRS_LIBRARY_VERSION,
  FSRS_PARAMETERS_VERSION,
} from '../domain/constants';
import {
  computeDailyQuota,
  countReviewedToday,
  isProblemPaused,
  resolveAutoGroupId,
} from '../domain/queue-policy';
import type {
  DailySummary,
  DetectionIssue,
  ProblemMetadata,
  ProblemRecord,
  Settings,
  SubmissionReview,
} from '../domain/types';
import { AppError } from './errors';
import type { AcceptedSubmissionInput, DashboardFilter } from './store';

export function assembleDailySummary(options: {
  readonly allProblems: readonly ProblemRecord[];
  readonly allReviews: readonly SubmissionReview[];
  readonly allIssues: readonly DetectionIssue[];
  readonly filter: DashboardFilter;
  readonly now: number;
  readonly settings?: Settings | undefined;
}): DailySummary {
  const problems = sortProblems(
    options.allProblems.filter((problem) => matchesFilter(problem, options.filter)),
  );
  const visibleIds = new Set(problems.map((problem) => problem.problemId));
  const reviews = options.allReviews.filter((review) => visibleIds.has(review.problemId));
  const dueProblems = problems
    .filter((problem) => !isProblemPaused(problem) && problem.nextReviewAt !== null && problem.nextReviewAt <= options.now)
    .sort((left, right) => (left.nextReviewAt ?? 0) - (right.nextReviewAt ?? 0));
  const dailyQuota = options.settings
    ? computeDailyQuota({
        dueCount: dueProblems.length,
        completedToday: countReviewedToday(options.allReviews, {
          now: options.now,
          timezone: options.settings.timezone,
        }),
        dailyReviewLimit: options.settings.dailyReviewLimit,
      })
    : undefined;
  return {
    problems,
    dueProblems,
    pendingReviews: sortReviews(reviews.filter((review) => review.rating === null)),
    recentReviews: sortReviews(reviews.filter((review) => review.rating !== null)),
    issues: [...options.allIssues].sort((left, right) => right.occurredAt - left.occurredAt),
    ...(dailyQuota ? { dailyQuota } : {}),
  };
}

export function buildUpsertedProblem(options: {
  readonly metadata: ProblemMetadata;
  readonly stored: ProblemRecord | undefined;
  readonly timestamp: number;
  readonly settings?: Pick<Settings, 'reviewGroups' | 'autoGroupRules'> | undefined;
}): ProblemRecord {
  const { metadata, stored, timestamp, settings } = options;
  return {
    ...metadata,
    createdAt: stored?.createdAt ?? timestamp,
    updatedAt: timestamp,
    fsrsCard: stored?.fsrsCard ?? null,
    nextReviewAt: stored?.nextReviewAt ?? null,
    pausedAt: stored?.pausedAt ?? null,
    groupId: resolveInitialGroupId(stored, metadata.slug, settings),
    algorithm: FSRS_ALGORITHM,
    algorithmLibrary: FSRS_LIBRARY_VERSION,
    parametersVersion: FSRS_PARAMETERS_VERSION,
  };
}

function resolveInitialGroupId(
  stored: ProblemRecord | undefined,
  slug: string,
  settings?: Pick<Settings, 'reviewGroups' | 'autoGroupRules'>,
): string | null {
  if (stored) return stored.groupId ?? null;
  return settings ? resolveAutoGroupId(slug, settings) : null;
}

export function createPendingReview(
  input: AcceptedSubmissionInput,
  detectedAt: number,
): SubmissionReview {
  return {
    submissionId: input.submissionId,
    problemId: input.metadata.problemId,
    trigger: input.trigger,
    acceptedAt: input.acceptedAt,
    detectedAt,
    rating: null,
    fsrsLog: null,
  };
}

export function assertProblemIdentity(metadata: ProblemMetadata): void {
  if (metadata.problemId !== `leetcode-cn:${metadata.slug}`) {
    throw new AppError('INVALID_PROBLEM_ID', '题目 ID 必须与力扣中文站 slug 一致');
  }
  const url = new URL(metadata.url);
  const problemPath = `/problems/${metadata.slug}`;
  const pathMatches = url.pathname === problemPath || url.pathname.startsWith(`${problemPath}/`);
  if (url.origin !== 'https://leetcode.cn' || !pathMatches) {
    throw new AppError('INVALID_PROBLEM_URL', '题目地址不属于当前力扣中文站题目');
  }
}

export function assertSameAccepted(
  stored: SubmissionReview,
  input: AcceptedSubmissionInput,
): void {
  if (stored.problemId !== input.metadata.problemId || stored.acceptedAt !== input.acceptedAt) {
    throw new AppError('SUBMISSION_CONFLICT', `提交 ${input.submissionId} 与已有记录冲突`);
  }
}

export function matchesFilter(problem: ProblemRecord, filter: DashboardFilter): boolean {
  if (filter.difficulty && problem.difficulty !== filter.difficulty) return false;
  if (filter.tag && !problem.tags.some((tag) => tag.toLocaleLowerCase() === filter.tag?.toLocaleLowerCase())) {
    return false;
  }
  const search = filter.search?.trim().toLocaleLowerCase();
  if (!search) return true;
  return [problem.title, problem.frontendId, problem.slug, ...problem.tags].some((value) =>
    value.toLocaleLowerCase().includes(search),
  );
}

export function sortProblems(problems: readonly ProblemRecord[]): ProblemRecord[] {
  return [...problems].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function sortReviews(reviews: readonly SubmissionReview[]): SubmissionReview[] {
  return [...reviews].sort((left, right) => right.acceptedAt - left.acceptedAt);
}
