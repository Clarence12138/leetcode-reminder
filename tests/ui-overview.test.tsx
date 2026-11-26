import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardApp } from '../entrypoints/dashboard/DashboardApp';
import { OverviewView } from '../entrypoints/dashboard/views/OverviewView';
import type { DailySummary, Settings, SubmissionReview } from '../src/domain/types';
import { ToastProvider } from '../src/ui/components';
import { installChromeMock, makeIssue, makePendingReview, problems, settings, summary, withIssues } from './ui-fixtures';

// 其他页面由别的模块负责，这里只关心路由把正确的页面（和 tab）挂出来
vi.mock('../entrypoints/dashboard/views/ProblemsView', () => ({ ProblemsView: () => <div>题库页面</div> }));
vi.mock('../entrypoints/dashboard/views/SettingsView', () => ({ SettingsView: () => <div>设置页面</div> }));
vi.mock('../entrypoints/dashboard/views/RecordsView', () => ({
  RecordsView: ({ tab }: { readonly tab: string }) => <div>记录页面：{tab}</div>,
}));

const DAY = 86_400_000;

function rated(id: string, problemId: string, daysAgo: number): SubmissionReview {
  const at = Date.now() - daysAgo * DAY;
  return { submissionId: id, problemId, trigger: 'button', acceptedAt: at, detectedAt: at, rating: 'GOOD', fsrsLog: null };
}

/** 有评分记录 = 不是新用户。 */
const warmSummary: DailySummary = { ...summary, recentReviews: [rated('r1', problems[0]!.problemId, 3)] };

function mockBackend(data: DailySummary, config: Settings = settings): ReturnType<typeof vi.fn> {
  const sendMessage = vi.fn((request: { readonly type: string }) => {
    if (request.type === 'dashboard.query') return Promise.resolve({ ok: true, data });
    if (request.type === 'settings.get') return Promise.resolve({ ok: true, data: config });
    if (request.type === 'review.preview') {
      const at = Date.now() + 9 * DAY;
      return Promise.resolve({ ok: true, data: { AGAIN: at, HARD: at, GOOD: at, EASY: at } });
    }
    if (request.type === 'submission.rate') {
      return Promise.resolve({ ok: true, data: { review: { ...makePendingReview(problems[0]!), rating: 'GOOD' }, nextReviewAt: Date.now() + 9 * DAY } });
    }
    return Promise.resolve({ ok: true, data: {} });
  });
  installChromeMock(sendMessage);
  return sendMessage;
}

function renderOverview(data: DailySummary, config: Settings = settings, refresh = vi.fn().mockResolvedValue(undefined)) {
  const onNavigate = vi.fn();
  render(<ToastProvider><OverviewView onNavigate={onNavigate} refresh={refresh} settings={config} summary={data} /></ToastProvider>);
  return { onNavigate, refresh };
}

