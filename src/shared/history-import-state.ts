import type { HistoryImportResult, HistoryRatingMode } from '../domain/types';
import type { HistoryFetchResult } from '../leetcode/history-fetcher';

export const HISTORY_IMPORT_STATE_KEY = 'historyImportState';
export type HistoryImportState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly phase: 'opening' | 'problems' | 'submissions' | 'committing'; readonly done: number; readonly total: number; readonly tabId: number | null; readonly startedAt: number }
  | { readonly status: 'done'; readonly fetched: Omit<HistoryFetchResult, 'problems'>; readonly result: HistoryImportResult | null; readonly rating: HistoryRatingMode }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'cancelled' };
