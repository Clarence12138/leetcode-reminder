import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_REMINDER_HOUR,
  DEFAULT_REMINDER_MINUTE,
  FSRS_REQUEST_RETENTION,
} from '../domain/constants';
import { settingsSchema, settingsV0Schema } from '../domain/schemas';
import type { AutoGroupRule, ReviewGroup, Settings } from '../domain/types';
import { AppError } from './errors';

export const SETTINGS_STORAGE_KEY = 'settings';
export const LAST_NOTIFICATION_DATE_KEY = 'lastNotificationDate';

export interface LocalStoragePort {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | readonly string[]): Promise<void>;
}

export interface SettingsRepository {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
  replace(settings: Settings): Promise<Settings>;
  reset(): Promise<Settings>;
  ensureCurrentTimezone(): Promise<{ readonly settings: Settings; readonly changed: boolean }>;
  getLastNotificationDate(): Promise<string | null>;
  setLastNotificationDate(date: string): Promise<void>;
}

export class ChromeSettingsRepository implements SettingsRepository {
  constructor(
    private readonly storage: LocalStoragePort,
    private readonly getTimezone: () => string = systemTimezone,
  ) {}

  async get(): Promise<Settings> {
    const stored = await this.storage.get(SETTINGS_STORAGE_KEY);
    const value = stored[SETTINGS_STORAGE_KEY];
    if (value === undefined) {
      const defaults = createDefaultSettings(this.getTimezone());
      await this.storage.set({ [SETTINGS_STORAGE_KEY]: defaults });
      return defaults;
    }
    const parsed = settingsSchema.safeParse(value);
    if (parsed.success) return sanitizeGroupReferences(parsed.data);
    const migrated = migrateSettingsV0(value);
    if (migrated) {
      await this.storage.set({ [SETTINGS_STORAGE_KEY]: migrated });
      return migrated;
    }
    throw new AppError('SETTINGS_CORRUPT', `本地设置损坏：${parsed.error.message}`);
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    assertManagedFields(patch, this.getTimezone());
    const current = await this.get();
    const merged = mergeSettingsPatch(current, patch);
    const settings = settingsSchema.parse(merged);
    assertValidGroupConfig(settings);
    await this.storage.set({ [SETTINGS_STORAGE_KEY]: settings });
    return settings;
  }

  async replace(settings: Settings): Promise<Settings> {
    const parsed = settingsSchema.parse({ ...settings, timezone: this.getTimezone() });
    const normalized = sanitizeGroupReferences(parsed);
    assertUniqueGroupIds(normalized.reviewGroups);
    await this.storage.set({ [SETTINGS_STORAGE_KEY]: normalized });
    return normalized;
  }

  async reset(): Promise<Settings> {
    const defaults = createDefaultSettings(this.getTimezone());
    await this.storage.set({ [SETTINGS_STORAGE_KEY]: defaults });
    await this.storage.remove(LAST_NOTIFICATION_DATE_KEY);
    return defaults;
  }

  async ensureCurrentTimezone() {
    const settings = await this.get();
    const timezone = this.getTimezone();
    if (settings.timezone === timezone) return { settings, changed: false };
    const updated = { ...settings, timezone };
    await this.storage.set({ [SETTINGS_STORAGE_KEY]: updated });
    return { settings: updated, changed: true };
  }

  async getLastNotificationDate(): Promise<string | null> {
    const stored = await this.storage.get(LAST_NOTIFICATION_DATE_KEY);
    const value = stored[LAST_NOTIFICATION_DATE_KEY];
    if (value === undefined) return null;
    if (typeof value !== 'string') {
      throw new AppError('NOTIFICATION_STATE_CORRUPT', '通知幂等状态损坏');
    }
    return value;
  }

  async setLastNotificationDate(date: string): Promise<void> {
    await this.storage.set({ [LAST_NOTIFICATION_DATE_KEY]: date });
  }
}

function migrateSettingsV0(value: unknown): Settings | null {
  const parsed = settingsV0Schema.safeParse(value);
  if (!parsed.success) return null;
  return settingsSchema.parse({
    ...parsed.data,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });
}

export function createDefaultSettings(timezone = systemTimezone()): Settings {
  return {
    notificationsEnabled: true,
    reminderHour: DEFAULT_REMINDER_HOUR,
    reminderMinute: DEFAULT_REMINDER_MINUTE,
    timezone,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    resetCodeOnReview: false,
    dailyReviewLimit: null,
    queueSortStrategy: 'due_asc',
    defaultRequestRetention: FSRS_REQUEST_RETENTION,
    reviewGroups: [],
    autoGroupRules: [],
  };
}

export function systemTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) throw new AppError('TIMEZONE_UNAVAILABLE', '无法读取系统时区');
  return timezone;
}

function assertManagedFields(patch: Partial<Settings>, timezone: string): void {
  if (patch.schemaVersion !== undefined && patch.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new AppError('SCHEMA_VERSION_READONLY', '设置数据版本不可手动修改');
  }
  if (patch.timezone !== undefined && patch.timezone !== timezone) {
    throw new AppError('TIMEZONE_MANAGED', '时区由系统自动管理');
  }
}

function mergeSettingsPatch(current: Settings, patch: Partial<Settings>): Settings {
  const merged: Settings = { ...current, ...patch };
  if (patch.reviewGroups !== undefined && patch.autoGroupRules === undefined) {
    return sanitizeGroupReferences(merged);
  }
  return merged;
}

function sanitizeGroupReferences(settings: Settings): Settings {
  const validGroupIds = new Set(settings.reviewGroups.map((group) => group.id));
  const seenLists = new Set<string>();
  const autoGroupRules: AutoGroupRule[] = [];
  for (const rule of settings.autoGroupRules) {
    if (!validGroupIds.has(rule.groupId) || seenLists.has(rule.listId)) continue;
    seenLists.add(rule.listId);
    autoGroupRules.push(rule);
  }
  return { ...settings, autoGroupRules };
}

function assertValidGroupConfig(settings: Settings): void {
  assertUniqueGroupIds(settings.reviewGroups);
  const validGroupIds = new Set(settings.reviewGroups.map((group) => group.id));
  const seenLists = new Set<string>();
  for (const rule of settings.autoGroupRules) {
    if (!validGroupIds.has(rule.groupId)) {
      throw new AppError('GROUP_NOT_FOUND', `自动归组规则引用了不存在的分组 ${rule.groupId}`);
    }
    if (seenLists.has(rule.listId)) {
      throw new AppError('DUPLICATE_AUTO_GROUP_RULE', `题单 ${rule.listId} 不能配置多条自动归组规则`);
    }
    seenLists.add(rule.listId);
  }
}

function assertUniqueGroupIds(groups: readonly ReviewGroup[]): void {
  const ids = new Set<string>();
  for (const group of groups) {
    if (ids.has(group.id)) {
      throw new AppError('DUPLICATE_GROUP_ID', `分组 ID 重复：${group.id}`);
    }
    ids.add(group.id);
  }
}
