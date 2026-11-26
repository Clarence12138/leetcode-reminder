import { useMemo, useRef } from 'react';
import { computeHeatmap } from '../../../../src/domain/stats';
import type { SubmissionReview } from '../../../../src/domain/types';
import { Card } from '../../../../src/ui/components';
import { ChartTip, formatDayKey, useChartTip, useElementWidth } from './chart-utils';

const CELL = 14;
const GAP = 3;
const STEP = CELL + GAP;
const DAYS_COLUMN = 28;
const MIN_WEEKS = 12;
const MAX_WEEKS = 43;
const FALLBACK_WIDTH = 760;
const LEVELS = [0, 1, 2, 3, 4] as const;

/** 周一到周日，只标周一、三、五。 */
const DAY_LABELS = ['', '', '一', '', '三', '', '五', ''] as const;

export function HeatmapCard({ cold, now, reviews, timezone }: {
  readonly cold: boolean;
  readonly now: number;
  readonly reviews: readonly SubmissionReview[];
  readonly timezone: string;
}): React.ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(bodyRef, FALLBACK_WIDTH);
  const weeks = Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.floor((width - DAYS_COLUMN + GAP) / STEP)));
  const heatmap = useMemo(() => computeHeatmap(reviews, { timezone, now, weeks }), [reviews, timezone, now, weeks]);
  const { hide, show, tip } = useChartTip();
  const months = useMemo(() => buildMonthLabels(heatmap.cells), [heatmap.cells]);
  const summary = `近 ${weeks} 周 · 复习 ${heatmap.total} 次 · 活跃 ${heatmap.activeDays} 天`;
  return (
    <Card aside={cold && heatmap.total === 0 ? '从这里开始' : summary} className="ov-heatmap" title="复习热力图">
      <div ref={bodyRef}>
        <div aria-label={`复习热力图，${summary}`} className="hm" role="img">
          <div className="hm-days">{DAY_LABELS.map((label, index) => <span key={index}>{label}</span>)}</div>
          <div>
            <div className="hm-months">{months.map((month) => <span key={month.week} style={{ left: month.week * STEP }}>{month.label}</span>)}</div>
            <div className="hm-cells">
              {heatmap.cells.map((cell) => {
                if (cell.isFuture) return <i key={cell.day} style={{ visibility: 'hidden' }} />;
                const label = formatDayKey(cell.day);
                return (
                  <i
                    className={cell.isToday ? 'today' : undefined}
                    data-l={cell.level}
                    key={cell.day}
                    onMouseLeave={hide}
                    onMouseMove={(event) => show(event, <><b>{label}</b><br />{cell.count > 0 ? `复习 ${cell.count} 题` : '没有复习'}</>)}
                  />
                );
              })}
            </div>
          </div>
        </div>
        <div className="hm-foot">
          <span>{cold ? '每天复习一点，格子会慢慢填满' : '每格一天，颜色越深当天复习越多'}</span>
          <span aria-hidden="true" className="legend-scale">
            少{LEVELS.map((level) => <i key={level} style={{ background: `var(--s${level})` }} />)}多
          </span>
        </div>
      </div>
      <ChartTip tip={tip} />
    </Card>
  );
}

function buildMonthLabels(cells: ReturnType<typeof computeHeatmap>['cells']): readonly { readonly week: number; readonly label: string }[] {
  const labels: { week: number; label: string }[] = [];
  let lastMonth = -1;
  for (let index = 0; index < cells.length; index += 7) {
    const cell = cells[index];
    if (!cell) continue;
    const [, month, date] = cell.day.split('-').map(Number);
    if (month !== undefined && date !== undefined && month !== lastMonth && date <= 7) {
      lastMonth = month;
      labels.push({ week: index / 7, label: `${month}月` });
    }
  }
  return labels;
}
