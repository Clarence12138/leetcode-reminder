import { useMemo, useState } from 'react';
import type { DailySummary, Difficulty, ProblemRecord } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, DifficultyBadge, EmptyState, InlineNotice, PageHeading } from '../../../src/ui/components';
import { formatDate, formatDue } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';

type DifficultyFilter = Difficulty | 'ALL';
type ProblemDateField = 'CREATED_AT' | 'LAST_REVIEW_AT';
type SortDirection = 'ASC' | 'DESC';
type ProblemSort = 'CREATED_AT_ASC' | 'CREATED_AT_DESC' | 'LAST_REVIEW_AT_ASC' | 'LAST_REVIEW_AT_DESC';
type ProblemFilters = Readonly<{ difficulty: DifficultyFilter; search: string; tag: string }>;

const SORT_OPTIONS: Readonly<Record<ProblemSort, Readonly<{ dateField: ProblemDateField; direction: SortDirection }>>> = {
  CREATED_AT_ASC: { dateField: 'CREATED_AT', direction: 'ASC' },
  CREATED_AT_DESC: { dateField: 'CREATED_AT', direction: 'DESC' },
  LAST_REVIEW_AT_ASC: { dateField: 'LAST_REVIEW_AT', direction: 'ASC' },
  LAST_REVIEW_AT_DESC: { dateField: 'LAST_REVIEW_AT', direction: 'DESC' },
};

export function ProblemsView({ summary, refresh }: { readonly refresh: () => Promise<void>; readonly summary: DailySummary }): React.ReactElement {
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('ALL');
  const [tag, setTag] = useState('ALL');
  const [sort, setSort] = useState<ProblemSort>('CREATED_AT_DESC');
  const tags = useMemo(() => getTags(summary.problems), [summary.problems]);
  const problems = useMemo(
    () => [...filterProblems(summary.problems, { difficulty, search, tag })].sort((left, right) => compareProblems(left, right, sort)),
    [difficulty, search, sort, summary.problems, tag],
  );
  const selection = useProblemSelection(problems);
  const bulkDelete = useProblemDelete(selection.selectedProblemIds, refresh, selection.clear);
  return (
    <div className="view-content">
      <PageHeading description={`共记录 ${summary.problems.length} 道题，题目信息来自力扣中文站。`} title="全部题目" />
      <ProblemFilterBar
        difficulty={difficulty}
        onDifficultyChange={setDifficulty}
        onReset={() => { setSearch(''); setDifficulty('ALL'); setTag('ALL'); }}
        onSearchChange={setSearch}
        onSortChange={setSort}
        onTagChange={setTag}
        search={search}
        sort={sort}
        tag={tag}
        tags={tags}
      />
      {bulkDelete.error && <InlineNotice tone="error">{bulkDelete.error}</InlineNotice>}
      <ProblemTable deleteState={bulkDelete} onToggle={selection.toggle} onToggleAll={selection.toggleAll} problems={problems} refresh={refresh} selection={selection} />
    </div>
  );
}

type FilterBarProps = Readonly<{
  difficulty: DifficultyFilter;
  onDifficultyChange: (value: DifficultyFilter) => void;
  onReset: () => void;
  onSearchChange: (value: string) => void;
  onSortChange: (value: ProblemSort) => void;
  onTagChange: (value: string) => void;
  search: string;
  sort: ProblemSort;
  tag: string;
  tags: readonly string[];
}>;

function ProblemFilterBar({ difficulty, onDifficultyChange, onReset, onSearchChange, onSortChange, onTagChange, search, sort, tag, tags }: FilterBarProps): React.ReactElement {
  return (
    <div className="filter-bar">
      <label className="search-field"><Icon name="search" size={17} /><input aria-label="搜索题目" onChange={(event) => onSearchChange(event.target.value)} placeholder="搜索题号、标题或标签" type="search" value={search} /></label>
      <select aria-label="按难度筛选" onChange={(event) => onDifficultyChange(event.target.value as DifficultyFilter)} value={difficulty}>
        <option value="ALL">全部难度</option><option value="EASY">简单</option><option value="MEDIUM">中等</option><option value="HARD">困难</option>
      </select>
      <select aria-label="按标签筛选" onChange={(event) => onTagChange(event.target.value)} value={tag}>
        <option value="ALL">全部标签</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <select aria-label="排序方式" onChange={(event) => onSortChange(event.target.value as ProblemSort)} value={sort}>
        <option value="CREATED_AT_DESC">添加日期（最新优先）</option><option value="CREATED_AT_ASC">添加日期（最旧优先）</option>
        <option value="LAST_REVIEW_AT_DESC">最近复习日期（最新优先）</option><option value="LAST_REVIEW_AT_ASC">最近复习日期（最旧优先）</option>
      </select>
      {(search || difficulty !== 'ALL' || tag !== 'ALL') && <Button onClick={onReset} tone="ghost">清除筛选</Button>}
    </div>
  );
}

type SelectionState = ReturnType<typeof useProblemSelection>;
type DeleteState = ReturnType<typeof useProblemDelete>;

