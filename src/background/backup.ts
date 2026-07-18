import { BACKUP_FORMAT, CURRENT_SCHEMA_VERSION } from '../domain/constants';
import { backupV1Schema, parseBackup } from '../domain/schemas';
import type { BackupV1 } from '../domain/types';
import { AppError } from './errors';
import type { SettingsRepository } from './settings';
import type { PersistedSnapshot } from './store-import';
import type { ReviewStore } from './store';

export interface BackupManager {
  export(): Promise<BackupV1>;
  import(input: unknown, mode: 'merge' | 'replace'): Promise<BackupV1>;
}

export class LocalBackupManager implements BackupManager {
  constructor(
    private readonly store: ReviewStore,
    private readonly settings: SettingsRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async export(): Promise<BackupV1> {
    const [snapshot, settings] = await Promise.all([
      this.store.getSnapshot(),
      this.settings.get(),
    ]);
    const backup: BackupV1 = {
      format: BACKUP_FORMAT,
      exportedAt: new Date(this.now()).toISOString(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings,
      ...snapshot,
    };
    return backupV1Schema.parse(backup);
  }

  async import(input: unknown, mode: 'merge' | 'replace'): Promise<BackupV1> {
    const backup = parseBackup(input);
    const original = await this.store.getSnapshot();
    await this.store.importSnapshot(toSnapshot(backup), mode);

    try {
      await this.settings.replace(backup.settings);
    } catch (error) {
      await this.rollbackData(original, error);
    }
    return this.export();
  }

  private async rollbackData(original: PersistedSnapshot, settingsError: unknown): Promise<never> {
    try {
      await this.store.importSnapshot(original, 'replace');
    } catch (rollbackError) {
      throw new AppError(
        'BACKUP_ROLLBACK_FAILED',
        `写入设置失败，且数据回滚失败：${errorMessage(settingsError)}；${errorMessage(rollbackError)}`,
      );
    }
    throw new AppError(
      'BACKUP_SETTINGS_WRITE_FAILED',
      `写入设置失败，已回滚题目数据：${errorMessage(settingsError)}`,
    );
  }
}

function toSnapshot(backup: BackupV1): PersistedSnapshot {
  return {
    problems: backup.problems,
    submissions: backup.submissions,
    issues: backup.issues,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
