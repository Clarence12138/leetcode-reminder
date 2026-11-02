import type { HistoryFetchProgress, HistoryFetchResult } from '../leetcode/history-fetcher';
import { abortableDelay } from '../shared/abortable-delay';
import { HISTORY_PORT_NAME, type HistoryPortMessage } from '../shared/history-port';

const LEETCODE_ENTRY_URL = 'https://leetcode.cn/problemset/';
const CONNECT_ATTEMPTS = 40;
const CONNECT_RETRY_MS = 750;
const READY_TIMEOUT_MS = 1_500;

export interface LeetCodeHistoryRequest {
  readonly onTab: (tabId: number) => Promise<void>;
  readonly skipSlugs: readonly string[];
  readonly signal: AbortSignal;
  readonly onProgress: (progress: HistoryFetchProgress) => void;
}

/** 临时打开一个力扣后台标签页，借助页面内脚本读取做题记录，完成后关闭该标签页。 */
export async function fetchHistoryFromLeetCode(request: LeetCodeHistoryRequest, tabs: Pick<typeof chrome.tabs, 'create' | 'remove' | 'connect'>): Promise<HistoryFetchResult> {
  request.signal.throwIfAborted();
  const tab = await tabs.create({ url: LEETCODE_ENTRY_URL, active: false });
  const tabId = tab.id;
  if (tabId === undefined) throw new Error('无法打开力扣页面。');
  try {
    await request.onTab(tabId);
    request.signal.throwIfAborted();
    const port = await connectWhenReady(tabId, request.signal, tabs);
    return await runImport(port, request);
  } finally {
    await tabs.remove(tabId).catch(() => undefined);
  }
}

async function connectWhenReady(tabId: number, signal: AbortSignal, tabs: Pick<typeof chrome.tabs, 'connect'>): Promise<chrome.runtime.Port> {
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    const port = await tryConnect(tabId, tabs);
    if (port && signal.aborted) port.disconnect();
    signal.throwIfAborted();
    if (port) return port;
    await abortableDelay(CONNECT_RETRY_MS, signal);
  }
  throw new Error('力扣页面加载超时，请检查网络后重试。');
}

function tryConnect(tabId: number, tabs: Pick<typeof chrome.tabs, 'connect'>): Promise<chrome.runtime.Port | null> {
  return new Promise((resolve) => {
    const port = tabs.connect(tabId, { name: HISTORY_PORT_NAME });
    const fail = (): void => {
      // 读取 lastError，避免页面脚本尚未就绪时控制台出现未处理的连接错误。
      void chrome.runtime.lastError;
      clearTimeout(timer);
      port.onDisconnect.removeListener(fail);
      port.onMessage.removeListener(onReady);
      port.disconnect();
      resolve(null);
    };
    const timer = setTimeout(fail, READY_TIMEOUT_MS);
    port.onDisconnect.addListener(fail);
    function onReady(message: HistoryPortMessage): void {
      if (message.type !== 'ready') return;
      clearTimeout(timer);
      port.onDisconnect.removeListener(fail);
      port.onMessage.removeListener(onReady);
      resolve(port);
    }
    port.onMessage.addListener(onReady);
  });
}

function runImport(port: chrome.runtime.Port, request: LeetCodeHistoryRequest): Promise<HistoryFetchResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
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
