import {
  FSRS_ALGORITHM,
  FSRS_LIBRARY_VERSION,
  FSRS_PARAMETERS_VERSION,
} from '../domain/constants';
import type {
  DetectionIssue,
  ProblemRecord,
  SubmissionReview,
} from '../domain/types';
import { AppError } from './errors';
import type { ReplayResult } from './fsrs';

export interface PersistedSnapshot {
  readonly problems: readonly ProblemRecord[];
  readonly submissions: readonly SubmissionReview[];
  readonly issues: readonly DetectionIssue[];
}

type Replay = (reviews: readonly SubmissionReview[]) => ReplayResult;

export function prepareImportedSnapshot(options: {
  readonly current: PersistedSnapshot;
  readonly incoming: PersistedSnapshot;
  readonly mode: 'merge' | 'replace';
  readonly replay: Replay;
}): PersistedSnapshot {
  assertUniqueIncoming(options.incoming);
  const source =
    options.mode === 'replace'
      ? normalizeSnapshot(options.incoming)
      : mergeSnapshots(options.current, options.incoming);
  assertProblemIdentities(source.problems);
  assertSubmissionReferences(source);
  return rebuildDerivedState(source, options.replay);
}

function normalizeSnapshot(snapshot: PersistedSnapshot): PersistedSnapshot {
  return {
    problems: deduplicateProblems(snapshot.problems),
    submissions: deduplicateSubmissions(snapshot.submissions),
    issues: deduplicateIssues(snapshot.issues),
  };
}

function mergeSnapshots(
  current: PersistedSnapshot,
  incoming: PersistedSnapshot,
): PersistedSnapshot {
  return {
    problems: mergeProblems(current.problems, incoming.problems),
    submissions: mergeSubmissions(current.submissions, incoming.submissions),
    issues: deduplicateIssues([...current.issues, ...incoming.issues]),
  };
}

function mergeProblems(
  current: readonly ProblemRecord[],
  incoming: readonly ProblemRecord[],
): ProblemRecord[] {
  const merged = new Map(current.map((problem) => [problem.problemId, problem]));
  for (const problem of incoming) {
    const stored = merged.get(problem.problemId);
    if (!stored || problem.updatedAt >= stored.updatedAt) {
      merged.set(problem.problemId, problem);
    }
  }
  return Array.from(merged.values());
}

function mergeSubmissions(
  current: readonly SubmissionReview[],
  incoming: readonly SubmissionReview[],
): SubmissionReview[] {
  const merged = new Map(current.map((review) => [review.submissionId, review]));
  for (const review of incoming) {
    const stored = merged.get(review.submissionId);
    if (!stored) {
      merged.set(review.submissionId, review);
      continue;
    }
    if (!sameSubmission(stored, review)) {
      throw new AppError(
        'BACKUP_CONFLICT',
        `提交 ${review.submissionId} 与本地记录冲突，导入已取消`,
      );
    }
  }
  return Array.from(merged.values());
}

function deduplicateProblems(problems: readonly ProblemRecord[]): ProblemRecord[] {
  return mergeProblems([], problems);
}

function deduplicateSubmissions(
  submissions: readonly SubmissionReview[],
): SubmissionReview[] {
  return mergeSubmissions([], submissions);
}

function deduplicateIssues(issues: readonly DetectionIssue[]): DetectionIssue[] {
  const unique = new Map<string, DetectionIssue>();
  for (const issue of issues) {
    const key = issueKey(issue);
    const normalized = stripIssueId(issue);
    const stored = unique.get(key);
    unique.set(key, stored ? mergeIssueStatuses(stored, normalized) : normalized);
  }
  return Array.from(unique.values());
}

function assertUniqueIncoming(snapshot: PersistedSnapshot): void {
  const problemIds = snapshot.problems.map((problem) => problem.problemId);
  assertUnique(problemIds, '题目 ID');

  const submissions = new Map<string, SubmissionReview>();
  for (const review of snapshot.submissions) {
    const existing = submissions.get(review.submissionId);
    if (existing && !sameSubmission(existing, review)) {
      throw new AppError('BACKUP_INVALID', `提交 ${review.submissionId} 在备份中重复且内容不一致`);
    }
    submissions.set(review.submissionId, review);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new AppError('BACKUP_INVALID', `备份中存在重复的${label}`);
  }
}

