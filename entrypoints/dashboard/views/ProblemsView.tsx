import { useMemo, useState } from 'react';
import type { DailySummary, Difficulty, ProblemRecord } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, DifficultyBadge, EmptyState, InlineNotice, PageHeading } from '../../../src/ui/components';
import { formatDate, formatDue } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';

type DifficultyFilter = Difficulty | 'ALL';

export function ProblemsView({ summary, refresh }: { readonly refresh: () => Promise<void>; readonly summary: DailySummary }): React.ReactElement {
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('ALL');
  const [tag, setTag] = useState('ALL');
  const tags = useMemo(() => getTags(summary.problems), [summary.problems]);
  const problems = useMemo(
    () => filterProblems(summary.problems, { difficulty, search, tag }),
    [difficulty, search, summary.problems, tag],
  );
  const resetFilters = (): void => { setSearch(''); setDifficulty('ALL'); setTag('ALL'); };
  return (
    <div className="view-content">
      <PageHeading description={`共记录 ${summary.problems.length} 道题，题目信息来自力扣中文站。`} title="全部题目" />
      <div className="filter-bar">
        <label className="search-field"><Icon name="search" size={17} /><input aria-label="搜索题目" onChange={(event) => setSearch(event.target.value)} placeholder="搜索题号、标题或标签" type="search" value={search} /></label>
        <select aria-label="按难度筛选" onChange={(event) => setDifficulty(event.target.value as DifficultyFilter)} value={difficulty}>
          <option value="ALL">全部难度</option><option value="EASY">简单</option><option value="MEDIUM">中等</option><option value="HARD">困难</option>
        </select>
        <select aria-label="按标签筛选" onChange={(event) => setTag(event.target.value)} value={tag}>
          <option value="ALL">全部标签</option>{tags.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {(search || difficulty !== 'ALL' || tag !== 'ALL') && <Button onClick={resetFilters} tone="ghost">清除筛选</Button>}
      </div>
      <section className="problem-table" aria-label="题目列表">
        <header><span>题目</span><span>难度</span><span>下次复习</span><span>操作</span></header>
        {problems.length === 0
          ? <EmptyState description="试试放宽搜索或筛选条件。" icon="search" title="没有匹配的题目" />
          : problems.map((problem) => <ProblemTableRow key={problem.problemId} problem={problem} refresh={refresh} />)}
      </section>
    </div>
  );
}

function ProblemTableRow({ problem, refresh }: { readonly problem: ProblemRecord; readonly refresh: () => Promise<void> }): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async (): Promise<void> => {
    if (!confirming) { setConfirming(true); return; }
    setDeleting(true);
    setError(null);
    try {
      await sendExtensionRequest({ type: 'problem.delete', payload: { problemId: problem.problemId } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除题目失败');
      setDeleting(false);
    }
  };
  return (
    <article className="problem-table__row">
      <div className="problem-cell">
        <span className="problem-cell__number">{problem.frontendId}</span>
        <div><a href={problem.url} rel="noreferrer" target="_blank">{problem.title} <Icon name="external" size={13} /></a><small>记录于 {formatDate(problem.createdAt)} · {problem.tags.slice(0, 3).join(' / ')}</small></div>
      </div>
      <DifficultyBadge difficulty={problem.difficulty} />
      <span className="next-review">{formatDue(problem.nextReviewAt)}</span>
      <div className="row-actions">
        <a aria-label={`打开${problem.title}`} href={problem.url} rel="noreferrer" target="_blank"><Icon name="external" size={16} /></a>
        <button aria-label={`${confirming ? '确认删除' : '删除'}${problem.title}`} className={confirming ? 'confirm-delete' : ''} disabled={deleting} onBlur={() => setConfirming(false)} onClick={() => void remove()} type="button"><Icon name="trash" size={16} /><span>{confirming ? '再点一次确认' : '删除'}</span></button>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
      </div>
    </article>
  );
}

function getTags(problems: readonly ProblemRecord[]): readonly string[] {
  return [...new Set(problems.flatMap((problem) => problem.tags))].sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function filterProblems(problems: readonly ProblemRecord[], filters: { readonly difficulty: DifficultyFilter; readonly search: string; readonly tag: string }): readonly ProblemRecord[] {
  const query = filters.search.trim().toLocaleLowerCase('zh-CN');
  return problems.filter((problem) => {
    if (filters.difficulty !== 'ALL' && problem.difficulty !== filters.difficulty) return false;
    if (filters.tag !== 'ALL' && !problem.tags.includes(filters.tag)) return false;
    if (!query) return true;
    return [problem.frontendId, problem.title, problem.slug, ...problem.tags].some((value) => value.toLocaleLowerCase('zh-CN').includes(query));
  });
}
