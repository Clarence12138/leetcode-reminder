import type { HistoryFetchProgress, HistoryFetchResult } from '../leetcode/history-fetcher';

export const HISTORY_PORT_NAME = 'xiaoshuaji-leetcode-history';
export const CLOSE_HISTORY_TAB_REQUEST = 'history.close-tab';

export interface HistoryStartMessage {
  readonly type: 'start';
  readonly skipSlugs: readonly string[];
  /** 标签页由扩展临时打开时为 true：面板断开后请求后台关闭该标签页。 */
  readonly temporaryTab: boolean;
}

export type HistoryPortMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'progress'; readonly progress: HistoryFetchProgress }
  | { readonly type: 'done'; readonly result: HistoryFetchResult }
  | { readonly type: 'error'; readonly message: string };

export function isHistoryStartMessage(value: unknown): value is HistoryStartMessage {
  if (typeof value !== 'object' || value === null) return false;
  const skipSlugs: unknown = Reflect.get(value, 'skipSlugs');
  return Reflect.get(value, 'type') === 'start'
    && typeof Reflect.get(value, 'temporaryTab') === 'boolean'
    && Array.isArray(skipSlugs)
    && skipSlugs.every((slug) => typeof slug === 'string');
}

export function isCloseHistoryTabRequest(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Reflect.get(value, 'type') === CLOSE_HISTORY_TAB_REQUEST;
}
