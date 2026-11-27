import { useCallback, useEffect, useRef, useState } from 'react';
import type { MasteryRating, ReviewContext, ReviewPreview } from '../domain/types';
import { calendarDaysBetween, formatInDisplayZone, formatInterval, ratingLabel } from '../ui/format';
import { RATING_ORDER, isEditableTarget } from '../ui/rating';
import type { ContentController, ContentNotice as Notice } from './content-controller';
import { Card, CardHead, ProblemName } from './notice-parts';

export const RATING_CLASS: Readonly<Record<MasteryRating, string>> = {
  AGAIN: 'again',
  HARD: 'hard',
  GOOD: 'good',
  EASY: 'easy',
};

type RatingNotice = Extract<Notice, { readonly kind: 'rating' }>;

function useRatingActions(controller: ContentController) {
  const [pending, setPending] = useState<MasteryRating | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const submit = useCallback(async (value: MasteryRating) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(value);
    setError(null);
    try {
      await controller.rate(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '评分保存失败，请重试');
      setPending(null);
      busyRef.current = false;
    }
  }, [controller]);

  const discard = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setDiscarding(true);
    setError(null);
    try {
      await controller.discard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能取消记录');
      setDiscarding(false);
      busyRef.current = false;
    }
  }, [controller]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const rating = ratingForKey(event);
      if (rating) void submit(rating);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [submit]);

  return { pending, discarding, error, busy: pending !== null || discarding, submit, discard };
}

export function RatingCard({ controller, notice }: { readonly controller: ContentController; readonly notice: RatingNotice }) {
  const { pending, discarding, error, busy, submit, discard } = useRatingActions(controller);
  return (
    <Card label="选择掌握程度">
      <CardHead
        onClose={() => controller.dismiss()}
        subtitle={<ProblemName problem={notice.problem} />}
        title="Accepted 已记录"
      />
      <TrackSection context={notice.context} loading={notice.contextLoading} />
      <section className="xsj-sec xsj-sec--last">
        <h4 className="xsj-sech">本次感觉 <span>按 1–4</span></h4>
        <div aria-label="掌握程度" className="xsj-rates" role="group">
          {RATING_ORDER.map((rating, index) => (
            <RateButton
              chosen={pending === rating}
              dim={pending !== null && pending !== rating}
              disabled={busy}
              index={index}
              key={rating}
              loading={!notice.preview && !notice.previewError}
              onClick={() => void submit(rating)}
              preview={notice.preview}
              rating={rating}
            />
          ))}
        </div>
        {notice.previewError && <p className="xsj-muted xsj-err">下次复习间隔加载失败，仍可直接评分。</p>}
        {error && <p className="xsj-err" role="alert">{error}</p>}
      </section>
      <footer className="xsj-foot">
        <button className="xsj-btn xsj-btn--ghost" disabled={busy} onClick={() => controller.dismiss()} type="button">稍后评估</button>
        <button className="xsj-btn xsj-btn--ghost" disabled={busy} onClick={() => void discard()} type="button">
          {discarding ? '处理中…' : '不记录本次'}
        </button>
      </footer>
    </Card>
  );
}

/** 键盘 1–4 对应的评分；焦点在编辑器（含 Monaco）、输入框、contenteditable 里、输入法组合中或带修饰键时不响应。 */
export function ratingForKey(event: KeyboardEvent): MasteryRating | null {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (isTypingContext(event)) return null;
  const index = ['1', '2', '3', '4'].indexOf(event.key);
  return index < 0 ? null : (RATING_ORDER[index] ?? null);
}

/** 输入法组合中，或焦点在输入框 / Monaco 编辑器里。 */
function isTypingContext(event: KeyboardEvent): boolean {
  if (event.isComposing || isEditableTarget(event.target)) return true;
  return event.target instanceof Element && event.target.closest('.monaco-editor') !== null;
}

function RateButton({ rating, index, preview, loading, chosen, dim, disabled, onClick }: {
  readonly rating: MasteryRating;
  readonly index: number;
  readonly preview: ReviewPreview | null;
  readonly loading: boolean;
  readonly chosen: boolean;
  readonly dim: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const interval = preview ? formatInterval(calendarDaysBetween(preview[rating])) : null;
  const label = ratingLabel[rating];
  const classes = ['xsj-rt', RATING_CLASS[rating], chosen ? 'chosen' : '', dim ? 'dim' : ''].filter(Boolean).join(' ');
  return (
    <button
      aria-keyshortcuts={String(index + 1)}
      aria-label={interval ? `${label}（${interval}）` : label}
      className={classes}
      disabled={disabled && !chosen}
      onClick={onClick}
      type="button"
    >
      <kbd aria-hidden="true">{index + 1}</kbd>
      <b aria-hidden="true">{label}</b>
      <span aria-hidden="true" className={loading ? 'xsj-ph' : undefined}>{interval ?? (loading ? '' : '—')}</span>
    </button>
  );
}

function TrackSection({ context, loading }: { readonly context: ReviewContext | null; readonly loading: boolean }) {
  if (loading) {
    return (
      <section aria-busy="true" className="xsj-sec">
        <h4 className="xsj-sech">这道题的轨迹</h4>
        <div className="xsj-ph xsj-ph--line" />
      </section>
    );
  }
  // 轨迹加载失败时整块隐藏，不打扰评分。
  if (!context) return null;
  const { history, retrievability } = context;
  if (history.length === 0) {
    return (
      <section className="xsj-sec">
        <h4 className="xsj-sech">这道题的轨迹 <span>第一次记录</span></h4>
        <p className="xsj-muted xsj-first">这是这道题的第一次记录，评完分后会安排首次复习。</p>
      </section>
    );
  }
  const shown = history.slice(-4);
  const last = history[history.length - 1];
  const sinceDays = last ? Math.abs(calendarDaysBetween(last.acceptedAt)) : null;
  const percent = retrievability === null ? null : Math.round(retrievability * 100);
  return (
    <section className="xsj-sec">
      <h4 className="xsj-sech">这道题的轨迹 <span>第 {history.length + 1} 次</span></h4>
      <ol aria-label={`已复习 ${history.length} 次`} className="xsj-tl">
        {shown.map((entry) => (
          <li className={`xsj-tl-item ${RATING_CLASS[entry.rating]}`} key={entry.submissionId}>
            <i aria-hidden="true" />
            <span>{ratingLabel[entry.rating]}</span>
            <small>{formatShortDate(entry.acceptedAt)}</small>
          </li>
        ))}
        <li aria-current="step" className="xsj-tl-item now">
          <i aria-hidden="true" /><span>本次</span><small>今天</small>
        </li>
      </ol>
      <div className="xsj-ret">
        <b>{percent === null ? '暂无记忆概率' : `复习前记忆概率 ${percent}%`}</b>
        <em>{sinceDays === null ? '' : sinceDays === 0 ? '上次复习：今天' : `上次复习：${sinceDays} 天前`}</em>
        {percent !== null && (
          <div aria-label={`记忆概率 ${percent}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} className="xsj-meter" role="meter">
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
    </section>
  );
}

function formatShortDate(timestamp: number): string {
  return formatInDisplayZone(timestamp, { month: 'numeric', day: '2-digit' });
}

