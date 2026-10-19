import { afterEach, describe, expect, it } from 'vitest';

import type { BackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { createMessageHandler } from '../src/background/message-handler';
import { ChromeDataMirror, DATA_MIRROR_STORAGE_KEY } from '../src/background/mirror';
import type { ReminderCoordinator } from '../src/background/reminders';
import { ChromeSettingsRepository, type LocalStoragePort } from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';
import type { ProblemMetadata } from '../src/domain/types';

const NOW = Date.UTC(2026, 0, 10, 9);
let sequence = 0;
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('本地数据镜像', () => {
  it('IndexedDB 被清空后从镜像恢复评分与排期', async () => {
    const storage = new MemoryStorage();
    const before = createContext(storage);
    await before.store.recordAccepted(acceptedInput('100'));
    await before.store.rateSubmission('100', 'GOOD');
    await before.mirror.sync();
    const original = await before.store.getSnapshot();

    const after = createContext(storage);
    await expect(after.mirror.initialize()).resolves.toEqual({
      status: 'restored',
      problemCount: 1,
      savedAt: NOW,
    });

    const restored = await after.store.getSnapshot();
    expect(restored.submissions[0]?.rating).toBe('GOOD');
    expect(restored.problems[0]?.nextReviewAt).toBe(original.problems[0]?.nextReviewAt);
  });

  it('已有数据时启动只刷新镜像，不覆盖本地数据', async () => {
    const storage = new MemoryStorage();
    const context = createContext(storage);
    await context.store.recordAccepted(acceptedInput('100'));

    await expect(context.mirror.initialize()).resolves.toEqual({ status: 'refreshed' });
    expect(mirrorOf(storage)).toMatchObject({ problems: [{ slug: 'two-sum' }] });
  });

  it('数据库与镜像都为空时不做任何恢复', async () => {
    const context = createContext(new MemoryStorage());

    await expect(context.mirror.initialize()).resolves.toEqual({ status: 'empty' });
  });

  it('用户主动清空数据后不会被镜像复活', async () => {
    const storage = new MemoryStorage();
    const before = createContext(storage);
    await before.handle({ type: 'submission.accepted', payload: acceptedInput('100') });
    expect(mirrorOf(storage)).toMatchObject({ problems: [{ slug: 'two-sum' }] });

    await expect(before.handle({ type: 'data.clear' })).resolves.toEqual({ ok: true });

    const after = createContext(storage);
    await expect(after.mirror.initialize()).resolves.toEqual({ status: 'empty' });
    expect((await after.store.getSnapshot()).problems).toHaveLength(0);
  });

  it('只读请求不写镜像', async () => {
    const storage = new MemoryStorage();
    const context = createContext(storage);

    await context.handle({ type: 'dashboard.query' });

    expect(mirrorOf(storage)).toBeUndefined();
  });

  it('镜像损坏时报错并停止覆盖镜像', async () => {
    const storage = new MemoryStorage();
    await storage.set({ [DATA_MIRROR_STORAGE_KEY]: { format: 'xiaoshuaji-mirror/v1', broken: true } });
    const context = createContext(storage);

    await expect(context.mirror.initialize()).rejects.toMatchObject({ code: 'MIRROR_INVALID' });
    await context.store.recordAccepted(acceptedInput('100'));
    await context.mirror.sync();

    expect(mirrorOf(storage)).toEqual({ format: 'xiaoshuaji-mirror/v1', broken: true });
  });
});

function createContext(storage: MemoryStorage) {
  const database = new XiaoshuajiDatabase(`test-mirror-${sequence++}`);
  databases.push(database);
  const store = new DexieReviewStore({ database, now: () => NOW });
  const settings = new ChromeSettingsRepository(storage, () => 'Asia/Shanghai');
  const mirror = new ChromeDataMirror(store, storage, () => NOW);
  const handle = createMessageHandler({
    store,
    settings,
    backups: {} as BackupManager,
    reminders: {
      refreshBadge: async () => undefined,
      initialize: async () => undefined,
    } as unknown as ReminderCoordinator,
    mirror,
  });
  return { store, mirror, handle };
}

function mirrorOf(storage: MemoryStorage): unknown {
  return storage.peek(DATA_MIRROR_STORAGE_KEY);
}

function metadata(slug = 'two-sum'): ProblemMetadata {
  return {
    problemId: `leetcode-cn:${slug}`,
    slug,
    frontendId: '1',
    title: '两数之和',
    difficulty: 'EASY',
    tags: ['数组'],
    url: `https://leetcode.cn/problems/${slug}/`,
  };
}

function acceptedInput(submissionId: string) {
  return { metadata: metadata(), submissionId, trigger: 'button' as const, acceptedAt: NOW };
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
