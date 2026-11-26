import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { MasteryRating, ReviewPreview, SubmissionReview } from '../domain/types';
import { sendExtensionRequest } from '../shared/messaging';
import { cx } from './cx';
import { calendarDaysBetween, formatInterval, formatNextReviewIn, ratingLabel } from './format';
import { useToast, type ToastApi } from './toast';

export const RATING_ORDER: readonly MasteryRating[] = ['AGAIN', 'HARD', 'GOOD', 'EASY'];

/** 评分按下后，等“弹一下”的动画播完再通知调用方（调用方通常会刷新并收起这一行）。 */
export const RATING_SETTLE_MS = 280;

export interface RateResult {
  readonly rating: MasteryRating;
  readonly review: SubmissionReview;
  readonly nextReviewAt: number | null;
}

export interface RatingButtonsProps {
  readonly submissionId: string;
  /** 评分成功后调用（已等待动画）。通常传刷新函数。 */
  readonly onRated: (result: RateResult) => void | Promise<void>;
  /** 撤销评分成功后调用。通常也传刷新函数。 */
  readonly onUndone?: (() => void | Promise<void>) | undefined;
  /** 传入后会请求 review.preview，在每档下面显示“x 天”。 */
  readonly problemId?: string | undefined;
  /** 已有预览时直接传入，不再请求。 */
  readonly preview?: ReviewPreview | null | undefined;
  readonly disabled?: boolean | undefined;
  /** 监听键盘 1–4（输入框、可编辑区域内不触发）。同一页面只给一组开启。 */
  readonly keyboard?: boolean | undefined;
  /** default：两行（名称 + 间隔）；compact：一行，适合弹窗和列表行内；cols-2：两列宽按钮。 */
  readonly variant?: 'default' | 'compact' | 'cols-2' | undefined;
  /** 在 ToastProvider 内时，评分后弹“已评为 X · y 天后复习”，5 秒内可撤销。默认开启。 */
  readonly undoable?: boolean | undefined;
  readonly settleDelayMs?: number | undefined;
  readonly className?: string | undefined;
}

/**
 * 四档评分按钮：选中后弹一下并打勾、其他三档淡出；
 * 传 problemId 时显示各档下次间隔；在 ToastProvider 内评分后可撤销。
 */
export function RatingButtons(props: RatingButtonsProps): React.ReactElement {
  const { keyboard = false, variant = 'default' } = props;
  const action = useRatingAction(props);
  const preview = useResolvedPreview(props);
  useRatingShortcuts(keyboard && !action.busy, action.rate);

  return (
    <div className={cx('rating-control', props.className)}>
      <div aria-label="选择掌握程度" className={cx('rates', variant !== 'default' && variant)} role="group">
        {RATING_ORDER.map((rating, index) => (
          <RatingButton
            chosen={action.chosen}
            disabled={action.busy}
            hint={previewHint(preview, rating)}
            key={rating}
            onRate={action.rate}
            rating={rating}
            shortcut={keyboard ? String(index + 1) : null}
          />
        ))}
      </div>
      {action.error && <p className="rating-error" role="alert">{action.error}</p>}
    </div>
  );
}

