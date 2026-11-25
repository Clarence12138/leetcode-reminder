import type { BuiltinProblemListId } from '../domain/problem-lists';
import {
  countReviewedToday,
  isProblemPaused,
  resolveRequestRetention,
} from '../domain/queue-policy';
import type {
  DailySummary,
  DetectionIssue,
  Difficulty,
  MasteryRating,
  ProblemMetadata,
  ProblemRecord,
  ReviewPreview,
  Settings,
  SubmissionReview,
  SubmissionTrigger,
} from '../domain/types';
import type { XiaoshuajiDatabase } from './database';
import { AppError } from './errors';
import { previewPendingReview, replayReviews, type FsrsReplayOptions } from './fsrs';
import {
  assembleDailySummary,
  assertProblemIdentity,
  assertSameAccepted,
  buildUpsertedProblem,
  createPendingReview,
} from './store-helpers';
import { prepareImportedSnapshot, type PersistedSnapshot, type Replay } from './store-import';
import {
  applyListGroupBatch,
  deleteProblemsBatch,
  recalculateAllProblemSchedules,
  updateIssuesBatch,
  updateProblemsGroup,
  updateProblemsPaused,
} from './store-mutations';

export interface AcceptedSubmissionInput {
  readonly metadata: ProblemMetadata;
  readonly submissionId: string;
  readonly trigger: SubmissionTrigger;
  readonly acceptedAt: number;
}

export interface DashboardFilter {
  readonly search?: string;
  readonly difficulty?: Difficulty;
  readonly tag?: string;
}

export interface AttentionCounts {
  readonly due: number;
  readonly pending: number;
}

export type IssueUpdateResult = Readonly<{ updatedCount: number }>;
export type ProblemUpdateResult = Readonly<{ updatedCount: number }>;
export type ListGroupApplyResult = Readonly<{ updatedCount: number; matchedCount: number }>;

export interface ReviewStore {
  recordAccepted(input: AcceptedSubmissionInput): Promise<{
    readonly created: boolean;
    readonly review: SubmissionReview;
    readonly nextReviewAt: number | null;
  }>;
  rateSubmission(submissionId: string, rating: MasteryRating): Promise<{
    readonly review: SubmissionReview;
    readonly nextReviewAt: number | null;
  }>;
  discardSubmission(submissionId: string): Promise<{ readonly problemDeleted: boolean }>;
  preview(problemId: string, submissionId: string): Promise<ReviewPreview>;
  queryDashboard(filter?: DashboardFilter): Promise<DailySummary>;
  getAttentionCounts(dueCutoff?: number): Promise<AttentionCounts>;
  countReviewedToday(timezone: string, now?: number): Promise<number>;
  recordIssue(issue: Omit<DetectionIssue, 'id'>): Promise<DetectionIssue>;
  markIssuesRead(issueIds: readonly number[]): Promise<IssueUpdateResult>;
  resolveIssues(issueIds: readonly number[]): Promise<IssueUpdateResult>;
  deleteProblem(problemId: string): Promise<boolean>;
  deleteProblems(problemIds: readonly string[]): Promise<{ readonly deletedCount: number }>;
  setProblemsPaused(problemIds: readonly string[], paused: boolean): Promise<ProblemUpdateResult>;
  setProblemsGroup(problemIds: readonly string[], groupId: string | null): Promise<ProblemUpdateResult>;
  applyListGroup(listIds: readonly BuiltinProblemListId[], groupId: string | null): Promise<ListGroupApplyResult>;
  recalculateSchedules(settings?: Settings): Promise<ProblemUpdateResult>;
  clear(): Promise<void>;
  getSnapshot(): Promise<PersistedSnapshot>;
  importSnapshot(
    snapshot: SnapshotSource,
    mode: 'merge' | 'replace',
    settingsOverride?: Settings,
  ): Promise<void>;
}

/** 传入函数时，会在同一事务内基于当前数据生成待导入快照。 */
export type SnapshotSource = PersistedSnapshot | ((current: PersistedSnapshot) => PersistedSnapshot);

type Preview = (
  reviews: readonly SubmissionReview[],
  submissionId: string,
  options?: FsrsReplayOptions,
) => ReviewPreview;

export interface DexieReviewStoreOptions {
  readonly database: XiaoshuajiDatabase;
  readonly now?: () => number;
  readonly replay?: Replay;
  readonly preview?: Preview;
  readonly getSettings?: (() => Promise<Settings>) | undefined;
}

export class DexieReviewStore implements ReviewStore {
  private readonly db: XiaoshuajiDatabase;
  private readonly now: () => number;
  private readonly replay: Replay;
  private readonly previewer: Preview;
  private readonly getSettings: (() => Promise<Settings>) | undefined;

