import {
  FSRS_ALGORITHM,
  FSRS_LIBRARY_VERSION,
  FSRS_PARAMETERS_VERSION,
} from '../domain/constants';
import type {
  HistoryImportResult,
  HistoryRatingMode,
  LeetCodeHistoryProblem,
  ProblemRecord,
  SubmissionReview,
} from '../domain/types';
import { AppError } from './errors';
import type { PersistedSnapshot } from './store-import';
import type { ReviewStore } from './store';

type HistorySubmission = LeetCodeHistoryProblem['submissions'][number];

export interface HistoryImportOptions {
  readonly problems: readonly LeetCodeHistoryProblem[];
  readonly rating: HistoryRatingMode;
  readonly timezone: string;
  readonly now: number;
}

export interface HistoryImportPlan {
  readonly snapshot: PersistedSnapshot;
  readonly result: HistoryImportResult;
}

/**
 * 把力扣历史 AC 记录转换为可合并导入的快照。
 * 本地已有的题目整体跳过，保留用户自己的评分；同一天多次 AC 只算一次复习。
 */
export function planHistoryImport(
  current: PersistedSnapshot,
  options: HistoryImportOptions,
): HistoryImportPlan {
  const knownProblems = new Set(current.problems.map((problem) => problem.problemId));
  const knownSubmissions = new Set(current.submissions.map((review) => review.submissionId));
  const seenProblems = new Set<string>();
  const claimedSubmissions = new Set<string>();
  const problems: ProblemRecord[] = [];
  const submissions: SubmissionReview[] = [];
  let skippedProblems = 0;

  for (const entry of options.problems) {
    const { problemId } = entry.metadata;
    if (knownProblems.has(problemId) || seenProblems.has(problemId)) {
      skippedProblems += 1;
      continue;
    }
    const accepted = selectSubmissions(entry.submissions, options)
      .filter((submission) => !knownSubmissions.has(submission.submissionId));
    if (accepted.length === 0) {
      skippedProblems += 1;
      continue;
    }
    seenProblems.add(problemId);
    claimSubmissions(accepted, claimedSubmissions);
    problems.push(toProblemRecord(entry, options.now));
    submissions.push(...accepted.map((submission) => toReview(problemId, submission, options)));
  }

  return {
    snapshot: { problems, submissions, issues: [] },
    result: {
      importedProblems: problems.length,
      importedSubmissions: submissions.length,
      skippedProblems,
    },
  };
}

export async function importLeetCodeHistory(
  store: ReviewStore,
  options: HistoryImportOptions,
): Promise<HistoryImportResult> {
  let result: HistoryImportResult | null = null;
  await store.importSnapshot((current) => {
    const plan = planHistoryImport(current, options);
    result = plan.result;
    return plan.snapshot;
  }, 'merge');
  if (!result) throw new Error('导入计划未生成');
  return result;
}

function selectSubmissions(
  submissions: readonly HistorySubmission[],
  options: HistoryImportOptions,
): HistorySubmission[] {
  const ordered = uniqueById(submissions).sort((left, right) => left.acceptedAt - right.acceptedAt);
  // 自己补评时每题只留最近一次 AC，避免待评估队列被历史记录淹没。
  if (options.rating.mode === 'manual') return ordered.slice(-1);
  const firstPerDay = new Map<string, HistorySubmission>();
  for (const submission of ordered) {
    const day = localDay(submission.acceptedAt, options.timezone);
    if (!firstPerDay.has(day)) firstPerDay.set(day, submission);
  }
  return [...firstPerDay.values()];
}

function claimSubmissions(accepted: readonly HistorySubmission[], known: Set<string>): void {
  for (const { submissionId } of accepted) {
    if (known.has(submissionId)) {
      throw new AppError('HISTORY_CONFLICT', `力扣返回的提交 ${submissionId} 同时属于多道题目，导入已取消`);
    }
    known.add(submissionId);
  }
}

function uniqueById(submissions: readonly HistorySubmission[]): HistorySubmission[] {
  return [...new Map(submissions.map((submission) => [submission.submissionId, submission])).values()];
}

function localDay(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timestamp);
}

function toProblemRecord(entry: LeetCodeHistoryProblem, now: number): ProblemRecord {
  return {
    ...entry.metadata,
    createdAt: now,
    updatedAt: now,
    fsrsCard: null,
    nextReviewAt: null,
    algorithm: FSRS_ALGORITHM,
    algorithmLibrary: FSRS_LIBRARY_VERSION,
    parametersVersion: FSRS_PARAMETERS_VERSION,
  };
}

function toReview(
  problemId: string,
  submission: HistorySubmission,
  options: HistoryImportOptions,
): SubmissionReview {
  return {
    submissionId: submission.submissionId,
    problemId,
    trigger: 'import',
    acceptedAt: submission.acceptedAt,
    detectedAt: options.now,
    rating: options.rating.mode === 'uniform' ? options.rating.rating : null,
    fsrsLog: null,
  };
}
