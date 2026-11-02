import { describe, expect, it, vi } from 'vitest';
import { createMessageHandler, type BackgroundServices } from '../src/background/message-handler';
import { HistoryImportJob } from '../src/background/history-import-job';
import { fetchHistoryFromLeetCode } from '../src/background/leetcode-history';
import { HISTORY_IMPORT_STATE_KEY, type HistoryImportState } from '../src/shared/history-import-state';
import type { HistoryPortMessage } from '../src/shared/history-port';
import type { HistoryFetchResult } from '../src/leetcode/history-fetcher';

const rating = { mode: 'manual' } as const;
const fetched: HistoryFetchResult = { solvedTotal: 1, skippedLocal: 0, withoutAccepted: 0, problems: [{ metadata: { problemId: 'leetcode-cn:two-sum', slug: 'two-sum', frontendId: '1', title: '两数之和', difficulty: 'EASY', tags: [], url: 'https://leetcode.cn/problems/two-sum/' }, submissions: [{ submissionId: '1', acceptedAt: 1 }] }] };

function setup(saved?: HistoryImportState) {
  const listeners = new Set<(message: HistoryPortMessage) => void>();
  const disconnects = new Set<() => void>();
  const port = {
    onMessage: { addListener: (fn: (message: HistoryPortMessage) => void) => listeners.add(fn), removeListener: (fn: (message: HistoryPortMessage) => void) => listeners.delete(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnects.add(fn), removeListener: (fn: () => void) => disconnects.delete(fn) },
    disconnect: vi.fn(), postMessage: vi.fn(),
  } as unknown as chrome.runtime.Port;
  const emit = (message: HistoryPortMessage) => listeners.forEach((fn) => fn(message));
  const tabs = {
    create: vi.fn().mockResolvedValue({ id: 42 }), remove: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(() => { queueMicrotask(() => emit({ type: 'ready' })); return port; }),
  };
  let state: HistoryImportState = saved ?? { status: 'idle' };
  const states: HistoryImportState[] = [];
  const commit = vi.fn().mockResolvedValue({ importedProblems: 1, importedSubmissions: 1, skippedProblems: 0 });
  const job = new HistoryImportJob({
    storage: { get: async () => ({ [HISTORY_IMPORT_STATE_KEY]: state }), set: async (items) => { state = items[HISTORY_IMPORT_STATE_KEY] as HistoryImportState; states.push(state); } },
    skipSlugs: async () => ['existing'], closeTab: tabs.remove,
    fetch: (request) => fetchHistoryFromLeetCode(request, tabs as unknown as Pick<typeof chrome.tabs, 'create' | 'remove' | 'connect'>), commit,
  });
  return { job, tabs, port, commit, emit, disconnects, states, state: () => state };
}

describe('后台历史导入任务', () => {
  it('history.start 经校验后立即返回，开始与取消均不触发镜像同步', async () => {
    const h = setup();
    const sync = vi.fn();
    const handle = createMessageHandler({ historyJob: h.job, mirror: { sync } } as unknown as BackgroundServices);
    await expect(handle({ type: 'history.start', payload: { rating } })).resolves.toEqual({ ok: true });
    expect(h.state().status).toBe('running');
    await expect(handle({ type: 'history.start', payload: { rating: { mode: 'invalid' } } })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    await expect(handle({ type: 'history.cancel' })).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(h.state().status).toBe('cancelled'));
    expect(sync).not.toHaveBeenCalled();
  });

  it('开始立即返回；后台收取进度、写库并保存结果', async () => {
    const h = setup();
    await h.job.start(rating);
    expect(h.state().status).toBe('running');
    await vi.waitFor(() => expect(h.port.postMessage).toHaveBeenCalled());
    expect(h.port.postMessage).toHaveBeenCalledWith({ type: 'start', skipSlugs: ['existing'], temporaryTab: true });
    h.emit({ type: 'progress', progress: { phase: 'submissions', done: 1, total: 1 } });
    h.emit({ type: 'done', result: fetched });
    await vi.waitFor(() => expect(h.state().status).toBe('done'));
    expect(h.commit).toHaveBeenCalledWith(fetched.problems, rating);
    expect(h.tabs.remove).toHaveBeenCalledWith(42);
    expect(h.states.some((state) => state.status === 'running' && state.phase === 'committing')).toBe(true);
  });

  it('读取期间取消关闭临时页且不写库，重复开始被拒绝', async () => {
    const h = setup();
    await h.job.start(rating);
    await expect(h.job.start(rating)).rejects.toThrow('已有导入');
    await vi.waitFor(() => expect(h.port.postMessage).toHaveBeenCalled());
    h.job.cancel();
    await vi.waitFor(() => expect(h.state().status).toBe('cancelled'));
    expect(h.tabs.remove).toHaveBeenCalledWith(42);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it.each(['error', 'disconnect'])('内容脚本异常或标签页关闭：%s', async (kind) => {
    const h = setup();
    await h.job.start(rating);
    await vi.waitFor(() => expect(h.port.postMessage).toHaveBeenCalled());
    if (kind === 'error') h.emit({ type: 'error', message: '请先登录力扣' });
    else h.disconnects.forEach((fn) => fn());
    await vi.waitFor(() => expect(h.state().status).toBe('failed'));
    expect(h.tabs.remove).toHaveBeenCalledWith(42);
    expect(h.commit).not.toHaveBeenCalled();
  });

  it.each(['opening', 'committing'] as const)('恢复残留 %s 状态', async (phase) => {
    const h = setup({ status: 'running', phase, done: 0, total: 0, tabId: 42, startedAt: 1 });
    await h.job.recover();
    expect(h.state()).toMatchObject({ status: 'failed', message: expect.stringContaining('导入被中断') });
    expect(h.tabs.remove).toHaveBeenCalledWith(42);
  });

  it('空结果不写库', async () => {
    const h = setup();
    await h.job.start(rating);
    await vi.waitFor(() => expect(h.port.postMessage).toHaveBeenCalled());
    h.emit({ type: 'done', result: { ...fetched, problems: [] } });
    await vi.waitFor(() => expect(h.state()).toMatchObject({ status: 'done', result: null }));
    expect(h.commit).not.toHaveBeenCalled();
  });

  it('进入写库阶段后不可取消', async () => {
    const h = setup();
    let finish!: () => void;
    h.commit.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await h.job.start(rating);
    await vi.waitFor(() => expect(h.port.postMessage).toHaveBeenCalled());
    h.emit({ type: 'done', result: fetched });
    await vi.waitFor(() => expect(h.commit).toHaveBeenCalled());
    h.job.cancel();
    finish();
    await vi.waitFor(() => expect(h.state().status).toBe('done'));
  });
});
