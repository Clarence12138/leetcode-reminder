import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { planHistoryImport } from '../src/background/history-import';
import { createMessageHandler } from '../src/background/message-handler';
import { ChromeDataMirror, DATA_MIRROR_STORAGE_KEY } from '../src/background/mirror';
import type { ReminderCoordinator } from '../src/background/reminders';
import { ChromeSettingsRepository, type LocalStoragePort } from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';
import type { LeetCodeHistoryProblem, ProblemMetadata } from '../src/domain/types';

const NOW = Date.UTC(2026, 0, 10, 9);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EMPTY = { problems: [], submissions: [], issues: [] };
let sequence = 0;
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('planHistoryImport', () => {
  it('统一评分时保留每天首次 AC 并全部按所选档位评分', () => {
    const plan = planHistoryImport(EMPTY, {
      problems: [history('two-sum', [
        ['1', Date.UTC(2026, 0, 1, 1)],
        ['2', Date.UTC(2026, 0, 1, 10)],
        ['3', Date.UTC(2026, 0, 1, 17)],
        ['4', Date.UTC(2026, 0, 3, 2)],
      ])],
      rating: { mode: 'uniform', rating: 'HARD' },
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    // 上海时区：1 日 01:00Z 与 10:00Z 同属 1 日；17:00Z 已是 2 日。
    expect(plan.snapshot.submissions.map((review) => [review.submissionId, review.rating, review.trigger])).toEqual([
      ['1', 'HARD', 'import'],
      ['3', 'HARD', 'import'],
      ['4', 'HARD', 'import'],
    ]);
    expect(plan.result).toEqual({ importedProblems: 1, importedSubmissions: 3, skippedProblems: 0 });
  });

  it('自己补评时每题只导入最近一次 AC 并保持待评估', () => {
    const plan = planHistoryImport(EMPTY, {
      problems: [history('two-sum', [['1', NOW - 3 * DAY], ['2', NOW - DAY]])],
      rating: { mode: 'manual' },
      timezone: 'UTC',
      now: NOW,
    });

    expect(plan.snapshot.submissions).toEqual([expect.objectContaining({ submissionId: '2', rating: null })]);
  });

  it('自己补评时同一天多次 AC 取当天最后一次', () => {
    const plan = planHistoryImport(EMPTY, {
      problems: [history('two-sum', [['morning', Date.UTC(2026, 0, 5, 1)], ['night', Date.UTC(2026, 0, 5, 14)]])],
      rating: { mode: 'manual' },
      timezone: 'Asia/Shanghai',
      now: NOW,
    });

    expect(plan.snapshot.submissions.map((review) => review.submissionId)).toEqual(['night']);
  });

  it('同一提交出现在多道题下时明确报错', () => {
    expect(() => planHistoryImport(EMPTY, {
      problems: [history('two-sum', [['1', NOW]]), history('add-two-numbers', [['1', NOW]])],
      rating: { mode: 'uniform', rating: 'GOOD' },
      timezone: 'UTC',
      now: NOW,
    })).toThrow('同时属于多道题目');
  });

  it('跳过本地已有题目和重复条目', () => {
    const current = {
      ...EMPTY,
      problems: [{ ...metadata('two-sum'), createdAt: 0, updatedAt: 0, fsrsCard: null, nextReviewAt: null, algorithm: 'FSRS-6' as const, algorithmLibrary: 'x', parametersVersion: 'x' }],
    };
    const plan = planHistoryImport(current, {
      problems: [
        history('two-sum', [['1', NOW]]),
        history('add-two-numbers', [['2', NOW]]),
        history('add-two-numbers', [['3', NOW]]),
      ],
      rating: { mode: 'uniform', rating: 'GOOD' },
      timezone: 'UTC',
      now: NOW,
    });

    expect(plan.snapshot.problems.map((problem) => problem.slug)).toEqual(['add-two-numbers']);
    expect(plan.result).toEqual({ importedProblems: 1, importedSubmissions: 1, skippedProblems: 2 });
  });
});

describe('history.import 消息', () => {
  it('统一评分导入后生成排期、保留本地题目评分并同步镜像', async () => {
    const context = createContext();
    await context.store.recordAccepted({ metadata: metadata('two-sum'), submissionId: 'local', trigger: 'button', acceptedAt: NOW - DAY });
    await context.store.rateSubmission('local', 'EASY');

    const response = await context.handle({
      type: 'history.import',
      payload: {
        problems: [history('two-sum', [['old', NOW - 9 * DAY]]), history('add-two-numbers', [['a', NOW - 5 * DAY], ['b', NOW - 2 * DAY]])],
        rating: { mode: 'uniform', rating: 'GOOD' },
      },
    });

    expect(response).toEqual({ ok: true, data: { importedProblems: 1, importedSubmissions: 2, skippedProblems: 1 } });
    const snapshot = await context.store.getSnapshot();
    const imported = snapshot.problems.find((problem) => problem.slug === 'add-two-numbers');
    expect(imported?.fsrsCard?.reps).toBe(2);
    expect(imported?.nextReviewAt).toBeGreaterThan(NOW - 2 * DAY);
    expect(snapshot.submissions.find((review) => review.submissionId === 'local')?.rating).toBe('EASY');
    expect(snapshot.submissions.some((review) => review.submissionId === 'old')).toBe(false);
    expect(context.storage.peek(DATA_MIRROR_STORAGE_KEY)).toMatchObject({ problems: [{}, {}] });
  });

  it('徽标刷新失败不影响导入结果，镜像照常同步', async () => {
    const context = createContext(async () => { throw new Error('badge'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await context.handle({
      type: 'history.import',
      payload: { problems: [history('two-sum', [['1', NOW - DAY]])], rating: { mode: 'uniform', rating: 'GOOD' } },
    });

    expect(response).toMatchObject({ ok: true, data: { importedProblems: 1 } });
    expect(context.storage.peek(DATA_MIRROR_STORAGE_KEY)).toMatchObject({ problems: [{ slug: 'two-sum' }] });
    errors.mockRestore();
  });

  it('自己补评导入后进入待评估队列', async () => {
    const context = createContext();

    await context.handle({
      type: 'history.import',
      payload: { problems: [history('two-sum', [['1', NOW - DAY]])], rating: { mode: 'manual' } },
    });

    const summary = await context.store.queryDashboard();
    expect(summary.pendingReviews.map((review) => review.submissionId)).toEqual(['1']);
    expect(summary.problems[0]?.nextReviewAt).toBeNull();
  });
});

function createContext(refreshBadge: () => Promise<void> = async () => undefined) {
  const database = new XiaoshuajiDatabase(`test-history-${sequence++}`);
  databases.push(database);
  const storage = new MemoryStorage();
  const store = new DexieReviewStore({ database, now: () => NOW });
  const settings = new ChromeSettingsRepository(storage, () => 'UTC');
  const handle = createMessageHandler({
    store,
    settings,
    backups: {} as BackupManager,
    reminders: { refreshBadge } as ReminderCoordinator,
    mirror: new ChromeDataMirror(store, storage, () => NOW),
  });
  return { store, storage, handle };
}

function metadata(slug: string): ProblemMetadata {
  return {
    problemId: `leetcode-cn:${slug}`,
    slug,
    frontendId: '1',
    title: slug,
    difficulty: 'EASY',
    tags: [],
    url: `https://leetcode.cn/problems/${slug}/`,
  };
}

function history(slug: string, submissions: readonly (readonly [string, number])[]): LeetCodeHistoryProblem {
  return {
    metadata: metadata(slug),
    submissions: submissions.map(([submissionId, acceptedAt]) => ({ submissionId, acceptedAt })),
  };
}

class MemoryStorage implements LocalStoragePort {
  private readonly values: Record<string, unknown> = {};

  get(key: string) {
    return Promise.resolve(key in this.values ? { [key]: structuredClone(this.values[key]) } : {});
  }

  set(items: Record<string, unknown>) {
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }

  remove(keys: string | readonly string[]) {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];
    return Promise.resolve();
  }

  peek(key: string): unknown {
    return this.values[key];
  }
}
