import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentNotice } from '../src/leetcode/ContentNotice';
import { ContentController } from '../src/leetcode/content-controller';
import { detectPageMode, readPageMode, watchPageMode, type PageThemeSignals } from '../src/leetcode/page-theme';

const NOW = Date.now();
const DAY = 86_400_000;
const PREVIEW = {
  AGAIN: NOW + DAY,
  HARD: NOW + 3 * DAY,
  GOOD: NOW + 9 * DAY,
  EASY: NOW + 24 * DAY,
};
const ACCEPTED = {
  metadata: {
    problemId: 'leetcode-cn:number-of-islands',
    slug: 'number-of-islands',
    frontendId: '200',
    title: '岛屿数量',
    difficulty: 'MEDIUM' as const,
    tags: [],
    url: 'https://leetcode.cn/problems/number-of-islands/',
  },
  submissionId: 's-1',
  acceptedAt: NOW,
  trigger: 'button' as const,
};

function reviewOf(rating: 'GOOD' | null) {
  return {
    submissionId: 's-1',
    problemId: ACCEPTED.metadata.problemId,
    trigger: 'button' as const,
    acceptedAt: NOW,
    detectedAt: NOW,
    rating,
    fsrsLog: null,
  };
}

type Handlers = Record<string, () => unknown>;

function install(overrides: Handlers = {}) {
  const handlers: Handlers = {
    'submission.accepted': () => ({ created: true, review: reviewOf(null), nextReviewAt: null }),
    'review.preview': () => PREVIEW,
    'review.context': () => ({
      problem: null,
      history: [
        { submissionId: 'a', acceptedAt: NOW - 18 * DAY, rating: 'AGAIN', scheduledDays: 1 },
        { submissionId: 'b', acceptedAt: NOW - 9 * DAY, rating: 'GOOD', scheduledDays: 7 },
      ],
      retrievability: 0.82,
    }),
    'submission.rate': () => ({ review: reviewOf('GOOD'), nextReviewAt: NOW + 9 * DAY }),
    'submission.unrate': () => ({ review: reviewOf(null), nextReviewAt: null }),
    'review.next': () => ({
      problem: { frontendId: '42', title: '接雨水', difficulty: 'HARD', problemId: 'leetcode-cn:trapping-rain-water' },
      url: 'https://leetcode.cn/problems/trapping-rain-water/?resetCode=1',
      remainingToday: 3,
    }),
    ...overrides,
  };
  const sendMessage = vi.fn().mockImplementation((request: { readonly type: string }) => {
    const handler = handlers[request.type];
    if (!handler) return Promise.resolve({ ok: false, error: { code: 'X', message: `unexpected ${request.type}` } });
    try {
      return Promise.resolve({ ok: true, data: handler() });
    } catch (error) {
      return Promise.resolve({ ok: false, error: { code: 'X', message: error instanceof Error ? error.message : 'x' } });
    }
  });
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage } } });
  return sendMessage;
}

async function showRating(handlers: Handlers = {}) {
  const sendMessage = install(handlers);
  const controller = new ContentController();
  render(<ContentNotice controller={controller} />);
  await act(async () => { await controller.handleAccepted(ACCEPTED); });
  return { controller, sendMessage };
}

beforeEach(() => {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ContentNotice 评分态', () => {
  it('渲染标题、轨迹、记忆概率和一行四档（含下次间隔）', async () => {
    await showRating();
    expect(screen.getByText('Accepted 已记录')).toBeInTheDocument();
    expect(screen.getByText('200. 岛屿数量')).toBeInTheDocument();
    expect(screen.getByText('中等')).toBeInTheDocument();
    expect(screen.getByText('第 3 次')).toBeInTheDocument();
    expect(screen.getByText('复习前记忆概率 82%')).toBeInTheDocument();
    expect(screen.getByText('上次复习：9 天前')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '未掌握（明天）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '吃力（3 天）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '掌握（9 天）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '熟练（24 天）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '稍后评估' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '不记录本次' })).toBeInTheDocument();
  });

  it('第一次做的题显示“第一次记录”', async () => {
    await showRating({ 'review.context': () => ({ problem: null, history: [], retrievability: null }) });
    expect(screen.getByText('第一次记录')).toBeInTheDocument();
  });

  it('轨迹加载失败时仍可评分', async () => {
    await showRating({ 'review.context': () => { throw new Error('boom'); } });
    expect(screen.queryByText('这道题的轨迹')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '掌握（9 天）' })).toBeEnabled();
  });

  it('间隔加载中显示占位，名称不带间隔', async () => {
    const sendMessage = install();
    sendMessage.mockImplementation((request: { readonly type: string }) => {
      if (request.type === 'submission.accepted') {
        return Promise.resolve({ ok: true, data: { created: true, review: reviewOf(null), nextReviewAt: null } });
      }
      return new Promise(() => undefined);
    });
    const controller = new ContentController();
    render(<ContentNotice controller={controller} />);
    await act(async () => { void controller.handleAccepted(ACCEPTED); await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByRole('button', { name: '掌握' })).toBeEnabled();
  });

  it('键盘 1–4 评分', async () => {
    const { sendMessage } = await showRating();
    await act(async () => { fireEvent.keyDown(document.body, { key: '3' }); });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'submission.rate',
      payload: { submissionId: 's-1', rating: 'GOOD' },
    });
  });

  it('焦点在编辑器 textarea / 输入框 / contenteditable 时不触发', async () => {
    const { sendMessage } = await showRating();
    const textarea = document.body.appendChild(document.createElement('textarea'));
    const input = document.body.appendChild(document.createElement('input'));
    const editable = document.body.appendChild(document.createElement('div'));
    editable.setAttribute('contenteditable', 'true');
    for (const target of [textarea, input, editable]) fireEvent.keyDown(target, { key: '1' });
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: '5' });
    expect(sendMessage.mock.calls.some(([req]) => req.type === 'submission.rate')).toBe(false);
    textarea.remove(); input.remove(); editable.remove();
  });
});