function RatingButton({ chosen, disabled, hint, onRate, rating, shortcut }: {
  readonly chosen: MasteryRating | null;
  readonly disabled: boolean;
  readonly hint: string | null;
  readonly onRate: (rating: MasteryRating) => Promise<void>;
  readonly rating: MasteryRating;
  readonly shortcut: string | null;
}): React.ReactElement {
  const label = ratingLabel[rating];
  return (
    <button
      aria-label={hint && hint !== '…' ? `${label}（${hint}）` : label}
      className={cx('rt', rating.toLowerCase(), chosen === rating && 'chosen', chosen !== null && chosen !== rating && 'dim')}
      disabled={disabled}
      onClick={() => void onRate(rating)}
      type="button"
    >
      <b>{label}</b>
      {hint !== null && <span>{hint}</span>}
      {shortcut !== null && <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>
  );
}

type PreviewState = { readonly preview: ReviewPreview | null; readonly loading: boolean };

function previewHint(state: PreviewState, rating: MasteryRating): string | null {
  if (state.preview) return formatInterval(calendarDaysBetween(state.preview[rating]));
  return state.loading ? '…' : null;
}

function useResolvedPreview({ preview, problemId, submissionId }: RatingButtonsProps): PreviewState {
  const fetched = useReviewPreview(preview === undefined ? problemId : undefined, submissionId);
  if (preview !== undefined) return { preview, loading: false };
  return fetched;
}

function useReviewPreview(problemId: string | undefined, submissionId: string): PreviewState {
  const [state, setState] = useState<{ readonly key: string; readonly preview: ReviewPreview | null } | null>(null);
  const key = problemId ? `${problemId}\0${submissionId}` : '';
  useEffect(() => {
    if (!problemId) return undefined;
    let active = true;
    sendExtensionRequest({ type: 'review.preview', payload: { problemId, submissionId } }).then(
      (preview) => { if (active) setState({ key, preview }); },
      () => { if (active) setState({ key, preview: null }); },
    );
    return () => { active = false; };
  }, [key, problemId, submissionId]);
  if (!problemId) return { preview: null, loading: false };
  return state?.key === key ? { preview: state.preview, loading: false } : { preview: null, loading: true };
}

interface RatingAction {
  readonly busy: boolean;
  readonly chosen: MasteryRating | null;
  readonly error: string | null;
  readonly rate: (rating: MasteryRating) => Promise<void>;
}

function useRatingAction(props: RatingButtonsProps): RatingAction {
  const toast = useToast();
  const [chosen, setChosen] = useState<MasteryRating | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMountedRef();
  const busy = Boolean(props.disabled) || saving || chosen !== null;

  const rate = async (rating: MasteryRating): Promise<void> => {
    if (busy) return;
    setChosen(rating);
    setSaving(true);
    setError(null);
    // 动画期间点了撤销：取消尚未执行的 onRated，并立即放开按钮。
    const attempt = { undone: false, wake: null as (() => void) | null };
    try {
      const result = await submitRating(props, rating, {
        toast,
        onUndone: () => {
          attempt.undone = true;
          attempt.wake?.();
          if (mounted.current) { setChosen(null); setSaving(false); }
        },
      });
      await settleOrUndo(props.settleDelayMs ?? RATING_SETTLE_MS, attempt);
      if (attempt.undone) return;
      await props.onRated(result);
    } catch (cause) {
      if (mounted.current) {
        setChosen(null);
        setError(cause instanceof Error ? cause.message : '评估失败');
      }
    } finally {
      if (mounted.current && !attempt.undone) setSaving(false);
    }
  };
  return { busy, chosen, error, rate };
}

/** 等动画播完；期间撤销会提前唤醒。 */
async function settleOrUndo(ms: number, attempt: { undone: boolean; wake: (() => void) | null }): Promise<void> {
  if (ms <= 0 || attempt.undone) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    attempt.wake = () => { clearTimeout(timer); resolve(); };
  });
}

/** 发送评分；在 ToastProvider 内时弹出可撤销的提示条。 */
async function submitRating(
  props: RatingButtonsProps,
  rating: MasteryRating,
  options: { readonly toast: ToastApi; readonly onUndone: () => void },
): Promise<RateResult> {
  const { submissionId } = props;
  const result = await sendExtensionRequest({ type: 'submission.rate', payload: { submissionId, rating } });
  const rated: RateResult = { rating, review: result.review, nextReviewAt: result.nextReviewAt ?? null };
  if ((props.undoable ?? true) && options.toast.available) {
    options.toast.show({
      message: `已评为「${ratingLabel[rating]}」· ${formatNextReviewIn(rated.nextReviewAt)}`,
      action: {
        label: '撤销',
        onAction: async () => {
          await undoRating(submissionId, rating);
          options.onUndone();
          options.toast.show({ tone: 'info', message: '已撤销评分，可以重新选择' });
          await props.onUndone?.();
        },
      },
    });
  }
  return rated;
}

/** 撤销评分：把这次提交恢复为待评估并重算排期。 */
export async function undoRating(submissionId: string, rating?: MasteryRating): Promise<void> {
  await sendExtensionRequest({
    type: 'submission.unrate',
    payload: rating === undefined ? { submissionId } : { submissionId, rating },
  });
}

function useMountedRef(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

function useRatingShortcuts(enabled: boolean, rate: (rating: MasteryRating) => Promise<void>): void {
  const onShortcut = useEffectEvent((event: KeyboardEvent): void => {
    const rating = shortcutRating(event);
    if (!rating) return;
    event.preventDefault();
    void rate(rating);
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (event: KeyboardEvent): void => onShortcut(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [enabled]);
}

function shortcutRating(event: KeyboardEvent): MasteryRating | null {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null;
  if (isEditableTarget(event.target)) return null;
  return RATING_ORDER[['1', '2', '3', '4'].indexOf(event.key)] ?? null;
}

/** 焦点在输入框、下拉框或可编辑区域（如代码编辑器）里时，不响应评分快捷键。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]')) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}
