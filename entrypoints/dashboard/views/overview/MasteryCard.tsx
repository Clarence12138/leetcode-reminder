import { MASTERY_LEVELS, type MasteryDistribution } from '../../../../src/domain/stats';
import { Card } from '../../../../src/ui/components';

const SHADES = [2, 3, 4, 5] as const;

export function MasteryCard({ mastery }: { readonly mastery: MasteryDistribution }): React.ReactElement {
  const summary = MASTERY_LEVELS.map((level) => `${level.label} ${mastery.counts[level.id]}`).join('，');
  const aside = mastery.total === 0
    ? '评分后开始统计'
    : `共 ${mastery.total} 题${mastery.unrated > 0 ? ` · 另有 ${mastery.unrated} 题待评分` : ''}`;
  return (
    <Card aside={aside} className="ov-mastery" title="掌握分布">
      {mastery.total === 0
        ? <p className="ov-chart-empty">题目评过分后，会按间隔长短分成新学、学习中、复习中、已稳定四档。</p>
        : (
          <div aria-label={summary} className="seg" role="img">
            {MASTERY_LEVELS.map((level, index) => {
              const count = mastery.counts[level.id];
              const shade = SHADES[index] ?? 5;
              return count > 0
                ? <span key={level.id} style={{ flex: count, background: `var(--s${shade})`, color: `var(--on-s${shade})` }}>{count}</span>
                : null;
            })}
          </div>
        )}
      <div className="leg">
        {MASTERY_LEVELS.map((level, index) => (
          <div key={level.id}><i style={{ background: `var(--s${SHADES[index] ?? 5})` }} />{level.label}<em>{level.hint}</em></div>
        ))}
      </div>
    </Card>
  );
}
