import { LocalBackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { createMessageHandler } from '../src/background/message-handler';
import {
  ReminderCoordinator,
  type NotificationPort,
} from '../src/background/reminders';
import { ChromeSettingsRepository } from '../src/background/settings';
import { DexieReviewStore } from '../src/background/store';

export default defineBackground(() => {
  const database = new XiaoshuajiDatabase();
  const store = new DexieReviewStore({ database });
  const settings = new ChromeSettingsRepository({
    get: (key) => chrome.storage.local.get(key),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove(typeof keys === 'string' ? keys : [...keys]),
  });
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
  const handleMessage = createMessageHandler({ store, settings, backups, reminders });
  const openDashboardAfterNotificationClick = (notificationId: string): void => {
    void reminders.handleNotificationClick(notificationId).catch(reportBackgroundError);
  };

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    void handleMessage(request).then(sendResponse);
    return true;
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    void reminders.handleAlarm(alarm.name).catch(reportBackgroundError);
  });
  chrome.notifications.onClicked.addListener(openDashboardAfterNotificationClick);
  chrome.notifications.onButtonClicked.addListener((notificationId) => {
    openDashboardAfterNotificationClick(notificationId);
  });
  chrome.runtime.onInstalled.addListener(() => {
    void reminders.initialize().catch(reportBackgroundError);
  });
  chrome.runtime.onStartup.addListener(() => {
    void reminders.initialize().catch(reportBackgroundError);
  });

  void reminders.initialize().catch(reportBackgroundError);
});

function reportBackgroundError(error: unknown): void {
  console.error('[小刷记] 后台任务失败', error);
}
