import {
  FSRS_ALGORITHM,
  FSRS_LIBRARY_VERSION,
  FSRS_PARAMETERS_VERSION,
} from '../domain/constants';
import type {
  DailySummary,
  DetectionIssue,
  Difficulty,
  MasteryRating,
  ProblemMetadata,
  ProblemRecord,
  ReviewPreview,
  SubmissionReview,
  SubmissionTrigger,
} from '../domain/types';
import type { XiaoshuajiDatabase } from './database';
import { AppError } from './errors';
import { previewPendingReview, replayReviews, type ReplayResult } from './fsrs';
import {
  assertProblemIdentity,
  assertSameAccepted,
  createPendingReview,
  matchesFilter,
  sortProblems,
  sortReviews,
} from './store-helpers';
import { prepareImportedSnapshot, type PersistedSnapshot } from './store-import';

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
  recordIssue(issue: Omit<DetectionIssue, 'id'>): Promise<DetectionIssue>;
  markIssuesRead(issueIds: readonly number[]): Promise<IssueUpdateResult>;
  resolveIssues(issueIds: readonly number[]): Promise<IssueUpdateResult>;
  deleteProblem(problemId: string): Promise<boolean>;
  clear(): Promise<void>;
  getSnapshot(): Promise<PersistedSnapshot>;
  importSnapshot(snapshot: PersistedSnapshot, mode: 'merge' | 'replace'): Promise<void>;
}

type Replay = (reviews: readonly SubmissionReview[]) => ReplayResult;
type Preview = (reviews: readonly SubmissionReview[], submissionId: string) => ReviewPreview;

export interface DexieReviewStoreOptions {
  readonly database: XiaoshuajiDatabase;
  readonly now?: () => number;
  readonly replay?: Replay;
  readonly preview?: Preview;
}

export class DexieReviewStore implements ReviewStore {
  private readonly db: XiaoshuajiDatabase;
  private readonly now: () => number;
  private readonly replay: Replay;
  private readonly previewer: Preview;

  constructor(options: DexieReviewStoreOptions) {
    this.db = options.database;
    this.now = options.now ?? Date.now;
    this.replay = options.replay ?? replayReviews;
    this.previewer = options.preview ?? previewPendingReview;
  }

  async recordAccepted(input: AcceptedSubmissionInput) {
    assertProblemIdentity(input.metadata);
    return this.db.transaction('rw', this.db.problems, this.db.submissions, async () => {
      const storedReview = await this.db.submissions.get(input.submissionId);
      if (storedReview) {
        assertSameAccepted(storedReview, input);
        const problem = await this.upsertProblemMetadata(input.metadata);
        return { created: false, review: storedReview, nextReviewAt: problem.nextReviewAt };
      }

      const review = createPendingReview(input, this.now());
      const problem = await this.upsertProblemMetadata(input.metadata);
      await this.db.submissions.add(review);
      return { created: true, review, nextReviewAt: problem.nextReviewAt };
    });
  }

