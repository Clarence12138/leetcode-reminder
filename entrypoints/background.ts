import { LocalBackupManager } from '../src/background/backup';
import { XiaoshuajiDatabase } from '../src/background/database';
import { HistoryImportJob } from '../src/background/history-import-job';
import { fetchHistoryFromLeetCode } from '../src/background/leetcode-history';
import { createMessageHandler } from '../src/background/message-handler';
import { ChromeDataMirror, type MirrorInitializeResult } from '../src/background/mirror';
import {
  ReminderCoordinator,
  type NotificationPort,
} from '../src/background/reminders';
import { ChromeSettingsRepository, type LocalStoragePort } from '../src/background/settings';
import { DexieReviewStore, type ReviewStore } from '../src/background/store';
import type { ExtensionResponse } from '../src/domain/messages';
import type { HistoryImportResult } from '../src/domain/types';
import { isCloseHistoryTabRequest } from '../src/shared/history-port';

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
  const services = { store, settings, backups, reminders, mirror };
  const historyJob = createHistoryJob(store, createMessageHandler(services));
  const handleMessage = createMessageHandler({ ...services, historyJob });
  // 恢复检查完成前不处理任何读写，避免新数据抢先写入导致跳过恢复。
  const ready = prepareBackground(mirror, historyJob);
  const afterReady = (task: () => Promise<unknown>): void => {
    void ready.then(task).catch(reportBackgroundError);
  };
  const openDashboardAfterNotificationClick = (notificationId: string): void => {
    afterReady(() => reminders.handleNotificationClick(notificationId));
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (isCloseHistoryTabRequest(request)) return closeSenderTab(sender);
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

/** 镜像恢复后再收尾上次中断的导入；失败只记录，ready 不能 reject，否则所有消息都会无响应。 */
function prepareBackground(mirror: ChromeDataMirror, historyJob: HistoryImportJob): Promise<void> {
  return mirror.initialize()
    .then(reportMirrorResult, reportBackgroundError)
    .then(() => historyJob.recover())
    .catch(reportBackgroundError);
}

function createHistoryJob(store: ReviewStore, handleMessage: (request: unknown) => Promise<ExtensionResponse>): HistoryImportJob {
  return new HistoryImportJob({
    storage: chrome.storage.session,
    skipSlugs: async () => (await store.getSnapshot()).problems.map((problem) => problem.slug),
    fetch: (request) => fetchHistoryFromLeetCode(request, chrome.tabs),
    closeTab: (id) => chrome.tabs.remove(id),
    commit: async (problems, rating) => {
      const response = await handleMessage({ type: 'history.import', payload: { problems, rating } });
      if (!response.ok) throw new Error(response.error.message);
      return response.data as HistoryImportResult;
    },
  });
}

/** 导入用的临时力扣标签页在后台连接断开后请求关闭自己。 */
function closeSenderTab(sender: chrome.runtime.MessageSender): false {
  const tabId = sender.tab?.id;
  if (tabId !== undefined) void chrome.tabs.remove(tabId).catch(() => undefined);
  return false;
}

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
