import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewPreview } from '../src/domain/types';
import { Button, ChipMenu, Segmented, Select, Switch, ToastProvider, useToast } from '../src/ui/components';
import { RatingButtons } from '../src/ui/rating';
import {
  APPEARANCE_CACHE_KEY,
  APPEARANCE_STORAGE_KEY,
  AppearanceController,
  initPageAppearance,
  normalizeAppearance,
  readAppearance,
  resolveMode,
  subscribeAppearance,
  useAppearance,
  type AppearanceDeps,
} from '../src/ui/theme/appearance';
import { buildPaletteCss, PALETTES, paletteTokens } from '../src/ui/theme/palettes';

const DAY_MS = 24 * 60 * 60 * 1000;

type Listener = (changes: Record<string, { readonly newValue?: unknown }>, areaName: string) => void;

function createFakeStorage(initial: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...initial };
  const listeners = new Set<Listener>();
  return {
    data,
    storage: {
      get: (key: string) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
      set: (items: Record<string, unknown>) => {
        Object.assign(data, items);
        const changes = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }]));
        listeners.forEach((listener) => listener(changes, 'local'));
        return Promise.resolve();
      },
    },
    events: {
      addListener: (listener: Listener) => { listeners.add(listener); },
      removeListener: (listener: Listener) => { listeners.delete(listener); },
    },
    listenerCount: () => listeners.size,
  };
}

