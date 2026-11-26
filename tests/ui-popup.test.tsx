import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopupApp } from '../entrypoints/popup/PopupApp';
import type { DailySummary, DetectionIssue, ProblemRecord, SubmissionReview } from '../src/domain/types';
import { makeIssue as makeFixtureIssue, makePendingReview, makeProblem, settings } from './ui-fixtures';

const problem: ProblemRecord = makeProblem('1', '两数之和', 'EASY', ['数组', '哈希表']);
const pending: SubmissionReview = makePendingReview(problem);
const summary: DailySummary = {
  problems: [problem],
  dueProblems: [problem],
  pendingReviews: [pending],
  recentReviews: [pending],
  issues: [],
};
const DAY = 86_400_000;
/** review.preview 返回各档的下次到期时间戳，界面按日历天数换算成间隔。 */
const noon = Date.now();
const preview = {
  AGAIN: noon + DAY,
  HARD: noon + 3 * DAY,
  GOOD: noon + 9 * DAY,
  EASY: noon + 24 * DAY,
};

type Request = { readonly type: string; readonly payload?: unknown };

describe('弹窗', () => {
  const sendMessage = vi.fn();
  const tabsCreate = vi.fn().mockResolvedValue(undefined);
  let current: DailySummary;
  let currentSettings: typeof settings;

  function respond(request: Request): Promise<unknown> {
    switch (request.type) {
      case 'dashboard.query': return Promise.resolve({ ok: true, data: current });
      case 'settings.get': return Promise.resolve({ ok: true, data: currentSettings });
      case 'review.preview': return Promise.resolve({ ok: true, data: preview });
      case 'submission.rate': return Promise.resolve({ ok: true, data: { review: { ...pending, rating: 'GOOD' }, nextReviewAt: 3 } });
      case 'submission.unrate': return Promise.resolve({ ok: true, data: { review: pending, nextReviewAt: 1 } });
      default: throw new Error(`unexpected request: ${request.type}`);
    }
  }

  beforeEach(() => {
    current = summary;
    currentSettings = settings;
    sendMessage.mockImplementation(respond);
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: { getURL: (path: string) => path, sendMessage },
        tabs: { create: tabsCreate },
      },
    });
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

  it('展示到期、待评估和题目中文信息', async () => {
    render(<PopupApp />);
    expect(await screen.findByRole('button', { name: /开始复习 · 1\. 两数之和/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /还有 1 题/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /待评估/ })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: '1. 两数之和' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '掌握（9 天）' })).toBeInTheDocument();
  });

  it('评分后通知后台并刷新数据', async () => {
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole('button', { name: '掌握（9 天）' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'submission.rate',
      payload: { submissionId: '123', rating: 'GOOD' },
    }));
    const queries = () => sendMessage.mock.calls.filter(([request]) => request.type === 'dashboard.query').length;
    await waitFor(() => expect(queries()).toBeGreaterThanOrEqual(2));
  });

  it('评分后可撤销并重新拉取数据', async () => {
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole('button', { name: '掌握（9 天）' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'submission.unrate',
      payload: { submissionId: '123', rating: 'GOOD' },
    }));
    const before = sendMessage.mock.calls.filter(([request]) => request.type === 'dashboard.query').length;
    await waitFor(() => {
      const after = sendMessage.mock.calls.filter(([request]) => request.type === 'dashboard.query').length;
      expect(after).toBeGreaterThanOrEqual(before);
      expect(after).toBeGreaterThanOrEqual(2);
    });
  });

  it('收起动画结束前撤销：这一行不会被收起，仍可重新评分', async () => {
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole('button', { name: '掌握（9 天）' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'submission.unrate', payload: { submissionId: '123', rating: 'GOOD' } }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    const row = screen.getByRole('article', { name: '1. 两数之和' });
    expect(row).not.toHaveClass('gone');
    expect(row).not.toHaveAttribute('aria-hidden');
    expect(screen.getByRole('button', { name: '掌握（9 天）' })).toBeEnabled();
  });

  it('待评估超过 2 条时提示去面板评', async () => {
    const extra = ['124', '125', '126'].map((id) => ({ ...pending, submissionId: id }));
    current = { ...summary, pendingReviews: [pending, ...extra] };
    render(<PopupApp />);
    expect(await screen.findByRole('button', { name: /还有 2 条，去面板评/ })).toBeInTheDocument();
  });

  it('开始复习在新标签打开第一题并关闭弹窗', async () => {
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole('button', { name: /开始复习 · 1\. 两数之和/ }));
    await waitFor(() => expect(tabsCreate).toHaveBeenCalledWith({ url: problem.url }));
    expect(window.close).toHaveBeenCalled();
  });

  it('开启还原代码时开始复习带还原标记', async () => {
    currentSettings = { ...settings, resetCodeOnReview: true };
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole('button', { name: /开始复习/ }));
    await waitFor(() => expect(tabsCreate).toHaveBeenCalledTimes(1));
    const { url } = (tabsCreate.mock.calls[0]?.[0] ?? {}) as { url: string };
    expect(url).not.toBe(problem.url);
    expect(url.startsWith(problem.url)).toBe(true);
  });

  it('今日队列和底栏入口打开面板对应页面', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole('button', { name: /查看全部/ }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '打开完整面板' }));
    expect(open).toHaveBeenNthCalledWith(1, '/dashboard.html#queue', '_blank', 'noopener,noreferrer');
    expect(open).toHaveBeenNthCalledWith(2, '/dashboard.html#settings', '_blank', 'noopener,noreferrer');
    expect(open).toHaveBeenNthCalledWith(3, '/dashboard.html', '_blank', 'noopener,noreferrer');
    expect(screen.getByText('数据仅保存在本机')).toBeInTheDocument();
  });

  it('没有题目时给出新用户引导', async () => {
    current = { problems: [], dueProblems: [], pendingReviews: [], recentReviews: [], issues: [] };
    render(<PopupApp />);
    expect(await screen.findByText('还没有题目')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '去力扣做题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入历史' })).toBeInTheDocument();
  });

  it('没有待做题时显示完成态', async () => {
    current = { ...summary, dueProblems: [], pendingReviews: [] };
    render(<PopupApp />);
    expect(await screen.findByRole('heading', { name: /没有到期|已完成/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /开始复习/ })).not.toBeInTheDocument();
  });

  it('检测异常提醒只统计未读记录', async () => {
    const issues: readonly DetectionIssue[] = [
      makeFixtureIssue(1, null, null, '异常 1'),
      makeFixtureIssue(2, 1_700_000_000_100, null, '异常 2'),
    ];
    current = { ...summary, issues };
    render(<PopupApp />);
    const notice = await screen.findByRole('button', { name: /有 1 条检测异常待查看/ });
    expect(screen.queryByText('有 2 条检测异常待查看')).not.toBeInTheDocument();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(notice);
    expect(open).toHaveBeenCalledWith('/dashboard.html#issues', '_blank', 'noopener,noreferrer');
  });
});
