import { isSlugInBuiltinList, type BuiltinProblemListId } from '../domain/problem-lists';
import { isProblemPaused, resolveRequestRetention } from '../domain/queue-policy';
import type { DetectionIssue, ProblemRecord, Settings, SubmissionReview } from '../domain/types';
import type { XiaoshuajiDatabase } from './database';
import { AppError } from './errors';
import type { Replay } from './store-import';

export interface StoreMutationContext {
  readonly db: XiaoshuajiDatabase;
  readonly now: () => number;
  readonly replay: Replay;
}

export type RetentionSettings = Pick<Settings, 'defaultRequestRetention' | 'reviewGroups'>;

export async function deleteProblemsBatch(
  db: XiaoshuajiDatabase,
  problemIds: readonly string[],
): Promise<{ readonly deletedCount: number }> {
  return db.transaction('rw', db.problems, db.submissions, db.issues, async () => {
    const stored = (await db.problems.bulkGet([...new Set(problemIds)])).filter(isDefinedProblem);
    if (stored.length === 0) return { deletedCount: 0 };
    const ids = stored.map((problem) => problem.problemId);
    const slugs = [...new Set(stored.map((problem) => problem.slug))];
    await Promise.all([
      db.problems.bulkDelete(ids),
      db.submissions.where('problemId').anyOf(ids).delete(),
      db.issues.where('slug').anyOf(slugs).delete(),
    ]);
    return { deletedCount: stored.length };
  });
}

export async function updateIssuesBatch(
  ctx: Pick<StoreMutationContext, 'db' | 'now'>,
  issueIds: readonly number[],
  update: (issue: DetectionIssue, timestamp: number) => DetectionIssue | null,
): Promise<{ readonly updatedCount: number }> {
  return ctx.db.transaction('rw', ctx.db.issues, async () => {
    const stored = await ctx.db.issues.bulkGet([...issueIds]);
    const missingId = issueIds.find((_, index) => stored[index] === undefined);
    if (missingId !== undefined) throw new AppError('ISSUE_NOT_FOUND', `未找到检测异常 ${missingId}`);
    const timestamp = ctx.now();
    const updated = (stored as DetectionIssue[])
      .map((issue) => update(issue, timestamp))
      .filter((issue): issue is DetectionIssue => issue !== null);
    if (updated.length > 0) await ctx.db.issues.bulkPut(updated);
    return { updatedCount: updated.length };
  });
}

export async function updateProblemsPaused(
  ctx: StoreMutationContext,
  problemIds: readonly string[],
  paused: boolean,
): Promise<{ readonly updatedCount: number }> {
  return ctx.db.transaction('rw', ctx.db.problems, async () => {
    const uniqueIds = [...new Set(problemIds)];
    const stored = (await ctx.db.problems.bulkGet(uniqueIds)).filter(isDefinedProblem);
    const timestamp = ctx.now();
    const updated: ProblemRecord[] = [];
    for (const problem of stored) {
      if (isProblemPaused(problem) === paused) continue;
      updated.push({ ...problem, pausedAt: paused ? timestamp : null, updatedAt: timestamp });
    }
    if (updated.length > 0) await ctx.db.problems.bulkPut(updated);
    return { updatedCount: updated.length };
  });
}

export async function updateProblemsGroup(options: {
  readonly ctx: StoreMutationContext;
  readonly problemIds: readonly string[];
  readonly groupId: string | null;
  readonly settings?: RetentionSettings | undefined;
}): Promise<{ readonly updatedCount: number }> {
  const { ctx, problemIds, groupId, settings } = options;
  assertGroupExists(groupId, settings);
  return ctx.db.transaction('rw', ctx.db.problems, ctx.db.submissions, async () => {
    const uniqueIds = [...new Set(problemIds)];
    const stored = (await ctx.db.problems.bulkGet(uniqueIds)).filter(isDefinedProblem);
    const targets = stored.filter((problem) => (problem.groupId ?? null) !== groupId);
    if (targets.length === 0) return { updatedCount: 0 };
    const timestamp = ctx.now();
    const reassigned = targets.map((problem) => ({ ...problem, groupId, updatedAt: timestamp }));
    await replayAndPersistProblems({ ctx, problems: reassigned, settings });
    return { updatedCount: reassigned.length };
  });
}

