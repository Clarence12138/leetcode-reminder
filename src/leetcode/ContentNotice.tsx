import { useEffect, useState } from 'react';
import type { MasteryRating } from '../domain/types';
import type { ContentController, ContentNotice as Notice } from './content-controller';

const RATING_OPTIONS: readonly {
  readonly rating: MasteryRating;
  readonly label: string;
  readonly description: string;
}[] = [
  { rating: 'AGAIN', label: '未掌握', description: '无法独立完成' },
  { rating: 'HARD', label: '吃力', description: '独立完成，但思路不稳或耗时明显' },
  { rating: 'GOOD', label: '掌握', description: '可以独立完成并讲清思路' },
  { rating: 'EASY', label: '熟练', description: '快速完成，关键变式也清楚' },
];

interface Props {
  readonly controller: ContentController;
}

export function ContentNotice({ controller }: Props) {
  const [notice, setNotice] = useState<Notice>({ kind: 'idle' });
  const [rating, setRating] = useState<MasteryRating | null>(null);

  useEffect(() => controller.subscribe(setNotice), [controller]);
  if (notice.kind === 'idle') return null;

  if (notice.kind === 'hint') {
    return <aside className="notice notice--compact">{notice.text}</aside>;
  }

  if (notice.kind === 'monitoring') {
    return <aside className="notice notice--compact">正在确认本次提交结果…</aside>;
  }

  if (notice.kind === 'error') {
    return <ErrorNotice controller={controller} notice={notice} />;
  }

  if (notice.kind === 'success') {
    return <SuccessNotice controller={controller} notice={notice} />;
  }

  if (notice.kind === 'discarded') {
    return <DiscardedNotice controller={controller} notice={notice} />;
  }

  return <RatingNotice controller={controller} notice={notice} rating={rating} setRating={setRating} />;
}

function RatingNotice({ controller, notice, rating, setRating }: {
  readonly controller: ContentController;
  readonly notice: Extract<Notice, { readonly kind: 'rating' }>;
  readonly rating: MasteryRating | null;
  readonly setRating: (rating: MasteryRating | null) => void;
}) {
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = rating !== null || discarding;

  const submitRating = async (value: MasteryRating) => {
    setRating(value);
    setError(null);
    try {
      await controller.rate(value);
    } finally {
      setRating(null);
    }
  };

  const discard = async () => {
    setDiscarding(true);
    setError(null);
    try {
      await controller.discard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能取消记录');
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <aside className="notice notice--rating" aria-label="选择掌握程度">
      <header>
        <div><span className="eyebrow">Accepted 已记录</span><strong>{notice.title}</strong></div>
        <RatingActions discarding={discarding} disabled={busy} onDefer={() => controller.dismiss()} onDiscard={discard} />
      </header>
      <p>请选择这次独立完成题目的程度：</p>
      <RatingGrid busy={busy} notice={notice} onRate={submitRating} />
      {notice.previewError && <p className="preview-error">预计日期加载失败：{notice.previewError}</p>}
      {error && <p className="preview-error" role="alert">{error}</p>}
      <footer>稍后评估会保留为“待评估”；不记录本次不会生成复习计划。</footer>
    </aside>
  );
}

function RatingActions({
  discarding,
  disabled,
  onDefer,
  onDiscard,
}: {
  readonly discarding: boolean;
  readonly disabled: boolean;
  readonly onDefer: () => void;
  readonly onDiscard: () => Promise<void>;
}) {
  return (
    <div className="notice-actions">
      <button disabled={disabled} onClick={onDefer}>稍后评估</button>
      <button className="notice-discard" disabled={disabled} onClick={() => void onDiscard()}>
        {discarding ? '处理中…' : '不记录本次'}
      </button>
    </div>
  );
}

function RatingGrid({
  busy,
  notice,
  onRate,
}: {
  readonly busy: boolean;
  readonly notice: Extract<Notice, { readonly kind: 'rating' }>;
  readonly onRate: (rating: MasteryRating) => Promise<void>;
}) {
  return (
    <div className="rating-grid">
      {RATING_OPTIONS.map((option) => (
        <button
          className={`rating rating--${option.rating.toLowerCase()}`}
          disabled={busy}
          key={option.rating}
          onClick={() => void onRate(option.rating)}
        >
          <strong>{option.label}</strong>
          <span>{option.description}</span>
          <small>{formatPreview(notice.preview?.[option.rating])}</small>
        </button>
      ))}
    </div>
  );
}

function ErrorNotice({ controller, notice }: {
  readonly controller: ContentController;
  readonly notice: Extract<Notice, { readonly kind: 'error' }>;
}) {
  return (
    <aside className="notice notice--error" role="alert">
      <header><strong>检测失败</strong><button onClick={() => controller.dismiss()}>关闭</button></header>
      <p>{notice.message}</p>
      {notice.retryable && <button className="secondary" onClick={() => void controller.retry()}>重新检测</button>}
    </aside>
  );
}

function SuccessNotice({ controller, notice }: {
  readonly controller: ContentController;
  readonly notice: Extract<Notice, { readonly kind: 'success' }>;
}) {
  return (
    <aside className="notice notice--success" role="status">
      <header><strong>复习计划已更新</strong><button onClick={() => controller.dismiss()}>关闭</button></header>
      <p>{notice.title}</p>
      <small>{formatNextReview(notice.nextReviewAt)}</small>
    </aside>
  );
}

function DiscardedNotice({ controller, notice }: {
  readonly controller: ContentController;
  readonly notice: Extract<Notice, { readonly kind: 'discarded' }>;
}) {
  return (
    <aside className="notice notice--success" role="status">
      <header><strong>未记录本次提交</strong><button onClick={() => controller.dismiss()}>关闭</button></header>
      <p>{notice.title}</p>
      <small>这条 Accepted 不会进入待评估，也不会改动现有复习计划。</small>
    </aside>
  );
}

function formatPreview(timestamp: number | undefined): string {
  if (!timestamp) return '正在计算下次复习…';
  return `下次：${new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(timestamp)}`;
}

function formatNextReview(timestamp: number | null): string {
  if (!timestamp) return '下次复习时间将在面板中显示。';
  const value = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(timestamp);
  return `下次复习：${value}`;
}