describe('ContentNotice 键盘防误触', () => {
  it('输入法组合中、Monaco 编辑器内不触发评分', async () => {
    const { sendMessage } = await showRating();
    const monaco = document.body.appendChild(document.createElement('div'));
    monaco.className = 'monaco-editor';
    const line = monaco.appendChild(document.createElement('span'));
    fireEvent.keyDown(line, { key: '1' });
    fireEvent.keyDown(document.body, { key: '2', isComposing: true });
    expect(sendMessage.mock.calls.some(([req]) => req.type === 'submission.rate')).toBe(false);
    monaco.remove();
  });
});

describe('ContentNotice 完成态', () => {
  it('评分后显示结果、撤销和下一题', async () => {
    await showRating();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '掌握（9 天）' })); });
    expect(screen.getByText('已评为「掌握」· 9 天后复习')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销评分' })).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /去下一题/ });
    expect(link).toHaveAttribute('href', 'https://leetcode.cn/problems/trapping-rain-water/?resetCode=1');
    expect(screen.getByText('42. 接雨水')).toBeInTheDocument();
  });

  it('没有下一题时显示今日已完成', async () => {
    await showRating({ 'review.next': () => ({ problem: null, url: null, remainingToday: 0 }) });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '掌握（9 天）' })); });
    expect(await screen.findByText('今日复习已完成')).toBeInTheDocument();
  });

  it('撤销回到评分态，5 秒后撤销按钮消失', async () => {
    await showRating();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '熟练（24 天）' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '撤销评分' })); });
    expect(screen.getByText('Accepted 已记录')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '掌握（9 天）' })).toBeEnabled();
  });

  it('超过 5 秒不再显示撤销', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await showRating();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '掌握（9 天）' })); });
    expect(screen.getByRole('button', { name: '撤销评分' })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5_100); });
    expect(screen.queryByRole('button', { name: '撤销评分' })).not.toBeInTheDocument();
  });
});

describe('ContentNotice 其他状态与主题', () => {
  it('错误态可重新检测与关闭', async () => {
    install();
    const controller = new ContentController();
    const retry = vi.fn().mockResolvedValue(undefined);
    controller.setRetryHandler(retry);
    render(<ContentNotice controller={controller} />);
    await act(async () => {
      await controller.recordIssue('网络异常', true, { type: 'issue.record', payload: {} as never });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('网络异常');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新检测' })); });
    expect(retry).toHaveBeenCalled();
  });

  it('根节点带主题与浅深色属性，并跟随页面变化', async () => {
    document.documentElement.classList.add('dark');
    await showRating();
    const root = document.querySelector<HTMLElement>('.xsj-root');
    expect(root?.dataset.mode).toBe('dark');
    expect(root?.dataset.theme).toBe('pine');
    await act(async () => {
      document.documentElement.classList.remove('dark');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(root?.dataset.mode).toBe('light');
  });
});

describe('页面主题检测', () => {
  const base: PageThemeSignals = { classNames: [[], []], dataValues: [], colorSchemes: [], systemDark: false };

  it('html.dark / body 上的 dark class', () => {
    expect(detectPageMode({ ...base, classNames: [['dark'], []] })).toBe('dark');
    expect(detectPageMode({ ...base, classNames: [[], ['theme-dark']] })).toBe('dark');
    expect(detectPageMode({ ...base, classNames: [['light'], []], systemDark: true })).toBe('light');
  });

  it('data-theme 等属性', () => {
    expect(detectPageMode({ ...base, dataValues: [null, 'dark'] })).toBe('dark');
    expect(detectPageMode({ ...base, dataValues: ['light'], systemDark: true })).toBe('light');
  });

  it('color-scheme 明确时采用，含糊时回落系统偏好', () => {
    expect(detectPageMode({ ...base, colorSchemes: ['', 'dark'] })).toBe('dark');
    expect(detectPageMode({ ...base, colorSchemes: ['light dark'], systemDark: true })).toBe('dark');
    expect(detectPageMode({ ...base, colorSchemes: ['normal'] })).toBe('light');
  });

  it('class 优先于 data 与 color-scheme，无信号用系统偏好', () => {
    expect(detectPageMode({ ...base, classNames: [['dark']], dataValues: ['light'], colorSchemes: ['light'] })).toBe('dark');
    expect(detectPageMode({ ...base, systemDark: true })).toBe('dark');
  });

  it('readPageMode / watchPageMode 读 DOM 并监听变化', async () => {
    expect(readPageMode()).toBe('light');
    const seen: string[] = [];
    const stop = watchPageMode((mode) => seen.push(mode));
    document.documentElement.setAttribute('data-theme', 'dark');
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop();
    document.documentElement.setAttribute('data-theme', 'light');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(['dark']);
  });
});
