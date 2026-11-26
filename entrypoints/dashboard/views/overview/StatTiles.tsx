import { dayKeyWeekday, MASTERY_LEVELS } from '../../../../src/domain/stats';
import type { Settings } from '../../../../src/domain/types';
import { Meter, Tile } from '../../../../src/ui/components';
import { WEEKDAY_CHARS } from './chart-utils';
import type { OverviewModel } from './overview-model';

const PERCENT = 100;
const MIN_RETENTION_SAMPLE = 10;
const STABLE_LABEL = MASTERY_LEVELS.find((level) => level.id === 'stable')?.hint ?? '';

export function StatTiles({ model, settings }: { readonly model: OverviewModel; readonly settings: Settings }): React.ReactElement {
  return (
    <div className="tiles">
      <ProgressTile model={model} />
      <StreakTile model={model} />
      <RetentionTile model={model} settings={settings} />
      <StableTile model={model} />
    </div>
  );
}

function ProgressTile({ model }: { readonly model: OverviewModel }): React.ReactElement {
  const { cold, progress } = model;
  const unit = progress.limit === null ? `/ ${progress.target} 题` : `/ ${progress.target} 题配额`;
  let delta: string;
  if (progress.target === 0) delta = cold ? '第一次复习通常在评分后 1–3 天出现' : '今天没有到期的题';
  else if (progress.done) delta = progress.backlog > 0 ? `今天的配额完成了 · 另有 ${progress.backlog} 题积压` : '今天的复习完成了';
  else delta = `还剩 ${progress.remaining} 题${progress.backlog > 0 ? ` · 另有 ${progress.backlog} 题积压` : ''}`;
  return (
    <Tile delta={delta} label="今日进度" unit={unit} value={<span className="num">{progress.completed}</span>}>
      <Meter label="今日复习进度" max={Math.max(progress.target, 1)} value={progress.completed} />
    </Tile>
  );
}

function StreakTile({ model }: { readonly model: OverviewModel }): React.ReactElement {
  const { streak } = model;
  const delta = streak.longest > streak.current ? `最长 ${streak.longest} 天` : streak.current > 0 ? '保持住，今天也复习一下' : '今天复习一道题就开始计数';
  return (
    <Tile delta={delta} label="连续复习" unit="天" value={<span className="num">{streak.current}</span>}>
      <div aria-label="最近 7 天复习情况" className="week" role="img">
        {streak.week.map((day) => (
          <i className={`${day.active ? 'y' : ''}${day.isToday ? ' t' : ''}`.trim()} key={day.day} title={`${day.day}${day.active ? ' 已复习' : ''}`}>
            {/* week 是截至今天的最近 7 天，按实际星期标注 */}
            {WEEKDAY_CHARS[dayKeyWeekday(day.day)]}
          </i>
        ))}
      </div>
    </Tile>
  );
}

function RetentionTile({ model, settings }: { readonly model: OverviewModel; readonly settings: Settings }): React.ReactElement {
  const { cold, retention } = model;
  if (retention.rate === null) {
    return (
      <Tile
        delta={cold ? `评满 ${MIN_RETENTION_SAMPLE} 次后开始计算` : '近 30 天还没有复习，复习后开始计算'}
        dim
        label="近 30 天记住率"
        value="—"
      />
    );
  }
  const change = retention.previousRate === null ? null : Math.round((retention.rate - retention.previousRate) * PERCENT);
  return (
    <Tile
      delta={(
        <>
          近 30 天复习时没评为「未掌握」的比例
          {change !== null && change !== 0 && <> · <b>较上月 {change > 0 ? '+' : ''}{change}%</b></>}
        </>
      )}
      label="近 30 天记住率"
      unit={`目标 ${Math.round(settings.defaultRequestRetention * PERCENT)}%`}
      value={<><span className="num">{Math.round(retention.rate * PERCENT)}</span>%</>}
    />
  );
}

function StableTile({ model }: { readonly model: OverviewModel }): React.ReactElement {
  const { mastery } = model;
  const gain = mastery.stableGain;
  return (
    <Tile
      delta={mastery.total === 0
        ? '间隔超过 21 天的题会算作稳定掌握'
        : <>间隔{STABLE_LABEL.replace('> ', '超过 ')}的题目{gain !== null && gain > 0 && <> · <b>本周 +{gain}</b></>}</>}
      label="已稳定掌握"
      unit={`/ ${model.problemMap.size} 题`}
      value={<span className="num">{mastery.counts.stable}</span>}
    />
  );
}
