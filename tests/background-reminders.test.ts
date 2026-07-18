import { afterEach, describe, expect, it } from 'vitest';

import { LocalBackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { createMessageHandler } from '../src/background/message-handler';
import {
  ReminderCoordinator,
  nextReminderTime,
  type AlarmPort,
  type BadgePort,
  type ExtensionRuntimePort,
  type NotificationPort,
} from '../src/background/reminders';
import { ChromeSettingsRepository, type LocalStoragePort } from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';
import type { ProblemMetadata } from '../src/domain/types';

let databaseSequence = 0;
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('后台消息', () => {
  it('对未知结构返回明确校验错误', async () => {
    const now = Date.UTC(2026, 0, 1, 9);
    const { store } = createStore(now);
    const dependencies = createReminderDependencies(store, now);
    const backups = new LocalBackupManager(store, dependencies.settings, () => now);
    const handle = createMessageHandler({ store, backups, ...dependencies });

    const response = await handle({ type: 'submission.accepted', payload: { submissionId: 'x' } });

    expect(response).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('清空全部数据后恢复默认提醒设置和角标', async () => {
    const now = new Date(2026, 0, 1, 8).getTime();
    const { store } = createStore(now);
    const dependencies = createReminderDependencies(store, now);
    await store.recordAccepted(acceptedInput('100', now));
    await dependencies.settings.update({ notificationsEnabled: false, reminderHour: 7 });
    await dependencies.settings.setLastNotificationDate('2026-01-01');
    const backups = new LocalBackupManager(store, dependencies.settings, () => now);
    const handle = createMessageHandler({ store, backups, ...dependencies });

    expect(await handle({ type: 'data.clear' })).toEqual({ ok: true });
    expect(await store.queryDashboard()).toMatchObject({ problems: [], pendingReviews: [] });
    expect(await dependencies.settings.get()).toMatchObject({
      notificationsEnabled: true,
      reminderHour: 9,
      reminderMinute: 0,
    });
    expect(await dependencies.settings.getLastNotificationDate()).toBeNull();
    expect(dependencies.badge.text).toBe('');
  });

  it('只迁移已知的 Settings v0 结构并持久化为 v1', async () => {
    const storage = new MemoryStorage();
    await storage.set({
      settings: {
        notificationsEnabled: false,
        reminderHour: 7,
        reminderMinute: 30,
        timezone: 'Asia/Shanghai',
        schemaVersion: 0,
      },
    });
    const repository = new ChromeSettingsRepository(storage, () => 'Asia/Shanghai');

    await expect(repository.get()).resolves.toMatchObject({
      notificationsEnabled: false,
      reminderHour: 7,
      reminderMinute: 30,
      schemaVersion: 1,
    });
    await expect(storage.get('settings')).resolves.toMatchObject({
      settings: { schemaVersion: 1 },
    });
  });

  it('未知设置版本显式报错而不回退默认值', async () => {
    const storage = new MemoryStorage();
    await storage.set({
      settings: {
        notificationsEnabled: true,
        reminderHour: 9,
        reminderMinute: 0,
        timezone: 'Asia/Shanghai',
        schemaVersion: 99,
      },
    });
    const repository = new ChromeSettingsRepository(storage, () => 'Asia/Shanghai');

    await expect(repository.get()).rejects.toMatchObject({ code: 'SETTINGS_CORRUPT' });
  });
});

describe('闹钟、通知和角标', () => {
  it('计算下一个当地时间的 one-shot 09:00', () => {
    const atEight = new Date(2026, 0, 1, 8).getTime();
    const atTen = new Date(2026, 0, 1, 10).getTime();

    expect(nextReminderTime(atEight, { reminderHour: 9, reminderMinute: 0 }).getDate()).toBe(1);
    expect(nextReminderTime(atEight, { reminderHour: 9, reminderMinute: 0 }).getHours()).toBe(9);
    expect(nextReminderTime(atTen, { reminderHour: 9, reminderMinute: 0 }).getDate()).toBe(2);
  });

  it('点击每日汇总通知打开待处理队列', async () => {
    const now = new Date(2026, 0, 1, 9).getTime();
    const { store } = createStore(now);
    const dependencies = createReminderDependencies(store, now);

    await dependencies.reminders.handleNotificationClick('xiaoshuaji-summary:2026-01-01');
    await dependencies.reminders.handleNotificationClick('unrelated-notification');

    expect(dependencies.runtime.openedUrls).toEqual([
      'chrome-extension://test/dashboard.html#queue',
    ]);
  });

  it('休眠恢复后同一天只发一条当前汇总', async () => {
    let now = new Date(2026, 0, 1, 8).getTime();
    const { store } = createStore(() => now);
    await store.recordAccepted(acceptedInput('100', now));
    const dependencies = createReminderDependencies(store, () => now);

    await dependencies.reminders.initialize();
    expect(dependencies.alarms.created.at(-1)?.info.when).toBe(
      new Date(2026, 0, 1, 9).getTime(),
    );
    now = new Date(2026, 0, 1, 12).getTime();
    await dependencies.reminders.handleAlarm('xiaoshuaji-daily-summary');
    await dependencies.reminders.handleAlarm('xiaoshuaji-daily-summary');

    expect(dependencies.notifications.created).toHaveLength(1);
    expect(dependencies.notifications.created[0]?.options.message).toBe(
      '今日/逾期 0 题、待评估 1 条',
    );
    expect(dependencies.badge.text).toBe('1');
    expect(dependencies.badge.color).toBe('#F59E0B');
  });

  it('已过当日提醒时间且闹钟丢失时在启动阶段补发一次', async () => {
    const now = new Date(2026, 0, 1, 12).getTime();
    const { store } = createStore(now);
    await store.recordAccepted(acceptedInput('100', now));
    const dependencies = createReminderDependencies(store, now);

    await dependencies.reminders.initialize();
    await dependencies.reminders.initialize();

    expect(dependencies.notifications.created).toHaveLength(1);
    expect(dependencies.alarms.current?.scheduledTime).toBe(new Date(2026, 0, 2, 9).getTime());
  });

  it('Service Worker 重启发现过期闹钟时补发且重建下一次闹钟', async () => {
    let now = new Date(2026, 0, 1, 8).getTime();
    const { store } = createStore(() => now);
    await store.recordAccepted(acceptedInput('100', now));
    const dependencies = createReminderDependencies(store, () => now);

    await dependencies.reminders.initialize();
    now = new Date(2026, 0, 1, 12).getTime();
    await dependencies.reminders.initialize();

    expect(dependencies.notifications.created).toHaveLength(1);
    expect(dependencies.alarms.current?.scheduledTime).toBe(new Date(2026, 0, 2, 9).getTime());
  });

  it('汇总统计今日稍后到期的题，角标只统计当前已到期', async () => {
    const now = new Date(2026, 0, 2, 12).getTime();
    const dueLaterToday = new Date(2026, 0, 2, 18).getTime();
    const { database, store } = createStore(now);
    await store.recordAccepted(acceptedInput('100', new Date(2026, 0, 1, 9).getTime()));
    await store.rateSubmission('100', 'GOOD');
    const problem = (await store.queryDashboard()).problems[0]!;
    await database.problems.put({
      ...problem,
      nextReviewAt: dueLaterToday,
      fsrsCard: problem.fsrsCard ? { ...problem.fsrsCard, due: dueLaterToday } : null,
    });
    const dependencies = createReminderDependencies(store, now);

    await dependencies.reminders.initialize();

    expect(dependencies.notifications.created[0]?.options.message).toContain('今日/逾期 1 题');
    expect(dependencies.badge.text).toBe('');
  });

  it('测试通知只报告 Chrome API 创建成功', async () => {
    const now = Date.UTC(2026, 0, 1, 9);
    const { store } = createStore(now);
    const { reminders, notifications } = createReminderDependencies(store, now);

    const result = await reminders.testNotification();

    expect(result.created).toBe(true);
    expect(result.notificationId).toContain('xiaoshuaji-test:');
    expect(notifications.created[0]?.options.message).toContain('已交给 Chrome');
  });
});

function createStore(now: number | (() => number)) {
  const database = new XiaoshuajiDatabase(`test-background-reminders-${databaseSequence++}`);
  databases.push(database);
  const clock = typeof now === 'number' ? () => now : now;
  return { database, store: new DexieReviewStore({ database, now: clock }) };
}

function acceptedInput(submissionId: string, acceptedAt: number) {
  return { metadata: metadata(), submissionId, trigger: 'button' as const, acceptedAt };
}

function metadata(): ProblemMetadata {
  return {
    problemId: 'leetcode-cn:two-sum', slug: 'two-sum', frontendId: '1', title: '两数之和',
    difficulty: 'EASY', tags: ['数组'], url: 'https://leetcode.cn/problems/two-sum/',
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
  readonly created: { name: string; info: { when: number } }[] = [];
  get() { return Promise.resolve(this.current); }
  clear() { this.current = undefined; return Promise.resolve(true); }
  create(name: string, info: { when: number }) {
    this.current = { scheduledTime: info.when };
    this.created.push({ name, info });
    return Promise.resolve();
  }
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

class MemoryRuntime implements ExtensionRuntimePort {
  readonly openedUrls: string[] = [];
  getUrl(path: string) { return `chrome-extension://test${path}`; }
  openDashboard(url: string) { this.openedUrls.push(url); return Promise.resolve(); }
}

function createReminderDependencies(store: DexieReviewStore, now: number | (() => number)) {
  const clock = typeof now === 'number' ? () => now : now;
  const settings = new ChromeSettingsRepository(new MemoryStorage(), () => 'Asia/Shanghai');
  const alarms = new MemoryAlarms();
  const notifications = new MemoryNotifications();
  const badge = new MemoryBadge();
  const runtime = new MemoryRuntime();
  const reminders = new ReminderCoordinator({
    store, settings, alarms, notifications, badge, runtime, now: clock,
  });
  return { settings, alarms, notifications, badge, runtime, reminders };
}
