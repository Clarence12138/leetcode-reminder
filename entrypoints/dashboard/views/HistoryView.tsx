import { useMemo, useState } from 'react';
import type { DailySummary, MasteryRating, Settings } from '../../../src/domain/types';
import { Button, EmptyState } from '../../../src/ui/components';
import { ratingLabel } from '../../../src/ui/format';
import { RATINGS, buildTimelineEntries, computeWeekRatings, countByDay, filterEntries, groupByDay, toggleRating, type TimelineEntry } from './records/history-model';
import { TimelineDay } from './records/TimelineDay';
import { WeekPanel } from './records/WeekPanel';
import './records.css';

/** 时间线每批渲染的条数，避免记录上千条时一次全部渲染。 */
export const HISTORY_PAGE_SIZE = 50;

const NO_HIDDEN: ReadonlySet<MasteryRating> = new Set();

export interface HistoryViewProps {
  readonly refresh: () => Promise<void>;
  readonly settings: Pick<Settings, 'timezone'>;
  readonly summary: DailySummary;
}

export function HistoryView({ refresh, settings, summary }: HistoryViewProps): React.ReactElement {
  const { timezone } = settings;
  const [hidden, setHidden] = useState<ReadonlySet<MasteryRating>>(NO_HIDDEN);
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE);
  const entries = useMemo(() => buildTimelineEntries(summary, timezone), [summary, timezone]);
  const week = useMemo(() => computeWeekRatings(summary.recentReviews, { timezone }), [summary.recentReviews, timezone]);
  const filtered = useMemo(() => filterEntries(entries, hidden), [entries, hidden]);

  if (entries.length === 0) {
    return (
      <section className="card rec-empty">
        <EmptyState
          description="在力扣通过题目并评分后，这里会按天列出每次复习，以及间隔从几天变成几天。"
          icon="history"
          title="还没有复习记录"
        />
      </section>
    );
  }

  const changeFilter = (next: ReadonlySet<MasteryRating>): void => {
    setHidden(next);
    setLimit(HISTORY_PAGE_SIZE);
  };
  return (
    <div className="rec-hist">
      <Timeline
        entries={filtered}
        hidden={hidden}
        limit={limit}
        onMore={() => setLimit(limit + HISTORY_PAGE_SIZE)}
        onReset={() => changeFilter(NO_HIDDEN)}
        refresh={refresh}
        today={week.today}
      />
      <WeekPanel hidden={hidden} onToggle={(rating) => changeFilter(toggleRating(hidden, rating))} week={week} />
    </div>
  );
}

function Timeline({ entries, hidden, limit, onMore, onReset, refresh, today }: {
  readonly entries: readonly TimelineEntry[];
  readonly hidden: ReadonlySet<MasteryRating>;
  readonly limit: number;
  readonly onMore: () => void;
  readonly onReset: () => void;
  readonly refresh: () => Promise<void>;
  readonly today: string;
}): React.ReactElement {
  const days = groupByDay(entries.slice(0, limit));
  const totals = countByDay(entries);
  const rest = entries.length - limit;
  return (
    <section aria-label="复习记录" className="card rec-timeline">
      {hidden.size > 0 && <FilterBar hidden={hidden} onReset={onReset} />}
      {entries.length === 0 && (
        <EmptyState
          action={<Button onClick={onReset} size="sm">显示全部</Button>}
          description="当前筛选隐藏了所有记录。"
          icon="filter"
          title="没有符合筛选的记录"
        />
      )}
      {days.map((day) => <TimelineDay day={day} key={day.day} refresh={refresh} today={today} total={totals.get(day.day) ?? day.entries.length} />)}
      {rest > 0 && (
        <footer className="rec-more">
          <span className="num">已显示 {limit} / {entries.length} 条</span>
          <Button onClick={onMore} size="sm">再显示 {Math.min(rest, HISTORY_PAGE_SIZE)} 条</Button>
        </footer>
      )}
    </section>
  );
}

function FilterBar({ hidden, onReset }: { readonly hidden: ReadonlySet<MasteryRating>; readonly onReset: () => void }): React.ReactElement {
  const names = RATINGS.filter((rating) => hidden.has(rating)).map((rating) => `「${ratingLabel[rating]}」`).join('');
  return (
    <div className="rec-filterbar" role="status">
      <span>已隐藏{names}，待评估的记录也一并隐藏</span>
      <Button onClick={onReset} size="sm" tone="link">显示全部</Button>
    </div>
  );
}
