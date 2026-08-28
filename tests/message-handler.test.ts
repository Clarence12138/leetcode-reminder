import { afterEach, describe, expect, it } from 'vitest';

import type { BackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { createMessageHandler } from '../src/background/message-handler';
import type { ReminderCoordinator } from '../src/background/reminders';
import type { SettingsRepository } from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';
import type { ProblemMetadata } from '../src/domain/types';

let databaseSequence = 0;
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('异常状态消息', () => {
  it('路由批量已读和解决请求并返回实际更新数量', async () => {
    const { handle, store } = createHarness();
    const first = await createIssue(store);
    const second = await createIssue(store);

    await expect(handle({
      type: 'issue.mark-read',
      payload: { issueIds: [requiredId(first), requiredId(second)] },
    })).resolves.toEqual({ ok: true, data: { updatedCount: 2 } });
    await expect(handle({
      type: 'issue.resolve',
      payload: { issueIds: [requiredId(first)] },
    })).resolves.toEqual({ ok: true, data: { updatedCount: 1 } });
  });

  it('拒绝空、重复、非正整数异常 ID 列表', async () => {
    const { handle } = createHarness();
    const invalidIssueIdLists: readonly (readonly number[])[] = [[], [1, 1], [0], [-1], [1.5]];

    for (const issueIds of invalidIssueIdLists) {
      await expect(handle({
        type: 'issue.mark-read',
        payload: { issueIds },
      })).resolves.toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_ERROR' },
      });
    }
  });

  it('将不存在的异常明确映射为 ISSUE_NOT_FOUND', async () => {
    const { handle } = createHarness();

    await expect(handle({
      type: 'issue.resolve',
      payload: { issueIds: [999] },
    })).resolves.toEqual({
      ok: false,
      error: { code: 'ISSUE_NOT_FOUND', message: '未找到检测异常 999' },
    });
  });
});

describe('题目删除消息', () => {
  it('支持一次删除多道题目', async () => {
    const { handle, store } = createHarness();
    await store.recordAccepted(acceptedInput('100', metadata()));
    await store.recordAccepted(acceptedInput('200', rainWaterMetadata()));

    await expect(handle({
      type: 'problem.delete',
      payload: { problemIds: ['leetcode-cn:two-sum', 'leetcode-cn:trapping-rain-water'] },
    })).resolves.toEqual({ ok: true, data: { deletedCount: 2 } });
    expect(await store.queryDashboard()).toMatchObject({
      problems: [],
      pendingReviews: [],
    });
  });

  it('拒绝空、重复或空白题目 ID 列表', async () => {
    const { handle } = createHarness();
    const invalidProblemIdLists: readonly (readonly string[])[] = [[], ['a', 'a'], ['']];

    for (const problemIds of invalidProblemIdLists) {
      await expect(handle({
        type: 'problem.delete',
        payload: { problemIds },
      })).resolves.toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_ERROR' },
      });
    }
  });
});

function createHarness() {
  const database = new XiaoshuajiDatabase(`test-message-handler-${databaseSequence++}`);
  databases.push(database);
  const store = new DexieReviewStore({ database, now: () => Date.UTC(2026, 0, 1, 9) });
  const handle = createMessageHandler({
    store,
    settings: {} as SettingsRepository,
    backups: {} as BackupManager,
    reminders: { refreshBadge: async () => undefined } as ReminderCoordinator,
  });
  return { handle, store };
}

function createIssue(store: DexieReviewStore) {
  return store.recordIssue({
    slug: 'two-sum',
    occurredAt: Date.UTC(2026, 0, 1, 9),
    code: 'NETWORK_ERROR',
    retryable: true,
    diagnostic: '请求失败',
    readAt: null,
    resolvedAt: null,
  });
}

function requiredId(issue: { readonly id?: number | undefined }): number {
  if (issue.id === undefined) throw new Error('测试异常缺少 ID');
  return issue.id;
}

function acceptedInput(submissionId: string, problem: ProblemMetadata) {
  return {
    metadata: problem,
    submissionId,
    trigger: 'button' as const,
    acceptedAt: Date.UTC(2026, 0, 1, 9),
  };
}

function metadata(): ProblemMetadata {
  return {
    problemId: 'leetcode-cn:two-sum',
    slug: 'two-sum',
    frontendId: '1',
    title: '两数之和',
    difficulty: 'EASY',
    tags: ['数组'],
    url: 'https://leetcode.cn/problems/two-sum/',
  };
}

function rainWaterMetadata(): ProblemMetadata {
  return {
    problemId: 'leetcode-cn:trapping-rain-water',
    slug: 'trapping-rain-water',
    frontendId: '42',
    title: '接雨水',
    difficulty: 'HARD',
    tags: ['栈'],
    url: 'https://leetcode.cn/problems/trapping-rain-water/',
  };
}