  constructor(options: DexieReviewStoreOptions) {
    this.db = options.database;
    this.now = options.now ?? Date.now;
    this.replay = options.replay ?? replayReviews;
    this.previewer = options.preview ?? previewPendingReview;
    this.getSettings = options.getSettings;
  }

  async recordAccepted(input: AcceptedSubmissionInput) {
    assertProblemIdentity(input.metadata);
    const settings = await this.readSettings();
    return this.db.transaction('rw', this.db.problems, this.db.submissions, async () => {
      const storedReview = await this.db.submissions.get(input.submissionId);
      if (storedReview) {
        assertSameAccepted(storedReview, input);
        const problem = await this.upsertProblemMetadata(input.metadata, settings);
        return { created: false, review: storedReview, nextReviewAt: problem.nextReviewAt };
      }
      const review = createPendingReview(input, this.now());
      const problem = await this.upsertProblemMetadata(input.metadata, settings);
      await this.db.submissions.add(review);
      return { created: true, review, nextReviewAt: problem.nextReviewAt };
    });
  }

  async rateSubmission(submissionId: string, rating: MasteryRating) {
    const settings = await this.readSettings();
    return this.db.transaction('rw', this.db.problems, this.db.submissions, async () => {
      const stored = await this.db.submissions.get(submissionId);
      if (!stored) throw new AppError('SUBMISSION_NOT_FOUND', `未找到提交 ${submissionId}`);
      const problem = await this.db.problems.get(stored.problemId);
      if (!problem) throw new AppError('DATA_INTEGRITY_ERROR', `提交 ${submissionId} 缺少题目记录`);
      const reviews = await this.db.submissions.where('problemId').equals(stored.problemId).toArray();
      const rated = reviews.map((review) =>
        review.submissionId === submissionId ? { ...review, rating } : review,
      );
      const requestRetention = resolveRequestRetention(problem, settings);
      const replayed = this.replay(rated, { requestRetention });
      const updated = replayed.reviews.find((review) => review.submissionId === submissionId);
      if (!updated) throw new AppError('DATA_INTEGRITY_ERROR', `FSRS 未返回提交 ${submissionId}`);
      await this.db.submissions.bulkPut([...replayed.reviews]);
      await this.db.problems.put({
        ...problem,
        fsrsCard: replayed.card,
        nextReviewAt: replayed.card?.due ?? null,
        updatedAt: this.now(),
      });
      return { review: updated, nextReviewAt: replayed.card?.due ?? null };
    });
  }

  async discardSubmission(submissionId: string): Promise<{ readonly problemDeleted: boolean }> {
    return this.db.transaction('rw', this.db.problems, this.db.submissions, async () => {
      const stored = await this.db.submissions.get(submissionId);
      if (!stored) throw new AppError('SUBMISSION_NOT_FOUND', `未找到提交 ${submissionId}`);
      if (stored.rating !== null) {
        throw new AppError('SUBMISSION_ALREADY_RATED', `提交 ${submissionId} 已评分，不能丢弃`);
      }
      await this.db.submissions.delete(submissionId);
      const remaining = await this.db.submissions.where('problemId').equals(stored.problemId).count();
      if (remaining > 0) return { problemDeleted: false };
      const problem = await this.db.problems.get(stored.problemId);
      if (!problem || problem.fsrsCard !== null) return { problemDeleted: false };
      await this.db.problems.delete(stored.problemId);
      return { problemDeleted: true };
    });
  }

  async preview(problemId: string, submissionId: string): Promise<ReviewPreview> {
    const [problem, settings] = await Promise.all([this.db.problems.get(problemId), this.readSettings()]);
    if (!problem) throw new AppError('PROBLEM_NOT_FOUND', `未找到题目 ${problemId}`);
    const reviews = await this.db.submissions.where('problemId').equals(problemId).toArray();
    return this.previewer(reviews, submissionId, { requestRetention: resolveRequestRetention(problem, settings) });
  }

  async queryDashboard(filter: DashboardFilter = {}): Promise<DailySummary> {
    const [allProblems, allReviews, allIssues, settings] = await Promise.all([
      this.db.problems.toArray(),
      this.db.submissions.toArray(),
      this.db.issues.toArray(),
      this.readSettings(),
    ]);
    return assembleDailySummary({ allProblems, allReviews, allIssues, filter, now: this.now(), settings });
  }

  async getAttentionCounts(dueCutoff = this.now()): Promise<AttentionCounts> {
    const [dueProblems, pending] = await Promise.all([
      this.db.problems.where('nextReviewAt').belowOrEqual(dueCutoff).toArray(),
      this.db.submissions.filter((review) => review.rating === null).count(),
    ]);
    return { due: dueProblems.filter((problem) => !isProblemPaused(problem)).length, pending };
  }

