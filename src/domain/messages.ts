import type {
  BackupV1,
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
  | { readonly type: 'notification.test' }
  | { readonly type: 'data.clear' }
  | {
      readonly type: 'problem.delete';
      readonly payload: { readonly problemId: string };
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
      : T extends 'review.preview'
        ? ReviewPreview
      : T extends 'dashboard.query'
        ? DailySummary
        : T extends 'settings.get' | 'settings.update'
          ? Settings
          : T extends 'backup.export'
            ? BackupV1
            : unknown;
