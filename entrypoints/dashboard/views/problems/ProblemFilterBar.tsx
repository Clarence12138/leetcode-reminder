import type { BuiltinProblemListId } from '../../../../src/domain/problem-lists';
import type { Difficulty } from '../../../../src/domain/types';
import { Button, ChipMenu, Segmented, type ChipMenuOption } from '../../../../src/ui/components';
import { Icon } from '../../../../src/ui/Icon';
import {
  hasActiveFilters,
  SORT_LABELS,
  type FacetOption,
  type ProblemFilters,
  type ProblemSort,
  type StatusCounts,
  type StatusFilter,
} from '../problem-filters';

export interface ProblemFacets {
  readonly difficulties: readonly FacetOption<Difficulty>[];
  /** 没有自定义分组时为 null，不显示分组筛选。 */
  readonly groups: readonly FacetOption<string>[] | null;
  readonly tags: readonly FacetOption<string>[];
  readonly lists: readonly FacetOption<BuiltinProblemListId>[];
}

export interface ProblemFilterBarProps {
  readonly facets: ProblemFacets;
  readonly filters: ProblemFilters;
  readonly onChange: (patch: Partial<ProblemFilters>) => void;
  readonly onReset: () => void;
  readonly onSortChange: (sort: ProblemSort) => void;
  readonly resultCount: number;
  readonly sort: ProblemSort;
  readonly statusCounts: StatusCounts;
  readonly total: number;
}

const SORT_OPTIONS: readonly ChipMenuOption<ProblemSort>[] = (Object.keys(SORT_LABELS) as ProblemSort[])
  .map((value) => ({ value, label: SORT_LABELS[value] }));

export function ProblemFilterBar(props: ProblemFilterBarProps): React.ReactElement {
  const { filters, onChange } = props;
  const filtered = hasActiveFilters(filters);
  return (
    <div className="pfilters">
      <label className="field psearch">
        <Icon name="search" size={15} />
        <input aria-label="搜索题目" onChange={(event) => onChange({ search: event.target.value })} placeholder="搜索题号、标题或标签" type="search" value={filters.search} />
      </label>
      <StatusSegment counts={props.statusCounts} onChange={(status) => onChange({ status })} value={filters.status} />
      <FacetMenus facets={props.facets} filters={filters} onChange={onChange} />
      <span className="pfilters-spacer" />
      {filtered && (
        <span className="pfilters-result">
          <span aria-live="polite" className="num">{props.resultCount} / {props.total} 题</span>
          <Button onClick={props.onReset} size="sm" tone="ghost">清除筛选</Button>
        </span>
      )}
      <ChipMenu
        align="right"
        className="psort"
        icon="sort"
        label="排序"
        multiple={false}
        onChange={(next) => { if (next[0]) props.onSortChange(next[0]); }}
        options={SORT_OPTIONS}
        selected={[props.sort]}
      />
    </div>
  );
}

function StatusSegment({ counts, onChange, value }: {
  readonly counts: StatusCounts;
  readonly onChange: (value: StatusFilter) => void;
  readonly value: StatusFilter;
}): React.ReactElement {
  const option = (status: StatusFilter, label: string, count: number) => ({
    value: status,
    label: <>{label} <span className="seg-count num">{count}</span></>,
    ariaLabel: `${label}（${count}）`,
  });
  return (
    <Segmented
      ariaLabel="按复习状态筛选"
      onChange={onChange}
      options={[option('ALL', '全部', counts.all), option('ACTIVE', '复习中', counts.active), option('PAUSED', '已暂停', counts.paused)]}
      value={value}
    />
  );
}

function FacetMenus({ facets, filters, onChange }: {
  readonly facets: ProblemFacets;
  readonly filters: ProblemFilters;
  readonly onChange: (patch: Partial<ProblemFilters>) => void;
}): React.ReactElement {
  return (
    <>
      <ChipMenu label="难度" onChange={(difficulties) => onChange({ difficulties })} options={toOptions(facets.difficulties)} selected={filters.difficulties} />
      {facets.groups && (
        <ChipMenu label="分组" onChange={(groups) => onChange({ groups })} options={toOptions(facets.groups)} selected={filters.groups} />
      )}
      {facets.tags.length > 0 && (
        <ChipMenu label="标签" onChange={(tags) => onChange({ tags })} options={toOptions(facets.tags)} selected={filters.tags} />
      )}
      <ChipMenu label="高频题单" onChange={(lists) => onChange({ lists })} options={toOptions(facets.lists)} selected={filters.lists} />
    </>
  );
}

function toOptions<T extends string>(facets: readonly FacetOption<T>[]): ChipMenuOption<T>[] {
  return facets.map((facet) => ({ value: facet.value, label: facet.label, hint: <CountHint count={facet.count} /> }));
}

/** 菜单右侧的题目数：屏幕上只显示数字，读屏读作「，3 题」。 */
export function CountHint({ count }: { readonly count: number }): React.ReactElement {
  return <><span className="visually-hidden">，</span>{count}<span className="visually-hidden"> 题</span></>;
}
