import { createContext, useEffect, useRef, useState } from 'react';
import { HISTORY_IMPORT_STATE_KEY, type HistoryImportState } from '../../src/shared/history-import-state';

export const HistoryImportContext = createContext<HistoryImportState>({ status: 'idle' });

export function useHistoryImport(refresh: () => Promise<void>): HistoryImportState {
  const [state, setState] = useState<HistoryImportState>({ status: 'idle' });
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    let active = true;
    let changed = false;
    let previous: HistoryImportState = { status: 'idle' };
    const accept = (next: HistoryImportState): void => {
      if (!active) return;
      if (previous.status === 'running' && next.status === 'done' && next.result && next.result.importedProblems > 0) {
        void refreshRef.current().catch(console.error);
      }
      previous = next;
      setState(next);
    };
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area !== 'session' || !changes[HISTORY_IMPORT_STATE_KEY]) return;
      changed = true;
      accept((changes[HISTORY_IMPORT_STATE_KEY].newValue as HistoryImportState | undefined) ?? { status: 'idle' });
    };
    chrome.storage.onChanged.addListener(listener);
    void chrome.storage.session.get(HISTORY_IMPORT_STATE_KEY).then((items) => {
      if (!changed) accept((items[HISTORY_IMPORT_STATE_KEY] as HistoryImportState | undefined) ?? { status: 'idle' });
    }).catch(console.error);
    return () => { active = false; chrome.storage.onChanged.removeListener(listener); };
  }, []);
  return state;
}
