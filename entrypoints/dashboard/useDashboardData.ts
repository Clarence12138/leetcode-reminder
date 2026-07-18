import { useCallback, useEffect, useState } from 'react';
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

export function useDashboardData(): DashboardDataState {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async (): Promise<void> => {
    try {
      setData(await fetchDashboardData());
      setError(null);
    } catch (cause) {
      setError(toLoadError(cause));
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchDashboardData().then(
      (result) => { if (active) { setData(result); setError(null); } },
      (cause: unknown) => { if (active) setError(toLoadError(cause)); },
    );
    return () => { active = false; };
  }, []);
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