  async rateSubmission(submissionId: string, rating: MasteryRating) {
    return this.db.transaction('rw', this.db.problems, this.db.submissions, async () => {
      const stored = await this.db.submissions.get(submissionId);
      if (!stored) {
        throw new AppError('SUBMISSION_NOT_FOUND', `未找到提交 ${submissionId}`);
      }
      const problem = await this.db.problems.get(stored.problemId);
      if (!problem) {
        throw new AppError('DATA_INTEGRITY_ERROR', `提交 ${submissionId} 缺少题目记录`);
      }

      const reviews = await this.db.submissions.where('problemId').equals(stored.problemId).toArray();
      const rated = reviews.map((review) =>
        review.submissionId === submissionId ? { ...review, rating } : review,
      );
      const replayed = this.replay(rated);
      const updated = replayed.reviews.find((review) => review.submissionId === submissionId);
      if (!updated) {
        throw new AppError('DATA_INTEGRITY_ERROR', `FSRS 未返回提交 ${submissionId}`);
      }

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
      if (!stored) {
        throw new AppError('SUBMISSION_NOT_FOUND', `未找到提交 ${submissionId}`);
      }
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
    const problem = await this.db.problems.get(problemId);
    if (!problem) {
      throw new AppError('PROBLEM_NOT_FOUND', `未找到题目 ${problemId}`);
    }
    const reviews = await this.db.submissions.where('problemId').equals(problemId).toArray();
    return this.previewer(reviews, submissionId);
  }

  async queryDashboard(filter: DashboardFilter = {}): Promise<DailySummary> {
    const [allProblems, allReviews, allIssues] = await Promise.all([
      this.db.problems.toArray(),
      this.db.submissions.toArray(),
      this.db.issues.toArray(),
    ]);
    const problems = sortProblems(allProblems.filter((problem) => matchesFilter(problem, filter)));
    const visibleIds = new Set(problems.map((problem) => problem.problemId));
    const reviews = allReviews.filter((review) => visibleIds.has(review.problemId));
    const now = this.now();

    return {
      problems,
      dueProblems: problems
        .filter((problem) => problem.nextReviewAt !== null && problem.nextReviewAt <= now)
        .sort(
          (left, right) => (left.nextReviewAt ?? 0) - (right.nextReviewAt ?? 0),
        ),
      pendingReviews: sortReviews(reviews.filter((review) => review.rating === null)),
      recentReviews: sortReviews(reviews.filter((review) => review.rating !== null)),
      issues: [...allIssues].sort((left, right) => right.occurredAt - left.occurredAt),
    };
  }

  async getAttentionCounts(dueCutoff = this.now()): Promise<AttentionCounts> {
    const [due, pending] = await Promise.all([
      this.db.problems.where('nextReviewAt').belowOrEqual(dueCutoff).count(),
      this.db.submissions.filter((review) => review.rating === null).count(),
    ]);
    return { due, pending };
  }

  async recordIssue(issue: Omit<DetectionIssue, 'id'>): Promise<DetectionIssue> {
    const id = await this.db.issues.add(issue);
    return { ...issue, id: Number(id) };
  }

  async markIssuesRead(issueIds: readonly number[]): Promise<IssueUpdateResult> {
    return this.updateIssues(
      issueIds,
      (issue, at) => issue.readAt === null ? { ...issue, readAt: at } : null,
    );
  }

  async resolveIssues(issueIds: readonly number[]): Promise<IssueUpdateResult> {
    return this.updateIssues(
      issueIds,
      (issue, at) => issue.readAt === null || issue.resolvedAt === null
        ? { ...issue, readAt: issue.readAt ?? at, resolvedAt: issue.resolvedAt ?? at }
        : null,
    );
  }

  async deleteProblem(problemId: string): Promise<boolean> {
    return this.db.transaction('rw', this.db.problems, this.db.submissions, this.db.issues, async () => {
      const problem = await this.db.problems.get(problemId);
      if (!problem) return false;
      await Promise.all([
        this.db.problems.delete(problemId),
        this.db.submissions.where('problemId').equals(problemId).delete(),
        this.db.issues.where('slug').equals(problem.slug).delete(),
      ]);
      return true;
    });
  }

  async clear(): Promise<void> {
    await this.db.transaction('rw', this.db.problems, this.db.submissions, this.db.issues, () =>
      Promise.all([this.db.problems.clear(), this.db.submissions.clear(), this.db.issues.clear()]),
    );
  }

  async getSnapshot(): Promise<PersistedSnapshot> {
    return this.db.transaction('r', this.db.problems, this.db.submissions, this.db.issues, async () => {
      const [problems, submissions, issues] = await Promise.all([
        this.db.problems.toArray(),
        this.db.submissions.toArray(),
        this.db.issues.toArray(),
      ]);
      return { problems, submissions, issues };
    });
  }

  async importSnapshot(snapshot: PersistedSnapshot, mode: 'merge' | 'replace'): Promise<void> {
    await this.db.transaction('rw', this.db.problems, this.db.submissions, this.db.issues, async () => {
      const current = await this.readSnapshotInTransaction();
      const prepared = prepareImportedSnapshot({ current, incoming: snapshot, mode, replay: this.replay });
      await Promise.all([
        this.db.problems.clear(),
        this.db.submissions.clear(),
        this.db.issues.clear(),
      ]);
      await this.writeSnapshotInTransaction(prepared);
    });
  }

  private async upsertProblemMetadata(metadata: ProblemMetadata): Promise<ProblemRecord> {
    const stored = await this.db.problems.get(metadata.problemId);
    const timestamp = this.now();
    const problem: ProblemRecord = {
      ...metadata,
      createdAt: stored?.createdAt ?? timestamp,
      updatedAt: timestamp,
      fsrsCard: stored?.fsrsCard ?? null,
      nextReviewAt: stored?.nextReviewAt ?? null,
      algorithm: FSRS_ALGORITHM,
      algorithmLibrary: FSRS_LIBRARY_VERSION,
      parametersVersion: FSRS_PARAMETERS_VERSION,
    };
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

  private async writeSnapshotInTransaction(snapshot: PersistedSnapshot): Promise<void> {
    if (snapshot.problems.length > 0) await this.db.problems.bulkAdd([...snapshot.problems]);
    if (snapshot.submissions.length > 0) await this.db.submissions.bulkAdd([...snapshot.submissions]);
    if (snapshot.issues.length > 0) await this.db.issues.bulkAdd([...snapshot.issues]);
  }

  private async updateIssues(
    issueIds: readonly number[],
    update: (issue: DetectionIssue, timestamp: number) => DetectionIssue | null,
  ): Promise<IssueUpdateResult> {
    return this.db.transaction('rw', this.db.issues, async () => {
      const stored = await this.db.issues.bulkGet([...issueIds]);
      const missingId = issueIds.find((_, index) => stored[index] === undefined);
      if (missingId !== undefined) throw new AppError('ISSUE_NOT_FOUND', `未找到检测异常 ${missingId}`);
      const timestamp = this.now();
      const issues = stored as DetectionIssue[];
      const updated = issues.map((issue) => update(issue, timestamp))
        .filter((issue): issue is DetectionIssue => issue !== null);
      if (updated.length > 0) await this.db.issues.bulkPut(updated);
      return { updatedCount: updated.length };
    });
  }
}