function assertSubmissionReferences(snapshot: PersistedSnapshot): void {
  const problemIds = new Set(snapshot.problems.map((problem) => problem.problemId));
  const orphan = snapshot.submissions.find((review) => !problemIds.has(review.problemId));
  if (orphan) {
    throw new AppError(
      'BACKUP_INVALID',
      `提交 ${orphan.submissionId} 引用了不存在的题目 ${orphan.problemId}`,
    );
  }
}

function assertProblemIdentities(problems: readonly ProblemRecord[]): void {
  for (const problem of problems) {
    if (problem.problemId !== `leetcode-cn:${problem.slug}`) {
      throw new AppError('BACKUP_INVALID', `题目 ${problem.problemId} 与 slug 不一致`);
    }
    const url = new URL(problem.url);
    const problemPath = `/problems/${problem.slug}`;
    const pathMatches = url.pathname === problemPath || url.pathname.startsWith(`${problemPath}/`);
    if (url.origin !== 'https://leetcode.cn' || !pathMatches) {
      throw new AppError('BACKUP_INVALID', `题目 ${problem.problemId} 的链接不属于力扣中文站`);
    }
  }
}

function rebuildDerivedState(snapshot: PersistedSnapshot, replay: Replay): PersistedSnapshot {
  const reviewsByProblem = groupReviews(snapshot.submissions);
  const rebuiltReviews = new Map<string, SubmissionReview>();
  const problems = snapshot.problems.map((problem) => {
    const result = replay(reviewsByProblem.get(problem.problemId) ?? []);
    for (const review of result.reviews) {
      rebuiltReviews.set(review.submissionId, review);
    }
    return {
      ...problem,
      fsrsCard: result.card,
      nextReviewAt: result.card?.due ?? null,
      algorithm: FSRS_ALGORITHM as 'FSRS-6',
      algorithmLibrary: FSRS_LIBRARY_VERSION,
      parametersVersion: FSRS_PARAMETERS_VERSION,
    };
  });

  return {
    problems,
    submissions: snapshot.submissions.map((review) => {
      const rebuilt = rebuiltReviews.get(review.submissionId);
      if (!rebuilt) {
        throw new AppError('BACKUP_INVALID', `无法重建提交 ${review.submissionId}`);
      }
      return rebuilt;
    }),
    issues: snapshot.issues.map(stripIssueId),
  };
}

function groupReviews(
  reviews: readonly SubmissionReview[],
): Map<string, SubmissionReview[]> {
  const grouped = new Map<string, SubmissionReview[]>();
  for (const review of reviews) {
    const problemReviews = grouped.get(review.problemId) ?? [];
    problemReviews.push(review);
    grouped.set(review.problemId, problemReviews);
  }
  return grouped;
}

function sameSubmission(left: SubmissionReview, right: SubmissionReview): boolean {
  return (
    left.submissionId === right.submissionId &&
    left.problemId === right.problemId &&
    left.trigger === right.trigger &&
    left.acceptedAt === right.acceptedAt &&
    left.detectedAt === right.detectedAt &&
    left.rating === right.rating
  );
}

function issueKey(issue: DetectionIssue): string {
  return JSON.stringify([
    issue.slug,
    issue.occurredAt,
    issue.code,
    issue.retryable,
    issue.diagnostic,
  ]);
}

function mergeIssueStatuses(
  left: DetectionIssue,
  right: DetectionIssue,
): DetectionIssue {
  return {
    ...left,
    readAt: earliestTimestamp(left.readAt, right.readAt),
    resolvedAt: earliestTimestamp(left.resolvedAt, right.resolvedAt),
  };
}

function earliestTimestamp(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function stripIssueId(issue: DetectionIssue): DetectionIssue {
  return {
    slug: issue.slug,
    occurredAt: issue.occurredAt,
    code: issue.code,
    retryable: issue.retryable,
    diagnostic: issue.diagnostic,
    readAt: issue.readAt,
    resolvedAt: issue.resolvedAt,
  };
}
