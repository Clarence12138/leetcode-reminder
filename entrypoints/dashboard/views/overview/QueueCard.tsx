import { useState } from 'react';
import type { ProblemRecord, QueueSortStrategy, Settings } from '../../../../src/domain/types';
import { sendExtensionRequest } from '../../../../src/shared/messaging';
import { buttonClassName, Card, DifficultyBadge, EmptyState, InlineNotice, Select } from '../../../../src/ui/components';
import { formatInterval, formatDue, ratingLabel } from '../../../../src/ui/format';
import type { OverviewModel } from './overview-model';
import { problemLabel, reviewUrl } from './overview-model';

const SORT_OPTIONS: readonly { readonly value: QueueSortStrategy; readonly label: string }[] = [
  { value: 'due_asc', label: '最早到期优先' },
  { value: 'priority', label: '智能优先（高保持率 / 薄弱 / 难题）' },
  { value: 'stability_asc', label: '薄弱与新题优先' },
];

const RATING_COLOR = { AGAIN: 'var(--again)', HARD: 'var(--hard)', GOOD: 'var(--good)', EASY: 'var(--easy)' } as const;
const STABILITY_FULL_DAYS = 30;

export function QueueCard({ model, refresh, settings }: {
  readonly model: OverviewModel;
  readonly refresh: () => Promise<void>;
  readonly settings: Settings;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const sort = useSortUpdate(refresh);
  const { backlogProblems, progress, todayProblems } = model;
  const title = progress.limit === null ? '今日队列' : `今日队列 · ${todayProblems.length}`;
  const aside = (
    <span className="ov-queue-aside">
      <Select
        align="right"
        ariaLabel="队列排序策略"
        disabled={sort.saving}
        onChange={(next) => void sort.update(next)}
        options={SORT_OPTIONS}
        size="sm"
        value={settings.queueSortStrategy}
      />
    </span>
  );
  return (
    <Card aside={aside} bodyClassName="ov-queue-body" className="ov-queue" id="today-queue" padded={false} title={title}>
      {sort.error && <div className="ov-queue-note"><InlineNotice tone="error">{sort.error}</InlineNotice></div>}
      {todayProblems.length === 0
        ? (
          <EmptyState
            description={backlogProblems.length > 0
              ? `今日配额（${progress.limit ?? 0} 题）已完成，另有 ${backlogProblems.length} 道积压题可随时展开查看。`
              : '今天没有到期的题目，可以去力扣学一道新题。'}
            icon="sparkle"
            title={backlogProblems.length > 0 ? '今日配额已完成' : '队列已清空'}
          />
        )
        : <QueueTable model={model} problems={todayProblems} settings={settings} />}
      {backlogProblems.length > 0 && (
        <div className="ov-backlog">
          <div className="ov-backlog-bar">
            <span>超出今日配额的积压 · {backlogProblems.length} 题，默认折叠，想多刷时再展开</span>
            <button className={buttonClassName({ size: 'sm', tone: 'ghost' })} onClick={() => setExpanded((value) => !value)} type="button">
              {expanded ? '收起积压' : `展开其余 ${backlogProblems.length} 题`}
            </button>
          </div>
          {expanded && <QueueTable backlog model={model} problems={backlogProblems} settings={settings} />}
        </div>
      )}
    </Card>
  );
}

function QueueTable({ backlog = false, model, problems, settings }: {
  readonly backlog?: boolean;
  readonly model: OverviewModel;
  readonly problems: readonly ProblemRecord[];
  readonly settings: Settings;
}): React.ReactElement {
  const firstId = backlog ? null : model.next?.problemId;
  return (
    <div className="ov-table-wrap">
      <table aria-label={backlog ? '积压题目' : '今日队列'} className="table ov-table">
        <thead>
          <tr><th>题目</th><th>难度</th><th className="hide-sm">上次评分</th><th className="hide-sm">记忆稳定度</th><th>到期</th><th><span className="ov-sr">操作</span></th></tr>
        </thead>
        <tbody>
          {problems.map((problem) => <QueueRow isNext={problem.problemId === firstId} key={problem.problemId} model={model} problem={problem} settings={settings} />)}
        </tbody>
      </table>
    </div>
  );
}

function QueueRow({ isNext, model, problem, settings }: {
  readonly isNext: boolean;
  readonly model: OverviewModel;
  readonly problem: ProblemRecord;
  readonly settings: Settings;
}): React.ReactElement {
  const rating = model.lastRatings.get(problem.problemId);
  const due = formatDue(problem.nextReviewAt, model.now);
  const overdue = due.startsWith('逾期') || due === '昨天到期';
  const stability = problem.fsrsCard?.stability ?? null;
  const tag = problem.tags[0];
  return (
    <tr className={isNext ? 'next' : undefined}>
      <td className="t"><b>{problemLabel(problem)}</b>{tag && <span>{tag}</span>}</td>
      <td><DifficultyBadge difficulty={problem.difficulty} /></td>
      <td className="hide-sm">
        {rating ? <span className="dot" style={{ '--c': RATING_COLOR[rating] } as React.CSSProperties}>{ratingLabel[rating]}</span> : <span className="ov-dim">—</span>}
      </td>
      <td className="hide-sm">
        {stability === null
          ? <span className="ov-dim">—</span>
          : (
            <span className="stab">
              <i><s style={{ width: `${Math.max(4, Math.min(100, (stability / STABILITY_FULL_DAYS) * 100)).toFixed(0)}%` }} /></i>
              <span className="num">{formatInterval(Math.max(1, Math.round(stability)))}</span>
            </span>
          )}
      </td>
      <td className={overdue ? 'over' : undefined}>{due}</td>
      <td className="r">
        <a
          aria-label={`开始复习${problem.title}`}
          className={`${buttonClassName({ size: 'sm', tone: 'secondary' })}${isNext ? '' : ' reveal'}`}
          href={reviewUrl(problem, settings)}
          rel="noreferrer"
          target="_blank"
        >开始</a>
      </td>
    </tr>
  );
}

function useSortUpdate(refresh: () => Promise<void>): {
  readonly error: string | null;
  readonly saving: boolean;
  readonly update: (strategy: QueueSortStrategy) => Promise<void>;
} {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (strategy: QueueSortStrategy): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await sendExtensionRequest({ type: 'settings.update', payload: { queueSortStrategy: strategy } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新排序策略失败');
    } finally {
      setSaving(false);
    }
  };
  return { error, saving, update };
}
