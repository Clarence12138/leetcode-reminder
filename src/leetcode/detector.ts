import {
  DETECTION_DEADLINE_MS,
  SUBMISSION_STATUS_POLL_MS,
} from '../domain/constants';
import type {
  DetectionIssue,
  ProblemMetadata,
  SubmissionTrigger,
} from '../domain/types';
import type { LeetCodeClient } from './api-client';
import { LeetCodeIntegrationError, normalizeIntegrationError } from './errors';
import type { SubmissionStatus } from './schemas';

const ACCEPTED_STATUS_CODE = 10;

export interface AcceptedSubmission {
  readonly metadata: ProblemMetadata;
  readonly submissionId: string;
  readonly acceptedAt: number;
  readonly trigger: SubmissionTrigger;
}

interface DetectionAttempt {
  readonly slug: string;
  readonly trigger: SubmissionTrigger;
  readonly observedSubmission: ObservedSubmission;
  readonly previousSubmissionId: string | null;
  submissionId?: string;
}

interface ObservedSubmission {
  readonly promise: Promise<string>;
  readonly resolve: (submissionId: string) => void;
}

export interface DetectorRoute {
  readonly slug: string | null;
  readonly submissionId: string | null;
}

export interface DetectorCallbacks {
  readonly onAccepted: (submission: AcceptedSubmission) => Promise<void>;
  readonly onIssue: (issue: Omit<DetectionIssue, 'id'>) => Promise<void>;
  readonly onMonitoringChange: (monitoring: boolean) => void;
}

export class SubmissionDetector {
  private readonly seenIds = new Set<string>();
  private readonly client: LeetCodeClient;
  private readonly callbacks: DetectorCallbacks;
  private readonly now: () => number;
  private activeController: AbortController | null = null;
  private currentSubmissionId: string | null = null;
  private lastAttempt: DetectionAttempt | null = null;
  private slug: string | null = null;

  constructor(client: LeetCodeClient, callbacks: DetectorCallbacks, now = Date.now) {
    this.client = client;
    this.callbacks = callbacks;
    this.now = now;
  }

  async recordIntent(trigger: SubmissionTrigger): Promise<void> {
    if (!this.slug || this.activeController) return;
    const attempt: DetectionAttempt = {
      slug: this.slug,
      trigger,
      observedSubmission: createObservedSubmission(),
      previousSubmissionId: this.currentSubmissionId,
    };
    this.lastAttempt = attempt;
    await this.runAttempt(attempt);
  }

  updateRoute(route: DetectorRoute): void {
    if (route.slug !== this.slug) {
      this.switchProblem(route);
      return;
    }
    this.currentSubmissionId = route.submissionId;
    if (!route.slug || !route.submissionId) return;
    this.observeSubmissionId(route.slug, route.submissionId);
  }

  async retryLast(): Promise<void> {
    if (!this.lastAttempt || this.activeController) return;
    await this.runAttempt(this.lastAttempt);
  }

  cancelActive(): void {
    this.activeController?.abort();
    this.activeController = null;
    this.callbacks.onMonitoringChange(false);
  }

  private async runAttempt(attempt: DetectionAttempt): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;
    this.callbacks.onMonitoringChange(true);
    try {
      const deadline = this.now() + DETECTION_DEADLINE_MS;
      await runUntilDeadline(
        this.detectSubmission(attempt, deadline, controller.signal),
        controller,
        Math.max(0, deadline - this.now()),
      );
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        await this.reportError(attempt.slug, error);
      }
    } finally {
      if (this.activeController === controller) this.activeController = null;
      this.callbacks.onMonitoringChange(false);
    }
  }

  private async detectSubmission(
    attempt: DetectionAttempt,
    deadline: number,
    signal: AbortSignal,
  ): Promise<void> {
    const submissionId = attempt.submissionId
      ?? await waitForObservedSubmission(attempt.observedSubmission, signal);
    attempt.submissionId = submissionId;
    const status = await this.waitForAccepted(submissionId, deadline, signal);
    if (!status) return;
    const acceptedAt = status.taskFinishTime ?? this.now();
    const metadata = await this.loadMetadata(attempt.slug, signal);
    await this.callbacks.onAccepted({
      metadata,
      submissionId,
      acceptedAt,
      trigger: attempt.trigger,
    });
  }

  private switchProblem(route: DetectorRoute): void {
    this.cancelActive();
    this.seenIds.clear();
    this.slug = route.slug;
    this.currentSubmissionId = route.submissionId;
    this.lastAttempt = null;
    if (route.submissionId) this.seenIds.add(route.submissionId);
  }

  private observeSubmissionId(slug: string, submissionId: string): void {
    const attempt = this.lastAttempt;
    if (!attempt || attempt.slug !== slug) {
      this.seenIds.add(submissionId);
      return;
    }
    if (submissionId === attempt.previousSubmissionId || this.seenIds.has(submissionId)) return;
    if (attempt.submissionId) return;
    this.seenIds.add(submissionId);
    attempt.submissionId = submissionId;
    attempt.observedSubmission.resolve(submissionId);
  }

  private async loadMetadata(slug: string, signal: AbortSignal): Promise<ProblemMetadata> {
    try {
      return await this.client.getProblemMetadata(slug, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const normalized = normalizeIntegrationError(error);
      throw new LeetCodeIntegrationError(
        'METADATA_ERROR',
        `已确认 Accepted，但题目信息读取失败：${normalized.message}`,
        normalized.retryable,
      );
    }
  }

  private async waitForAccepted(
    submissionId: string,
    deadline: number,
    signal: AbortSignal,
  ): Promise<SubmissionStatus | null> {
    while (this.now() < deadline) {
      const status = await this.client.getSubmissionStatus(submissionId, signal);
      if (status.state === 'SUCCESS') {
        if (status.statusCode === undefined) {
          throw new LeetCodeIntegrationError(
            'UNKNOWN_RESPONSE',
            '判题完成，但响应缺少 status_code。',
            false,
          );
        }
        return status.statusCode === ACCEPTED_STATUS_CODE ? status : null;
      }
      await abortableDelay(SUBMISSION_STATUS_POLL_MS, signal);
    }
    throw timeoutError();
  }

  private async reportError(slug: string, error: unknown): Promise<void> {
    const normalized = normalizeIntegrationError(error);
    await this.callbacks.onIssue({
      slug,
      occurredAt: this.now(),
      code: normalized.code,
      retryable: normalized.retryable,
      diagnostic: normalized.message,
      resolvedAt: null,
    });
  }
}

function createObservedSubmission(): ObservedSubmission {
  let resolve: (submissionId: string) => void = () => undefined;
  const promise = new Promise<string>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function waitForObservedSubmission(
  observed: ObservedSubmission,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    observed.promise.then((submissionId) => {
      signal.removeEventListener('abort', abort);
      resolve(submissionId);
    }, reject);
  });
}

function timeoutError(): LeetCodeIntegrationError {
  return new LeetCodeIntegrationError(
    'TIMEOUT',
    '两分钟内未取得完整判题结果，可点击重试。',
    true,
  );
}

function abortableDelay(duration: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, duration);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

async function runUntilDeadline<T>(
  operation: Promise<T>,
  controller: AbortController,
  duration: number,
): Promise<T> {
  let deadlineReached = false;
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(deadlineReached ? timeoutError() : new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
  const timer = window.setTimeout(() => {
    deadlineReached = true;
    controller.abort();
  }, duration);
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    window.clearTimeout(timer);
  }
}