  async countReviewedToday(timezone: string, now = this.now()): Promise<number> {
    return countReviewedToday(await this.db.submissions.toArray(), { now, timezone });
  }

  async recordIssue(issue: Omit<DetectionIssue, 'id'>): Promise<DetectionIssue> {
    return { ...issue, id: Number(await this.db.issues.add(issue)) };
  }

  markIssuesRead(issueIds: readonly number[]): Promise<IssueUpdateResult> {
    return updateIssuesBatch(this.mutationContext(), issueIds, (issue, at) =>
      issue.readAt === null ? { ...issue, readAt: at } : null,
    );
  }

  resolveIssues(issueIds: readonly number[]): Promise<IssueUpdateResult> {
    return updateIssuesBatch(this.mutationContext(), issueIds, (issue, at) =>
      issue.readAt === null || issue.resolvedAt === null
        ? { ...issue, readAt: issue.readAt ?? at, resolvedAt: issue.resolvedAt ?? at }
        : null,
    );
  }

  async deleteProblem(problemId: string): Promise<boolean> {
    return (await this.deleteProblems([problemId])).deletedCount > 0;
  }

  deleteProblems(problemIds: readonly string[]): Promise<{ readonly deletedCount: number }> {
    return deleteProblemsBatch(this.db, problemIds);
  }

  setProblemsPaused(problemIds: readonly string[], paused: boolean): Promise<ProblemUpdateResult> {
    return updateProblemsPaused(this.mutationContext(), problemIds, paused);
  }

  async setProblemsGroup(problemIds: readonly string[], groupId: string | null): Promise<ProblemUpdateResult> {
    const settings = await this.readSettings();
    return updateProblemsGroup({ ctx: this.mutationContext(), problemIds, groupId, settings });
  }

  async applyListGroup(
    listIds: readonly BuiltinProblemListId[],
    groupId: string | null,
  ): Promise<ListGroupApplyResult> {
    return applyListGroupBatch({
      ctx: this.mutationContext(),
      listIds,
      groupId,
      settings: await this.readSettings(),
    });
  }

  async recalculateSchedules(settings?: Settings): Promise<ProblemUpdateResult> {
    return recalculateAllProblemSchedules({
      ctx: this.mutationContext(),
      settings: settings ?? await this.readSettings(),
    });
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.problems, this.db.submissions, this.db.issues, () =>
      Promise.all([this.db.problems.clear(), this.db.submissions.clear(), this.db.issues.clear()]),
    );
  }

  getSnapshot(): Promise<PersistedSnapshot> {
    return this.db.transaction('r', this.db.problems, this.db.submissions, this.db.issues, () =>
      this.readSnapshotInTransaction(),
    );
  }

  async importSnapshot(
    snapshot: SnapshotSource,
    mode: 'merge' | 'replace',
    settingsOverride?: Settings,
  ): Promise<void> {
    const settings = settingsOverride ?? await this.readSettings();
    await this.db.transaction('rw', this.db.problems, this.db.submissions, this.db.issues, async () => {
      const current = await this.readSnapshotInTransaction();
      const incoming = typeof snapshot === 'function' ? snapshot(current) : snapshot;
      const prepared = prepareImportedSnapshot({ current, incoming, mode, replay: this.replay, settings });
      await Promise.all([this.db.problems.clear(), this.db.submissions.clear(), this.db.issues.clear()]);
      if (prepared.problems.length > 0) await this.db.problems.bulkAdd([...prepared.problems]);
      if (prepared.submissions.length > 0) await this.db.submissions.bulkAdd([...prepared.submissions]);
      if (prepared.issues.length > 0) await this.db.issues.bulkAdd([...prepared.issues]);
    });
  }

  private mutationContext() {
    return { db: this.db, now: this.now, replay: this.replay };
  }

  private async readSettings(): Promise<Settings | undefined> {
    return this.getSettings ? this.getSettings() : undefined;
  }

  private async upsertProblemMetadata(metadata: ProblemMetadata, settings?: Settings): Promise<ProblemRecord> {
    const stored = await this.db.problems.get(metadata.problemId);
    const problem = buildUpsertedProblem({ metadata, stored, timestamp: this.now(), settings });
    await this.db.problems.put(problem);
    return problem;
  }

  private async readSnapshotInTransaction(): Promise<PersistedSnapshot> {
    const [problems, submissions, issues] = await Promise.all([
      this.db.problems.toArray(),
      this.db.submissions.toArray(),
      this.db.issues.toArray(),
    ]);
    return { problems, submissions, issues };
  }
}