describe('面板 · 概览', () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    window.location.hash = '';
    sendMessage = mockBackend(warmSummary);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('待评估卡片需二次确认后才会丢弃提交', async () => {
    const { refresh } = renderOverview({ ...warmSummary, dueProblems: [], pendingReviews: [makePendingReview(problems[0]!)] });

    fireEvent.click(screen.getByRole('button', { name: '丢弃两数之和' }));
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'submission.discard' }));

    fireEvent.click(screen.getByRole('button', { name: '确认丢弃两数之和' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'submission.discard', payload: { submissionId: '123' } }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('开始复习打开队列第一题（新标签页）', () => {
    renderOverview(warmSummary);
    const start = screen.getByRole('link', { name: /开始复习 · 1\. 两数之和/ });
    expect(start).toHaveAttribute('href', 'https://leetcode.cn/problems/1/');
    expect(start).toHaveAttribute('target', '_blank');
  });

  it('开启还原后开始复习和队列里的链接都带还原标记', () => {
    renderOverview(warmSummary, { ...settings, resetCodeOnReview: true });
    const expected = 'https://leetcode.cn/problems/1/?xiaoshuaji=review';
    expect(screen.getByRole('link', { name: /开始复习 · 1\. 两数之和/ })).toHaveAttribute('href', expected);
    const table = screen.getByRole('table', { name: '今日队列' });
    expect(within(table).getByRole('link', { name: '开始复习两数之和' })).toHaveAttribute('href', expected);
  });

  it('没有到期题时开始复习换成去题库', () => {
    const { onNavigate } = renderOverview({ ...warmSummary, dueProblems: [] });
    expect(screen.queryByRole('link', { name: /开始复习/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '去题库看看' }));
    expect(onNavigate).toHaveBeenCalledWith('problems');
  });

  it('支持切换排序策略和展开配额积压', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    renderOverview(warmSummary, { ...settings, dailyReviewLimit: 1 }, refresh);

    const table = screen.getByRole('table', { name: '今日队列' });
    expect(within(table).getByText('1. 两数之和')).toBeInTheDocument();
    expect(screen.queryByText('42. 接雨水')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开其余 1 题' }));
    expect(within(screen.getByRole('table', { name: '积压题目' })).getByText('42. 接雨水')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('队列排序策略'), { target: { value: 'priority' } });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'settings.update', payload: { queueSortStrategy: 'priority' } }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('评分后收起这一行并弹出可撤销提示，撤销后刷新', async () => {
    const pending = makePendingReview(problems[0]!);
    const { refresh } = renderOverview({ ...warmSummary, dueProblems: [], pendingReviews: [pending] });

    fireEvent.click(await screen.findByRole('button', { name: /^掌握（/ }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'submission.rate', payload: { submissionId: '123', rating: 'GOOD' } }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    fireEvent.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'submission.unrate', payload: { submissionId: '123', rating: 'GOOD' } }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it('评分动画结束前撤销：这一行不会被收起，仍可重新评分', async () => {
    const pending = makePendingReview(problems[0]!);
    const { refresh } = renderOverview({ ...warmSummary, dueProblems: [], pendingReviews: [pending] });

    fireEvent.click(await screen.findByRole('button', { name: /^掌握（/ }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(refresh).toHaveBeenCalledOnce();
    expect(document.querySelector('.pend')).not.toHaveClass('gone');
    expect(screen.getByRole('button', { name: /^掌握（/ })).toBeEnabled();
  });

  it('有未读异常时给出入口，点击去检测异常', () => {
    const { onNavigate } = renderOverview({ ...warmSummary, issues: [makeIssue(1, null, null, '未读'), makeIssue(2, 1_700_000_000_100, null, '已读')] });
    fireEvent.click(screen.getByRole('button', { name: /有 1 条提交检测异常需要查看/ }));
    expect(onNavigate).toHaveBeenCalledWith('issues');
  });

  it('新用户显示 3 步引导，统计块给说明文字而不是空数字', () => {
    const { onNavigate } = renderOverview({ ...summary, problems: problems.map((problem) => ({ ...problem, nextReviewAt: null })), dueProblems: [], recentReviews: [], pendingReviews: [makePendingReview(problems[0]!)] });
    expect(screen.getByRole('heading', { name: '欢迎，先把这 3 步走完' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: '开始使用的步骤' })).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveClass('done');
    expect(steps[1]).not.toHaveClass('done');
    expect(screen.getByText('完成 1 步')).toBeInTheDocument();
    expect(screen.getByText('评满 10 次后开始计算')).toBeInTheDocument();
    expect(screen.getByText('评分后，下次复习的日子会按天显示在这里。')).toBeInTheDocument();
    expect(screen.queryByText('今日队列')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '从力扣导入' }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });
});

describe('面板 · 外壳与路由', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); window.location.hash = ''; });

  it('导航标签：概览显示剩余加待评估，记录只统计未读异常', async () => {
    mockBackend({
      ...withIssues([makeIssue(1, null, null, '未读异常'), makeIssue(2, 1_700_000_000_100, null, '已读但未解决')]),
      recentReviews: warmSummary.recentReviews,
      pendingReviews: [makePendingReview(problems[0]!)],
    });
    render(<DashboardApp />);
    const navigation = await screen.findByRole('navigation', { name: '主导航' });
    expect(within(navigation).getAllByRole('button').map((button) => button.textContent)).toEqual(['概览3', '题库', '记录1', '设置']);
    expect(within(navigation).getByRole('button', { name: /记录/ }).querySelector('b')).toHaveTextContent('1');
  });

  it.each([
    ['', '今天还有'],
    ['#home', '今天还有'],
    ['#queue', '今日队列'],
    ['#problems', '题库页面'],
    ['#history', '记录页面：history'],
    ['#issues', '记录页面：issues'],
    ['#settings', '设置页面'],
  ])('hash %s 打开对应页面', async (hash, text) => {
    mockBackend(warmSummary);
    window.location.hash = hash;
    render(<DashboardApp />);
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
  });

  it('点击标签切换页面并写入 hash', async () => {
    mockBackend(warmSummary);
    render(<DashboardApp />);
    const navigation = await screen.findByRole('navigation', { name: '主导航' });
    fireEvent.click(within(navigation).getByRole('button', { name: /记录/ }));
    expect(await screen.findByText('记录页面：history')).toBeInTheDocument();
    expect(window.location.hash).toBe('#history');
    expect(within(navigation).getByRole('button', { name: /记录/ })).toHaveAttribute('aria-current', 'page');
  });
});
