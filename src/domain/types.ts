export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type MasteryRating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';
export type SubmissionTrigger = 'button' | 'keyboard';

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
  readonly resolvedAt: number | null;
}

export interface Settings {
  readonly notificationsEnabled: boolean;
  readonly reminderHour: number;
  readonly reminderMinute: number;
  readonly timezone: string;
  readonly schemaVersion: number;
}

export interface DailySummary {
  readonly problems: readonly ProblemRecord[];
  readonly dueProblems: readonly ProblemRecord[];
  readonly pendingReviews: readonly SubmissionReview[];
  readonly recentReviews: readonly SubmissionReview[];
  readonly issues: readonly DetectionIssue[];
}

export type ReviewPreview = Readonly<Record<MasteryRating, number>>;

export interface BackupV1 {
  readonly format: 'xiaoshuaji-backup/v1';
  readonly exportedAt: string;
  readonly schemaVersion: 1;
  readonly settings: Settings;
  readonly problems: readonly ProblemRecord[];
  readonly submissions: readonly SubmissionReview[];
  readonly issues: readonly DetectionIssue[];
}
