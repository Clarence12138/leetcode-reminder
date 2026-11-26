import type { BuiltinProblemListId } from './problem-lists';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type MasteryRating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';
export type SubmissionTrigger = 'button' | 'keyboard' | 'import';
export type QueueSortStrategy = 'due_asc' | 'priority' | 'stability_asc';

export interface ReviewGroup {
  readonly id: string;
  readonly name: string;
  readonly requestRetention: number;
}

export interface AutoGroupRule {
  readonly listId: BuiltinProblemListId;
  readonly groupId: string;
}

export interface ProblemMetadata {
  readonly problemId: string;
  readonly slug: string;
  readonly frontendId: string;
  readonly title: string;
  readonly difficulty: Difficulty;
  readonly tags: readonly string[];
  readonly url: string;
}

export interface SerializedFsrsCard {
  readonly due: number;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsed_days: number;
  readonly scheduled_days: number;
  readonly reps: number;
  readonly lapses: number;
  readonly learning_steps: number;
  readonly state: number;
  readonly last_review?: number | undefined;
}

export interface SerializedFsrsLog {
  readonly rating: number;
  readonly state: number;
  readonly due: number;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsed_days: number;
  readonly last_elapsed_days: number;
  readonly scheduled_days: number;
  readonly review: number;
}

export interface ProblemRecord extends ProblemMetadata {
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly fsrsCard: SerializedFsrsCard | null;
  readonly nextReviewAt: number | null;
  readonly pausedAt?: number | null;
  readonly groupId?: string | null;
  readonly algorithm: 'FSRS-6';
  readonly algorithmLibrary: string;
  readonly parametersVersion: string;
}

export interface SubmissionReview {
  readonly submissionId: string;
  readonly problemId: string;
  readonly trigger: SubmissionTrigger;
  readonly acceptedAt: number;
  readonly detectedAt: number;
  readonly rating: MasteryRating | null;
  readonly fsrsLog: SerializedFsrsLog | null;
}

export type DetectionIssueCode =
  | 'AUTH_REQUIRED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN_RESPONSE'
  | 'METADATA_ERROR'
  | 'CONTEXT_CHANGED';

export interface DetectionIssue {
  readonly id?: number | undefined;
  readonly slug: string;
  readonly occurredAt: number;
  readonly code: DetectionIssueCode;
  readonly retryable: boolean;
  readonly diagnostic: string;
  readonly readAt: number | null;
  readonly resolvedAt: number | null;
}

export interface Settings {
  readonly notificationsEnabled: boolean;
  readonly reminderHour: number;
  readonly reminderMinute: number;
  readonly timezone: string;
  readonly schemaVersion: number;
  readonly resetCodeOnReview: boolean;
  readonly dailyReviewLimit: number | null;
  readonly queueSortStrategy: QueueSortStrategy;
  readonly defaultRequestRetention: number;
  readonly reviewGroups: readonly ReviewGroup[];
  readonly autoGroupRules: readonly AutoGroupRule[];
}

export interface DailySummary {
  readonly problems: readonly ProblemRecord[];
  readonly dueProblems: readonly ProblemRecord[];
  readonly pendingReviews: readonly SubmissionReview[];
  readonly recentReviews: readonly SubmissionReview[];
  readonly issues: readonly DetectionIssue[];
  readonly dailyQuota?: {
    readonly limit: number | null;
    readonly completedToday: number;
    readonly remainingDue: number;
    readonly overflowDue: number;
    readonly reached: boolean;
  };
}

export interface LeetCodeHistoryProblem {
  readonly metadata: ProblemMetadata;
  readonly submissions: readonly {
    readonly submissionId: string;
    readonly acceptedAt: number;
  }[];
}

export type HistoryRatingMode =
  | { readonly mode: 'uniform'; readonly rating: MasteryRating }
  | { readonly mode: 'manual' };

export interface HistoryImportResult {
  readonly importedProblems: number;
  readonly importedSubmissions: number;
  readonly skippedProblems: number;
}

export type ReviewPreview = Readonly<Record<MasteryRating, number>>;

/** 下一道该复习的题（按配额与排序策略，排除指定题目）。 */
export interface NextReview {
  readonly problem: ProblemRecord | null;
  /** 题目链接；开启“复习时还原代码”时已带上还原标记。 */
  readonly url: string | null;
  /** 排除指定题目后，今日配额内还剩几题。 */
  readonly remainingToday: number;
}

export interface ReviewHistoryEntry {
  readonly submissionId: string;
  readonly acceptedAt: number;
  readonly rating: MasteryRating;
  /**
   * 这次评分后排的间隔（天）。FSRS 日志的 scheduled_days 记的是评分前的间隔，
   * 所以取下一次评分日志的值；最后一次取题目卡片的当前间隔。
   */
  readonly scheduledDays: number;
}

/** 页内卡展示用：这道题的复习轨迹与当前记忆概率。 */
export interface ReviewContext {
  readonly problem: ProblemRecord | null;
  /** 已评分记录，按时间从早到晚。 */
  readonly history: readonly ReviewHistoryEntry[];
  /** 当前记忆概率 0–1；还没有排期时为 null。 */
  readonly retrievability: number | null;
}

export interface BackupV1 {
  readonly format: 'xiaoshuaji-backup/v1';
  readonly exportedAt: string;
  readonly schemaVersion: 1;
  readonly settings: Settings;
  readonly problems: readonly ProblemRecord[];
  readonly submissions: readonly SubmissionReview[];
  readonly issues: readonly Omit<DetectionIssue, 'readAt'>[];
}

export interface BackupV2 {
  readonly format: 'xiaoshuaji-backup/v2';
  readonly exportedAt: string;
  readonly schemaVersion: 2;
  readonly settings: Settings;
  readonly problems: readonly ProblemRecord[];
  readonly submissions: readonly SubmissionReview[];
  readonly issues: readonly DetectionIssue[];
}