function createFakeMedia(matches = false) {
  const listeners = new Set<(event: { readonly matches: boolean }) => void>();
  const media = {
    matches,
    addEventListener: (_type: 'change', listener: (event: { readonly matches: boolean }) => void) => { listeners.add(listener); },
    removeEventListener: (_type: 'change', listener: (event: { readonly matches: boolean }) => void) => { listeners.delete(listener); },
    set(next: boolean) {
      media.matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
  return media;
}

function createFakeCache(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, map };
}

function deps(overrides: Partial<AppearanceDeps> = {}): AppearanceDeps {
  return { storage: null, events: null, cache: null, media: null, ...overrides };
}

describe('外观设置', () => {
  it('非法值回落到默认的松绿 + 跟随系统', () => {
    expect(normalizeAppearance(null)).toEqual({ theme: 'pine', mode: 'system' });
    expect(normalizeAppearance({ theme: 'rainbow', mode: 'dark' })).toEqual({ theme: 'pine', mode: 'dark' });
    expect(normalizeAppearance({ theme: 'mocha', mode: 'auto' })).toEqual({ theme: 'mocha', mode: 'system' });
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('light', true)).toBe('light');
  });

  it('启动时先同步读缓存，再用存储里的真值覆盖', async () => {
    const fake = createFakeStorage({ [APPEARANCE_STORAGE_KEY]: { theme: 'violet', mode: 'dark' } });
    const cache = createFakeCache({ [APPEARANCE_CACHE_KEY]: JSON.stringify({ theme: 'mocha', mode: 'light' }) });
    const controller = new AppearanceController(deps({ storage: fake.storage, events: fake.events, cache }));

    expect(controller.getSnapshot().appearance).toEqual({ theme: 'mocha', mode: 'light' });
    await controller.start();
    expect(controller.getSnapshot().appearance).toEqual({ theme: 'violet', mode: 'dark' });
    expect(JSON.parse(cache.map.get(APPEARANCE_CACHE_KEY)!)).toEqual({ theme: 'violet', mode: 'dark' });
  });

  it('一个页面改了，另一个页面通过存储变化实时同步', async () => {
    const fake = createFakeStorage();
    const popup = new AppearanceController(deps({ storage: fake.storage, events: fake.events }));
    const dashboard = new AppearanceController(deps({ storage: fake.storage, events: fake.events }));
    await Promise.all([popup.start(), dashboard.start()]);
    const onChange = vi.fn();
    dashboard.subscribe(onChange);

    await popup.setTheme('indigo');
    await popup.setMode('dark');

    expect(fake.data[APPEARANCE_STORAGE_KEY]).toEqual({ theme: 'indigo', mode: 'dark' });
    expect(dashboard.getSnapshot()).toMatchObject({ appearance: { theme: 'indigo', mode: 'dark' }, effectiveMode: 'dark' });
    expect(onChange).toHaveBeenCalledTimes(2);
    dashboard.dispose();
    popup.dispose();
    expect(fake.listenerCount()).toBe(0);
  });

  it('跟随系统时随系统外观实时切换，固定模式不受影响', async () => {
    const media = createFakeMedia(false);
    const controller = new AppearanceController(deps({ media }));
    await controller.start();
    expect(controller.getSnapshot().effectiveMode).toBe('light');

    media.set(true);
    expect(controller.getSnapshot().effectiveMode).toBe('dark');

    await controller.setMode('light');
    media.set(true);
    expect(controller.getSnapshot().effectiveMode).toBe('light');
  });

  it('写入存储失败：界面和缓存退回最近一次已持久化的外观，错误抛给调用方，可再次重试', async () => {
    const fake = createFakeStorage({ [APPEARANCE_STORAGE_KEY]: { theme: 'violet', mode: 'dark' } });
    const cache = createFakeCache();
    let fail = true;
    const storage = {
      get: fake.storage.get,
      set: (items: Record<string, unknown>) => (fail ? Promise.reject(new Error('quota')) : fake.storage.set(items)),
    };
    const controller = new AppearanceController(deps({ storage, cache }));
    await controller.start();

    await expect(controller.setTheme('indigo')).rejects.toThrow('quota');
    expect(controller.getSnapshot().appearance).toEqual({ theme: 'violet', mode: 'dark' });
    expect(JSON.parse(cache.map.get(APPEARANCE_CACHE_KEY)!)).toEqual({ theme: 'violet', mode: 'dark' });

    fail = false;
    await controller.setTheme('indigo');
    expect(controller.getSnapshot().appearance).toEqual({ theme: 'indigo', mode: 'dark' });
    expect(fake.data[APPEARANCE_STORAGE_KEY]).toEqual({ theme: 'indigo', mode: 'dark' });
  });

  it('本地改动后，迟到的初次读取不会把新值覆盖回旧值', async () => {
    let resolveGet: (value: Record<string, unknown>) => void = () => undefined;
    const storage = {
      get: () => new Promise<Record<string, unknown>>((resolve) => { resolveGet = resolve; }),
      set: () => Promise.resolve(),
    };
    const controller = new AppearanceController(deps({ storage }));
    const loading = controller.start();
    await controller.setTheme('slate');
    resolveGet({ [APPEARANCE_STORAGE_KEY]: { theme: 'violet', mode: 'dark' } });
    await loading;
    expect(controller.getSnapshot().appearance.theme).toBe('slate');
  });

  it('initPageAppearance 给 <html> 设上 data-theme / data-mode 并注入色板样式', async () => {
    const media = createFakeMedia(true);
    const controller = new AppearanceController(deps({ media }));
    const stop = initPageAppearance(document, controller);

    expect(document.documentElement.dataset).toMatchObject({ theme: 'pine', mode: 'dark' });
    expect(document.head.querySelectorAll('style[data-xsj-palettes]')).toHaveLength(1);

    await controller.update({ theme: 'mocha', mode: 'light' });
    expect(document.documentElement.dataset).toMatchObject({ theme: 'mocha', mode: 'light' });

    initPageAppearance(document, controller)();
    expect(document.head.querySelectorAll('style[data-xsj-palettes]')).toHaveLength(1);
    stop();
    controller.dispose();
  });

  it('页内卡可以只读存储并订阅变化', async () => {
    const fake = createFakeStorage({ [APPEARANCE_STORAGE_KEY]: { theme: 'slate', mode: 'dark' } });
    await expect(readAppearance(fake.storage)).resolves.toEqual({ theme: 'slate', mode: 'dark' });
    await expect(readAppearance(null)).resolves.toEqual({ theme: 'pine', mode: 'system' });

    const listener = vi.fn();
    const stop = subscribeAppearance(listener, fake.events);
    await fake.storage.set({ [APPEARANCE_STORAGE_KEY]: { theme: 'violet', mode: 'light' } });
    await fake.storage.set({ unrelated: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ theme: 'violet', mode: 'light' });
    stop();
    expect(fake.listenerCount()).toBe(0);
  });

  it('useAppearance 返回当前设置，修改后组件跟着更新', async () => {
    const controller = new AppearanceController(deps({ media: createFakeMedia(false) }));
    function Probe() {
      const { effectiveMode, mode, setMode, setTheme, theme } = useAppearance(controller);
      return (
        <div>
          <span>{`${theme}/${mode}/${effectiveMode}`}</span>
          <button onClick={() => void setTheme('violet')} type="button">紫藤</button>
          <button onClick={() => void setMode('dark')} type="button">深色</button>
        </div>
      );
    }
    render(<Probe />);
    expect(screen.getByText('pine/system/light')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '紫藤' }));
    fireEvent.click(screen.getByRole('button', { name: '深色' }));
    expect(await screen.findByText('violet/dark/dark')).toBeInTheDocument();
    cleanup();
    controller.dispose();
  });
});

