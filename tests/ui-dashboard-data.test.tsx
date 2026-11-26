import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDashboardData, VISIBILITY_REFRESH_MS } from '../entrypoints/dashboard/useDashboardData';
import { installChromeMock, settings, summary } from './ui-fixtures';

describe('useDashboardData 可见性刷新', () => {
  const sendMessage = vi.fn();
  const queries = () => sendMessage.mock.calls.filter(([request]) => request.type === 'dashboard.query').length;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    sendMessage.mockImplementation((request: { readonly type: string }) => Promise.resolve({
      ok: true,
      data: request.type === 'settings.get' ? settings : summary,
    }));
    installChromeMock(sendMessage);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  const becomeVisible = (): void => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('隐藏后变回可见：超过 60 秒才重新拉取，节流内不拉，卸载后移除监听', async () => {
    const { unmount } = renderHook(() => useDashboardData());
    await waitFor(() => expect(queries()).toBe(1));

    vi.setSystemTime(Date.now() + 10_000);
    act(() => becomeVisible());
    expect(queries()).toBe(1);

    vi.setSystemTime(Date.now() + VISIBILITY_REFRESH_MS);
    act(() => becomeVisible());
    await waitFor(() => expect(queries()).toBe(2));

    unmount();
    vi.setSystemTime(Date.now() + 2 * VISIBILITY_REFRESH_MS);
    act(() => becomeVisible());
    expect(queries()).toBe(2);
  });
});
