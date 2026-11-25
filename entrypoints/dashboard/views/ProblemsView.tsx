import { useMemo, useState } from 'react';
import { BUILTIN_PROBLEM_LISTS } from '../../../src/domain/problem-lists';
import { isProblemPaused, resolveProblemGroup } from '../../../src/domain/queue-policy';
import type { DailySummary, ProblemRecord, ReviewGroup, Settings } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, DifficultyBadge, EmptyState, InlineNotice, PageHeading } from '../../../src/ui/components';
import { formatDate, formatDue } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';
import { ProblemBatchToolbar } from './ProblemBatchToolbar';
import {
  filterAndSortProblems,
  getProblemTags,
  type DifficultyFilter,
  type ListFilter,
  type ProblemFilters,
  type ProblemSort,
  type StatusFilter,
} from './problem-filters';

const INITIAL_FILTERS: ProblemFilters = {
  difficulty: 'ALL',
  group: 'ALL',
  list: 'ALL',
  search: '',
  status: 'ALL',
  tag: 'ALL',
};

export function ProblemsView({
  refresh,
  settings,
  summary,
}: {
  readonly refresh: () => Promise<void>;
  readonly settings?: Settings;
  readonly summary: DailySummary;
}): React.ReactElement {
  const [filters, setFilters] = useState<ProblemFilters>(INITIAL_FILTERS);
  const [sort, setSort] = useState<ProblemSort>('CREATED_AT_DESC');
  const groups = useMemo(() => settings?.reviewGroups ?? [], [settings?.reviewGroups]);
  const tags = useMemo(() => getProblemTags(summary.problems), [summary.problems]);
  const problems = useMemo(
    () => filterAndSortProblems(summary.problems, filters, sort),
    [filters, sort, summary.problems],
  );
  const selection = useProblemSelection(problems);
  const bulkDelete = useProblemDelete(selection.selectedProblemIds, refresh, selection.clear);
  const pausedCount = summary.problems.filter((problem) => isProblemPaused(problem)).length;
  const description = `共记录 ${summary.problems.length} 道题${pausedCount > 0 ? `（已暂停 ${pausedCount} 道）` : ''}，题目信息来自力扣中文站。`;
  return (
    <div className="view-content">
      <PageHeading description={description} title="全部题目" />
      <ProblemFilterBar
        filters={filters}
        groups={groups}
        onPatch={(patch) => setFilters((current) => ({ ...current, ...patch }))}
        onReset={() => setFilters(INITIAL_FILTERS)}
        onSortChange={setSort}
        sort={sort}
        tags={tags}
      />
      <ProblemBatchToolbar groups={groups} onDone={selection.clear} refresh={refresh} selectedProblems={selection.selectedProblems} />
      {bulkDelete.error && <InlineNotice tone="error">{bulkDelete.error}</InlineNotice>}
      <ProblemTable deleteState={bulkDelete} groups={groups} onToggle={selection.toggle} onToggleAll={selection.toggleAll} problems={problems} refresh={refresh} selection={selection} />
    </div>
  );
}

