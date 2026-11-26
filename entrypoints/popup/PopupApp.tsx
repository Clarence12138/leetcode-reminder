import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProblemRecord, Settings } from '../../src/domain/types';
import {
  Brand,
  Button,
  Card,
  DifficultyBadge,
  EmptyState,
  IconButton,
  InlineNotice,
  LoadingState,
  Meter,
  ToastProvider,
} from '../../src/ui/components';
import { calendarDaysBetween, difficultyLabel, formatInterval } from '../../src/ui/format';
import { Icon } from '../../src/ui/Icon';
import { openDashboard } from '../../src/ui/runtime';
import { PendingSection } from './PendingSection';
import {
  buildPopupModel,
  fetchPopupData,
  formatHeaderDate,
  LEETCODE_PROBLEMSET_URL,
  openInNewTab,
  overdueDays,
  reviewUrl,
  type PopupData,
  type PopupModel,
  type Reload,
} from './popup-data';

const QUEUE_LIMIT = 3;
const RETENTION_HINT = '近 30 天复习时没评为「未掌握」的比例';


export function PopupApp(): React.ReactElement {
  return (
    <ToastProvider>
      <Popup />
    </ToastProvider>
  );
}

function Popup(): React.ReactElement {
  const { data, error, reload } = usePopupData();
  return (
    <main className="popup">
      <PopupHeader timezone={data?.settings.timezone} />
      <div className="pop-body">
        <PopupBody data={data} error={error} reload={reload} />
      </div>
      <PopupFooter />
    </main>
  );
}

