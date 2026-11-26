import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProblemRecord, SubmissionReview } from '../../src/domain/types';
import { Card, cx } from '../../src/ui/components';
import { problemName } from '../../src/ui/format';
import { Icon } from '../../src/ui/Icon';
import { RatingButtons } from '../../src/ui/rating';
import { openDashboard } from '../../src/ui/runtime';
import { formatShortTime, type Reload } from './popup-data';

const PENDING_LIMIT = 2;
/** 评完一行先收起（与 style.css 的过渡时长一致），再刷新数据。 */
const COLLAPSE_MS = 300;

export function PendingSection({ pending, problemMap, reload, timezone }: {
  readonly pending: readonly SubmissionReview[];
  readonly problemMap: ReadonlyMap<string, ProblemRecord>;
  readonly reload: Reload;
  readonly timezone: string;
}): React.ReactElement | null {
  const { collapsed, collapse, restore } = useCollapsed(reload);
  if (pending.length === 0) return null;
  const open = pending.filter((review) => !collapsed.has(review.submissionId));
  const rows = pickPendingRows(pending, collapsed, PENDING_LIMIT);
  const more = open.length - rows.filter((review) => !collapsed.has(review.submissionId)).length;

  return (
    <section aria-labelledby="pop-pending-title" className="pop-sec">
      <div className="pop-sec-h">
        <h2 id="pop-pending-title">待评估 <span className="num bump" key={open.length}>{open.length}</span></h2>
      </div>
      <Card className="pop-list" padded={false}>
        {rows.map((review) => (
          <PendingRow
            gone={collapsed.has(review.submissionId)}
            key={review.submissionId}
            onRated={collapse}
            onUndone={restore}
            problem={problemMap.get(review.problemId)}
            review={review}
            timezone={timezone}
          />
        ))}
        {more > 0 && (
          <button className="pop-more" onClick={() => openDashboard()} type="button">
            还有 {more} 条，去面板评<Icon className="pop-go" name="chevron" size={14} />
          </button>
        )}
      </Card>
    </section>
  );
}

/** 评完的行先收起，动画结束后刷新；撤销时展开并刷新。 */
function useCollapsed(reload: Reload): {
  readonly collapsed: ReadonlySet<string>;
  readonly collapse: (submissionId: string) => void;
  readonly restore: (submissionId: string) => Promise<void>;
} {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => { pendingTimers.forEach(clearTimeout); };
  }, []);

  /** 评完：这一行先收起，动画结束后刷新（刷新后这条就不在待评估里了）。 */
  const collapse = useCallback((submissionId: string): void => {
    setCollapsed((current) => new Set(current).add(submissionId));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      void reload();
    }, COLLAPSE_MS);
    timers.current.add(timer);
  }, [reload]);

  /** 撤销：展开这一行并刷新，提交会回到待评估。 */
  const restore = useCallback(async (submissionId: string): Promise<void> => {
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(submissionId);
      return next;
    });
    await reload();
  }, [reload]);
  return { collapsed, collapse, restore };
}

/** 前 limit 条未收起的，加上正在收起的（保留它们以播放收起动画）。 */
function pickPendingRows(pending: readonly SubmissionReview[], collapsed: ReadonlySet<string>, limit: number): SubmissionReview[] {
  const rows: SubmissionReview[] = [];
  let shown = 0;
  for (const review of pending) {
    const gone = collapsed.has(review.submissionId);
    if (!gone && shown >= limit) break;
    rows.push(review);
    if (!gone) shown += 1;
  }
  return rows;
}

function PendingRow({ gone, onRated, onUndone, problem, review, timezone }: {
  readonly gone: boolean;
  readonly onRated: (submissionId: string) => void;
  readonly onUndone: (submissionId: string) => Promise<void>;
  readonly problem: ProblemRecord | undefined;
  readonly review: SubmissionReview;
  readonly timezone: string;
}): React.ReactElement {
  const name = problemName(problem, review);
  return (
    <article aria-hidden={gone || undefined} aria-label={name} className={cx('pop-pend', gone && 'gone')} inert={gone}>
      <div className="pop-pend-top">
        <b title={name}>{name}</b>
        <time dateTime={new Date(review.acceptedAt).toISOString()}>{formatShortTime(review.acceptedAt, timezone)}</time>
      </div>
      <RatingButtons
        onRated={() => onRated(review.submissionId)}
        onUndone={() => onUndone(review.submissionId)}
        problemId={review.problemId}
        submissionId={review.submissionId}
      />
    </article>
  );
}