function ProblemFilterBar({ filters, groups, onPatch, onReset, onSortChange, sort, tags }: {
  readonly filters: ProblemFilters;
  readonly groups: readonly ReviewGroup[];
  readonly onPatch: (patch: Partial<ProblemFilters>) => void;
  readonly onReset: () => void;
  readonly onSortChange: (value: ProblemSort) => void;
  readonly sort: ProblemSort;
  readonly tags: readonly string[];
}): React.ReactElement {
  return (
    <div className="filter-bar">
      <label className="search-field">
        <Icon name="search" size={17} />
        <input aria-label="搜索题目" onChange={(event) => onPatch({ search: event.target.value })} placeholder="搜索题号、标题或标签" type="search" value={filters.search} />
      </label>
      <select aria-label="按复习状态筛选" onChange={(event) => onPatch({ status: event.target.value as StatusFilter })} value={filters.status}>
        <option value="ALL">全部状态</option><option value="ACTIVE">复习中</option><option value="PAUSED">已暂停</option>
      </select>
      <select aria-label="按难度筛选" onChange={(event) => onPatch({ difficulty: event.target.value as DifficultyFilter })} value={filters.difficulty}>
        <option value="ALL">全部难度</option><option value="EASY">简单</option><option value="MEDIUM">中等</option><option value="HARD">困难</option>
      </select>
      <select aria-label="按高频题单筛选" onChange={(event) => onPatch({ list: event.target.value as ListFilter })} value={filters.list}>
        <option value="ALL">全部题单</option>
        {BUILTIN_PROBLEM_LISTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {groups.length > 0 && (
        <select aria-label="按分组筛选" onChange={(event) => onPatch({ group: event.target.value })} value={filters.group}>
          <option value="ALL">全部分组</option><option value="DEFAULT">默认分组</option>
          {groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      )}
      <select aria-label="按标签筛选" onChange={(event) => onPatch({ tag: event.target.value })} value={filters.tag}>
        <option value="ALL">全部标签</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <select aria-label="排序方式" onChange={(event) => onSortChange(event.target.value as ProblemSort)} value={sort}>
        <option value="CREATED_AT_DESC">添加日期（最新优先）</option><option value="CREATED_AT_ASC">添加日期（最旧优先）</option>
        <option value="LAST_REVIEW_AT_DESC">最近复习日期（最新优先）</option><option value="LAST_REVIEW_AT_ASC">最近复习日期（最旧优先）</option>
      </select>
      {hasActiveFilters(filters) && <Button onClick={onReset} tone="ghost">清除筛选</Button>}
    </div>
  );
}

type SelectionState = ReturnType<typeof useProblemSelection>;
type DeleteState = ReturnType<typeof useProblemDelete>;

function ProblemTable({ deleteState, groups, onToggle, onToggleAll, problems, refresh, selection }: {
  readonly deleteState: DeleteState;
  readonly groups: readonly ReviewGroup[];
  readonly onToggle: (problemId: string) => void;
  readonly onToggleAll: () => void;
  readonly problems: readonly ProblemRecord[];
  readonly refresh: () => Promise<void>;
  readonly selection: SelectionState;
}): React.ReactElement {
  return (
    <section className="problem-table" aria-label="题目列表">
      <ProblemTableHeader deleteState={deleteState} onToggleAll={onToggleAll} selection={selection} showSelectAll={problems.length > 0} />
      {problems.length === 0
        ? <EmptyState description="试试放宽搜索或筛选条件。" icon="search" title="没有匹配的题目" />
        : problems.map((problem) => (
          <ProblemTableRow busy={deleteState.deleting} groups={groups} key={problem.problemId} onToggle={() => onToggle(problem.problemId)} problem={problem} refresh={refresh} selected={selection.selectedIds.has(problem.problemId)} />
        ))}
    </section>
  );
}

function ProblemTableHeader({ deleteState, onToggleAll, selection, showSelectAll }: {
  readonly deleteState: DeleteState;
  readonly onToggleAll: () => void;
  readonly selection: SelectionState;
  readonly showSelectAll: boolean;
}): React.ReactElement {
  const someSelected = selection.selectedCount > 0;
  const { cancelConfirm, confirming, deleting, remove } = deleteState;
  return (
    <header>
      <span className="problem-heading">
        {showSelectAll && <input aria-label="全选当前题目" checked={selection.allSelected} className="problem-check" disabled={deleting} onChange={onToggleAll} ref={bindIndeterminate(someSelected && !selection.allSelected)} type="checkbox" />}
        题目
      </span>
      <span className="problem-table__meta">难度</span>
      <span className="problem-table__meta">下次复习</span>
      {someSelected
        ? <Button aria-label={confirming ? `再点一次确认删除 ${selection.selectedCount} 道题` : `删除所选 ${selection.selectedCount} 道题`} className="problem-table__bulk-delete" disabled={deleting} icon="trash" onBlur={cancelConfirm} onClick={() => void remove()} tone="danger">{deleting ? '删除中…' : confirming ? '再点一次确认' : '删除所选'}</Button>
        : <span>操作</span>}
    </header>
  );
}

function ProblemTableRow({ busy, groups, onToggle, problem, refresh, selected }: {
  readonly busy: boolean;
  readonly groups: readonly ReviewGroup[];
  readonly onToggle: () => void;
  readonly problem: ProblemRecord;
  readonly refresh: () => Promise<void>;
  readonly selected: boolean;
}): React.ReactElement {
  const paused = isProblemPaused(problem);
  const group = resolveProblemGroup(problem, { reviewGroups: groups });
  return (
    <article className={`problem-table__row${selected ? ' is-selected' : ''}${paused ? ' is-paused' : ''}`}>
      <div className="problem-cell">
        <input aria-label={`选择${problem.title}`} checked={selected} className="problem-check" disabled={busy} onChange={onToggle} type="checkbox" />
        <span className="problem-cell__number">{problem.frontendId}</span>
        <div>
          <a href={problem.url} rel="noreferrer" target="_blank">{problem.title} <Icon name="external" size={13} /></a>
          <small className="problem-cell__meta">
            {paused && <span className="status-chip status-chip--paused">已暂停</span>}
            {group && <span className="status-chip status-chip--group">{group.name} · {Math.round(group.requestRetention * 100)}%</span>}
            <span>记录于 {formatDate(problem.createdAt)} · {problem.tags.slice(0, 3).join(' / ')}</span>
          </small>
        </div>
      </div>
      <DifficultyBadge difficulty={problem.difficulty} />
      <span className="next-review">{paused ? '已暂停复习' : formatDue(problem.nextReviewAt)}</span>
      <ProblemRowActions busy={busy} paused={paused} problem={problem} refresh={refresh} />
    </article>
  );
}

function ProblemRowActions({ busy, paused, problem, refresh }: {
  readonly busy: boolean;
  readonly paused: boolean;
  readonly problem: ProblemRecord;
  readonly refresh: () => Promise<void>;
}): React.ReactElement {
  const deletion = useProblemDelete([problem.problemId], refresh, noop);
  const pause = useProblemPauseToggle(problem.problemId, paused, refresh);
  const disabled = busy || deletion.deleting || pause.toggling;
  const pauseActionLabel = paused ? '恢复复习' : '暂停复习';
  const deleteActionLabel = deletion.confirming ? '确认删除' : '删除';
  return (
    <div className="row-actions">
      <button aria-label={`${pauseActionLabel}${problem.title}`} disabled={disabled} onClick={() => void pause.toggle()} title={pauseActionLabel} type="button">
        <Icon name={paused ? 'play' : 'pause'} size={15} /><span>{paused ? '恢复' : '暂停'}</span>
      </button>
      <a aria-label={`打开${problem.title}`} href={problem.url} rel="noreferrer" target="_blank"><Icon name="external" size={16} /></a>
      <button aria-label={`${deleteActionLabel}${problem.title}`} className={deletion.confirming ? 'confirm-delete' : ''} disabled={disabled} onBlur={deletion.cancelConfirm} onClick={() => void deletion.remove()} type="button">
        <Icon name="trash" size={16} /><span>{deletion.confirming ? '再点一次确认' : '删除'}</span>
      </button>
      {deletion.error && <InlineNotice tone="error">{deletion.error}</InlineNotice>}
    </div>
  );
}

function useProblemPauseToggle(problemId: string, paused: boolean, refresh: () => Promise<void>) {
  const [toggling, setToggling] = useState(false);
  const toggle = async (): Promise<void> => {
    setToggling(true);
    try {
      await sendExtensionRequest({ type: 'problem.set-paused', payload: { problemIds: [problemId], paused: !paused } });
      await refresh();
    } finally {
      setToggling(false);
    }
  };
  return { toggle, toggling };
}

function useProblemSelection(problems: readonly ProblemRecord[]) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedProblems = problems.filter((problem) => selectedIds.has(problem.problemId));
  const selectedProblemIds = selectedProblems.map((problem) => problem.problemId);
  const selectedCount = selectedProblemIds.length;
  const allSelected = problems.length > 0 && selectedCount === problems.length;
  return {
    allSelected,
    clear: () => { setSelectedIds(new Set()); },
    selectedCount,
    selectedIds,
    selectedProblemIds,
    selectedProblems,
    toggle: (problemId: string) => {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(problemId)) next.delete(problemId);
        else next.add(problemId);
        return next;
      });
    },
    toggleAll: () => { setSelectedIds(allSelected ? new Set() : new Set(problems.map((problem) => problem.problemId))); },
  };
}

function useProblemDelete(problemIds: readonly string[], refresh: () => Promise<void>, onDeleted: () => void) {
  const selectionKey = problemIds.join('\0');
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirming = confirmingKey === selectionKey && problemIds.length > 0;
  const remove = async (): Promise<void> => {
    if (problemIds.length === 0) return;
    if (!confirming) { setConfirmingKey(selectionKey); return; }
    setDeleting(true);
    setError(null);
    try {
      await sendExtensionRequest({ type: 'problem.delete', payload: { problemIds } });
      await refresh();
      onDeleted();
      setConfirmingKey(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除题目失败');
    } finally {
      setDeleting(false);
    }
  };
  return { cancelConfirm: () => { setConfirmingKey(null); }, confirming, deleting, error, remove };
}

function hasActiveFilters(filters: ProblemFilters): boolean {
  return Boolean(
    filters.search || filters.difficulty !== 'ALL' || filters.status !== 'ALL'
      || filters.group !== 'ALL' || filters.list !== 'ALL' || filters.tag !== 'ALL',
  );
}

function bindIndeterminate(indeterminate: boolean) {
  return (element: HTMLInputElement | null): void => {
    if (element) element.indeterminate = indeterminate;
  };
}

function noop(): void {}
