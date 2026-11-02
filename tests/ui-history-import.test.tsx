// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { HistoryImportContext, useHistoryImport } from '../entrypoints/dashboard/useHistoryImport';
import { LeetCodeImportPanel } from '../entrypoints/dashboard/views/LeetCodeImportPanel';
import type { HistoryImportState } from '../src/shared/history-import-state';

const refresh = vi.fn().mockResolvedValue(undefined);
function Harness() {
  const state = useHistoryImport(refresh);
  return <HistoryImportContext.Provider value={state}><LeetCodeImportPanel /></HistoryImportContext.Provider>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(initial: HistoryImportState) {
  let change!: (changes: Record<string, unknown>, area: string) => void;
  const sendMessage = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: {
    session: { get: vi.fn().mockResolvedValue({ historyImportState: initial }) },
    onChanged: { addListener: (fn: typeof change) => { change = fn; }, removeListener: vi.fn() },
  } });
  render(<Harness />);
  return { sendMessage, update: (state: HistoryImportState) => act(() => change({ historyImportState: { newValue: state } }, 'session')) };
}

it('从 session 恢复进度，取消发送后台请求，完成时只刷新一次', async () => {
  const h = setup({ status: 'running', phase: 'submissions', done: 2, total: 5, startedAt: 1, tabId: 42 });
  await screen.findByText('正在读取 AC 记录（2/5 道）…');
  fireEvent.click(screen.getByRole('button', { name: '取消导入' }));
  await waitFor(() => expect(h.sendMessage).toHaveBeenCalledWith({ type: 'history.cancel' }));
  const done: HistoryImportState = { status: 'done', fetched: { solvedTotal: 5, skippedLocal: 0, withoutAccepted: 0 }, result: { importedProblems: 5, importedSubmissions: 5, skippedProblems: 0 }, rating: { mode: 'manual' } };
  h.update(done);
  expect(screen.getByText(/已导入 5 道题/)).toBeTruthy();
  h.update(done);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('面板卸载不会发送取消请求', async () => {
  const h = setup({ status: 'running', phase: 'opening', done: 0, total: 0, startedAt: 1, tabId: null });
  await screen.findByText('正在打开力扣页面…');
  cleanup();
  expect(h.sendMessage).not.toHaveBeenCalled();
});

it('已保存结果可见，再次开始只发启动请求', async () => {
  const h = setup({ status: 'cancelled' });
  await screen.findByText('已取消导入，本地数据没有变化。');
  fireEvent.click(screen.getByRole('button', { name: '开始导入' }));
  await waitFor(() => expect(h.sendMessage).toHaveBeenCalledWith({ type: 'history.start', payload: { rating: { mode: 'uniform', rating: 'GOOD' } } }));
  cleanup();
  expect(h.sendMessage).toHaveBeenCalledTimes(1);
});
