import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IssuesView } from '../entrypoints/dashboard/views/IssuesView';
import { RecordsView } from '../entrypoints/dashboard/views/RecordsView';
import type { DailySummary, MasteryRating, SubmissionReview } from '../src/domain/types';
import { installChromeMock, makeIssue, makeProblem, settings, summary, withIssues } from './ui-fixtures';

const sendMessage = vi.fn();

describe('面板 · 记录与检测异常', () => {
  beforeEach(() => {
    sendMessage.mockResolvedValue({ ok: true, data: {} });
    installChromeMock(sendMessage);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('异常页支持单条已读、批量解决，并在请求期间禁用操作', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    let finishRequest: ((value: unknown) => void) | undefined;
    sendMessage.mockImplementation(() => new Promise((resolve) => { finishRequest = resolve; }));
    const issueSummary = withIssues([
      makeIssue(1, null, null, '未读异常'),
      makeIssue(2, 1_700_000_000_100, null, '已读异常'),
      makeIssue(3, 1_700_000_000_100, 1_700_000_000_200, '已解决异常'),
    ]);

    render(<IssuesView refresh={refresh} summary={issueSummary} />);
    expect(screen.getByText(/2 条未解决，1 条未读/)).toBeInTheDocument();
    expect(within(issueArticle('未读异常')).getByRole('button', { name: '标记已读' })).toBeInTheDocument();
    expect(within(issueArticle('已读异常')).queryByRole('button', { name: '标记已读' })).not.toBeInTheDocument();
    expect(within(issueArticle('已解决异常')).queryByRole('button')).not.toBeInTheDocument();

    fireEvent.click(within(issueArticle('未读异常')).getByRole('button', { name: '标记已读' }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'issue.mark-read', payload: { issueIds: [1] } });
    expect(screen.getByRole('button', { name: '处理中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '全部标记已解决' })).toBeDisabled();
    finishRequest?.({ ok: true, data: { updatedCount: 1 } });
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('批量操作只提交当前快照中的对应异常 ID', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<IssuesView refresh={refresh} summary={withIssues([
      makeIssue(1, null, null, '异常一'),
      makeIssue(2, 1_700_000_000_100, null, '异常二'),
      makeIssue(3, 1_700_000_000_100, 1_700_000_000_200, '异常三'),
    ])} />);

    fireEvent.click(screen.getByRole('button', { name: '全部标记已读' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'issue.mark-read', payload: { issueIds: [1] } }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: '全部标记已解决' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'issue.resolve', payload: { issueIds: [2, 1] } }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it('异常操作失败时明确展示后台错误', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: { code: 'ISSUE_NOT_FOUND', message: '异常记录不存在。' } });
    render(<IssuesView refresh={vi.fn()} summary={withIssues([makeIssue(1, null, null, '已失效异常')])} />);

    fireEvent.click(screen.getByRole('button', { name: '全部标记已读' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('异常记录不存在。');
  });
});

const NOW = Date.parse('2026-11-25T04:00:00Z'); // 上海 12:00

function makeReview(id: string, problemId: string, acceptedAt: number, rating: MasteryRating | null, scheduledDays: number, trigger: SubmissionReview['trigger'] = 'button'): SubmissionReview {
  return {
    submissionId: id,
    problemId,
    trigger,
    acceptedAt,
    detectedAt: acceptedAt + 100,
    rating,
    fsrsLog: rating === null ? null : {
      rating: 3, state: 2, due: acceptedAt, stability: 1, difficulty: 1,
      elapsed_days: 0, last_elapsed_days: 0, scheduled_days: scheduledDays, review: acceptedAt,
    },
  };
}

function historySummary(): DailySummary {
  const card = makeProblem('1', '两数之和', 'EASY', ['数组'], { lastReviewAt: NOW });
  const problem = { ...card, fsrsCard: { ...card.fsrsCard!, scheduled_days: 9 } };
  const other = makeProblem('42', '接雨水', 'HARD', ['栈'], { lastReviewAt: NOW });
  const otherProblem = { ...other, fsrsCard: { ...other.fsrsCard!, scheduled_days: 2 } };
  return {
    ...summary,
    problems: [problem, otherProblem],
    recentReviews: [
      makeReview('a1', problem.problemId, Date.parse('2026-11-24T01:00:00Z'), 'GOOD', 0, 'keyboard'),
      makeReview('a2', problem.problemId, Date.parse('2026-11-25T02:00:00Z'), 'EASY', 3),
      makeReview('b1', otherProblem.problemId, Date.parse('2026-11-10T12:00:00Z'), 'AGAIN', 0, 'import'),
    ],
  };
}

function renderRecords(tab: 'history' | 'issues', props: { summary?: DailySummary; onTabChange?: () => void } = {}): void {
  render(<RecordsView onTabChange={props.onTabChange ?? vi.fn()} refresh={vi.fn()} settings={settings} summary={props.summary ?? historySummary()} tab={tab} />);
}

describe('记录页 · 复习记录', () => {
  beforeEach(() => {
    sendMessage.mockResolvedValue({ ok: true, data: {} });
    installChromeMock(sendMessage);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

  it('按天分组并显示今天、昨天与具体日期', () => {
    renderRecords('history');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings[0]).toMatch(/^今天/);
    expect(headings[1]).toMatch(/^昨天/);
    expect(headings[2]).toMatch(/^11月10日/);
    expect(within(screen.getByRole('region', { name: /^今天/ })).getByRole('link', { name: /1\. 两数之和/ })).toHaveAttribute('href', 'https://leetcode.cn/problems/1/');
    expect(screen.getByText('快捷键提交')).toBeInTheDocument();
    expect(screen.getByText('从力扣导入')).toBeInTheDocument();
  });

  it('显示间隔变化与首次评分', () => {
    renderRecords('history');
    const today = screen.getByRole('region', { name: /^今天/ });
    expect(today).toHaveTextContent('间隔 3 → 9 天');
    expect(today).toHaveTextContent('（变长）');
    expect(screen.getByRole('region', { name: /^昨天/ })).toHaveTextContent('首次 · 3 天');
  });

  it('点图例隐藏某档评分，再点恢复', () => {
    renderRecords('history');
    const legend = screen.getByRole('group', { name: '按评分筛选记录' });
    const again = within(legend).getByRole('button', { name: /未掌握/ });
    fireEvent.click(again);
    expect(again).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: /^11月10日/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已隐藏');
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: '显示全部' }));
    expect(screen.getByRole('region', { name: /^11月10日/ })).toBeInTheDocument();
  });

  it('记录很多时分批显示', () => {
    const base = historySummary();
    const many = Array.from({ length: 60 }, (_, index) => makeReview(`m${index}`, 'leetcode-cn:1', NOW - (index + 1) * 60_000, 'GOOD', 1));
    renderRecords('history', { summary: { ...base, recentReviews: [...base.recentReviews, ...many] } });
    fireEvent.click(screen.getByRole('button', { name: /再显示/ }));
    expect(screen.queryByRole('button', { name: /再显示/ })).not.toBeInTheDocument();
  });

  it('没有记录时给出说明', () => {
    renderRecords('history', { summary });
    expect(screen.getByText('还没有复习记录')).toBeInTheDocument();
  });

  it('标签带未读数，切换时回调', () => {
    const onTabChange = vi.fn();
    renderRecords('history', { onTabChange, summary: withIssues([makeIssue(1, null, null, '未读异常')]) });
    fireEvent.click(screen.getByRole('radio', { name: '检测异常（1 条未读）' }));
    expect(onTabChange).toHaveBeenCalledWith('issues');
  });

  it('异常标签下渲染异常列表', () => {
    renderRecords('issues', { summary: withIssues([makeIssue(1, null, null, '未读异常')]) });
    expect(screen.getByText(/1 条未解决，1 条未读/)).toBeInTheDocument();
  });
});

function issueArticle(diagnostic: string): HTMLElement {
  const article = screen.getByText(diagnostic).closest('article');
  if (!article) throw new Error(`未找到异常条目：${diagnostic}`);
  return article;
}
