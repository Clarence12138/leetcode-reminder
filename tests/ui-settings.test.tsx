import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView } from '../entrypoints/dashboard/views/SettingsView';
import type { Settings } from '../src/domain/types';
import { APPEARANCE_STORAGE_KEY, resetAppearanceController } from '../src/ui/theme/appearance';
import { installChromeMock, settings, summary } from './ui-fixtures';

const FAILURE = { ok: false, error: { code: 'STORAGE_FAILED', message: '写入存储失败' } };

describe('面板 · 设置', () => {
  const sendMessage = vi.fn();
  const storageSet = vi.fn().mockResolvedValue(undefined);
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    sendMessage.mockResolvedValue({ ok: true, data: {} });
    installChromeMock(sendMessage);
    const chromeMock = (globalThis as unknown as { chrome: { storage: Record<string, unknown> } }).chrome;
    chromeMock.storage.local = { get: vi.fn().mockResolvedValue({}), set: storageSet };
    resetAppearanceController();
    refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  });
  afterEach(() => { cleanup(); resetAppearanceController(); vi.clearAllMocks(); });

  const renderView = (value: Settings = settings): void => {
    render(<SettingsView refresh={refresh} settings={value} summary={summary} />);
  };

  it('按顺序展示区块，并提供锚点导航', () => {
    renderView();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['外观', '提醒', '复习', '分组与题单', '导入力扣历史', '数据', '危险操作']);
    const nav = screen.getByRole('navigation', { name: '设置分区' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['外观', '提醒', '复习', '分组与题单', '导入力扣历史', '数据', '危险操作']);
    fireEvent.click(within(nav).getByRole('button', { name: '数据' }));
    expect(within(nav).getByRole('button', { name: '数据' })).toHaveAttribute('aria-current', 'true');
  });

  it('测试通知仅报告 Chrome API 创建成功', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: '发送测试通知' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'notification.test' }));
    expect(await screen.findByText(/Chrome 通知 API 已成功创建/)).toBeInTheDocument();
    expect(screen.getByText(/系统是否展示取决于/)).toBeInTheDocument();
  });

  it('还原代码开关改动后立即保存并提示「已保存」', async () => {
    renderView();
    fireEvent.click(screen.getByRole('switch', { name: '打开复习题时还原代码模板' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { resetCodeOnReview: true },
    }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(await screen.findByText('已保存')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '打开复习题时还原代码模板' })).toHaveAttribute('aria-checked', 'true');
  });

  it('保存失败时回滚控件并显示错误', async () => {
    sendMessage.mockResolvedValue(FAILURE);
    renderView();
    fireEvent.click(screen.getByRole('switch', { name: '打开复习题时还原代码模板' }));
    expect(await screen.findByText('写入存储失败')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '打开复习题时还原代码模板' })).toHaveAttribute('aria-checked', 'false');
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });

  it('提醒时间在失焦后才保存，失败时回到原值', async () => {
    renderView();
    const input = screen.getByLabelText('每日提醒时间');
    fireEvent.change(input, { target: { value: '21:30' } });
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { reminderHour: 21, reminderMinute: 30 },
    }));

    sendMessage.mockResolvedValue(FAILURE);
    fireEvent.change(input, { target: { value: '07:15' } });
    fireEvent.blur(input);
    expect(await screen.findByText('写入存储失败')).toBeInTheDocument();
    expect(input).toHaveValue('09:00');
  });

  it('关闭「跟随系统时区」后可在下拉框里搜索并选择任意时区', async () => {
    renderView();
    expect(screen.queryByRole('button', { name: '手动时区' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: '跟随系统时区' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { timezoneMode: 'manual' },
    }));
    cleanup();
    sendMessage.mockClear();

    renderView({ ...settings, timezoneMode: 'manual' });
    const trigger = screen.getByRole('button', { name: '手动时区' });
    expect(trigger).toHaveTextContent('Asia/Shanghai（上海）');
    fireEvent.click(trigger);
    const search = screen.getByRole('combobox', { name: '搜索手动时区' });
    expect(search).toHaveFocus();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(300);
    expect(screen.getByRole('option', { name: /Asia\/Shanghai/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.change(search, { target: { value: 'zzqqxx' } });
    expect(screen.getByText('没有匹配的时区')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: '东京' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Asia/Tokyo（东京）');
    fireEvent.keyDown(search, { key: 'Enter' });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { timezone: 'Asia/Tokyo' },
    }));
    expect(screen.queryByRole('listbox', { name: '手动时区' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '手动时区' })).toHaveFocus();
  });

  it('时区下拉框支持直接打字展开、方向键选择和 Esc 关闭', async () => {
    renderView({ ...settings, timezoneMode: 'manual' });
    const trigger = screen.getByRole('button', { name: '手动时区' });
    fireEvent.keyDown(trigger, { key: 'n' });
    const search = screen.getByRole('combobox', { name: '搜索手动时区' });
    expect(search).toHaveValue('n');
    fireEvent.change(search, { target: { value: 'new york' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('America/New_York');
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: '搜索手动时区' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    const reopened = screen.getByRole('combobox', { name: '搜索手动时区' });
    fireEvent.change(reopened, { target: { value: '+9' } });
    fireEvent.keyDown(reopened, { key: 'ArrowDown' });
    const options = screen.getAllByRole('option');
    expect(options[1]).toHaveClass('is-active');
    fireEvent.click(options[0]!);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'settings.update' })));
  });

  it('每日配额支持预设和自定义（1–200 校验）', async () => {
    renderView();
    fireEvent.click(screen.getByRole('radio', { name: '3 题' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { dailyReviewLimit: 3 },
    }));

    fireEvent.click(screen.getByRole('radio', { name: '自定义' }));
    const input = await screen.findByLabelText('自定义每日复习配额');
    sendMessage.mockClear();
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.blur(input);
    expect(await screen.findByText('每日配额需为 1–200 之间的整数。')).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { dailyReviewLimit: 12 },
    }));
  });

  it('自定义配额保存失败后，输入框回到回滚后的值', async () => {
    renderView();
    fireEvent.click(screen.getByRole('radio', { name: '自定义' }));
    const input = await screen.findByLabelText('自定义每日复习配额');
    sendMessage.mockResolvedValue(FAILURE);
    fireEvent.change(input, { target: { value: '12' } });
    fireEvent.blur(input);
    expect(await screen.findByText('写入存储失败')).toBeInTheDocument();
    expect(screen.getByLabelText('自定义每日复习配额')).toHaveValue(null);
  });

  it('保持率连点后立刻卸载：待保存的值会被保存而不是丢弃', () => {
    const { unmount } = render(<SettingsView refresh={refresh} settings={settings} summary={summary} />);
    fireEvent.click(screen.getByRole('button', { name: '增加默认保持率' }));
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'settings.update' }));
    unmount();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'settings.update', payload: { defaultRequestRetention: 0.91 } });
  });

  it('队列排序与默认保持率即时保存', async () => {
    renderView();
    fireEvent.click(screen.getByRole('combobox', { name: '默认队列排序策略' }));
    fireEvent.click(screen.getByRole('option', { name: /智能优先/ }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { queueSortStrategy: 'priority' },
    }));
    fireEvent.click(screen.getByRole('button', { name: '增加默认保持率' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { defaultRequestRetention: 0.91 },
    }));
  });

  it('外观：切换主题色和模式写入外观存储，跟随系统时说明系统外观', async () => {
    renderView();
    expect(screen.getByRole('radio', { name: '松绿' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/跟随系统：系统当前是/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '靛蓝' }));
    await waitFor(() => expect(storageSet).toHaveBeenCalledWith({ [APPEARANCE_STORAGE_KEY]: { theme: 'indigo', mode: 'system' } }));
    expect(await screen.findByText('已保存')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '靛蓝' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    await waitFor(() => expect(storageSet).toHaveBeenCalledWith({ [APPEARANCE_STORAGE_KEY]: { theme: 'indigo', mode: 'dark' } }));
    expect(screen.getByText(/固定为/)).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'settings.update' }));
  });

  it('创建分组、一键归组高频题单', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: { matchedCount: 1, updatedCount: 1 } });
    const groupedSettings: Settings = {
      ...settings,
      reviewGroups: [{ id: 'hot', name: '高频核心', requestRetention: 0.9 }],
    };
    renderView(groupedSettings);

    fireEvent.click(screen.getByRole('button', { name: '一键归组所选题单命中题目' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'problem.apply-list-group',
      payload: { listIds: ['hot-100'], groupId: 'hot' },
    }));
    expect(await screen.findByText(/已匹配本地 1 道题/)).toBeInTheDocument();

    const nameInput = screen.getByLabelText('新分组名称');
    const createBtn = screen.getByRole('button', { name: '新建分组' });
    expect(createBtn).toBeEnabled();
    fireEvent.click(createBtn);
    expect(nameInput).toHaveFocus();
    expect(await screen.findByText('请输入分组名称')).toBeInTheDocument();

    fireEvent.change(nameInput, { target: { value: '冲刺' } });
    fireEvent.click(createBtn);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { reviewGroups: [...groupedSettings.reviewGroups, { id: '冲刺', name: '冲刺', requestRetention: 0.9 }] },
    }));
  });

  it('分组保持率用步进器调整', async () => {
    renderView({ ...settings, reviewGroups: [{ id: 'hot', name: '高频核心', requestRetention: 0.9 }] });
    fireEvent.click(screen.getByRole('button', { name: '增加高频核心保持率' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'settings.update',
      payload: { reviewGroups: [{ id: 'hot', name: '高频核心', requestRetention: 0.91 }] },
    }));
  });

  it('清空数据需输入确认词', async () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: '清空全部数据' }));
    const dialog = await screen.findByRole('dialog', { name: '确认清空全部数据' });
    const confirm = within(dialog).getByRole('button', { name: '确认清空' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '清空' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'data.clear' }));
    expect(await screen.findByText('所有本地复习数据已清空。')).toBeInTheDocument();
  });
});
