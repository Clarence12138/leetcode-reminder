import type { MasteryRating } from '../../../../src/domain/types';
import { cx } from '../../../../src/ui/components';
import { ratingLabel } from '../../../../src/ui/format';
import { RATINGS, type RatingCounts, type WeekRatings } from './history-model';

export function WeekPanel({ hidden, onToggle, week }: {
  readonly hidden: ReadonlySet<MasteryRating>;
  readonly onToggle: (rating: MasteryRating) => void;
  readonly week: WeekRatings;
}): React.ReactElement {
  return (
    <aside aria-label="本周评分分布" className="card rec-week">
      <span className="rec-week-label">本周复习</span>
      <span className="rec-week-big num">
        {week.total}
        <small>次{week.total + week.previousTotal > 0 && <> · 比上周同期 <b>{formatDelta(week.total - week.previousTotal)}</b></>}</small>
      </span>
      <RatingBar counts={week.counts} hidden={hidden} total={week.total} />
      <div aria-label="按评分筛选记录" className="rec-legend" role="group">
        {RATINGS.map((rating) => (
          <button
            aria-pressed={!hidden.has(rating)}
            className={cx(hidden.has(rating) && 'off')}
            data-rating={rating}
            key={rating}
            onClick={() => onToggle(rating)}
            title={hidden.has(rating) ? `显示「${ratingLabel[rating]}」的记录` : `隐藏「${ratingLabel[rating]}」的记录`}
            type="button"
          >
            {ratingLabel[rating]}{' '}<em className="num">{week.counts[rating]}</em>
          </button>
        ))}
      </div>
      <p className="rec-side-note">点图例可以只看或隐藏某几档。{describeShare(week)}</p>
    </aside>
  );
}

function RatingBar({ counts, hidden, total }: {
  readonly counts: RatingCounts;
  readonly hidden: ReadonlySet<MasteryRating>;
  readonly total: number;
}): React.ReactElement {
  if (total === 0) return <div className="rec-rbar empty">本周还没有评分</div>;
  const label = RATINGS.map((rating) => `${ratingLabel[rating]} ${counts[rating]}`).join('，');
  return (
    <div aria-label={`本周评分：${label}`} className="rec-rbar" role="img">
      {RATINGS.filter((rating) => counts[rating] > 0).map((rating) => (
        <span
          className={cx(hidden.has(rating) && 'off')}
          data-rating={rating}
          key={rating}
          style={{ flexGrow: counts[rating] }}
          title={`${ratingLabel[rating]} ${counts[rating]} 次`}
        >
          {counts[rating]}
        </span>
      ))}
    </div>
  );
}

function formatDelta(delta: number): string {
  if (delta === 0) return '持平';
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}

function describeShare(week: WeekRatings): string {
  if (week.share === null) return '';
  const percent = Math.round(week.share * 100);
  const base = `本周「掌握 + 熟练」占 ${percent}%`;
  if (week.previousShare === null) return `${base}。`;
  const diff = percent - Math.round(week.previousShare * 100);
  if (diff === 0) return `${base}，与上周同期持平。`;
  return `${base}，比上周同期${diff > 0 ? '高' : '低'} ${Math.abs(diff)} 个百分点。`;
}
