import { useCallback, useEffect, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { dayKeyWeekday, localDayKey } from '../../../../src/domain/stats';

/** 0 = 周一 … 6 = 周日。 */
export const WEEKDAY_CHARS = ['一', '二', '三', '四', '五', '六', '日'] as const;

/** `YYYY-MM-DD` → “11月25日”。 */
export function formatDayKey(day: string): string {
  const [, month, date] = day.split('-').map(Number);
  return `${month ?? ''}月${date ?? ''}日`;
}

export function weekdayLabel(day: string): string {
  return `周${WEEKDAY_CHARS[dayKeyWeekday(day)] ?? ''}`;
}

/** “11 月 25 日 · 周三”（按设置的时区）。 */
export function formatTodayLine(now: number, timezone: string): string {
  const day = localDayKey(now, timezone);
  const [, month, date] = day.split('-').map(Number);
  return `${month ?? ''} 月 ${date ?? ''} 日 · ${weekdayLabel(day)}`;
}

const GREETINGS: readonly (readonly [number, string])[] = [
  [5, '夜深了'],
  [11, '早上好'],
  [13, '中午好'],
  [18, '下午好'],
  [24, '晚上好'],
];

export function greetingFor(now: number, timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  return GREETINGS.find(([end]) => hour < end)?.[1] ?? '你好';
}

// ---------------------------------------------------------------------------
// 悬停提示：跟随鼠标的小黑框（样式 .tip 在 shared.css）

export interface ChartTipState {
  readonly x: number;
  readonly y: number;
  readonly content: ReactNode;
}

export interface ChartTipApi {
  readonly tip: ChartTipState | null;
  readonly show: (event: MouseEvent, content: ReactNode) => void;
  readonly hide: () => void;
}

const TIP_OFFSET = 14;

export function useChartTip(): ChartTipApi {
  const [tip, setTip] = useState<ChartTipState | null>(null);
  const show = useCallback((event: MouseEvent, content: ReactNode): void => {
    setTip({ x: event.clientX + TIP_OFFSET, y: event.clientY + TIP_OFFSET, content });
  }, []);
  const hide = useCallback((): void => setTip(null), []);
  return { tip, show, hide };
}

export function ChartTip({ tip }: { readonly tip: ChartTipState | null }): React.ReactElement | null {
  if (!tip) return null;
  return <div aria-hidden="true" className="tip chart-tip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>;
}

// ---------------------------------------------------------------------------
// 元素宽度：图表按容器宽度排版（测试环境没有 ResizeObserver 时用默认值）

export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next > 0) setWidth(Math.round(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width ?? fallback;
}

/** 坐标轴刻度：从 0 起等距，最多 4 条，最后一条不小于 top。 */
export function niceTicks(top: number): readonly number[] {
  const step = niceStep(Math.max(top, 1) / 3);
  const ticks = [0];
  while (ticks.at(-1)! < top) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

const STEP_BASES = [1, 2, 2.5, 5, 10] as const;
const SMALL_STEP_LIMIT = 10;

function niceStep(raw: number): number {
  if (raw <= SMALL_STEP_LIMIT) return Math.ceil(raw);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const base = STEP_BASES.find((candidate) => candidate * magnitude >= raw) ?? 10;
  return Math.max(1, Math.ceil(base * magnitude));
}
