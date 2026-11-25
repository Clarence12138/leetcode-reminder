import { afterEach, describe, expect, it } from 'vitest';

import { LocalBackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { replayReviews } from '../src/background/fsrs';
import { createMessageHandler } from '../src/background/message-handler';
import {
  ReminderCoordinator,
  type AlarmPort,
  type BadgePort,
  type ExtensionRuntimePort,
  type NotificationPort,
} from '../src/background/reminders';
import { ChromeSettingsRepository, type LocalStoragePort } from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';
import { BUILTIN_PROBLEM_LISTS, getBuiltinProblemList } from '../src/domain/problem-lists';
import { countReviewedToday, sortDueProblems } from '../src/domain/queue-policy';
import type { ProblemMetadata, ProblemRecord, Settings, SubmissionReview } from '../src/domain/types';

const DAY_MS = 24 * 60 * 60 * 1_000;
let sequence = 0;
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('内置高频题单', () => {
  it('Hot 100 / 面试 150 / CodeTop 100 数量准确且无重复 slug', () => {
    expect(BUILTIN_PROBLEM_LISTS.map((list) => list.id)).toEqual([
      'hot-100',
      'top-interview-150',
      'codetop-100',
    ]);
    const hot = getBuiltinProblemList('hot-100').slugs;
    const top150 = getBuiltinProblemList('top-interview-150').slugs;
    const codetop = getBuiltinProblemList('codetop-100').slugs;

    expect(hot).toHaveLength(100);
    expect(new Set(hot).size).toBe(100);
    expect(top150).toHaveLength(150);
    expect(new Set(top150).size).toBe(150);
    expect(codetop).toHaveLength(100);
    expect(new Set(codetop).size).toBe(100);
  });
});

describe('批量暂停/恢复、分组保持率与一键题单归组', () => {
  it('批量暂停后退出到期队列与角标，恢复后保留 FSRS 进度回归', async () => {
    let now = new Date(2026, 0, 1, 9).getTime();
    const env = createEnvironment(() => now);
    await env.store.recordAccepted(accepted('1', metadata('two-sum', '1', '两数之和'), now));
    await env.store.rateSubmission('1', 'GOOD');
    await env.store.recordAccepted(accepted('2', metadata('lru-cache', '146', 'LRU 缓存'), now));
    await env.store.rateSubmission('2', 'GOOD');

    now += 30 * DAY_MS;
    await env.reminders.refreshBadge();
    expect(env.badge.text).toBe('2');

    const pausedRes = await env.handle({
      type: 'problem.set-paused',
      payload: { problemIds: ['leetcode-cn:two-sum', 'leetcode-cn:lru-cache'], paused: true },
    });
    expect(pausedRes).toEqual({ ok: true, data: { updatedCount: 2 } });
    expect((await env.store.queryDashboard()).dueProblems).toHaveLength(0);
    expect(env.badge.text).toBe('');

    const idempotent = await env.handle({
      type: 'problem.set-paused',
      payload: { problemIds: ['leetcode-cn:two-sum'], paused: true },
    });
    expect(idempotent).toEqual({ ok: true, data: { updatedCount: 0 } });

    const resumed = await env.handle({
      type: 'problem.set-paused',
      payload: { problemIds: ['leetcode-cn:lru-cache'], paused: false },
    });
    expect(resumed).toEqual({ ok: true, data: { updatedCount: 1 } });
    expect((await env.store.queryDashboard()).dueProblems.map((p) => p.slug)).toEqual(['lru-cache']);
    expect(env.badge.text).toBe('1');
  });

  it('不同目标保持率产生不同 FSRS 间隔，切换分组和调整保持率会自动重算', async () => {
    const t0 = Date.UTC(2026, 0, 1, 9);
    const reviews: SubmissionReview[] = [
      { submissionId: 's1', problemId: 'leetcode-cn:two-sum', trigger: 'button', acceptedAt: t0, detectedAt: t0, rating: 'GOOD', fsrsLog: null },
      { submissionId: 's2', problemId: 'leetcode-cn:two-sum', trigger: 'button', acceptedAt: t0 + 3 * DAY_MS, detectedAt: t0 + 3 * DAY_MS, rating: 'GOOD', fsrsLog: null },
    ];
    const high = replayReviews(reviews, { requestRetention: 0.9 }).card!;
    const low = replayReviews(reviews, { requestRetention: 0.8 }).card!;
    expect(low.due).toBeGreaterThan(high.due);

    const env = createEnvironment(() => t0 + 3 * DAY_MS);
    await env.handle({
      type: 'settings.update',
      payload: {
        defaultRequestRetention: 0.8,
        reviewGroups: [{ id: 'hot', name: '面试高频', requestRetention: 0.9 }],
      },
    });
    await env.store.recordAccepted(accepted('s1', metadata('two-sum', '1', '两数之和'), t0));
    await env.store.rateSubmission('s1', 'GOOD');
    await env.store.recordAccepted(accepted('s2', metadata('two-sum', '1', '两数之和'), t0 + 3 * DAY_MS));
    await env.store.rateSubmission('s2', 'GOOD');
    const dueAtDefault80 = (await env.store.queryDashboard()).problems[0]!.nextReviewAt!;

    await env.handle({
      type: 'problem.set-group',
      payload: { problemIds: ['leetcode-cn:two-sum'], groupId: 'hot' },
    });
    const dueAtHot90 = (await env.store.queryDashboard()).problems[0]!.nextReviewAt!;
    expect(dueAtHot90).toBeLessThan(dueAtDefault80);

    // 删除分组后回归默认组 80%，并重新拉长排期
    await env.handle({
      type: 'settings.update',
      payload: { reviewGroups: [] },
    });
    const afterDelete = (await env.store.queryDashboard()).problems[0]!;
    expect(afterDelete.groupId).toBeNull();
    expect(afterDelete.nextReviewAt).toBe(dueAtDefault80);
  });

  it('支持按内置高频题单一键归组及新题命中自动归组', async () => {
    const now = Date.UTC(2026, 0, 1, 9);
    const env = createEnvironment(() => now);
    await env.handle({
      type: 'settings.update',
      payload: {
        defaultRequestRetention: 0.8,
        reviewGroups: [{ id: 'core', name: '高频核心', requestRetention: 0.9 }],
      },
    });
    await env.store.recordAccepted(accepted('1', metadata('two-sum', '1', '两数之和'), now));
    await env.store.recordAccepted(accepted('2', metadata('custom-low-freq', '9999', '冷门题'), now));

    const applyRes = await env.handle({
      type: 'problem.apply-list-group',
      payload: { listIds: ['hot-100'], groupId: 'core' },
    });
    expect(applyRes).toEqual({ ok: true, data: { matchedCount: 1, updatedCount: 1 } });

    const problems = (await env.store.queryDashboard()).problems;
    expect(problems.find((p) => p.slug === 'two-sum')?.groupId).toBe('core');
    expect(problems.find((p) => p.slug === 'custom-low-freq')?.groupId).toBeNull();

    // 开启自动归组后，新提交命中 CodeTop 100 的题自动进入 core 组
    await env.handle({
      type: 'settings.update',
      payload: { autoGroupRules: [{ listId: 'codetop-100', groupId: 'core' }] },
    });
    await env.store.recordAccepted(accepted('3', metadata('lru-cache', '146', 'LRU 缓存'), now));
    const lru = (await env.store.queryDashboard()).problems.find((p) => p.slug === 'lru-cache');
    expect(lru?.groupId).toBe('core');
  });

  it('每日复习配额限制角标并忽略今日新题，达标后角标清零', async () => {
    let now = new Date(2026, 0, 1, 9).getTime();
    const env = createEnvironment(() => now);
    await env.store.recordAccepted(accepted('a1', metadata('two-sum', '1', '两数之和'), now));
    await env.store.rateSubmission('a1', 'GOOD');
    await env.store.recordAccepted(accepted('b1', metadata('lru-cache', '146', 'LRU 缓存'), now));
    await env.store.rateSubmission('b1', 'GOOD');
    await env.store.recordAccepted(accepted('c1', metadata('3sum', '15', '三数之和'), now));
    await env.store.rateSubmission('c1', 'GOOD');

    now = new Date(2026, 1, 1, 10).getTime();
    await env.handle({ type: 'settings.update', payload: { dailyReviewLimit: 2 } });
    expect(env.badge.text).toBe('2');

    // 今天新刷 1 道从未做过的新题，不应消耗旧题复习配额
    await env.store.recordAccepted(accepted('n1', metadata('merge-intervals', '56', '合并区间'), now));
    await env.store.rateSubmission('n1', 'GOOD');
    await env.reminders.refreshBadge();
    expect(env.badge.text).toBe('2');

    // 复习完 2 道旧题后，虽然还有第 3 道积压到期，但今日配额已达标，角标清零
    await env.store.recordAccepted(accepted('a2', metadata('two-sum', '1', '两数之和'), now + 1000));
    await env.store.rateSubmission('a2', 'GOOD');
    await env.store.recordAccepted(accepted('b2', metadata('lru-cache', '146', 'LRU 缓存'), now + 2000));
    await env.store.rateSubmission('b2', 'GOOD');
    await env.reminders.refreshBadge();

    expect(env.badge.text).toBe('');
    expect(await env.store.countReviewedToday('Asia/Shanghai', now + 3000)).toBe(2);
  });

  it('队列排序默认最早到期，智能优先按保持率、薄弱度与难度排序', () => {
    const baseSettings: Pick<Settings, 'queueSortStrategy' | 'defaultRequestRetention' | 'reviewGroups'> = {
      queueSortStrategy: 'due_asc',
      defaultRequestRetention: 0.8,
      reviewGroups: [{ id: 'hot', name: '高频', requestRetention: 0.9 }],
    };
    const oldLow = makeCardProblem('old-low', { due: 100, stability: 20, groupId: null, difficulty: 'EASY' });
    const newHot = makeCardProblem('new-hot', { due: 300, stability: 2, groupId: 'hot', difficulty: 'MEDIUM' });
    const stableHot = makeCardProblem('stable-hot', { due: 200, stability: 15, groupId: 'hot', difficulty: 'HARD' });

    expect(sortDueProblems([newHot, oldLow, stableHot], baseSettings).map((p) => p.slug)).toEqual([
      'old-low',
      'stable-hot',
      'new-hot',
    ]);
    expect(
      sortDueProblems([newHot, oldLow, stableHot], { ...baseSettings, queueSortStrategy: 'priority' })
        .map((p) => p.slug),
    ).toEqual(['new-hot', 'stable-hot', 'old-low']);
    expect(
      sortDueProblems([newHot, oldLow, stableHot], { ...baseSettings, queueSortStrategy: 'stability_asc' })
        .map((p) => p.slug),
    ).toEqual(['new-hot', 'stable-hot', 'old-low']);
  });

  it('备份导入导出完整保留分组、暂停状态和配额设置', async () => {
    const now = Date.UTC(2026, 0, 10, 9);
    const source = createEnvironment(() => now);
    await source.handle({
      type: 'settings.update',
      payload: {
        dailyReviewLimit: 3,
        queueSortStrategy: 'priority',
        defaultRequestRetention: 0.8,
        reviewGroups: [{ id: 'hot', name: '高频', requestRetention: 0.9 }],
        autoGroupRules: [{ listId: 'hot-100', groupId: 'hot' }],
      },
    });
    await source.store.recordAccepted(accepted('1', metadata('two-sum', '1', '两数之和'), now));
    await source.store.rateSubmission('1', 'GOOD');
    await source.handle({
      type: 'problem.set-paused',
      payload: { problemIds: ['leetcode-cn:two-sum'], paused: true },
    });

    const exported = await source.backups.export();
    const target = createEnvironment(() => now);
    await target.backups.import(exported, 'replace');

    const restoredSettings = await target.settings.get();
    const restoredProblem = (await target.store.queryDashboard()).problems[0]!;
    expect(restoredSettings).toMatchObject({
      dailyReviewLimit: 3,
      queueSortStrategy: 'priority',
      defaultRequestRetention: 0.8,
      reviewGroups: [{ id: 'hot', name: '高频', requestRetention: 0.9 }],
      autoGroupRules: [{ listId: 'hot-100', groupId: 'hot' }],
    });
    expect(restoredProblem.groupId).toBe('hot');
    expect(restoredProblem.pausedAt).toBe(now);
    expect(countReviewedToday(exported.submissions, { now, timezone: 'Asia/Shanghai' })).toBe(0);
  });
});

function createEnvironment(now: () => number) {
  const database = new XiaoshuajiDatabase(`test-review-groups-${sequence++}`);
  databases.push(database);
  const settings = new ChromeSettingsRepository(new MemoryStorage(), () => 'Asia/Shanghai');
  const store = new DexieReviewStore({ database, now, getSettings: () => settings.get() });
  const alarms = new MemoryAlarms();
  const notifications = new MemoryNotifications();
  const badge = new MemoryBadge();
  const runtime: ExtensionRuntimePort = {
    getUrl: (path) => `chrome-extension://test${path}`,
    openDashboard: async () => undefined,
  };
  const reminders = new ReminderCoordinator({ store, settings, alarms, notifications, badge, runtime, now });
  const backups = new LocalBackupManager(store, settings, now);
  const handle = createMessageHandler({ store, settings, backups, reminders });
  return { store, settings, reminders, backups, handle, badge, notifications };
}

function accepted(submissionId: string, meta: ProblemMetadata, acceptedAt: number) {
  return { metadata: meta, submissionId, trigger: 'button' as const, acceptedAt };
}

function metadata(slug: string, frontendId: string, title: string): ProblemMetadata {
  return {
    problemId: `leetcode-cn:${slug}`,
    slug,
    frontendId,
    title,
    difficulty: 'MEDIUM',
    tags: ['数组'],
    url: `https://leetcode.cn/problems/${slug}/`,
  };
}

function makeCardProblem(
  slug: string,
  options: { readonly due: number; readonly stability: number; readonly groupId: string | null; readonly difficulty: ProblemRecord['difficulty'] },
): ProblemRecord {
  return {
    ...metadata(slug, slug, slug),
    difficulty: options.difficulty,
    createdAt: 1,
    updatedAt: 1,
    nextReviewAt: options.due,
    pausedAt: null,
    groupId: options.groupId,
    fsrsCard: {
      due: options.due,
      stability: options.stability,
      difficulty: 5,
      elapsed_days: 1,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      learning_steps: 0,
      state: 2,
      last_review: 1,
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

class MemoryAlarms implements AlarmPort {
  current: { scheduledTime: number } | undefined;
  get() { return Promise.resolve(this.current); }
  clear() { this.current = undefined; return Promise.resolve(true); }
  create(_name: string, info: { when: number }) { this.current = { scheduledTime: info.when }; return Promise.resolve(); }
}

class MemoryNotifications implements NotificationPort {
  readonly created: { id: string; options: Parameters<NotificationPort['create']>[1] }[] = [];
  create(id: string, options: Parameters<NotificationPort['create']>[1]) {
    this.created.push({ id, options });
    return Promise.resolve(id);
  }
}

class MemoryBadge implements BadgePort {
  text = '';
  color = '';
  title = '';
  setBadgeText({ text }: { text: string }) { this.text = text; return Promise.resolve(); }
  setBadgeBackgroundColor({ color }: { color: string }) { this.color = color; return Promise.resolve(); }
  setTitle({ title }: { title: string }) { this.title = title; return Promise.resolve(); }
}
