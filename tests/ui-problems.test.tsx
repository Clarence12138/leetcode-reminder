import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemsView } from '../entrypoints/dashboard/views/ProblemsView';
import type { ProblemRecord } from '../src/domain/types';
import { installChromeMock, makeProblem, problems, settings, summary } from './ui-fixtures';

function chooseFilter(chip: string, option: RegExp): void {
  const trigger = screen.getByRole('button', { name: new RegExp(`^${chip}`) });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('checkbox', { name: option }));
}

function chooseSort(option: string): void {
  fireEvent.click(screen.getByRole('button', { name: /^排序|^添加日期|^最近复习/ }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
}

describe('面板 · 题库', () => {
  const sendMessage = vi.fn();
  beforeEach(() => {
    sendMessage.mockResolvedValue({ ok: true, data: {} });
    installChromeMock(sendMessage);
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('支持按中文题名搜索和按难度筛选', () => {
    render(<ProblemsView refresh={vi.fn()} summary={summary} />);
    fireEvent.change(screen.getByLabelText('搜索题目'), { target: { value: '接雨' } });
    expect(screen.getByText('接雨水')).toBeInTheDocument();
    expect(screen.queryByText('两数之和')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索题目'), { target: { value: '' } });
    chooseFilter('难度', /简单/);
    expect(screen.getByText('两数之和')).toBeInTheDocument();
    expect(screen.queryByText('接雨水')).not.toBeInTheDocument();
  });

  it('难度、标签可多选，并能一键清除筛选', () => {
    const three = [...problems, makeProblem('3', '无重复字符', 'MEDIUM', ['哈希表'])];
    render(<ProblemsView refresh={vi.fn()} summary={{ ...summary, problems: three }} />);
    chooseFilter('难度', /简单/);
    chooseFilter('难度', /困难/);
    expect(visibleProblemTitles().sort()).toEqual(['两数之和', '接雨水']);
    expect(screen.getByText('2 / 3 题')).toBeInTheDocument();

    chooseFilter('标签', /栈/);
    expect(visibleProblemTitles()).toEqual(['接雨水']);

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(visibleProblemTitles()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument();
  });

  it('无匹配时显示空状态并可清除筛选', () => {
    render(<ProblemsView refresh={vi.fn()} summary={summary} />);
    fireEvent.change(screen.getByLabelText('搜索题目'), { target: { value: '不存在的题' } });
    expect(screen.getByText('没有符合条件的题目')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '清除筛选' })[0]!);
    expect(visibleProblemTitles()).toHaveLength(2);
  });

  it('支持按添加日期和最近复习日期双向排序', () => {
    const sortableProblems = [
      makeProblem('1', '较早添加，最近复习', 'EASY', ['数组'], { createdAt: 1_700_000_000_100, lastReviewAt: 1_700_000_000_600 }),
      makeProblem('2', '稍晚添加，较早复习', 'MEDIUM', ['哈希表'], { createdAt: 1_700_000_000_300, lastReviewAt: 1_700_000_000_400 }),
      makeProblem('3', '最新添加，尚未复习', 'HARD', ['栈'], { createdAt: 1_700_000_000_500 }),
    ];
    render(<ProblemsView refresh={vi.fn()} summary={{ ...summary, problems: sortableProblems }} />);

    expect(visibleProblemTitles()).toEqual(['最新添加，尚未复习', '稍晚添加，较早复习', '较早添加，最近复习']);
    chooseSort('添加日期 旧→新');
    expect(visibleProblemTitles()).toEqual(['较早添加，最近复习', '稍晚添加，较早复习', '最新添加，尚未复习']);
    chooseSort('最近复习 新→旧');
    expect(visibleProblemTitles()).toEqual(['较早添加，最近复习', '稍晚添加，较早复习', '最新添加，尚未复习']);
    chooseSort('最近复习 旧→新');
    expect(visibleProblemTitles()).toEqual(['稍晚添加，较早复习', '较早添加，最近复习', '最新添加，尚未复习']);
  });

  it('支持全选当前列表后二次确认批量删除', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    sendMessage.mockResolvedValue({ ok: true, data: { deletedCount: 2 } });
    render(<ProblemsView refresh={refresh} summary={summary} />);

    fireEvent.click(screen.getByLabelText('全选当前题目'));
    expect(screen.getByLabelText('选择两数之和')).toBeChecked();
    expect(screen.getByLabelText('选择接雨水')).toBeChecked();
    const bar = screen.getByRole('region', { name: '批量操作' });
    expect(within(bar).getByText('2')).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: '删除' }));
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(within(bar).getByRole('button', { name: '确认删除 2 题' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'problem.delete',
      payload: { problemIds: ['leetcode-cn:1', 'leetcode-cn:42'] },
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(await screen.findByText('已删除 2 题')).toBeInTheDocument();
  });

  it('筛选后全选只删除当前可见题目', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    sendMessage.mockResolvedValue({ ok: true, data: { deletedCount: 1 } });
    render(<ProblemsView refresh={refresh} summary={summary} />);

    fireEvent.click(screen.getByLabelText('选择接雨水'));
    chooseFilter('难度', /简单/);
    expect(screen.queryByLabelText('选择接雨水')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '批量操作' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('全选当前题目'));
    const bar = screen.getByRole('region', { name: '批量操作' });
    fireEvent.click(within(bar).getByRole('button', { name: '删除' }));
    fireEvent.click(within(bar).getByRole('button', { name: '确认删除 1 题' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'problem.delete',
      payload: { problemIds: ['leetcode-cn:1'] },
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });

  it('行内删除需要二次确认', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<ProblemsView refresh={refresh} summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: '删除两数之和' }));
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认删除两数之和' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'problem.delete',
      payload: { problemIds: ['leetcode-cn:1'] },
    }));
  });

  it('题库链接即使在复习队列之外也不带还原标记', () => {
    render(<ProblemsView refresh={vi.fn()} summary={summary} />);
    expect(screen.getAllByRole('link', { name: /两数之和/ })[0]).toHaveAttribute('href', 'https://leetcode.cn/problems/1/');
  });

  it('支持批量暂停、恢复和按复习状态筛选', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    sendMessage.mockResolvedValue({ ok: true, data: { updatedCount: 1 } });
    const mixed: readonly ProblemRecord[] = [
      { ...problems[0]!, pausedAt: null },
      { ...problems[1]!, pausedAt: 1_700_000_000_500 },
    ];
    render(<ProblemsView refresh={refresh} settings={settings} summary={{ ...summary, problems: mixed }} />);

    fireEvent.click(screen.getByRole('radio', { name: '已暂停（1）' }));
    expect(screen.getByText('接雨水')).toBeInTheDocument();
    expect(screen.queryByText('两数之和')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('选择接雨水'));
    const bar = screen.getByRole('region', { name: '批量操作' });
    expect(within(bar).getByRole('button', { name: '暂停' })).toBeDisabled();
    fireEvent.click(within(bar).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'problem.set-paused',
      payload: { problemIds: ['leetcode-cn:42'], paused: false },
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('radio', { name: '全部（2）' }));
    fireEvent.click(screen.getByLabelText('选择两数之和'));
    fireEvent.click(within(screen.getByRole('region', { name: '批量操作' })).getByRole('button', { name: '暂停' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'problem.set-paused',
      payload: { problemIds: ['leetcode-cn:1'], paused: true },
    }));
  });
});

function visibleProblemTitles(): string[] {
  return [...screen.getByLabelText('题目列表').querySelectorAll('.ptitle b')]
    .map((node) => node.textContent?.trim() ?? '');
}
