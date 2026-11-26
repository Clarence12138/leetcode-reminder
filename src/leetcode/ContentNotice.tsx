import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { formatNextReviewIn, ratingLabel } from '../ui/format';
import {
  applyAppearanceAttributes,
  DEFAULT_APPEARANCE,
  ensurePaletteStyle,
  readAppearance,
  subscribeAppearance,
  type ThemeId,
} from '../ui/theme/appearance';
import type { ContentController, ContentNotice as Notice, NextState } from './content-controller';
import { UNDO_WINDOW_MS } from './content-controller';
import { Card, CardHead, ProblemName } from './notice-parts';
import { readPageMode, watchPageMode, type PageMode } from './page-theme';
import { RatingCard } from './RatingCard';

export const CARD_ROOT_CLASS = 'xsj-root';

type SuccessNotice = Extract<Notice, { readonly kind: 'success' }>;

interface Props {
  readonly controller: ContentController;
}

export function ContentNotice({ controller }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState<Notice>({ kind: 'idle' });
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_APPEARANCE.theme);
  const [pageMode, setPageMode] = useState<PageMode>(() => readPageMode());

  useEffect(() => controller.subscribe(setNotice), [controller]);

  useEffect(() => {
    let active = true;
    void readAppearance().then((appearance) => { if (active) setTheme(appearance.theme); });
    const stop = subscribeAppearance((appearance) => setTheme(appearance.theme));
    const stopWatch = watchPageMode(setPageMode);
    return () => { active = false; stop(); stopWatch(); };
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const container = root.getRootNode();
    ensurePaletteStyle(container instanceof ShadowRoot ? container : document, `.${CARD_ROOT_CLASS}`);
    applyAppearanceAttributes(root, theme, pageMode);
  }, [theme, pageMode, notice.kind]);

  return (
    <div className={CARD_ROOT_CLASS} data-mode={pageMode} data-theme={theme} ref={rootRef}>
      <NoticeBody controller={controller} notice={notice} />
    </div>
  );
}

function NoticeBody({ controller, notice }: { readonly controller: ContentController; readonly notice: Notice }) {
  switch (notice.kind) {
    case 'idle':
      return null;
    case 'hint':
      return <aside className="xsj-pill" role="status">{notice.text}</aside>;
    case 'monitoring':
      return (
        <aside className="xsj-pill" role="status">
          <span className="xsj-spinner" aria-hidden="true" />正在确认本次提交结果…
        </aside>
      );
    case 'error':
      return <ErrorNotice controller={controller} notice={notice} />;
    case 'success':
      return <SuccessCard controller={controller} notice={notice} />;
    case 'discarded':
      return (
        <Card className="xsj-card--plain" label="未记录本次提交" role="status">
          <CardHead
            icon="minus"
            onClose={() => controller.dismiss()}
            subtitle={<ProblemName problem={notice.problem} />}
            title="未记录本次提交"
            tone="muted"
          />
          <p className="xsj-muted xsj-pad">这条 Accepted 不会进入待评估，也不会改动现有复习计划。</p>
        </Card>
      );
    case 'rating':
      return <RatingCard controller={controller} notice={notice} />;
  }
}

// ---------------------------------------------------------------------------
// 完成态

function SuccessCard({ controller, notice }: { readonly controller: ContentController; readonly notice: SuccessNotice }) {
  const canUndo = useUndoWindow(notice);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undo = async () => {
    setUndoing(true);
    setError(null);
    try {
      await controller.undo();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '撤销失败');
      setUndoing(false);
    }
  };

  const headline = notice.rating
    ? `已评为「${ratingLabel[notice.rating]}」· ${formatNextReviewIn(notice.nextReviewAt)}`
    : '复习计划已更新';
  return (
    <Card label="复习计划已更新" role="status">
      <CardHead
        onClose={() => controller.dismiss()}
        subtitle={<ProblemName problem={notice.problem} />}
        title={headline}
      >
        {canUndo && (
          <button
            aria-label="撤销评分"
            className="xsj-btn xsj-btn--ghost"
            disabled={undoing}
            onClick={() => void undo()}
            type="button"
          >
            <Icon name="undo" size={14} />{undoing ? '撤销中…' : '撤销'}
            <span aria-hidden="true" className="xsj-countdown" style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }} />
          </button>
        )}
      </CardHead>
      {error && <p className="xsj-err xsj-pad" role="alert">{error}</p>}
      <NextSection next={notice.next} />
    </Card>
  );
}

/** 撤销按钮只在评分后的 5 秒内可用。 */
function useUndoWindow(notice: SuccessNotice): boolean {
  const { undoUntil } = notice;
  const [expired, setExpired] = useState(() => undoUntil === null || undoUntil <= Date.now());
  useEffect(() => {
    if (undoUntil === null) return undefined;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, undoUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [undoUntil]);
  return !expired;
}

function NextSection({ next }: { readonly next: NextState }) {
  if (next.status === 'loading') {
    return (
      <section aria-busy="true" className="xsj-next">
        <div><small>下一题</small><div className="xsj-ph xsj-ph--line" /></div>
      </section>
    );
  }
  if (next.status === 'error') {
    return <section className="xsj-next"><p className="xsj-muted">暂时没能获取下一题。</p></section>;
  }
  const { problem, url, remainingToday } = next.next;
  if (!problem || !url) {
    return (
      <section className="xsj-next xsj-next--done">
        <Icon name="check" size={16} /><p>今日复习已完成</p>
      </section>
    );
  }
  return (
    <section aria-label="下一题" className="xsj-next">
      <div>
        <small>下一题 · 今日还剩 {remainingToday} 题</small>
        <b><ProblemName problem={problem} /></b>
      </div>
      <a className="xsj-btn xsj-btn--primary" href={url}>
        去下一题<Icon name="arrow-right" size={14} />
      </a>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 错误

function ErrorNotice({ controller, notice }: {
  readonly controller: ContentController;
  readonly notice: Extract<Notice, { readonly kind: 'error' }>;
}) {
  return (
    <Card className="xsj-card--error" label="检测失败" role="alert">
      <CardHead icon="alert" onClose={() => controller.dismiss()} title="检测失败" tone="danger" />
      <p className="xsj-text xsj-pad">{notice.message}</p>
      {notice.retryable && (
        <footer className="xsj-foot">
          <button className="xsj-btn xsj-btn--primary" onClick={() => void controller.retry()} type="button">重新检测</button>
        </footer>
      )}
    </Card>
  );
}
