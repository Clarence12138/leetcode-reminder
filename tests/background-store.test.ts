import { afterEach, describe, expect, it } from 'vitest';

import { XiaoshuajiDatabase } from '../src/background/database';
import { DexieReviewStore } from '../src/background/store';
import type { ProblemMetadata } from '../src/domain/types';

const HOUR_MS = 60 * 60 * 1_000;
let databaseSequence = 0;
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('后台数据服务', () => {
  it('以 submissionId 幂等记录 Accepted，且待评估不排期', async () => {
    const store = createStore(Date.UTC(2026, 0, 1, 9));
    const input = acceptedInput('100');

    const first = await store.recordAccepted(input);
    const second = await store.recordAccepted(input);
    const dashboard = await store.queryDashboard();

    expect(first.created).toBe(true);
    expect(second).toEqual({ created: false, review: first.review, nextReviewAt: null });
    expect(dashboard.problems).toHaveLength(1);
    expect(dashboard.problems[0]?.fsrsCard).toBeNull();
    expect(dashboard.pendingReviews).toHaveLength(1);
  });

  it('同一提交被按钮和快捷键同时观测到时仍保持幂等', async () => {
    const store = createStore(Date.UTC(2026, 0, 1, 9));
    const input = acceptedInput('100');
    await store.recordAccepted(input);

    const duplicate = await store.recordAccepted({ ...input, trigger: 'keyboard' });

    expect(duplicate.created).toBe(false);
    expect((await store.queryDashboard()).pendingReviews).toHaveLength(1);
  });

  it('拒绝不匹配 slug 路径段的题目链接', async () => {
    const store = createStore(Date.UTC(2026, 0, 1, 9));
    const input = acceptedInput('100');

    await expect(store.recordAccepted({
      ...input,
      metadata: { ...input.metadata, url: 'https://leetcode.cn/problems/two-sum-evil/' },
    })).rejects.toMatchObject({ code: 'INVALID_PROBLEM_URL' });
  });

  it('评分后持久化 FSRS 版本，新 Accepted 会再增加一次复习', async () => {
    let now = Date.UTC(2026, 0, 1, 9);
    const store = createStore(() => now);
    await store.recordAccepted(acceptedInput('100', now));
    const firstRating = await store.rateSubmission('100', 'GOOD');
    now += 24 * HOUR_MS;
    await store.recordAccepted(acceptedInput('101', now));
    await store.rateSubmission('101', 'EASY');

    const dashboard = await store.queryDashboard();
    const problem = dashboard.problems[0];

    expect(problem).toMatchObject({
      algorithm: 'FSRS-6',
      algorithmLibrary: 'ts-fsrs@5.4.1',
      parametersVersion: 'xiaoshuaji-fsrs-v1',
    });
    expect(problem?.fsrsCard?.reps).toBe(2);
    expect(firstRating.nextReviewAt).not.toBe(firstRating.review.fsrsLog?.due);
    expect(dashboard.pendingReviews).toHaveLength(0);
    expect(dashboard.recentReviews).toHaveLength(2);
  });

  it('题目删除会同时删除提交和该 slug 的检测异常', async () => {
    const store = createStore(Date.UTC(2026, 0, 1, 9));
    await store.recordAccepted(acceptedInput('100'));
    await store.recordIssue({
      slug: 'two-sum',
      occurredAt: Date.UTC(2026, 0, 1, 9),
      code: 'NETWORK_ERROR',
      retryable: true,
      diagnostic: '请求失败',
      readAt: null,
      resolvedAt: null,
    });

    expect(await store.deleteProblem('leetcode-cn:two-sum')).toBe(true);
    expect(await store.queryDashboard()).toMatchObject({
      problems: [],
      pendingReviews: [],
      issues: [],
    });
  });

  it('丢弃唯一待评估提交时会清掉尚未排期的题目',
    async () => {
      const store = createStore(Date.UTC(2026, 0, 1, 9));
      await store.recordAccepted(acceptedInput('100'));

      await expect(store.discardSubmission('100')).resolves.toEqual({ problemDeleted: true });
      expect(await store.queryDashboard()).toMatchObject({
        problems: [],
        pendingReviews: [],
        recentReviews: [],
      });
    });

  it('丢弃已有排期题目的待评估提交时保留题目和历史',
    async () => {
      let now = Date.UTC(2026, 0, 1, 9);
      const store = createStore(() => now);
      await store.recordAccepted(acceptedInput('100', now));
      await store.rateSubmission('100', 'GOOD');
      now += HOUR_MS;
      await store.recordAccepted(acceptedInput('101', now));

      await expect(store.discardSubmission('101')).resolves.toEqual({ problemDeleted: false });
      const dashboard = await store.queryDashboard();
      expect(dashboard.pendingReviews).toHaveLength(0);
      expect(dashboard.recentReviews).toHaveLength(1);
      expect(dashboard.problems).toHaveLength(1);
      expect(dashboard.problems[0]?.fsrsCard).not.toBeNull();
    });

  it('同一题多条待评估时丢弃一条仍保留题目',
    async () => {
      const store = createStore(Date.UTC(2026, 0, 1, 9));
      await store.recordAccepted(acceptedInput('100'));
      await store.recordAccepted(acceptedInput('101', Date.UTC(2026, 0, 1, 10)));

      await expect(store.discardSubmission('101')).resolves.toEqual({ problemDeleted: false });
      const dashboard = await store.queryDashboard();
      expect(dashboard.pendingReviews.map((review) => review.submissionId)).toEqual(['100']);
      expect(dashboard.problems).toHaveLength(1);
    });

  it('拒绝丢弃已评分或不存在的提交', async () => {
    const store = createStore(Date.UTC(2026, 0, 1, 9));
    await store.recordAccepted(acceptedInput('100'));
    await store.rateSubmission('100', 'GOOD');

    await expect(store.discardSubmission('100')).rejects.toMatchObject({
      code: 'SUBMISSION_ALREADY_RATED',
    });
    await expect(store.discardSubmission('missing')).rejects.toMatchObject({
      code: 'SUBMISSION_NOT_FOUND',
    });
    expect((await store.queryDashboard()).recentReviews).toHaveLength(1);
  });

  it('批量标记已读只填写首次已读时间并保持幂等', async () => {
    let now = Date.UTC(2026, 0, 1, 9);
    const store = createStore(() => now);
    const first = await recordIssue(store, 'NETWORK_ERROR');
    const second = await recordIssue(store, 'TIMEOUT');

    expect(await store.markIssuesRead([requiredId(first), requiredId(second)])).toEqual({
      updatedCount: 2,
    });
    now += HOUR_MS;
    expect(await store.markIssuesRead([requiredId(first), requiredId(second)])).toEqual({
      updatedCount: 0,
    });

    const issues = (await store.queryDashboard()).issues;
    expect(issues.map((issue) => issue.readAt)).toEqual([
      Date.UTC(2026, 0, 1, 9),
      Date.UTC(2026, 0, 1, 9),
    ]);
  });

  it('解决异常会隐含标记已读，并保留已有的首次时间', async () => {
    let now = Date.UTC(2026, 0, 1, 9);
    const store = createStore(() => now);
    const unread = await recordIssue(store, 'NETWORK_ERROR');
    const read = await recordIssue(store, 'TIMEOUT');
    await store.markIssuesRead([requiredId(read)]);

    now += HOUR_MS;
    expect(await store.resolveIssues([requiredId(unread), requiredId(read)])).toEqual({
      updatedCount: 2,
    });
    now += HOUR_MS;
    expect(await store.resolveIssues([requiredId(unread), requiredId(read)])).toEqual({
      updatedCount: 0,
    });

    const issues = (await store.queryDashboard()).issues;
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: unread.id,
        readAt: Date.UTC(2026, 0, 1, 10),
        resolvedAt: Date.UTC(2026, 0, 1, 10),
      }),
      expect.objectContaining({
        id: read.id,
        readAt: Date.UTC(2026, 0, 1, 9),
        resolvedAt: Date.UTC(2026, 0, 1, 10),
      }),
    ]));
  });

  it('任一异常不存在时整批更新失败且不写入已有记录', async () => {
    const store = createStore(Date.UTC(2026, 0, 1, 9));
    const issue = await recordIssue(store, 'NETWORK_ERROR');

    await expect(store.markIssuesRead([requiredId(issue), 999])).rejects.toMatchObject({
      code: 'ISSUE_NOT_FOUND',
    });
    await expect(store.resolveIssues([999, requiredId(issue)])).rejects.toMatchObject({
      code: 'ISSUE_NOT_FOUND',
    });
    expect((await store.queryDashboard()).issues[0]).toMatchObject({
      readAt: null,
      resolvedAt: null,
    });
  });
});

async function recordIssue(
  store: DexieReviewStore,
  code: 'NETWORK_ERROR' | 'TIMEOUT',
) {
  return store.recordIssue({
    slug: 'two-sum',
    occurredAt: Date.UTC(2026, 0, 1, code === 'NETWORK_ERROR' ? 9 : 10),
    code,
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

function createStore(now: number | (() => number)) {
  const database = new XiaoshuajiDatabase(`test-background-store-${databaseSequence++}`);
  databases.push(database);
  const clock = typeof now === 'number' ? () => now : now;
  return new DexieReviewStore({ database, now: clock });
}

function acceptedInput(submissionId: string, acceptedAt = Date.UTC(2026, 0, 1, 9)) {
  return { metadata: metadata(), submissionId, trigger: 'button' as const, acceptedAt };
}

function metadata(): ProblemMetadata {
  return {
    problemId: 'leetcode-cn:two-sum',
    slug: 'two-sum',
    frontendId: '1',
    title: '两数之和',
    difficulty: 'EASY',
    tags: ['数组', '哈希表'],
    url: 'https://leetcode.cn/problems/two-sum/',
  };
}
