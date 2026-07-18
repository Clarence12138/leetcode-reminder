import type { DetectionIssueCode } from '../domain/types';

export class LeetCodeIntegrationError extends Error {
  readonly code: DetectionIssueCode;
  readonly retryable: boolean;

  constructor(code: DetectionIssueCode, message: string, retryable: boolean) {
    super(message);
    this.name = 'LeetCodeIntegrationError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function normalizeIntegrationError(error: unknown): LeetCodeIntegrationError {
  if (error instanceof LeetCodeIntegrationError) {
    return error;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new LeetCodeIntegrationError('CONTEXT_CHANGED', '检测已取消。', false);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new LeetCodeIntegrationError(
    'NETWORK_ERROR',
    `访问力扣接口失败：${message}`,
    true,
  );
}
