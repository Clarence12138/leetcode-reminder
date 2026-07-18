import { ALARM_NAME, APP_NAME } from '../domain/constants';
import type { Settings } from '../domain/types';
import { AppError } from './errors';
import type { SettingsRepository } from './settings';
import type { AttentionCounts, ReviewStore } from './store';

const ALARM_MATCH_TOLERANCE_MS = 1_000;
const SUMMARY_NOTIFICATION_PREFIX = 'xiaoshuaji-summary:';
const TEST_NOTIFICATION_PREFIX = 'xiaoshuaji-test:';
const DUE_BADGE_COLOR = '#DC2626';
const PENDING_BADGE_COLOR = '#F59E0B';

export interface AlarmPort {
  get(name: string): Promise<{ readonly scheduledTime: number } | undefined>;
  clear(name: string): Promise<boolean>;
  create(name: string, info: { readonly when: number }): Promise<void>;
}

export interface NotificationPort {
  create(
    id: string,
    options: {
      readonly type: 'basic';
      readonly iconUrl: string;
      readonly title: string;
      readonly message: string;
    },
  ): Promise<string>;
}

export interface BadgePort {
  setBadgeText(details: { readonly text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { readonly color: string }): Promise<void>;
  setTitle(details: { readonly title: string }): Promise<void>;
}

export interface ExtensionRuntimePort {
  getUrl(path: string): string;
  openDashboard(url: string): Promise<void>;
}

export interface TestNotificationResult {
  readonly created: true;
  readonly notificationId: string;
}

export interface ReminderCoordinatorOptions {
  readonly store: ReviewStore;
  readonly settings: SettingsRepository;
  readonly alarms: AlarmPort;
  readonly notifications: NotificationPort;
  readonly badge: BadgePort;
  readonly runtime: ExtensionRuntimePort;
  readonly now?: () => number;
}

export class ReminderCoordinator {
  private readonly store: ReviewStore;
  private readonly settings: SettingsRepository;
  private readonly alarms: AlarmPort;
  private readonly notifications: NotificationPort;
  private readonly badge: BadgePort;
  private readonly runtime: ExtensionRuntimePort;
  private readonly now: () => number;

  constructor(options: ReminderCoordinatorOptions) {
    this.store = options.store;
    this.settings = options.settings;
    this.alarms = options.alarms;
    this.notifications = options.notifications;
    this.badge = options.badge;
    this.runtime = options.runtime;
    this.now = options.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    const { settings } = await this.settings.ensureCurrentTimezone();
    let initializationError: unknown;
    try {
      if (hasPassedReminder(this.now(), settings)) {
        await this.createDailySummaryIfNeeded(settings);
      }
      await this.refreshBadge();
    } catch (error) {
      initializationError = error;
    }
    await this.rescheduleAfterTask(settings, initializationError);
  }

  async settingsChanged(settings: Settings): Promise<void> {
    await this.ensureAlarm(settings, true);
  }

  async handleAlarm(name: string): Promise<void> {
    if (name !== ALARM_NAME) return;
    const { settings } = await this.settings.ensureCurrentTimezone();
    let taskError: unknown;
    try {
      await this.createDailySummaryIfNeeded(settings);
      await this.refreshBadge();
    } catch (error) {
      taskError = error;
    }

    await this.rescheduleAfterTask(settings, taskError, true);
  }

  async handleNotificationClick(notificationId: string): Promise<void> {
    if (!notificationId.startsWith(SUMMARY_NOTIFICATION_PREFIX)) return;
    await this.runtime.openDashboard(this.runtime.getUrl('/dashboard.html#queue'));
  }

  async refreshBadge(): Promise<void> {
    const counts = await this.store.getAttentionCounts();
    const total = counts.due + counts.pending;
    await this.badge.setBadgeText({ text: total === 0 ? '' : String(total) });
    if (total > 0) {
      await this.badge.setBadgeBackgroundColor({
        color: counts.due > 0 ? DUE_BADGE_COLOR : PENDING_BADGE_COLOR,
      });
    }
    await this.badge.setTitle({ title: badgeTitle(counts) });
  }

  async testNotification(): Promise<TestNotificationResult> {
    const notificationId = `${TEST_NOTIFICATION_PREFIX}${this.now()}`;
    const createdId = await this.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: this.runtime.getUrl('/icons/icon-128.png'),
      title: `${APP_NAME}：测试通知`,
      message: '通知已交给 Chrome；是否显示由操作系统通知设置决定。',
    });
    return { created: true, notificationId: createdId };
  }

  private async createDailySummaryIfNeeded(settings: Settings): Promise<void> {
    if (!settings.notificationsEnabled) return;
    const date = localDateKey(new Date(this.now()));
    if ((await this.settings.getLastNotificationDate()) === date) return;
    const counts = await this.store.getAttentionCounts(endOfLocalDay(this.now()));
    if (counts.due + counts.pending === 0) return;

    await this.notifications.create(`${SUMMARY_NOTIFICATION_PREFIX}${date}`, {
      type: 'basic',
      iconUrl: this.runtime.getUrl('/icons/icon-128.png'),
      title: APP_NAME,
      message: `今日/逾期 ${counts.due} 题、待评估 ${counts.pending} 条`,
    });
    await this.settings.setLastNotificationDate(date);
  }

  private async ensureAlarm(settings: Settings, force = false): Promise<void> {
    const expected = nextReminderTime(this.now(), settings).getTime();
    const alarm = await this.alarms.get(ALARM_NAME);
    const matches =
      alarm !== undefined && Math.abs(alarm.scheduledTime - expected) <= ALARM_MATCH_TOLERANCE_MS;
    if (!force && matches) return;
    if (alarm) await this.alarms.clear(ALARM_NAME);
    await this.alarms.create(ALARM_NAME, { when: expected });
  }

  private async rescheduleAfterTask(
    settings: Settings,
    taskError: unknown,
    force = false,
  ): Promise<void> {
    try {
      await this.ensureAlarm(settings, force);
    } catch (alarmError) {
      if (taskError !== undefined) {
        throw new AppError(
          'DAILY_TASK_AND_ALARM_FAILED',
          `每日任务失败：${errorMessage(taskError)}；重建闹钟失败：${errorMessage(alarmError)}`,
        );
      }
      throw alarmError;
    }
    if (taskError instanceof Error) throw taskError;
    if (taskError !== undefined) {
      throw new AppError('DAILY_TASK_FAILED', `每日任务失败：${errorMessage(taskError)}`);
    }
  }
}

export function nextReminderTime(now: number, settings: Pick<Settings, 'reminderHour' | 'reminderMinute'>): Date {
  const next = new Date(now);
  next.setHours(settings.reminderHour, settings.reminderMinute, 0, 0);
  if (next.getTime() <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function localDateKey(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function endOfLocalDay(now: number): number {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

function hasPassedReminder(now: number, settings: Settings): boolean {
  const reminder = new Date(now);
  reminder.setHours(settings.reminderHour, settings.reminderMinute, 0, 0);
  return now >= reminder.getTime();
}

function badgeTitle(counts: AttentionCounts): string {
  if (counts.due + counts.pending === 0) return APP_NAME;
  return `${APP_NAME}：${counts.due} 题待复习，${counts.pending} 条待评估`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
