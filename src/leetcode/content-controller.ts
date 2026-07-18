import type { ExtensionRequest } from '../domain/messages';
import type { ReviewPreview, SubmissionReview } from '../domain/types';
import type { AcceptedSubmission } from './detector';
import { sendExtensionRequest } from '../shared/messaging';

export type ContentNotice =
  | { readonly kind: 'idle' }
  | { readonly kind: 'monitoring' }
  | {
      readonly kind: 'rating';
      readonly title: string;
      readonly review: SubmissionReview;
      readonly preview: ReviewPreview | null;
      readonly previewError: string | null;
    }
  | {
      readonly kind: 'success';
      readonly title: string;
      readonly nextReviewAt: number | null;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly retryable: boolean;
    };

type Listener = (notice: ContentNotice) => void;

export class ContentController {
  private notice: ContentNotice = { kind: 'idle' };
  private readonly listeners = new Set<Listener>();
  private retryHandler: (() => Promise<void>) | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.notice);
    return () => this.listeners.delete(listener);
  }

  setRetryHandler(handler: () => Promise<void>): void {
    this.retryHandler = handler;
  }

  setMonitoring(monitoring: boolean): void {
    if (monitoring && this.notice.kind === 'idle') {
      this.update({ kind: 'monitoring' });
    } else if (!monitoring && this.notice.kind === 'monitoring') {
      this.update({ kind: 'idle' });
    }
  }

  async handleAccepted(submission: AcceptedSubmission): Promise<void> {
    const result = await sendExtensionRequest({
      type: 'submission.accepted',
      payload: submission,
    });
    if (result.review.rating) {
      this.update({
        kind: 'success',
        title: submission.metadata.title,
        nextReviewAt: result.nextReviewAt,
      });
      return;
    }
    this.update({
      kind: 'rating',
      title: submission.metadata.title,
      review: result.review,
      preview: null,
      previewError: null,
    });
    await this.loadPreview(submission.metadata.problemId, result.review.submissionId);
  }

  async rate(rating: SubmissionReview['rating']): Promise<void> {
    if (!rating || this.notice.kind !== 'rating') return;
    const title = this.notice.title;
    const result = await sendExtensionRequest({
      type: 'submission.rate',
      payload: { submissionId: this.notice.review.submissionId, rating },
    });
    this.update({
      kind: 'success',
      title,
      nextReviewAt: result.nextReviewAt,
    });
  }

  dismiss(): void {
    this.update({ kind: 'idle' });
  }

  async retry(): Promise<void> {
    if (!this.retryHandler) return;
    this.update({ kind: 'monitoring' });
    await this.retryHandler();
  }

  async recordIssue(
    message: string,
    retryable: boolean,
    payload: Extract<ExtensionRequest, { readonly type: 'issue.record' }>,
  ): Promise<void> {
    let displayedMessage = message;
    try {
      await sendExtensionRequest(payload);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      displayedMessage = `${message}；保存诊断失败：${reason}`;
    }
    this.update({ kind: 'error', message: displayedMessage, retryable });
  }

  private async loadPreview(problemId: string, submissionId: string): Promise<void> {
    try {
      const preview = await sendExtensionRequest({
        type: 'review.preview',
        payload: { problemId, submissionId },
      });
      if (this.notice.kind === 'rating') {
        this.update({ ...this.notice, preview, previewError: null });
      }
    } catch (error) {
      if (this.notice.kind === 'rating') {
        const message = error instanceof Error ? error.message : String(error);
        this.update({ ...this.notice, previewError: message });
      }
    }
  }

  private update(notice: ContentNotice): void {
    this.notice = notice;
    this.listeners.forEach((listener) => listener(notice));
  }
}
