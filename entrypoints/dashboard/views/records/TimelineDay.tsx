import { useState } from 'react';
import type { IntervalChange } from '../../../../src/domain/stats';
import { Button, Pill } from '../../../../src/ui/components';
import { problemName, ratingLabel } from '../../../../src/ui/format';
import { Icon } from '../../../../src/ui/Icon';
import { RatingButtons } from '../../../../src/ui/rating';
import { describeDay, triggerLabel, type TimelineDay as TimelineDayData, type TimelineEntry } from './history-model';

export function TimelineDay({ day, refresh, today, total }: {
  readonly day: TimelineDayData;
  readonly refresh: () => Promise<void>;
  readonly today: string;
  /** 这一天（筛选后）的总条数；分批显示时可能多于 day.entries。 */
  readonly total: number;
}): React.ReactElement {
  const { detail, title } = describeDay(day.day, today);
  const headingId = `rec-day-${day.day}`;
  return (
    <section aria-labelledby={headingId} className="rec-day">
      <h3 id={headingId}>{title} <small>{detail} · {total} 条</small></h3>
      <ol className="rec-list">
        {day.entries.map((entry) => <TimelineItem entry={entry} key={entry.review.submissionId} refresh={refresh} />)}
      </ol>
    </section>
  );
}

function TimelineItem({ entry, refresh }: { readonly entry: TimelineEntry; readonly refresh: () => Promise<void> }): React.ReactElement {
  const [rating, setRating] = useState(false);
  const { problem, review } = entry;
  const name = problemName(problem, review);
  const pending = review.rating === null;
  return (
    <li className="rec-ev" data-rating={review.rating ?? 'PENDING'}>
      <time dateTime={new Date(review.acceptedAt).toISOString()}>{entry.clock}</time>
      <span aria-hidden="true" className="rec-dot" />
      <div className="rec-tt">
        {problem
          ? <a href={problem.url} rel="noreferrer" target="_blank">{name}<Icon name="external" size={12} /></a>
          : <b>{name}</b>}
        <small>{triggerLabel[review.trigger]}</small>
      </div>
      {review.rating === null
        ? (
            <Button aria-expanded={rating} aria-label={`${rating ? '收起评估' : '去评估'}：${name}`} onClick={() => setRating(!rating)} size="sm">
              {rating ? '收起' : '去评估'}
            </Button>
          )
        : <Pill tone={review.rating.toLowerCase() as Lowercase<typeof review.rating>}>{ratingLabel[review.rating]}</Pill>}
      <IntervalText change={entry.change} pending={pending} />
      {pending && rating && (
        <div className="rec-rate">
          <RatingButtons onRated={() => refresh()} onUndone={refresh} problemId={review.problemId} submissionId={review.submissionId} variant="compact" />
        </div>
      )}
    </li>
  );
}

function IntervalText({ change, pending }: { readonly change: IntervalChange | null; readonly pending: boolean }): React.ReactElement {
  if (pending) return <span className="rec-iv">尚未排期</span>;
  if (!change) return <span className="rec-iv">—</span>;
  if (change.trend === 'first') {
    return (
      <span className="rec-iv">
        首次{change.nextDays !== null && <> · <b>{change.nextDays}</b> 天</>}
      </span>
    );
  }
  return (
    <span className="rec-iv">
      间隔 {change.previousDays} → <b>{change.nextDays ?? '—'}</b> 天 <TrendMark trend={change.trend} />
    </span>
  );
}

const trendMark = {
  up: ['↑', '（变长）'],
  down: ['↓', '（变短）'],
  same: ['=', '（不变）'],
} as const;

function TrendMark({ trend }: { readonly trend: Exclude<IntervalChange['trend'], 'first'> }): React.ReactElement {
  const [symbol, spoken] = trendMark[trend];
  return (
    <span className={`rec-trend ${trend}`}>
      <span aria-hidden="true">{symbol}</span>
      <span className="visually-hidden">{spoken}</span>
    </span>
  );
}