export async function applyListGroupBatch(options: {
  readonly ctx: StoreMutationContext;
  readonly listIds: readonly BuiltinProblemListId[];
  readonly groupId: string | null;
  readonly settings?: RetentionSettings | undefined;
}): Promise<{ readonly updatedCount: number; readonly matchedCount: number }> {
  const { ctx, listIds, groupId, settings } = options;
  const allProblems = await ctx.db.problems.toArray();
  const matchedIds = allProblems
    .filter((problem) => listIds.some((listId) => isSlugInBuiltinList(problem.slug, listId)))
    .map((problem) => problem.problemId);
  const { updatedCount } = await updateProblemsGroup({ ctx, problemIds: matchedIds, groupId, settings });
  return { updatedCount, matchedCount: matchedIds.length };
}

export async function recalculateAllProblemSchedules(options: {
  readonly ctx: StoreMutationContext;
  readonly settings?: RetentionSettings | undefined;
}): Promise<{ readonly updatedCount: number }> {
  const { ctx, settings } = options;
  const validGroups = settings ? new Set(settings.reviewGroups.map((group) => group.id)) : null;
  return ctx.db.transaction('rw', ctx.db.problems, ctx.db.submissions, async () => {
    const allProblems = await ctx.db.problems.toArray();
    if (allProblems.length === 0) return { updatedCount: 0 };
    const timestamp = ctx.now();
    const normalized = allProblems.map((problem) =>
      normalizeProblemGroup(problem, validGroups, timestamp),
    );
    await replayAndPersistProblems({ ctx, problems: normalized, settings });
    return { updatedCount: normalized.length };
  });
}

function normalizeProblemGroup(
  problem: ProblemRecord,
  validGroups: ReadonlySet<string> | null,
  timestamp: number,
): ProblemRecord {
  const currentGroup = problem.groupId ?? null;
  const nextGroup = currentGroup && validGroups && !validGroups.has(currentGroup)
    ? null
    : currentGroup;
  return nextGroup === currentGroup ? problem : { ...problem, groupId: nextGroup, updatedAt: timestamp };
}

async function replayAndPersistProblems(options: {
  readonly ctx: StoreMutationContext;
  readonly problems: readonly ProblemRecord[];
  readonly settings?: RetentionSettings | undefined;
}): Promise<void> {
  const { ctx, problems, settings } = options;
  const ids = problems.map((problem) => problem.problemId);
  const allReviews = await ctx.db.submissions.where('problemId').anyOf(ids).toArray();
  const reviewsByProblem = groupReviewsByProblem(allReviews);
  const updatedProblems: ProblemRecord[] = [];
  const updatedReviews: SubmissionReview[] = [];

  for (const problem of problems) {
    const requestRetention = resolveRequestRetention(problem, settings);
    const replayed = ctx.replay(reviewsByProblem.get(problem.problemId) ?? [], { requestRetention });
    updatedProblems.push({
      ...problem,
      fsrsCard: replayed.card,
      nextReviewAt: replayed.card?.due ?? null,
    });
    updatedReviews.push(...replayed.reviews);
  }
  if (updatedReviews.length > 0) await ctx.db.submissions.bulkPut(updatedReviews);
  if (updatedProblems.length > 0) await ctx.db.problems.bulkPut(updatedProblems);
}

function assertGroupExists(
  groupId: string | null,
  settings?: Pick<Settings, 'reviewGroups'>,
): void {
  if (groupId === null) return;
  const exists = settings?.reviewGroups.some((group) => group.id === groupId) ?? false;
  if (!exists) throw new AppError('GROUP_NOT_FOUND', `未找到复习分组 ${groupId}`);
}

function isDefinedProblem(problem: ProblemRecord | undefined): problem is ProblemRecord {
  return problem !== undefined;
}

function groupReviewsByProblem(
  reviews: readonly SubmissionReview[],
): Map<string, SubmissionReview[]> {
  const grouped = new Map<string, SubmissionReview[]>();
  for (const review of reviews) {
    const list = grouped.get(review.problemId) ?? [];
    list.push(review);
    grouped.set(review.problemId, list);
  }
  return grouped;
}
