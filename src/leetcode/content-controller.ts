import type { ExtensionRequest } from '../domain/messages';
import type {
  Difficulty,
  MasteryRating,
  NextReview,
  ReviewContext,
  ReviewPreview,
  SubmissionReview,
} from '../domain/types';
import type { AcceptedSubmission } from './detector';
import { sendExtensionRequest } from '../shared/messaging';

/** 评完后“下一题”的加载状态。 */
export type NextState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly next: NextReview }
  | { readonly status: 'error'; readonly message: string };

/** 题目的展示信息，评分态和完成态共用。 */
export interface NoticeProblem {
  readonly problemId: string;
  readonly frontendId: string;
  readonly title: string;
  readonly difficulty: Difficulty;
}

/** 评分后可撤销的时间窗口。 */
export const UNDO_WINDOW_MS = 5_000;

export type ContentNotice =
  | { readonly kind: 'idle' }
  | { readonly kind: 'hint'; readonly text: string }
  | { readonly kind: 'monitoring' }
  | {
      readonly kind: 'rating';
      readonly title: string;
      readonly problem: NoticeProblem;
      readonly review: SubmissionReview;
      readonly preview: ReviewPreview | null;
      readonly previewError: string | null;
      /** 这道题的复习轨迹；加载失败或未加载为 null，不影响评分。 */
      readonly context: ReviewContext | null;
      readonly contextLoading: boolean;
    }
  | {
      readonly kind: 'success';
      readonly title: string;
      readonly problem: NoticeProblem;
      readonly submissionId: string;
      readonly rating: MasteryRating | null;
      readonly nextReviewAt: number | null;
      /** 撤销截止时间；为 null 表示这次没有可撤销的评分。 */
      readonly undoUntil: number | null;
      readonly next: NextState;
    }
  | {
      readonly kind: 'discarded';
      readonly problem: NoticeProblem;
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
  /** 卡片周期版本号：关闭、换题、进入新的评分/完成周期都会递增；旧响应据此丢弃。 */
  private epoch = 0;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.notice);
    return () => this.listeners.delete(listener);
  }

  setRetryHandler(handler: () => Promise<void>): void {
    this.retryHandler = handler;
  }

  setMonitoring(monitoring: boolean): void {
    if (monitoring && (this.notice.kind === 'idle' || this.notice.kind === 'hint')) {
      this.update({ kind: 'monitoring' });
    } else if (!monitoring && this.notice.kind === 'monitoring') {
      this.update({ kind: 'idle' });
    }
  }

  showHint(text: string): void {
    if (this.notice.kind !== 'idle' && this.notice.kind !== 'hint') return;
    this.update({ kind: 'hint', text });
  }

  dismissHint(): void {
    if (this.notice.kind === 'hint') this.update({ kind: 'idle' });
  }

  async handleAccepted(submission: AcceptedSubmission): Promise<void> {
    const ticket = ++this.epoch;
    const result = await sendExtensionRequest({
      type: 'submission.accepted',
      payload: submission,
    });
    if (ticket !== this.epoch) return;
    const { metadata } = submission;
    const problem: NoticeProblem = {
      problemId: metadata.problemId,
      frontendId: metadata.frontendId,
      title: metadata.title,
      difficulty: metadata.difficulty,
    };
    if (result.review.rating) {
      this.showSuccess({
        problem,
        submissionId: result.review.submissionId,
        rating: result.review.rating,
        nextReviewAt: result.nextReviewAt,
        undoUntil: null,
      });
      return;
    }
    const loadTicket = this.transition({
      kind: 'rating',
      title: metadata.title,
      problem,
      review: result.review,
      preview: null,
      previewError: null,
      context: null,
      contextLoading: true,
    });
    await this.loadRatingData(problem.problemId, result.review.submissionId, loadTicket);
  }

  async rate(rating: SubmissionReview['rating']): Promise<void> {
    if (!rating || this.notice.kind !== 'rating') return;
    const { problem, review } = this.notice;
    const ticket = this.epoch;
    const result = await sendExtensionRequest({
      type: 'submission.rate',
      payload: { submissionId: review.submissionId, rating },
    });
    if (ticket !== this.epoch) return;
    this.showSuccess({
      problem,
      submissionId: review.submissionId,
      rating,
      nextReviewAt: result.nextReviewAt,
      undoUntil: Date.now() + UNDO_WINDOW_MS,
    });
  }

  /** 撤销刚才的评分，回到评分态并重新拉取预览与轨迹。 */
  async undo(): Promise<void> {
    if (this.notice.kind !== 'success' || this.notice.undoUntil === null) return;
    if (Date.now() > this.notice.undoUntil) return;
    const { problem, submissionId, rating } = this.notice;
    const ticket = this.epoch;
    const result = await sendExtensionRequest({
      type: 'submission.unrate',
      payload: rating === null ? { submissionId } : { submissionId, rating },
    });
    if (ticket !== this.epoch) return;
    const loadTicket = this.transition({
      kind: 'rating',
      title: problem.title,
      problem,
      review: result.review,
      preview: null,
      previewError: null,
      context: null,
      contextLoading: true,
    });
    await this.loadRatingData(problem.problemId, result.review.submissionId, loadTicket);
  }

  async discard(): Promise<void> {
    if (this.notice.kind !== 'rating') return;
    const { problem } = this.notice;
    const ticket = this.epoch;
    await sendExtensionRequest({
      type: 'submission.discard',
      payload: { submissionId: this.notice.review.submissionId },
    });
    if (ticket !== this.epoch) return;
    this.transition({ kind: 'discarded', problem });
  }

  dismiss(): void {
    this.transition({ kind: 'idle' });
  }

  dismissError(): void {
    if (this.notice.kind === 'error') this.transition({ kind: 'idle' });
  }

  async retry(): Promise<void> {
    if (!this.retryHandler) return;
    this.update({ kind: 'monitoring' });
    try {
      await this.retryHandler();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update({ kind: 'error', message, retryable: true });
    }
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

  private showSuccess(input: {
    readonly problem: NoticeProblem;
    readonly submissionId: string;
    readonly rating: MasteryRating | null;
    readonly nextReviewAt: number | null;
    readonly undoUntil: number | null;
  }): void {
    const ticket = this.transition({
      kind: 'success',
      title: input.problem.title,
      problem: input.problem,
      submissionId: input.submissionId,
      rating: input.rating,
      nextReviewAt: input.nextReviewAt,
      undoUntil: input.undoUntil,
      next: { status: 'loading' },
    });
    void this.loadNext(input.submissionId, input.problem.problemId, ticket);
  }

  private async loadNext(submissionId: string, problemId: string, ticket: number): Promise<void> {
    let next: NextState;
    try {
      const result = await sendExtensionRequest({
        type: 'review.next',
        payload: { excludeProblemId: problemId },
      });
      next = { status: 'ready', next: result };
    } catch (error) {
      next = { status: 'error', message: error instanceof Error ? error.message : String(error) };
    }
    if (ticket === this.epoch && this.notice.kind === 'success' && this.notice.submissionId === submissionId) {
      this.update({ ...this.notice, next });
    }
  }

  /** 预览与轨迹互不依赖，任何一个失败都不影响评分。 */
  private async loadRatingData(problemId: string, submissionId: string, ticket: number): Promise<void> {
    await Promise.all([
      this.loadPreview(problemId, submissionId, ticket),
      this.loadContext(problemId, submissionId, ticket),
    ]);
  }

  private isRatingFor(submissionId: string, ticket: number): boolean {
    return ticket === this.epoch && this.notice.kind === 'rating' && this.notice.review.submissionId === submissionId;
  }

  private async loadContext(problemId: string, submissionId: string, ticket: number): Promise<void> {
    let context: ReviewContext | null = null;
    try {
      context = await sendExtensionRequest({ type: 'review.context', payload: { problemId } });
    } catch {
      context = null;
    }
    if (this.notice.kind === 'rating' && this.isRatingFor(submissionId, ticket)) {
      this.update({ ...this.notice, context, contextLoading: false });
    }
  }

  private async loadPreview(problemId: string, submissionId: string, ticket: number): Promise<void> {
    try {
      const preview = await sendExtensionRequest({
        type: 'review.preview',
        payload: { problemId, submissionId },
      });
      if (this.notice.kind === 'rating' && this.isRatingFor(submissionId, ticket)) {
        this.update({ ...this.notice, preview, previewError: null });
      }
    } catch (error) {
      if (this.notice.kind === 'rating' && this.isRatingFor(submissionId, ticket)) {
        const message = error instanceof Error ? error.message : String(error);
        this.update({ ...this.notice, previewError: message });
      }
    }
  }

  /** 进入新的卡片周期：递增版本号并返回，让此前发出的异步响应失效。 */
  private transition(notice: ContentNotice): number {
    this.epoch += 1;
    this.update(notice);
    return this.epoch;
  }

  private update(notice: ContentNotice): void {
    this.notice = notice;
    this.listeners.forEach((listener) => listener(notice));
  }
}
