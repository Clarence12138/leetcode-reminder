import type {
  BackupV2,
  DailySummary,
  DetectionIssue,
  MasteryRating,
  ProblemMetadata,
  ReviewPreview,
  Settings,
  SubmissionReview,
  SubmissionTrigger,
} from './types';

export type ExtensionRequest =
  | {
      readonly type: 'submission.accepted';
      readonly payload: {
        readonly metadata: ProblemMetadata;
        readonly submissionId: string;
        readonly trigger: SubmissionTrigger;
        readonly acceptedAt: number;
      };
    }
  | {
      readonly type: 'submission.rate';
      readonly payload: {
        readonly submissionId: string;
        readonly rating: MasteryRating;
      };
    }
  | {
      readonly type: 'submission.discard';
      readonly payload: {
        readonly submissionId: string;
      };
    }
  | {
      readonly type: 'review.preview';
      readonly payload: {
        readonly problemId: string;
        readonly submissionId: string;
      };
    }
  | {
      readonly type: 'dashboard.query';
      readonly payload?: {
        readonly search?: string;
        readonly difficulty?: string;
        readonly tag?: string;
      };
    }
  | {
      readonly type: 'settings.update';
      readonly payload: Partial<Settings>;
    }
  | { readonly type: 'settings.get' }
  | { readonly type: 'backup.export' }
  | {
      readonly type: 'backup.import';
      readonly payload: {
        readonly backup: unknown;
        readonly mode: 'merge' | 'replace';
      };
    }
  | {
      readonly type: 'issue.record';
      readonly payload: Omit<DetectionIssue, 'id'>;
    }
  | {
      readonly type: 'issue.mark-read';
      readonly payload: { readonly issueIds: readonly number[] };
    }
  | {
      readonly type: 'issue.resolve';
      readonly payload: { readonly issueIds: readonly number[] };
    }
  | { readonly type: 'notification.test' }
  | { readonly type: 'data.clear' }
  | {
      readonly type: 'problem.delete';
      readonly payload: { readonly problemIds: readonly string[] };
    };

export type ExtensionResponse =
  | { readonly ok: true; readonly data?: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export type TypedResponse<T extends ExtensionRequest['type']> =
  T extends 'submission.accepted'
    ? {
        readonly created: boolean;
        readonly review: SubmissionReview;
        readonly nextReviewAt: number | null;
      }
    : T extends 'submission.rate'
      ? { readonly review: SubmissionReview; readonly nextReviewAt: number | null }
      : T extends 'submission.discard'
        ? { readonly problemDeleted: boolean }
      : T extends 'review.preview'
        ? ReviewPreview
      : T extends 'dashboard.query'
        ? DailySummary
        : T extends 'settings.get' | 'settings.update'
          ? Settings
          : T extends 'backup.export'
            ? BackupV2
            : T extends 'issue.mark-read' | 'issue.resolve'
              ? { readonly updatedCount: number }
              : T extends 'problem.delete'
                ? { readonly deletedCount: number }
                : unknown;