function usePopupData(): { readonly data: PopupData | null; readonly error: string | null; readonly reload: Reload } {
  const [state, setState] = useState<{ readonly data: PopupData | null; readonly error: string | null }>({ data: null, error: null });
  const reload = useCallback(async (): Promise<void> => {
    try {
      const data = await fetchPopupData();
      setState({ data, error: null });
    } catch (cause) {
      // 刷新失败时保留已有数据，只提示错误
      setState((current) => ({ data: current.data, error: cause instanceof Error ? cause.message : '无法读取复习数据' }));
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload };
}

function PopupBody({ data, error, reload }: { readonly data: PopupData | null; readonly error: string | null; readonly reload: Reload }): React.ReactElement {
  if (data) return <PopupContent data={data} error={error} reload={reload} />;
  if (error !== null) return <LoadError message={error} onRetry={reload} />;
  return <LoadingState />;
}

function PopupHeader({ timezone }: { readonly timezone: string | undefined }): React.ReactElement {
  return (
    <header className="pop-h">
      <Brand />
      <div className="pop-h-side">
        <small>{formatHeaderDate(timezone)}</small>
        <IconButton bare icon="external" label="打开完整面板" onClick={() => openDashboard()} size="sm" />
      </div>
    </header>
  );
}

function PopupFooter(): React.ReactElement {
  return (
    <footer className="pop-f">
      <span>数据仅保存在本机</span>
      <Button icon="settings" onClick={() => openDashboard('#settings')} size="sm" tone="ghost">设置</Button>
    </footer>
  );
}

function PopupContent({ data, error, reload }: { readonly data: PopupData; readonly error: string | null; readonly reload: Reload }): React.ReactElement {
  const model = useMemo(() => buildPopupModel(data), [data]);
  const { settings } = data;
  return (
    <>
      {error !== null && <InlineNotice tone="error">刷新失败：{error}</InlineNotice>}
      {model.unreadIssues > 0 && <IssueNotice count={model.unreadIssues} />}
      {model.isEmpty ? <WelcomeCard /> : <TodayCard model={model} settings={settings} />}
      <PendingSection pending={model.pending} problemMap={model.problemMap} reload={reload} timezone={settings.timezone} />
      <QueueSection problems={model.todayProblems} settings={settings} />
    </>
  );
}

// ---------- 今日进度 ----------

function TodayCard({ model, settings }: { readonly model: PopupModel; readonly settings: Settings }): React.ReactElement {
  const { next, progress } = model;
  const facts = <TodayFacts retention={model.retention} streakDays={model.streakDays} />;
  const counter = progress.target > 0 && <small className="num">今日 {progress.completed} / {progress.target}</small>;
  const meter = progress.target > 0 && <Meter label="今日进度" max={progress.target} value={progress.completed} />;

  if (next && progress.remaining > 0) {
    return (
      <Card className="pop-today" padded={false}>
        <div className="pop-today-top">
          <h1>还有 <em className="num">{progress.remaining}</em> 题</h1>
          {counter}
        </div>
        {meter}
        {facts}
        <Button block className="pop-start" icon="play" onClick={() => void openInNewTab(reviewUrl(next, settings))} tone="primary">
          开始复习 · <span className="pop-start-title">{problemTitle(next)}</span>
        </Button>
      </Card>
    );
  }

  const done = doneCopy(model);
  return (
    <Card className="pop-today done" padded={false}>
      <div className="pop-today-top">
        <h1><span className="pop-done-mark"><Icon name="check" size={13} /></span>{done.title}</h1>
        {counter}
      </div>
      {meter}
      {done.note !== null && <p className="pop-today-note">{done.note}</p>}
      {facts}
      {progress.backlog > 0 && (
        <Button block onClick={() => openDashboard('#queue')} size="sm">查看积压的 {progress.backlog} 题</Button>
      )}
    </Card>
  );
}

function doneCopy({ nextDueAt, progress }: PopupModel): { readonly title: string; readonly note: string | null } {
  if (progress.backlog > 0) {
    return { title: '今日配额已完成', note: `已复习 ${progress.completed} 题，另有 ${progress.backlog} 题超出配额。` };
  }
  const upcoming = nextDueHint(nextDueAt);
  if (progress.completed > 0) {
    return { title: '今日复习已完成', note: [`已复习 ${progress.completed} 题。`, upcoming].filter(Boolean).join('') };
  }
  return { title: '今天没有到期的题', note: upcoming };
}

function nextDueHint(nextDueAt: number | null): string | null {
  if (nextDueAt === null) return null;
  const days = calendarDaysBetween(nextDueAt);
  if (days <= 0) return '今天稍后还有题到期。';
  if (days === 1) return '下一题明天到期。';
  return `下一题 ${formatInterval(days)}后到期。`;
}

function TodayFacts({ retention, streakDays }: { readonly retention: number | null; readonly streakDays: number }): React.ReactElement | null {
  if (streakDays <= 0 && retention === null) return null;
  return (
    <p className="pop-facts">
      {streakDays > 0 && <span>连续复习 <b className="num">{streakDays} 天</b></span>}
      {retention !== null && <span title={RETENTION_HINT}>近 30 天记住率 <b className="num">{Math.round(retention * 100)}%</b></span>}
    </p>
  );
}

function WelcomeCard(): React.ReactElement {
  return (
    <Card className="pop-welcome" padded={false}>
      <EmptyState
        action={(
          <>
            <Button icon="external" onClick={() => void openInNewTab(LEETCODE_PROBLEMSET_URL)} size="sm" tone="primary">去力扣做题</Button>
            <Button icon="download" onClick={() => openDashboard('#settings')} size="sm">导入历史</Button>
          </>
        )}
        description="在力扣通过一道题，小刷记会自动记下并安排复习。以前刷过的题，可以去设置里导入。"
        icon="sparkle"
        title="还没有题目"
      />
    </Card>
  );
}

function IssueNotice({ count }: { readonly count: number }): React.ReactElement {
  return (
    <button className="notice warn pop-issue" onClick={() => openDashboard('#issues')} type="button">
      <Icon name="alert" size={16} />
      <span>有 {count} 条检测异常待查看</span>
      <Icon className="pop-go" name="chevron" size={14} />
    </button>
  );
}

// ---------- 今日队列 ----------

function QueueSection({ problems, settings }: { readonly problems: readonly ProblemRecord[]; readonly settings: Settings }): React.ReactElement | null {
  if (problems.length === 0) return null;
  return (
    <section aria-labelledby="pop-queue-title" className="pop-sec">
      <div className="pop-sec-h">
        <h2 id="pop-queue-title">今日队列 <span className="num">{problems.length}</span></h2>
        <button className="pop-link" onClick={() => openDashboard('#queue')} type="button">
          查看全部<Icon name="chevron" size={13} />
        </button>
      </div>
      <Card className="pop-list" padded={false}>
        {problems.slice(0, QUEUE_LIMIT).map((problem) => <QueueRow key={problem.problemId} problem={problem} settings={settings} />)}
      </Card>
    </section>
  );
}

function QueueRow({ problem, settings }: { readonly problem: ProblemRecord; readonly settings: Settings }): React.ReactElement {
  const url = reviewUrl(problem, settings);
  const overdue = overdueDays(problem, settings.timezone);
  const label = [problemTitle(problem), difficultyLabel[problem.difficulty], overdue > 0 ? `逾期 ${overdue} 天` : null]
    .filter(Boolean)
    .join('，');
  return (
    <a
      aria-label={label}
      className="pop-item"
      href={url}
      onClick={(event) => {
        event.preventDefault();
        void openInNewTab(url);
      }}
      rel="noreferrer"
      target="_blank"
    >
      <span className="no num">{problem.frontendId}</span>
      <b>{problem.title}</b>
      {overdue > 0 && <span className="over">逾期 {overdue} 天</span>}
      <DifficultyBadge difficulty={problem.difficulty} />
      <Icon className="pop-go" name="external" size={14} />
    </a>
  );
}

function LoadError({ message, onRetry }: { readonly message: string; readonly onRetry: Reload }): React.ReactElement {
  return (
    <div className="pop-error">
      <InlineNotice tone="error">{message}</InlineNotice>
      <Button onClick={() => void onRetry()}>重试</Button>
    </div>
  );
}

function problemTitle(problem: Pick<ProblemRecord, 'frontendId' | 'title'>): string {
  return `${problem.frontendId}. ${problem.title}`;
}
