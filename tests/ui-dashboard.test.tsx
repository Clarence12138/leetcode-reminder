import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardApp } from '../entrypoints/dashboard/DashboardApp';
import { HomeView } from '../entrypoints/dashboard/views/HomeView';
import { IssuesView } from '../entrypoints/dashboard/views/IssuesView';
import { ProblemsView } from '../entrypoints/dashboard/views/ProblemsView';
import { SettingsView } from '../entrypoints/dashboard/views/SettingsView';
import type { DailySummary, DetectionIssue, ProblemRecord, Settings } from '../src/domain/types';

const problems: readonly ProblemRecord[] = [
  makeProblem('1', '两数之和', 'EASY', ['数组']),
  makeProblem('42', '接雨水', 'HARD', ['栈', '双指针']),
];

const summary: DailySummary = {
  problems,
  dueProblems: problems,
  pendingReviews: [],
  recentReviews: [],
  issues: [],
};

const settings: Settings = {
  notificationsEnabled: true,
  reminderHour: 9,
  reminderMinute: 0,
  timezone: 'Asia/Shanghai',
  schemaVersion: 1,
};

describe('完整面板', () => {
  const sendMessage = vi.fn();
  beforeEach(() => {
    sendMessage.mockResolvedValue({ ok: true, data: {} });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('支持按中文题名和难度筛选', () => {
    render(<ProblemsView refresh={vi.fn()} summary={summary} />);
    fireEvent.change(screen.getByLabelText('搜索题目'), { target: { value: '接雨' } });
    expect(screen.getByText('接雨水')).toBeInTheDocument();
    expect(screen.queryByText('两数之和')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索题目'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('按难度筛选'), { target: { value: 'EASY' } });
    expect(screen.getByText('两数之和')).toBeInTheDocument();
    expect(screen.queryByText('接雨水')).not.toBeInTheDocument();
  });

  it('支持按添加日期和最近复习日期双向排序', () => {
    const sortableProblems = [
      makeProblem('1', '较早添加，最近复习', 'EASY', ['数组'], {
        createdAt: 1_700_000_000_100,
        lastReviewAt: 1_700_000_000_600,
      }),
      makeProblem('2', '稍晚添加，较早复习', 'MEDIUM', ['哈希表'], {
        createdAt: 1_700_000_000_300,
        lastReviewAt: 1_700_000_000_400,
      }),
      makeProblem('3', '最新添加，尚未复习', 'HARD', ['栈'], {
        createdAt: 1_700_000_000_500,
      }),
    ];
    render(<ProblemsView refresh={vi.fn()} summary={{ ...summary, problems: sortableProblems }} />);

    expect(visibleProblemTitles()).toEqual([
      '最新添加，尚未复习',
      '稍晚添加，较早复习',
      '较早添加，最近复习',
    ]);

    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'CREATED_AT_ASC' } });
    expect(visibleProblemTitles()).toEqual([
      '较早添加，最近复习',
      '稍晚添加，较早复习',
      '最新添加，尚未复习',
    ]);

    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'LAST_REVIEW_AT_DESC' } });
    expect(visibleProblemTitles()).toEqual([
      '较早添加，最近复习',
      '稍晚添加，较早复习',
      '最新添加，尚未复习',
    ]);

    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'LAST_REVIEW_AT_ASC' } });
    expect(visibleProblemTitles()).toEqual([
      '稍晚添加，较早复习',
      '较早添加，最近复习',
      '最新添加，尚未复习',
    ]);
  });

  it('测试通知仅报告 Chrome API 创建成功', async () => {
    render(<SettingsView refresh={vi.fn()} settings={settings} summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: '发送测试通知' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'notification.test' }));
    expect(await screen.findByText(/Chrome 通知 API 已成功创建/)).toBeInTheDocument();
    expect(screen.getByText(/系统是否展示取决于/)).toBeInTheDocument();
  });

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

  it('首页横幅和侧栏红点只统计未读异常', async () => {
    const issueSummary = withIssues([
      makeIssue(1, null, null, '未读异常'),
      makeIssue(2, 1_700_000_000_100, null, '已读但未解决'),
    ]);
    const { unmount } = render(<HomeView onNavigate={vi.fn()} summary={issueSummary} />);
    expect(screen.getByText('有 1 条提交检测异常需要查看')).toBeInTheDocument();
    unmount();

    sendMessage.mockImplementation((request: { readonly type: string }) => {
      if (request.type === 'dashboard.query') return Promise.resolve({ ok: true, data: issueSummary });
      if (request.type === 'settings.get') return Promise.resolve({ ok: true, data: settings });
      throw new Error(`unexpected request: ${request.type}`);
    });
    render(<DashboardApp />);
    const navigation = await screen.findByRole('navigation', { name: '主导航' });
    const issuesButton = within(navigation).getByRole('button', { name: /检测异常/ });
    expect(issuesButton.querySelector('.issue-count')).toHaveTextContent('1');
  });
});

function withIssues(issues: readonly DetectionIssue[]): DailySummary {
  return { ...summary, issues };
}

function makeIssue(id: number, readAt: number | null, resolvedAt: number | null, diagnostic: string): DetectionIssue {
  return {
    id,
    slug: 'two-sum',
    occurredAt: 1_700_000_000_000 + id,
    code: 'NETWORK_ERROR',
    retryable: true,
    diagnostic,
    readAt,
    resolvedAt,
  };
}

function issueArticle(diagnostic: string): HTMLElement {
  const article = screen.getByText(diagnostic).closest('article');
  if (!article) throw new Error(`未找到异常条目：${diagnostic}`);
  return article;
}

function visibleProblemTitles(): string[] {
  return [...screen.getByLabelText('题目列表').querySelectorAll('.problem-cell a')]
    .map((link) => link.textContent?.trim() ?? '');
}

function makeProblem(
  frontendId: string,
  title: string,
  difficulty: ProblemRecord['difficulty'],
  tags: readonly string[],
  options: { readonly createdAt?: number; readonly lastReviewAt?: number } = {},
): ProblemRecord {
  const createdAt = options.createdAt ?? 1_700_000_000_000;
  return {
    problemId: `leetcode-cn:${frontendId}`,
    slug: frontendId,
    frontendId,
    title,
    difficulty,
    tags,
    url: `https://leetcode.cn/problems/${frontendId}/`,
    createdAt,
    updatedAt: createdAt,
    fsrsCard: options.lastReviewAt === undefined ? null : {
      due: options.lastReviewAt + 86_400_000,
      stability: 1,
      difficulty: 1,
      elapsed_days: 0,
      scheduled_days: 1,
      reps: 1,
      lapses: 0,
      learning_steps: 0,
      state: 2,
      last_review: options.lastReviewAt,
    },
    nextReviewAt: 1_700_000_000_000,
    algorithm: 'FSRS-6',
    algorithmLibrary: 'ts-fsrs@5.4.1',
    parametersVersion: 'xiaoshuaji-fsrs-v1',
  };
}
