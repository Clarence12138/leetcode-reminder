import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PopupApp } from '../entrypoints/popup/PopupApp';
import type { DailySummary, DetectionIssue, ProblemRecord, SubmissionReview } from '../src/domain/types';

const problem: ProblemRecord = {
  problemId: 'leetcode-cn:two-sum',
  slug: 'two-sum',
  frontendId: '1',
  title: '两数之和',
  difficulty: 'EASY',
  tags: ['数组', '哈希表'],
  url: 'https://leetcode.cn/problems/two-sum/',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  fsrsCard: null,
  nextReviewAt: 1_700_000_000_000,
  algorithm: 'FSRS-6',
  algorithmLibrary: 'ts-fsrs@5.4.1',
  parametersVersion: 'xiaoshuaji-fsrs-v1',
};

const pending: SubmissionReview = {
  submissionId: '123',
  problemId: problem.problemId,
  trigger: 'keyboard',
  acceptedAt: 1_700_000_000_000,
  detectedAt: 1_700_000_000_100,
  rating: null,
  fsrsLog: null,
};

const summary: DailySummary = {
  problems: [problem],
  dueProblems: [problem],
  pendingReviews: [pending],
  recentReviews: [pending],
  issues: [],
};

describe('弹窗', () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    sendMessage.mockImplementation((request: { readonly type: string }) => {
      if (request.type === 'dashboard.query') return Promise.resolve({ ok: true, data: summary });
      if (request.type === 'submission.rate') return Promise.resolve({ ok: true, data: { review: { ...pending, rating: 'GOOD' } } });
      throw new Error(`unexpected request: ${request.type}`);
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { getURL: (path: string) => path, sendMessage } },
    });
  });

  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('展示到期、待评估和题目中文信息', async () => {
    render(<PopupApp />);
    expect(await screen.findAllByText('1. 两数之和')).not.toHaveLength(0);
    expect(screen.getByText('题待复习')).toBeInTheDocument();
    expect(screen.getByText('条待评估')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '掌握' })).toBeInTheDocument();
  });

  it('评分后通知后台并刷新数据', async () => {
    render(<PopupApp />);
    fireEvent.click(await screen.findByRole('button', { name: '掌握' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'submission.rate',
      payload: { submissionId: '123', rating: 'GOOD' },
    }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
  });

  it('检测异常提醒只统计未读记录', async () => {
    const issues: readonly DetectionIssue[] = [
      makeIssue(1, null),
      makeIssue(2, 1_700_000_000_100),
    ];
    sendMessage.mockImplementation((request: { readonly type: string }) => {
      if (request.type === 'dashboard.query') return Promise.resolve({ ok: true, data: { ...summary, issues } });
      throw new Error(`unexpected request: ${request.type}`);
    });

    render(<PopupApp />);
    expect(await screen.findByText('有 1 条检测异常待查看')).toBeInTheDocument();
    expect(screen.queryByText('有 2 条检测异常待查看')).not.toBeInTheDocument();
  });
});

function makeIssue(id: number, readAt: number | null): DetectionIssue {
  return {
    id,
    slug: 'two-sum',
    occurredAt: 1_700_000_000_000 + id,
    code: 'NETWORK_ERROR',
    retryable: true,
    diagnostic: `异常 ${id}`,
    readAt,
    resolvedAt: null,
  };
}
