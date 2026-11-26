import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetting_curve } from 'ts-fsrs';

import type { BackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { createMessageHandler } from '../src/background/message-handler';
import type { ReminderCoordinator } from '../src/background/reminders';
import { ChromeSettingsRepository, type LocalStoragePort } from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';
import { pickNextDueProblem } from '../src/domain/queue-policy';
import type { ProblemMetadata, ProblemRecord, Settings } from '../src/domain/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 0, 1, 1);
let sequence = 0;
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('撤销评分 submission.unrate', () => {
  it('评分后撤销：提交回到待评估，题目排期还原为未排期', async () => {
    const env = createEnvironment(() => START);
    await env.store.recordAccepted(accepted('100', meta('two-sum', '1'), START));
    const rated = await env.handle({ type: 'submission.rate', payload: { submissionId: '100', rating: 'GOOD' } });
    expect(rated).toMatchObject({ ok: true, data: { nextReviewAt: expect.any(Number) } });

    const undone = await env.handle({ type: 'submission.unrate', payload: { submissionId: '100' } });

    expect(undone).toMatchObject({ ok: true, data: { review: { rating: null, fsrsLog: null }, nextReviewAt: null } });
    const summary = await env.store.queryDashboard();
    expect(summary.pendingReviews.map((review) => review.submissionId)).toEqual(['100']);
    expect(summary.problems[0]).toMatchObject({ fsrsCard: null, nextReviewAt: null });
    expect(env.badgeRefreshes()).toBe(2);
  });

  it('撤销第二次评分时，排期回到第一次评分后的结果', async () => {
    let now = START;
    const env = createEnvironment(() => now);
    await env.store.recordAccepted(accepted('100', meta('two-sum', '1'), now));
    const first = await env.store.rateSubmission('100', 'GOOD');
    now += 5 * DAY_MS;
    await env.store.recordAccepted(accepted('101', meta('two-sum', '1'), now));
    await env.store.rateSubmission('101', 'AGAIN');

    const undone = await env.store.clearRating('101');

    expect(undone.nextReviewAt).toBe(first.nextReviewAt);
    const summary = await env.store.queryDashboard();
    expect(summary.problems[0]?.nextReviewAt).toBe(first.nextReviewAt);
    expect(summary.problems[0]?.fsrsCard?.reps).toBe(1);
  });

  it('未评分或不存在的提交返回明确错误码', async () => {
    const env = createEnvironment(() => START);
    await env.store.recordAccepted(accepted('100', meta('two-sum', '1'), START));

    await expect(env.handle({ type: 'submission.unrate', payload: { submissionId: '100' } }))
      .resolves.toMatchObject({ ok: false, error: { code: 'SUBMISSION_NOT_RATED' } });
    await expect(env.handle({ type: 'submission.unrate', payload: { submissionId: '404' } }))
      .resolves.toMatchObject({ ok: false, error: { code: 'SUBMISSION_NOT_FOUND' } });
    await expect(env.handle({ type: 'submission.unrate', payload: { submissionId: '' } }))
      .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('撤销评分的并发与容错', () => {
  it('带上评分撤销：评分已被改成别的档位时拒绝，且不改动当前评分', async () => {
    const env = createEnvironment(() => START);
    await env.store.recordAccepted(accepted('100', meta('two-sum', '1'), START));
    await env.store.rateSubmission('100', 'GOOD');
    await env.store.clearRating('100');
    await env.store.rateSubmission('100', 'EASY');

    await expect(env.handle({ type: 'submission.unrate', payload: { submissionId: '100', rating: 'GOOD' } }))
      .resolves.toMatchObject({ ok: false, error: { code: 'SUBMISSION_RATING_CHANGED', message: '这条提交的评分已在别处修改，无法撤销' } });
    const summary = await env.store.queryDashboard();
    expect(summary.pendingReviews).toEqual([]);
    await expect(env.handle({ type: 'submission.unrate', payload: { submissionId: '100', rating: 'EASY' } }))
      .resolves.toMatchObject({ ok: true, data: { review: { rating: null } } });
  });

  it('评分、撤销、丢弃成功但刷新角标失败时仍返回成功', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = createEnvironment(() => START, { refreshBadge: () => Promise.reject(new Error('badge boom')) });
    await env.store.recordAccepted(accepted('100', meta('two-sum', '1'), START));
    await env.store.recordAccepted(accepted('200', meta('add-two-numbers', '2'), START));

    await expect(env.handle({ type: 'submission.rate', payload: { submissionId: '100', rating: 'GOOD' } }))
      .resolves.toMatchObject({ ok: true });
    await expect(env.handle({ type: 'submission.unrate', payload: { submissionId: '100', rating: 'GOOD' } }))
      .resolves.toMatchObject({ ok: true });
    await expect(env.handle({ type: 'submission.discard', payload: { submissionId: '200' } }))
      .resolves.toMatchObject({ ok: true });
    expect(error).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });
});

describe('并发 settings.update', () => {
  it('两个并发更新的字段都保留，失败的更新不卡住后续请求', async () => {
    const memory = new MemoryStorage();
    const slow: LocalStoragePort = {
      get: async (key) => { const value = await memory.get(key); await new Promise((r) => setTimeout(r, 5)); return value; },
      set: (items) => memory.set(items),
      remove: (keys) => memory.remove(keys),
    };
    const env = createEnvironment(() => START, { storage: slow });

    const [a, b, bad, c] = await Promise.all([
      env.handle({ type: 'settings.update', payload: { dailyReviewLimit: 7 } }),
      env.handle({ type: 'settings.update', payload: { resetCodeOnReview: true } }),
      env.handle({ type: 'settings.update', payload: { dailyReviewLimit: -5 } }),
      env.handle({ type: 'settings.update', payload: { reminderHour: 6 } }),
    ]);

    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(bad.ok).toBe(false);
    await expect(env.handle({ type: 'settings.get' })).resolves.toMatchObject({
      ok: true,
      data: { dailyReviewLimit: 7, resetCodeOnReview: true, reminderHour: 6 },
    });
  });
});

describe('下一题 review.next', () => {
  it('按最早到期返回下一题，排除当前题，并按设置加上还原标记', async () => {
    let now = START;
    const env = createEnvironment(() => now);
    await rateNew(env.store, '100', meta('two-sum', '1'), now);
    now += DAY_MS;
    await rateNew(env.store, '200', meta('trapping-rain-water', '42'), now);
    now += 60 * DAY_MS;
    await env.settings.update({ resetCodeOnReview: true });

    const next = await env.handle({ type: 'review.next' });
    expect(next).toMatchObject({
      ok: true,
      data: {
        problem: { problemId: 'leetcode-cn:two-sum' },
        url: 'https://leetcode.cn/problems/two-sum/?xiaoshuaji=review',
        remainingToday: 2,
      },
    });

    const excluded = await env.handle({ type: 'review.next', payload: { excludeProblemId: 'leetcode-cn:two-sum' } });
    expect(excluded).toMatchObject({
      ok: true,
      data: { problem: { problemId: 'leetcode-cn:trapping-rain-water' }, remainingToday: 1 },
    });
  });

  it('没有到期题时返回空', async () => {
    const env = createEnvironment(() => START);
    await expect(env.handle({ type: 'review.next', payload: {} }))
      .resolves.toEqual({ ok: true, data: { problem: null, url: null, remainingToday: 0 } });
  });

  it('拒绝多余字段', async () => {
    const env = createEnvironment(() => START);
    await expect(env.handle({ type: 'review.next', payload: { extra: 1 } }))
      .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('复习轨迹 review.context', () => {
  it('返回按时间正序的评分轨迹、每次评分后的间隔和当前记忆概率', async () => {
    let now = START;
    const env = createEnvironment(() => now);
    await rateNew(env.store, '100', meta('two-sum', '1'), now, 'GOOD');
    now += 3 * DAY_MS;
    await env.store.recordAccepted(accepted('101', meta('two-sum', '1'), now));
    await env.store.recordAccepted(accepted('102', meta('two-sum', '1'), now + 1_000));
    await env.store.rateSubmission('101', 'HARD');
    now += 2 * DAY_MS;

    const response = await env.handle({ type: 'review.context', payload: { problemId: 'leetcode-cn:two-sum' } });
    if (!response.ok) throw new Error(response.error.message);
    const context = response.data as Awaited<ReturnType<DexieReviewStore['reviewContext']>>;

    expect(context.history.map((entry) => [entry.submissionId, entry.rating])).toEqual([['100', 'GOOD'], ['101', 'HARD']]);
    const card = context.problem?.fsrsCard;
    if (!card || card.last_review === undefined) throw new Error('缺少卡片');
    expect(context.history[1]?.scheduledDays).toBe(card.scheduled_days);
    expect(context.history[0]?.scheduledDays).toBeGreaterThan(0);
    expect(context.retrievability).toBeCloseTo(forgetting_curve(0.1542, (now - card.last_review) / DAY_MS, card.stability), 6);
  });

  it('题目不存在时返回空轨迹', async () => {
    const env = createEnvironment(() => START);
    await expect(env.handle({ type: 'review.context', payload: { problemId: 'leetcode-cn:none' } }))
      .resolves.toEqual({ ok: true, data: { problem: null, history: [], retrievability: null } });
    await expect(env.handle({ type: 'review.context', payload: {} }))
      .resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});

describe('pickNextDueProblem', () => {
  const settings: Pick<Settings, 'dailyReviewLimit' | 'queueSortStrategy' | 'defaultRequestRetention' | 'reviewGroups' | 'timezone'> = {
    dailyReviewLimit: null,
    queueSortStrategy: 'due_asc',
    defaultRequestRetention: 0.9,
    reviewGroups: [],
    timezone: 'Asia/Shanghai',
  };
  const now = START + 30 * DAY_MS;
  const problems = [
    problemRecord('a', { due: now - 3 * DAY_MS, stability: 20 }),
    problemRecord('b', { due: now - 2 * DAY_MS, stability: 2 }),
    problemRecord('c', { due: now - DAY_MS, stability: 8 }),
  ];

  it('按排序策略取第一题', () => {
    expect(pickNextDueProblem({ dueProblems: problems, reviews: [], settings, now }).problem?.slug).toBe('a');
    expect(pickNextDueProblem({ dueProblems: problems, reviews: [], settings: { ...settings, queueSortStrategy: 'stability_asc' }, now }).problem?.slug).toBe('b');
  });

  it('受每日配额限制，排除题目后剩余数相应减少', () => {
    const limited = { ...settings, dailyReviewLimit: 2 };
    expect(pickNextDueProblem({ dueProblems: problems, reviews: [], settings: limited, now })).toMatchObject({ remainingToday: 2 });
    const picked = pickNextDueProblem({ dueProblems: problems, reviews: [], settings: limited, now, excludeProblemId: 'leetcode-cn:a' });
    expect(picked.problem?.slug).toBe('b');
    expect(picked.remainingToday).toBe(1);
  });

  it('忽略暂停的题目，没有题目时返回空', () => {
    const paused = problems.map((problem) => ({ ...problem, pausedAt: now }));
    expect(pickNextDueProblem({ dueProblems: paused, reviews: [], settings, now })).toEqual({ problem: null, remainingToday: 0 });
  });
});

async function rateNew(
  store: DexieReviewStore,
  submissionId: string,
  problem: ProblemMetadata,
  acceptedAt: number,
  rating: 'GOOD' | 'HARD' = 'GOOD',
) {
  await store.recordAccepted(accepted(submissionId, problem, acceptedAt));
  return store.rateSubmission(submissionId, rating);
}

function createEnvironment(
  now: () => number,
  options: { readonly storage?: LocalStoragePort; readonly refreshBadge?: () => Promise<void> } = {},
) {
  const database = new XiaoshuajiDatabase(`test-review-flow-${sequence++}`);
  databases.push(database);
  const settings = new ChromeSettingsRepository(options.storage ?? new MemoryStorage(), () => 'Asia/Shanghai');
  const store = new DexieReviewStore({ database, now, getSettings: () => settings.get() });
  let refreshes = 0;
  const reminders = {
    refreshBadge: async () => { refreshes += 1; await options.refreshBadge?.(); },
    settingsChanged: async () => undefined,
  } as unknown as ReminderCoordinator;
  const handle = createMessageHandler({ store, settings, backups: {} as BackupManager, reminders });
  return { store, settings, handle, badgeRefreshes: () => refreshes };
}

function accepted(submissionId: string, problem: ProblemMetadata, acceptedAt: number) {
  return { metadata: problem, submissionId, trigger: 'button' as const, acceptedAt };
}

function meta(slug: string, frontendId: string): ProblemMetadata {
  return {
    problemId: `leetcode-cn:${slug}`,
    slug,
    frontendId,
    title: slug,
    difficulty: 'MEDIUM',
    tags: ['数组'],
    url: `https://leetcode.cn/problems/${slug}/`,
  };
}

function problemRecord(slug: string, options: { readonly due: number; readonly stability: number }): ProblemRecord {
  return {
    ...meta(slug, slug),
    createdAt: 1,
    updatedAt: 1,
    nextReviewAt: options.due,
    pausedAt: null,
    groupId: null,
    fsrsCard: {
      due: options.due,
      stability: options.stability,
      difficulty: 5,
      elapsed_days: 1,
      scheduled_days: 1,
      reps: 2,
      lapses: 0,
      learning_steps: 0,
      state: 2,
      last_review: options.due - DAY_MS,
    },
    algorithm: 'FSRS-6',
    algorithmLibrary: 'ts-fsrs@5.4.1',
    parametersVersion: 'xiaoshuaji-fsrs-v1',
  };
}

class MemoryStorage implements LocalStoragePort {
  private readonly values: Record<string, unknown> = {};
  get(key: string) { return Promise.resolve(key in this.values ? { [key]: this.values[key] } : {}); }
  set(items: Record<string, unknown>) { Object.assign(this.values, items); return Promise.resolve(); }
  remove(keys: string | readonly string[]) {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];
    return Promise.resolve();
  }
}
