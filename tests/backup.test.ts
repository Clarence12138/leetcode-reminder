import { afterEach, describe, expect, it } from 'vitest';

import { LocalBackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import {
  ChromeSettingsRepository,
  type LocalStoragePort,
  type SettingsRepository,
} from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';
import type { BackupV1, ProblemMetadata, Settings } from '../src/domain/types';

const NOW = Date.UTC(2026, 0, 10, 9);
let sequence = 0;
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('版本化备份', () => {
  it('导出 xiaoshuaji-backup/v1 并在导入时重建派生 FSRS 状态', async () => {
    const source = createContext('source');
    await source.store.recordAccepted(acceptedInput('100'));
    await source.store.rateSubmission('100', 'GOOD');
    const backup = await source.manager.export();
    const tampered = tamperDerivedState(backup);
    const target = createContext('target');

    await target.manager.import(tampered, 'replace');
    const restored = await target.manager.export();

    expect(restored.format).toBe('xiaoshuaji-backup/v1');
    expect(restored.problems[0]?.fsrsCard?.due).not.toBe(1);
    expect(restored.submissions[0]?.fsrsLog?.due).not.toBe(1);
    expect(restored.submissions[0]?.rating).toBe('GOOD');
  });

  it('合并时跳过内容相同的 submissionId', async () => {
    const source = createContext('source');
    await source.store.recordAccepted(acceptedInput('100'));
    const backup = await source.manager.export();
    const target = createContext('target');

    await target.manager.import(backup, 'merge');
    await target.manager.import(backup, 'merge');

    expect((await target.manager.export()).submissions).toHaveLength(1);
  });

  it('合并发现同 submissionId 内容冲突时中止且不写入', async () => {
    const source = createContext('source');
    await source.store.recordAccepted(acceptedInput('100', NOW));
    const backup = await source.manager.export();
    const target = createContext('target');
    await target.store.recordAccepted(acceptedInput('100', NOW + 1_000));
    const before = await target.store.getSnapshot();

    await expect(target.manager.import(backup, 'merge')).rejects.toMatchObject({
      code: 'BACKUP_CONFLICT',
    });
    expect(await target.store.getSnapshot()).toEqual(before);
  });

  it('损坏备份在完整校验前不会产生部分写入', async () => {
    const target = createContext('target');
    await target.store.recordAccepted(acceptedInput('local'));
    const before = await target.store.getSnapshot();
    const corrupted = {
      format: 'xiaoshuaji-backup/v1',
      exportedAt: new Date(NOW).toISOString(),
      schemaVersion: 1,
      settings: await target.settings.get(),
      problems: [{ problemId: 'missing-fields' }],
      submissions: [],
      issues: [],
    };

    await expect(target.manager.import(corrupted, 'replace')).rejects.toBeTruthy();
    expect(await target.store.getSnapshot()).toEqual(before);
  });

  it('拒绝伪造成其他站点的备份题目链接', async () => {
    const source = createContext('source');
    await source.store.recordAccepted(acceptedInput('100'));
    const backup = await source.manager.export();
    const forged: BackupV1 = {
      ...backup,
      problems: backup.problems.map((problem) => ({
        ...problem,
        url: 'https://example.com/problems/two-sum/',
      })),
    };
    const target = createContext('target');

    await expect(target.manager.import(forged, 'replace')).rejects.toMatchObject({
      code: 'BACKUP_INVALID',
    });
    expect((await target.store.getSnapshot()).problems).toHaveLength(0);
  });

  it('设置写入失败时显式报错并回滚 IndexedDB', async () => {
    const source = createContext('source');
    await source.store.recordAccepted(acceptedInput('remote'));
    const backup = await source.manager.export();
    const target = createContext('target');
    await target.store.recordAccepted(
      acceptedInput('local', NOW, metadata('three-sum', '15', '三数之和')),
    );
    const before = await target.store.getSnapshot();
    const failing = new FailingReplaceSettings(target.settings);
    const manager = new LocalBackupManager(target.store, failing, () => NOW);

    await expect(manager.import(backup, 'replace')).rejects.toMatchObject({
      code: 'BACKUP_SETTINGS_WRITE_FAILED',
    });
    expect(await target.store.getSnapshot()).toEqual(before);
  });
});

function createContext(label: string) {
  const database = new XiaoshuajiDatabase(`test-backup-${label}-${sequence++}`);
  databases.push(database);
  const store = new DexieReviewStore({ database, now: () => NOW });
  const settings = new ChromeSettingsRepository(new MemoryStorage(), () => 'Asia/Shanghai');
  const manager = new LocalBackupManager(store, settings, () => NOW);
  return { store, settings, manager };
}

function metadata(slug = 'two-sum', frontendId = '1', title = '两数之和'): ProblemMetadata {
  return {
    problemId: `leetcode-cn:${slug}`,
    slug,
    frontendId,
    title,
    difficulty: 'EASY',
    tags: ['数组'],
    url: `https://leetcode.cn/problems/${slug}/`,
  };
}

function acceptedInput(
  submissionId: string,
  acceptedAt = NOW,
  problemMetadata = metadata(),
) {
  return { metadata: problemMetadata, submissionId, trigger: 'button' as const, acceptedAt };
}

function tamperDerivedState(backup: BackupV1): BackupV1 {
  return {
    ...backup,
    problems: backup.problems.map((problem) => ({
      ...problem,
      nextReviewAt: 1,
      fsrsCard: problem.fsrsCard ? { ...problem.fsrsCard, due: 1 } : null,
    })),
    submissions: backup.submissions.map((review) => ({
      ...review,
      fsrsLog: review.fsrsLog ? { ...review.fsrsLog, due: 1 } : null,
    })),
  };
}

class MemoryStorage implements LocalStoragePort {
  private readonly values: Record<string, unknown> = {};

  get(key: string) {
    return Promise.resolve(key in this.values ? { [key]: this.values[key] } : {});
  }

  set(items: Record<string, unknown>) {
    Object.assign(this.values, items);
    return Promise.resolve();
  }

  remove(keys: string | readonly string[]) {
    for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];
    return Promise.resolve();
  }
}

class FailingReplaceSettings implements SettingsRepository {
  constructor(private readonly delegate: SettingsRepository) {}

  get() { return this.delegate.get(); }
  update(patch: Partial<Settings>) { return this.delegate.update(patch); }
  reset() { return this.delegate.reset(); }
  ensureCurrentTimezone() { return this.delegate.ensureCurrentTimezone(); }
  getLastNotificationDate() { return this.delegate.getLastNotificationDate(); }
  setLastNotificationDate(date: string) { return this.delegate.setLastNotificationDate(date); }
  replace(): Promise<Settings> { return Promise.reject(new Error('存储写入失败')); }
}