describe('色板', () => {
  it('5 套主题色 × 浅/深色都生成完整变量', () => {
    const css = buildPaletteCss(':root');
    expect(PALETTES.map((palette) => palette.id)).toEqual(['pine', 'indigo', 'violet', 'mocha', 'slate']);
    const keys = Object.keys(paletteTokens(PALETTES[0]!, 'light'));
    for (const palette of PALETTES) {
      for (const mode of ['light', 'dark'] as const) {
        const selector = `:root[data-theme="${palette.id}"][data-mode="${mode}"]{`;
        expect(css).toContain(selector);
        const tokens = paletteTokens(palette, mode);
        expect(Object.keys(tokens)).toEqual(keys);
        expect(tokens.brand).toMatch(/^oklch\(/);
        expect(tokens.focus).toMatch(/ \/ 0\.\d+\)$/);
      }
    }
    expect(css.split('\n')).toHaveLength(10);
  });

  it('作用域选择器可替换，供页内卡的 shadow root 使用', () => {
    expect(buildPaletteCss('.xsj-card')).toContain('.xsj-card[data-theme="mocha"][data-mode="dark"]{');
  });
});

describe('通用控件', () => {
  afterEach(() => { cleanup(); });

  it('分段控件可点击和用方向键切换', () => {
    function Demo() {
      const [value, setValue] = useState<'all' | 'active' | 'paused'>('all');
      return (
        <>
          <Segmented ariaLabel="状态" onChange={setValue} options={[{ value: 'all', label: '全部' }, { value: 'active', label: '复习中' }, { value: 'paused', label: '已暂停' }]} value={value} />
          <output>{value}</output>
        </>
      );
    }
    render(<Demo />);
    expect(screen.getByRole('radio', { name: '全部' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '已暂停' }));
    expect(screen.getByRole('status')).toHaveTextContent('paused');
    fireEvent.keyDown(screen.getByRole('radio', { name: '已暂停' }), { key: 'ArrowRight' });
    expect(screen.getByRole('status')).toHaveTextContent('all');
    expect(screen.getByRole('radio', { name: '全部' })).toHaveFocus();
  });

  it('开关切换、按钮加载时禁用但保留名称', () => {
    const onChange = vi.fn();
    render(<><Switch checked={false} label="每日提醒" onChange={onChange} /><Button loading tone="primary">保存</Button></>);
    fireEvent.click(screen.getByRole('switch', { name: '每日提醒' }));
    expect(onChange).toHaveBeenCalledWith(true);
    const save = screen.getByRole('button', { name: '保存' });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(save).toHaveClass('btn', 'primary', 'loading');
  });

  it('筛选标签：多选、显示摘要、× 清除、Esc 与点外部关闭', () => {
    function Demo() {
      const [selected, setSelected] = useState<('EASY' | 'MEDIUM' | 'HARD')[]>([]);
      return <ChipMenu label="难度" onChange={setSelected} options={[{ value: 'EASY', label: '简单' }, { value: 'MEDIUM', label: '中等' }, { value: 'HARD', label: '困难' }]} selected={selected} />;
    }
    render(<><Demo /><p>外部</p></>);
    const chip = screen.getByRole('button', { name: '难度' });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('checkbox', { name: '困难' }));
    expect(screen.getByRole('button', { name: '难度：困难' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: '简单' }));
    expect(screen.getByRole('button', { name: '难度 · 2' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('checkbox', { name: '简单' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: '难度' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '难度 · 2' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '难度 · 2' }));
    fireEvent.mouseDown(screen.getByText('外部'));
    expect(screen.queryByRole('group', { name: '难度' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除难度筛选' }));
    expect(screen.getByRole('button', { name: '难度' })).toBeInTheDocument();
  });

  it('单选菜单选一项后关闭', () => {
    const onChange = vi.fn();
    render(<ChipMenu label="排序" multiple={false} onChange={onChange} options={[{ value: 'new', label: '最新添加' }, { value: 'old', label: '最早添加' }]} selected={['new']} />);
    fireEvent.click(screen.getByRole('button', { name: '排序：最新添加' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '最早添加' }));
    expect(onChange).toHaveBeenCalledWith(['old']);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('自定义下拉框：支持点击选择、键盘导航与外部关闭', () => {
    function Demo() {
      const [value, setValue] = useState<'none' | 'hot' | 'sprint'>('none');
      return (
        <>
          <Select
            ariaLabel="目标分组"
            onChange={setValue}
            options={[
              { value: 'none', label: '不自动归组' },
              { value: 'hot', label: '高频核心', hint: '90%' },
              { value: 'sprint', label: '冲刺核心', hint: '95%' },
            ]}
            value={value}
          />
          <output>{value}</output>
          <p>外部空白</p>
        </>
      );
    }
    render(<Demo />);
    const trigger = screen.getByRole('combobox', { name: '目标分组' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: '不自动归组' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('option', { name: /高频核心/ }));
    expect(screen.getByRole('status')).toHaveTextContent('hot');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('status')).toHaveTextContent('sprint');

    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByText('外部空白'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('提示条', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  function Trigger({ onUndo }: { readonly onUndo: () => void }) {
    const toast = useToast();
    return <button onClick={() => toast.show({ message: '已评为「掌握」', action: { label: '撤销', onAction: onUndo } })} type="button">评分</button>;
  }

  it('带撤销的提示 5 秒后自动消失', () => {
    render(<ToastProvider><Trigger onUndo={vi.fn()} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: '评分' }));
    expect(screen.getByRole('status')).toHaveTextContent('已评为「掌握」');
    expect(screen.getByRole('status').querySelector('.bar')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(4_900); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('点撤销会执行操作并关闭提示', () => {
    const onUndo = vi.fn();
    render(<ToastProvider><Trigger onUndo={onUndo} /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: '评分' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(screen.queryByText('已评为「掌握」')).not.toBeInTheDocument();
  });

  it('不在 ToastProvider 内时 useToast 是空实现', () => {
    function Probe() { return <span>{useToast().available ? '有' : '无'}</span>; }
    render(<Probe />);
    expect(screen.getByText('无')).toBeInTheDocument();
  });
});

describe('评分按钮', () => {
  const sendMessage = vi.fn();
  const now = Date.now();
  const preview: ReviewPreview = { AGAIN: now + DAY_MS, HARD: now + 3 * DAY_MS, GOOD: now + 9 * DAY_MS, EASY: now + 24 * DAY_MS };

  beforeEach(() => {
    sendMessage.mockImplementation((request: { readonly type: string }) => {
      if (request.type === 'review.preview') return Promise.resolve({ ok: true, data: preview });
      if (request.type === 'submission.rate') return Promise.resolve({ ok: true, data: { review: {}, nextReviewAt: preview.GOOD } });
      if (request.type === 'submission.unrate') return Promise.resolve({ ok: true, data: { review: {}, nextReviewAt: null } });
      return Promise.reject(new Error(`unexpected ${request.type}`));
    });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage } } });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('传入题目时显示各档下次间隔', async () => {
    render(<RatingButtons onRated={vi.fn()} problemId="leetcode-cn:two-sum" submissionId="1" />);
    expect(await screen.findByRole('button', { name: '掌握（9 天）' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '未掌握（明天）' })).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'review.preview', payload: { problemId: 'leetcode-cn:two-sum', submissionId: '1' } });
  });

  it('评分后弹出可撤销的提示，撤销会恢复待评估并刷新', async () => {
    const onRated = vi.fn();
    const onUndone = vi.fn();
    render(
      <ToastProvider>
        <RatingButtons onRated={onRated} onUndone={onUndone} preview={preview} settleDelayMs={0} submissionId="1" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '掌握（9 天）' }));
    expect(screen.getByRole('button', { name: '掌握（9 天）' })).toHaveClass('chosen');
    expect(screen.getByRole('button', { name: '吃力（3 天）' })).toHaveClass('dim');
    await waitFor(() => expect(onRated).toHaveBeenCalledWith(expect.objectContaining({ rating: 'GOOD', nextReviewAt: preview.GOOD })));
    expect(screen.getByRole('status')).toHaveTextContent('已评为「掌握」· 9 天后复习');

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(onUndone).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'submission.unrate', payload: { submissionId: '1', rating: 'GOOD' } });
    expect(screen.getByRole('status')).toHaveTextContent('已撤销评分');
    expect(screen.getByRole('button', { name: '掌握（9 天）' })).not.toHaveClass('chosen');
  });

  it('动画结束前撤销：不再调用 onRated，按钮立即恢复可评分', async () => {
    const onRated = vi.fn();
    const onUndone = vi.fn();
    render(
      <ToastProvider>
        <RatingButtons onRated={onRated} onUndone={onUndone} preview={preview} settleDelayMs={120} submissionId="1" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '掌握（9 天）' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销' }));
    await waitFor(() => expect(onUndone).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: '掌握（9 天）' })).toBeEnabled();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(onRated).not.toHaveBeenCalled();
  });

  it('评分失败时恢复可选并显示错误', async () => {
    sendMessage.mockImplementation(() => Promise.resolve({ ok: false, error: { code: 'X', message: '后台繁忙' } }));
    render(<RatingButtons onRated={vi.fn()} settleDelayMs={0} submissionId="1" />);
    fireEvent.click(screen.getByRole('button', { name: '熟练' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('后台繁忙');
    expect(screen.getByRole('button', { name: '熟练' })).toBeEnabled();
  });

  it('键盘 1–4 可评分，焦点在输入框里时不触发', async () => {
    const onRated = vi.fn();
    render(<><input aria-label="代码" /><RatingButtons keyboard onRated={onRated} settleDelayMs={0} submissionId="1" /></>);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '代码' }), { key: '3' });
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: '3' });
    await waitFor(() => expect(onRated).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'submission.rate', payload: { submissionId: '1', rating: 'GOOD' } });
  });
});
