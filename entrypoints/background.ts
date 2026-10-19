import { LocalBackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { createMessageHandler } from '../src/background/message-handler';
import { ChromeDataMirror, type MirrorInitializeResult } from '../src/background/mirror';
import {
  ReminderCoordinator,
  type NotificationPort,
} from '../src/background/reminders';
import { ChromeSettingsRepository, type LocalStoragePort } from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';

export default defineBackground(() => {
  const database = new XiaoshuajiDatabase();
  const store = new DexieReviewStore({ database });
  const localStoragePort = createChromeLocalStorage();
  const settings = new ChromeSettingsRepository(localStoragePort);
  const mirror = new ChromeDataMirror(store, localStoragePort);
  const reminders = new ReminderCoordinator({
    store,
    settings,
    alarms: chrome.alarms,
    notifications: chrome.notifications as NotificationPort,
    badge: chrome.action,
    runtime: {
      getUrl: (path) => chrome.runtime.getURL(path),
      openDashboard: async (url) => {
        await chrome.tabs.create({ url });
      },
    },
  });
  const backups = new LocalBackupManager(store, settings);
  const handleMessage = createMessageHandler({ store, settings, backups, reminders, mirror });
  // 恢复检查完成前不处理任何读写，避免新数据抢先写入导致跳过恢复。
  const ready = mirror.initialize().then(reportMirrorResult, reportBackgroundError);
  const afterReady = (task: () => Promise<unknown>): void => {
    void ready.then(task).catch(reportBackgroundError);
  };
  const openDashboardAfterNotificationClick = (notificationId: string): void => {
    afterReady(() => reminders.handleNotificationClick(notificationId));
  };

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    void ready.then(() => handleMessage(request)).then(sendResponse);
    return true;
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    afterReady(() => reminders.handleAlarm(alarm.name));
  });
  chrome.notifications.onClicked.addListener(openDashboardAfterNotificationClick);
  chrome.notifications.onButtonClicked.addListener((notificationId) => {
    openDashboardAfterNotificationClick(notificationId);
  });
  chrome.runtime.onInstalled.addListener(() => {
    afterReady(() => reminders.initialize());
  });
  chrome.runtime.onStartup.addListener(() => {
    afterReady(() => reminders.initialize());
  });

  afterReady(() => reminders.initialize());
});

function createChromeLocalStorage(): LocalStoragePort {
  return {
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(typeof keys === 'string' ? keys : [...keys]),
  };
}

function reportMirrorResult(result: MirrorInitializeResult): void {
  if (result.status !== 'restored') return;
  console.warn(
    `[小刷记] IndexedDB 数据缺失，已从本地镜像恢复 ${result.problemCount} 道题（镜像时间 ${new Date(result.savedAt).toISOString()}）`,
  );
}

function reportBackgroundError(error: unknown): void {
  console.error('[小刷记] 后台任务失败', error);
}
