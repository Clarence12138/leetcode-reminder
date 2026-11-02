import { afterEach, expect, it, vi } from 'vitest';
import { serveHistoryPort } from '../src/leetcode/history-port-server';
import type { LeetCodeHistoryClient } from '../src/leetcode/history-client';
import { HISTORY_PORT_NAME } from '../src/shared/history-port';

afterEach(() => vi.useRealTimers());

it('读取时每十秒发送心跳，断开清理定时器', async () => {
  vi.useFakeTimers();
  let start!: (message: unknown) => void;
  let disconnect!: () => void;
  const postMessage = vi.fn();
  const port = {
    name: HISTORY_PORT_NAME, postMessage,
    onMessage: { addListener: (fn: typeof start) => { start = fn; } },
    onDisconnect: { addListener: (fn: typeof disconnect) => { disconnect = fn; } },
  } as unknown as chrome.runtime.Port;
  const client = { listSolvedProblems: () => new Promise(() => undefined) } as unknown as LeetCodeHistoryClient;
  serveHistoryPort(port, client);
  start({ type: 'start', skipSlugs: [], temporaryTab: false });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(postMessage.mock.calls.filter(([message]) => message.type === 'heartbeat')).toHaveLength(2);
  disconnect();
  postMessage.mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(postMessage).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('读取正常结束清理心跳', async () => {
  vi.useFakeTimers();
  let start!: (message: unknown) => void;
  const postMessage = vi.fn();
  const port = {
    name: HISTORY_PORT_NAME, postMessage,
    onMessage: { addListener: (fn: typeof start) => { start = fn; } },
    onDisconnect: { addListener: vi.fn() },
  } as unknown as chrome.runtime.Port;
  const client = { listSolvedProblems: async () => ({ total: 0, problems: [] }) } as unknown as LeetCodeHistoryClient;
  serveHistoryPort(port, client);
  start({ type: 'start', skipSlugs: [], temporaryTab: false });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'done' }));
  expect(vi.getTimerCount()).toBe(0);
});
