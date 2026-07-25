import type { ProblemMetadata, ProblemRecord, SubmissionReview } from '../domain/types';
import { AppError } from './errors';
import type { AcceptedSubmissionInput, DashboardFilter } from './store';

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
