import {
  CLOSE_HISTORY_TAB_REQUEST,
  HISTORY_PORT_NAME,
  isHistoryStartMessage,
  type HistoryPortMessage,
} from '../shared/history-port';
import type { LeetCodeHistoryClient } from './history-client';
import { fetchLeetCodeHistory } from './history-fetcher';

/** 在力扣页面内响应扩展面板的读取请求；面板断开连接即取消。 */
export function serveHistoryPort(port: chrome.runtime.Port, client: LeetCodeHistoryClient): void {
  if (port.name !== HISTORY_PORT_NAME) return;
  const controller = new AbortController();
  let temporaryTab = false;
  const post = (message: HistoryPortMessage): void => {
    if (!controller.signal.aborted) port.postMessage(message);
  };
  port.onDisconnect.addListener(() => {
    controller.abort();
    // 面板被关闭时它无法再清理临时标签页，由页面自己请求后台关闭。
    if (temporaryTab) void chrome.runtime.sendMessage({ type: CLOSE_HISTORY_TAB_REQUEST }).catch(() => undefined);
  });
  port.onMessage.addListener((message: unknown) => {
    if (!isHistoryStartMessage(message)) return;
    temporaryTab = message.temporaryTab;
    void fetchLeetCodeHistory(client, {
      skipSlugs: new Set(message.skipSlugs),
      signal: controller.signal,
      onProgress: (progress) => post({ type: 'progress', progress }),
    })
      .then((result) => post({ type: 'done', result }))
      .catch((error: unknown) => post({ type: 'error', message: errorMessage(error) }));
  });
  post({ type: 'ready' });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
