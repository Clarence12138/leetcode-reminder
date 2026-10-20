import type { HistoryFetchProgress, HistoryFetchResult } from '../../src/leetcode/history-fetcher';
import { abortableDelay } from '../../src/shared/abortable-delay';
import { HISTORY_PORT_NAME, type HistoryPortMessage } from '../../src/shared/history-port';

const LEETCODE_ENTRY_URL = 'https://leetcode.cn/problemset/';
const CONNECT_ATTEMPTS = 40;
const CONNECT_RETRY_MS = 750;
const READY_TIMEOUT_MS = 1_500;

export interface LeetCodeHistoryRequest {
  readonly skipSlugs: readonly string[];
  readonly signal: AbortSignal;
  readonly onProgress: (progress: HistoryFetchProgress) => void;
}

/** 临时打开一个力扣后台标签页，借助页面内脚本读取做题记录，完成后关闭该标签页。 */
export async function fetchHistoryFromLeetCode(request: LeetCodeHistoryRequest): Promise<HistoryFetchResult> {
  request.signal.throwIfAborted();
  const tab = await chrome.tabs.create({ url: LEETCODE_ENTRY_URL, active: false });
  const tabId = tab.id;
  if (tabId === undefined) throw new Error('无法打开力扣页面。');
  try {
    const port = await connectWhenReady(tabId, request.signal);
    return await runImport(port, request);
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function connectWhenReady(tabId: number, signal: AbortSignal): Promise<chrome.runtime.Port> {
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    const port = await tryConnect(tabId);
    if (port && signal.aborted) port.disconnect();
    signal.throwIfAborted();
    if (port) return port;
    await abortableDelay(CONNECT_RETRY_MS, signal);
  }
  throw new Error('力扣页面加载超时，请检查网络后重试。');
}

function tryConnect(tabId: number): Promise<chrome.runtime.Port | null> {
  return new Promise((resolve) => {
    const port = chrome.tabs.connect(tabId, { name: HISTORY_PORT_NAME });
    const fail = (): void => {
      // 读取 lastError，避免页面脚本尚未就绪时控制台出现未处理的连接错误。
      void chrome.runtime.lastError;
      clearTimeout(timer);
      port.disconnect();
      resolve(null);
    };
    const timer = setTimeout(fail, READY_TIMEOUT_MS);
    port.onDisconnect.addListener(fail);
    port.onMessage.addListener(function onReady(message: HistoryPortMessage) {
      if (message.type !== 'ready') return;
      clearTimeout(timer);
      port.onDisconnect.removeListener(fail);
      port.onMessage.removeListener(onReady);
      resolve(port);
    });
  });
}

function runImport(port: chrome.runtime.Port, request: LeetCodeHistoryRequest): Promise<HistoryFetchResult> {
  return new Promise((resolve, reject) => {
    const finish = (settle: () => void): void => {
      request.signal.removeEventListener('abort', abort);
      port.disconnect();
      settle();
    };
    const abort = (): void => finish(() => reject(request.signal.reason as Error));
    request.signal.addEventListener('abort', abort, { once: true });
    port.onDisconnect.addListener(() => finish(() => reject(new Error('力扣页面已关闭，导入中断。'))));
    port.onMessage.addListener((message: HistoryPortMessage) => {
      if (message.type === 'progress') request.onProgress(message.progress);
      if (message.type === 'error') finish(() => reject(new Error(message.message)));
      if (message.type === 'done') finish(() => resolve(message.result));
    });
    if (request.signal.aborted) {
      abort();
      return;
    }
    port.postMessage({ type: 'start', skipSlugs: request.skipSlugs, temporaryTab: true });
  });
}
