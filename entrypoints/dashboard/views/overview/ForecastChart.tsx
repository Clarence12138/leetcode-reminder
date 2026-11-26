import { useRef } from 'react';
import type { ChartTipApi } from './chart-utils';
import type { ForecastSummary } from '../../../../src/domain/stats';
import { Card } from '../../../../src/ui/components';
import { ChartTip, formatDayKey, niceTicks, useChartTip, useElementWidth, WEEKDAY_CHARS } from './chart-utils';

const HEIGHT = 176;
const PAD_TOP = 18;
const PAD_BOTTOM = 22;
const LEFT = 24;
const BAR_WIDTH = 14;
const BAR_RADIUS = 4;
const FALLBACK_WIDTH = 362;

interface Bar {
  readonly key: string;
  readonly count: number;
  readonly axis: string;
  readonly kind: 'overdue' | 'today' | 'peak' | 'normal';
  readonly title: string;
  readonly detail: string;
}

function buildBars(forecast: ForecastSummary, limit: number | null): readonly Bar[] {
  const peakIndex = forecast.max > 0 ? forecast.days.findIndex((day) => day.count === forecast.max) : -1;
  const over = (count: number): string => (limit !== null && count > limit ? `，超出配额 ${count - limit}` : '');
  const bars: Bar[] = forecast.days.map((day, index) => ({
    key: day.day,
    count: day.count,
    axis: day.isToday ? '今' : (WEEKDAY_CHARS[day.weekday] ?? ''),
    kind: day.isToday ? 'today' : index === peakIndex ? 'peak' : 'normal',
    title: day.isToday ? '今天' : `${formatDayKey(day.day)} 周${WEEKDAY_CHARS[day.weekday] ?? ''}`,
    detail: `到期 ${day.count} 题${over(day.count)}`,
  }));
  if (forecast.overdue > 0) {
    bars.unshift({ key: 'overdue', count: forecast.overdue, axis: '逾', kind: 'overdue', title: '已逾期', detail: `还有 ${forecast.overdue} 题没复习` });
  }
  return bars;
}

export function ForecastCard({ cold, forecast, limit }: {
  readonly cold: boolean;
  readonly forecast: ForecastSummary;
  readonly limit: number | null;
}): React.ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(bodyRef, FALLBACK_WIDTH);
  const { hide, show, tip } = useChartTip();
  const empty = forecast.total + forecast.overdue === 0;
  const bars = buildBars(forecast, limit);
  const ticks = niceTicks(Math.max(forecast.max, forecast.overdue, limit ?? 0, 1));
  const aside = cold ? '只有评过分的题才会排期' : forecast.overdue > 0 ? `逾期 ${forecast.overdue} 题` : '按当前排期';
  const label = `未来 14 天到期：共 ${forecast.total} 题${forecast.overdue > 0 ? `，另有 ${forecast.overdue} 题已逾期` : ''}`;
  return (
    <Card aside={aside} className="ov-forecast" title="未来 14 天到期">
      <div className="fc" ref={bodyRef}>
        {empty
          ? <p className="ov-chart-empty">{cold ? '评分后，下次复习的日子会按天显示在这里。' : '未来 14 天没有到期的题。'}</p>
          : (
            <ForecastSvg bars={bars} hide={hide} label={label} limit={limit} show={show} ticks={ticks} width={width} />
          )}
      </div>
      <ChartTip tip={tip} />
    </Card>
  );
}

function ForecastSvg({ bars, hide, label, limit, show, ticks, width }: {
  readonly bars: readonly Bar[];
  readonly hide: ChartTipApi['hide'];
  readonly label: string;
  readonly limit: number | null;
  readonly show: ChartTipApi['show'];
  readonly ticks: readonly number[];
  readonly width: number;
}): React.ReactElement {
  const scaleMax = ticks.at(-1) ?? 1;
  const y = (value: number): number => PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOTTOM) * (1 - value / scaleMax);
  const slot = (width - LEFT) / bars.length;
  return (
    <svg aria-label={label} height={HEIGHT} role="img" width={width}>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className={tick === 0 ? 'base' : 'grid'} x1={LEFT} x2={width} y1={y(tick)} y2={y(tick)} />
          <text x={0} y={y(tick) + 4}>{tick}</text>
        </g>
      ))}
      {limit !== null && limit <= scaleMax && (
        <g>
          <line className="quota" strokeDasharray="4 3" x1={LEFT} x2={width} y1={y(limit)} y2={y(limit)} />
          <text textAnchor="end" x={width} y={y(limit) - 5}>每日配额 {limit}</text>
        </g>
      )}
      {bars.map((bar, index) => {
        const x = LEFT + index * slot + (slot - BAR_WIDTH) / 2;
        const barTop = y(bar.count);
        const base = y(0);
        return (
          <g key={bar.key} onMouseLeave={hide} onMouseMove={(event) => show(event, <><b>{bar.title}</b><br />{bar.detail}</>)}>
            <rect className="hit" height={HEIGHT - PAD_TOP - PAD_BOTTOM} width={slot} x={LEFT + index * slot} y={PAD_TOP} />
            {bar.count > 0 && (
              <path
                className={`bar-${bar.kind}`}
                d={`M${x},${base} V${barTop + BAR_RADIUS} Q${x},${barTop} ${x + BAR_RADIUS},${barTop} H${x + BAR_WIDTH - BAR_RADIUS} Q${x + BAR_WIDTH},${barTop} ${x + BAR_WIDTH},${barTop + BAR_RADIUS} V${base} Z`}
              />
            )}
            {bar.kind !== 'normal' && bar.count > 0 && <text className="v" textAnchor="middle" x={x + BAR_WIDTH / 2} y={barTop - 5}>{bar.count}</text>}
            <text textAnchor="middle" x={x + BAR_WIDTH / 2} y={HEIGHT - 6}>{bar.axis}</text>
          </g>
        );
      })}
    </svg>
  );
}
