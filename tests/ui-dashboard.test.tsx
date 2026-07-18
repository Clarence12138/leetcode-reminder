import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemsView } from '../entrypoints/dashboard/views/ProblemsView';
import { SettingsView } from '../entrypoints/dashboard/views/SettingsView';
import type { DailySummary, ProblemRecord, Settings } from '../src/domain/types';

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

  it('测试通知仅报告 Chrome API 创建成功', async () => {
    render(<SettingsView refresh={vi.fn()} settings={settings} summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: '发送测试通知' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'notification.test' }));
    expect(await screen.findByText(/Chrome 通知 API 已成功创建/)).toBeInTheDocument();
    expect(screen.getByText(/系统是否展示取决于/)).toBeInTheDocument();
  });
});

function makeProblem(frontendId: string, title: string, difficulty: ProblemRecord['difficulty'], tags: readonly string[]): ProblemRecord {
  return {
    problemId: `leetcode-cn:${frontendId}`,
    slug: frontendId,
    frontendId,
    title,
    difficulty,
    tags,
    url: `https://leetcode.cn/problems/${frontendId}/`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    fsrsCard: null,
    nextReviewAt: 1_700_000_000_000,
    algorithm: 'FSRS-6',
    algorithmLibrary: 'ts-fsrs@5.4.1',
    parametersVersion: 'xiaoshuaji-fsrs-v1',
  };
}
