/** 面板各页测试共用的示例数据。各页测试需要额外的辅助函数时写在自己的测试文件里，不改这里。 */
import { vi } from 'vitest';
import type { DailySummary, DetectionIssue, ProblemRecord, Settings, SubmissionReview } from '../src/domain/types';

export function makeProblem(
  frontendId: string,
  title: string,
  difficulty: ProblemRecord['difficulty'],
  tags: readonly string[],
  options: { readonly createdAt?: number; readonly lastReviewAt?: number } = {},
): ProblemRecord {
  const createdAt = options.createdAt ?? 1_700_000_000_000;
  return {
    problemId: `leetcode-cn:${frontendId}`,
    slug: frontendId,
    frontendId,
    title,
    difficulty,
    tags,
    url: `https://leetcode.cn/problems/${frontendId}/`,
    createdAt,
    updatedAt: createdAt,
    fsrsCard: options.lastReviewAt === undefined ? null : {
      due: options.lastReviewAt + 86_400_000,
      stability: 1,
      difficulty: 1,
      elapsed_days: 0,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      learning_steps: 0,
      state: 2,
      last_review: options.lastReviewAt,
    },
    nextReviewAt: 1_700_000_000_000,
    algorithm: 'FSRS-6',
    algorithmLibrary: 'ts-fsrs@5.4.1',
    parametersVersion: 'xiaoshuaji-fsrs-v1',
  };
}

export const problems: readonly ProblemRecord[] = [
  makeProblem('1', '两数之和', 'EASY', ['数组']),
  makeProblem('42', '接雨水', 'HARD', ['栈', '双指针']),
];

export const summary: DailySummary = {
  problems,
  dueProblems: problems,
  pendingReviews: [],
  recentReviews: [],
  issues: [],
};

export const settings: Settings = {
  notificationsEnabled: true,
  reminderHour: 9,
  reminderMinute: 0,
  timezone: 'Asia/Shanghai',
  schemaVersion: 1,
  resetCodeOnReview: false,
  dailyReviewLimit: null,
  queueSortStrategy: 'due_asc',
  defaultRequestRetention: 0.9,
  reviewGroups: [],
  autoGroupRules: [],
};

export function withIssues(issues: readonly DetectionIssue[]): DailySummary {
  return { ...summary, issues };
}

export function makeIssue(id: number, readAt: number | null, resolvedAt: number | null, diagnostic: string): DetectionIssue {
  return {
    id,
    slug: 'two-sum',
    occurredAt: 1_700_000_000_000 + id,
    code: 'NETWORK_ERROR',
    retryable: true,
    diagnostic,
    readAt,
    resolvedAt,
  };
}

export function makePendingReview(problem: ProblemRecord): SubmissionReview {
  return {
    submissionId: '123',
    problemId: problem.problemId,
    trigger: 'button',
    acceptedAt: 1_700_000_000_000,
    detectedAt: 1_700_000_000_100,
    rating: null,
    fsrsLog: null,
  };
}

/** 安装面板测试用的 chrome mock，返回 sendMessage 以便断言。 */
export function installChromeMock(sendMessage: ReturnType<typeof vi.fn>): void {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { sendMessage, getURL: (path: string) => path },
      storage: {
        session: { get: vi.fn().mockResolvedValue({}) },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    },
  });
}