function ProblemTable({ deleteState, onToggle, onToggleAll, problems, refresh, selection }: {
  readonly deleteState: DeleteState;
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
        : problems.map((problem) => <ProblemTableRow busy={deleteState.deleting} key={problem.problemId} onToggle={() => onToggle(problem.problemId)} problem={problem} refresh={refresh} selected={selection.selectedIds.has(problem.problemId)} />)}
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

function ProblemTableRow({ busy, onToggle, problem, refresh, selected }: {
  readonly busy: boolean;
  readonly onToggle: () => void;
  readonly problem: ProblemRecord;
  readonly refresh: () => Promise<void>;
  readonly selected: boolean;
}): React.ReactElement {
  const deletion = useProblemDelete([problem.problemId], refresh, noop);
  const disabled = busy || deletion.deleting;
  return (
    <article className={`problem-table__row${selected ? ' is-selected' : ''}`}>
      <div className="problem-cell">
        <input aria-label={`选择${problem.title}`} checked={selected} className="problem-check" disabled={disabled} onChange={onToggle} type="checkbox" />
        <span className="problem-cell__number">{problem.frontendId}</span>
        <div><a href={problem.url} rel="noreferrer" target="_blank">{problem.title} <Icon name="external" size={13} /></a><small>记录于 {formatDate(problem.createdAt)} · {problem.tags.slice(0, 3).join(' / ')}</small></div>
      </div>
      <DifficultyBadge difficulty={problem.difficulty} />
      <span className="next-review">{formatDue(problem.nextReviewAt)}</span>
      <div className="row-actions">
        <a aria-label={`打开${problem.title}`} href={problem.url} rel="noreferrer" target="_blank"><Icon name="external" size={16} /></a>
        <button aria-label={`${deletion.confirming ? '确认删除' : '删除'}${problem.title}`} className={deletion.confirming ? 'confirm-delete' : ''} disabled={disabled} onBlur={deletion.cancelConfirm} onClick={() => void deletion.remove()} type="button"><Icon name="trash" size={16} /><span>{deletion.confirming ? '再点一次确认' : '删除'}</span></button>
        {deletion.error && <InlineNotice tone="error">{deletion.error}</InlineNotice>}
      </div>
    </article>
  );
}

function useProblemSelection(problems: readonly ProblemRecord[]): {
  readonly allSelected: boolean;
  readonly clear: () => void;
  readonly selectedCount: number;
  readonly selectedIds: ReadonlySet<string>;
  readonly selectedProblemIds: readonly string[];
  readonly toggle: (problemId: string) => void;
  readonly toggleAll: () => void;
} {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedProblemIds = problems.map((problem) => problem.problemId).filter((id) => selectedIds.has(id));
  const selectedCount = selectedProblemIds.length;
  const allSelected = problems.length > 0 && selectedCount === problems.length;
  return {
    allSelected,
    clear: () => { setSelectedIds(new Set()); },
    selectedCount,
    selectedIds,
    selectedProblemIds,
    toggle: (problemId) => {
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

function useProblemDelete(problemIds: readonly string[], refresh: () => Promise<void>, onDeleted: () => void): {
  readonly cancelConfirm: () => void;
  readonly confirming: boolean;
  readonly deleting: boolean;
  readonly error: string | null;
  readonly remove: () => Promise<void>;
} {
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

function bindIndeterminate(indeterminate: boolean) {
  return (element: HTMLInputElement | null): void => {
    if (element) element.indeterminate = indeterminate;
  };
}

function noop(): void {}

function getTags(problems: readonly ProblemRecord[]): readonly string[] {
  return [...new Set(problems.flatMap((problem) => problem.tags))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function compareProblems(left: ProblemRecord, right: ProblemRecord, sort: ProblemSort): number {
  const { dateField, direction } = SORT_OPTIONS[sort];
  const bySelectedDate = compareOptionalTimestamp(getProblemTimestamp(left, dateField), getProblemTimestamp(right, dateField), direction);
  if (bySelectedDate !== 0) return bySelectedDate;
  const byCreated = compareTimestamp(left.createdAt, right.createdAt, direction);
  if (byCreated !== 0) return byCreated;
  return left.problemId.localeCompare(right.problemId);
}

function compareOptionalTimestamp(left: number | undefined, right: number | undefined, direction: SortDirection): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return compareTimestamp(left, right, direction);
}

function compareTimestamp(left: number, right: number, direction: SortDirection): number {
  return direction === 'ASC' ? left - right : right - left;
}

function getProblemTimestamp(problem: ProblemRecord, dateField: ProblemDateField): number | undefined {
  return dateField === 'CREATED_AT' ? problem.createdAt : problem.fsrsCard?.last_review;
}

function filterProblems(problems: readonly ProblemRecord[], filters: ProblemFilters): readonly ProblemRecord[] {
  const query = filters.search.trim().toLocaleLowerCase('zh-CN');
  return problems.filter((problem) => {
    if (filters.difficulty !== 'ALL' && problem.difficulty !== filters.difficulty) return false;
    if (filters.tag !== 'ALL' && !problem.tags.includes(filters.tag)) return false;
    if (!query) return true;
    return [problem.frontendId, problem.title, problem.slug, ...problem.tags].some((value) => value.toLocaleLowerCase('zh-CN').includes(query));
  });
}
