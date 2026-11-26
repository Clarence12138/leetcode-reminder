import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailySummary, Settings } from '../../src/domain/types';
import { sendExtensionRequest } from '../../src/shared/messaging';

export interface DashboardData {
  readonly settings: Settings;
  readonly summary: DailySummary;
}

export interface DashboardDataState {
  readonly data: DashboardData | null;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
}

/** 页面从隐藏变回可见时，距上次拉取超过这个间隔就重新拉（跨午夜后“今日”会变）。 */
export const VISIBILITY_REFRESH_MS = 60_000;

export function useDashboardData(): DashboardDataState {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastFetchedAt = useRef(0);
  const refresh = useCallback(async (): Promise<void> => {
    lastFetchedAt.current = Date.now();
    try {
      setData(await fetchDashboardData());
      setError(null);
    } catch (cause) {
      setError(toLoadError(cause));
    }
  }, []);

  useEffect(() => {
    let active = true;
    lastFetchedAt.current = Date.now();
    void fetchDashboardData().then(
      (result) => { if (active) { setData(result); setError(null); } },
      (cause: unknown) => { if (active) setError(toLoadError(cause)); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchedAt.current < VISIBILITY_REFRESH_MS) return;
      void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refresh]);
  return { data, error, refresh };
}

async function fetchDashboardData(): Promise<DashboardData> {
  const [summary, settings] = await Promise.all([
    sendExtensionRequest({ type: 'dashboard.query' }),
    sendExtensionRequest({ type: 'settings.get' }),
  ]);
  return { settings, summary };
}

function toLoadError(cause: unknown): string {
  return cause instanceof Error ? cause.message : '无法读取复习面板数据';
}
