import { useMemo, useState } from 'react';
import { isProblemPaused } from '../../../src/domain/queue-policy';
import type { DailySummary, Settings } from '../../../src/domain/types';
import { InlineNotice, PageHeading } from '../../../src/ui/components';
import { ProblemBatchToolbar } from './ProblemBatchToolbar';
import {
  countByStatus,
  difficultyFacets,
  EMPTY_FILTERS,
  filterProblems,
  groupFacets,
  listFacets,
  sortProblems,
  tagFacets,
  type FilterContext,
  type ProblemFilters,
  type ProblemSort,
} from './problem-filters';
import { ProblemFilterBar, type ProblemFacets } from './problems/ProblemFilterBar';
import { useActionRunner, useProblemSelection, type ActionRunner } from './problems/problem-actions';
import { ProblemTable } from './problems/ProblemTable';
import './problems.css';

const PAGE_SIZE = 50;
type ReviewGroups = NonNullable<Settings['reviewGroups']>;
const NO_GROUPS: ReviewGroups = [];

function useProblemsModel(all: DailySummary['problems'], groups: ReviewGroups) {
  const [filters, setFilters] = useState<ProblemFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<ProblemSort>('CREATED_AT_DESC');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const context = useMemo<FilterContext>(() => ({ knownGroupIds: new Set(groups.map((group) => group.id)) }), [groups]);
  const matched = useMemo(() => sortProblems(filterProblems(all, filters, context), sort), [all, filters, context, sort]);
  const visible = useMemo(() => matched.slice(0, limit), [limit, matched]);
  const facets = useMemo<ProblemFacets>(() => ({
    difficulties: difficultyFacets(all),
    groups: groups.length > 0 ? groupFacets(all, groups, context) : null,
    tags: tagFacets(all),
    lists: listFacets(all),
  }), [all, context, groups]);
  const statusCounts = useMemo(() => countByStatus(all, filters, context), [all, filters, context]);
  return {
    facets, filters, matched, sort, statusCounts, visible,
    loadMore: () => setLimit((current) => current + PAGE_SIZE),
    patchFilters: (patch: Partial<ProblemFilters>): void => {
      setFilters((current) => ({ ...current, ...patch }));
      setLimit(PAGE_SIZE);
    },
    resetFilters: (): void => {
      setFilters(EMPTY_FILTERS);
      setLimit(PAGE_SIZE);
    },
    setSort,
  };
}

export function ProblemsView({
  refresh,
  settings,
  summary,
}: {
  readonly refresh: () => Promise<void>;
  readonly settings?: Settings;
  readonly summary: DailySummary;
}): React.ReactElement {
  const groups = settings?.reviewGroups ?? NO_GROUPS;
  const model = useProblemsModel(summary.problems, groups);
  const { filters, matched, patchFilters, resetFilters, visible } = model;
  const runner = useActionRunner(refresh);
  const selection = useProblemSelection(visible);
  return (
    <div className="view-content problems-view">
      <PageHeading description={summaryText(summary.problems)} title="题库" />
      <ProblemFilterBar
        facets={model.facets}
        filters={filters}
        onChange={patchFilters}
        onReset={resetFilters}
        onSortChange={model.setSort}
        resultCount={matched.length}
        sort={model.sort}
        statusCounts={model.statusCounts}
        total={summary.problems.length}
      />
      <InlineResult runner={runner} />
      <ProblemTable
        groupColumn={groups.length > 0 ? { groups, defaultRetention: settings?.defaultRequestRetention } : null}
        matchedCount={matched.length}
        onLoadMore={model.loadMore}
        onResetFilters={resetFilters}
        problems={visible}
        refresh={refresh}
        runner={runner}
        selection={selection}
      />
      <ProblemBatchToolbar
        defaultRetention={settings?.defaultRequestRetention}
        groups={groups}
        onClear={selection.clear}
        refresh={refresh}
        runner={runner}
        selected={selection.selected}
      />
    </div>
  );
}

function summaryText(all: DailySummary['problems']): string {
  const paused = all.filter((problem) => isProblemPaused(problem)).length;
  return `共 ${all.length} 题 · 复习中 ${all.length - paused} · 已暂停 ${paused}`;
}

/** 没有挂提示条时，操作结果显示在表格上方。 */
function InlineResult({ runner }: { readonly runner: ActionRunner }): React.ReactElement | null {
  if (!runner.inlineNotice) return null;
  return (
    <InlineNotice tone={runner.inlineNotice.tone}>
      {runner.inlineNotice.message}{' '}
      <button className="plink" onClick={runner.dismissInline} type="button">知道了</button>
    </InlineNotice>
  );
}
