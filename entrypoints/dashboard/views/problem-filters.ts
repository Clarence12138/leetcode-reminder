import { BUILTIN_PROBLEM_LISTS, isSlugInBuiltinList, type BuiltinProblemListId } from '../../../src/domain/problem-lists';
import { isProblemPaused } from '../../../src/domain/queue-policy';
import type { Difficulty, ProblemRecord, ReviewGroup } from '../../../src/domain/types';
import { difficultyLabel } from '../../../src/ui/format';

export type StatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED';
export type ProblemSort =
  | 'CREATED_AT_ASC'
  | 'CREATED_AT_DESC'
  | 'LAST_REVIEW_AT_ASC'
  | 'LAST_REVIEW_AT_DESC';

/** 分组筛选里代表「默认分组」的值：没设分组，或所在分组已被删除。 */
export const DEFAULT_GROUP = 'DEFAULT';

/** 多选筛选：同一类里选多个是「任一满足」，不同类之间是「同时满足」；空数组表示不限。 */
export type ProblemFilters = Readonly<{
  search: string;
  status: StatusFilter;
  difficulties: readonly Difficulty[];
  groups: readonly string[];
  tags: readonly string[];
  lists: readonly BuiltinProblemListId[];
}>;

export const EMPTY_FILTERS: ProblemFilters = {
  search: '',
  status: 'ALL',
  difficulties: [],
  groups: [],
  tags: [],
  lists: [],
};

export interface FilterContext {
  /** 设置里现有的分组 id；题目的分组不在其中时按默认分组处理。 */
  readonly knownGroupIds: ReadonlySet<string>;
}

export interface FacetOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count: number;
}

export interface StatusCounts {
  readonly all: number;
  readonly active: number;
  readonly paused: number;
}

export const SORT_LABELS: Readonly<Record<ProblemSort, string>> = {
  CREATED_AT_DESC: '添加日期 新→旧',
  CREATED_AT_ASC: '添加日期 旧→新',
  LAST_REVIEW_AT_DESC: '最近复习 新→旧',
  LAST_REVIEW_AT_ASC: '最近复习 旧→新',
};

const DIFFICULTIES: readonly Difficulty[] = ['EASY', 'MEDIUM', 'HARD'];

export function hasActiveFilters(filters: ProblemFilters): boolean {
  if (filters.search.trim() !== '' || filters.status !== 'ALL') return true;
  return [filters.difficulties, filters.groups, filters.tags, filters.lists].some((values) => values.length > 0);
}

export function problemGroupKey(problem: Pick<ProblemRecord, 'groupId'>, context: FilterContext): string {
  return problem.groupId && context.knownGroupIds.has(problem.groupId) ? problem.groupId : DEFAULT_GROUP;
}

export function filterProblems(
  problems: readonly ProblemRecord[],
  filters: ProblemFilters,
  context: FilterContext,
): ProblemRecord[] {
  const query = filters.search.trim().toLocaleLowerCase('zh-CN');
  return problems.filter((problem) =>
    matchesStatus(problem, filters.status)
    && matchesFacets(problem, filters, context)
    && matchesQuery(problem, query));
}

/** 状态分段上的数量：按除状态以外的筛选条件统计。 */
export function countByStatus(
  problems: readonly ProblemRecord[],
  filters: ProblemFilters,
  context: FilterContext,
): StatusCounts {
  const matched = filterProblems(problems, { ...filters, status: 'ALL' }, context);
  const paused = matched.filter((problem) => isProblemPaused(problem)).length;
  return { all: matched.length, active: matched.length - paused, paused };
}

export function sortProblems(problems: readonly ProblemRecord[], sort: ProblemSort): ProblemRecord[] {
  return [...problems].sort((left, right) => compareProblems(left, right, sort));
}

export function difficultyFacets(problems: readonly ProblemRecord[]): FacetOption<Difficulty>[] {
  return DIFFICULTIES.map((value) => ({
    value,
    label: difficultyLabel[value],
    count: problems.filter((problem) => problem.difficulty === value).length,
  }));
}

/** 标签按出现次数从多到少，次数相同按名称。 */
export function tagFacets(problems: readonly ProblemRecord[]): FacetOption<string>[] {
  const counts = new Map<string, number>();
  for (const tag of problems.flatMap((problem) => problem.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'));
}

export function listFacets(problems: readonly ProblemRecord[]): FacetOption<BuiltinProblemListId>[] {
  return BUILTIN_PROBLEM_LISTS.map((list) => ({
    value: list.id,
    label: list.name,
    count: problems.filter((problem) => isSlugInBuiltinList(problem.slug, list.id)).length,
  }));
}

export function groupFacets(
  problems: readonly ProblemRecord[],
  groups: readonly ReviewGroup[],
  context: FilterContext,
): FacetOption<string>[] {
  const keys = problems.map((problem) => problemGroupKey(problem, context));
  const count = (key: string): number => keys.filter((item) => item === key).length;
  return [
    { value: DEFAULT_GROUP, label: '默认分组', count: count(DEFAULT_GROUP) },
    ...groups.map((group) => ({ value: group.id, label: group.name, count: count(group.id) })),
  ];
}

function matchesStatus(problem: ProblemRecord, status: StatusFilter): boolean {
  if (status === 'ACTIVE') return !isProblemPaused(problem);
  if (status === 'PAUSED') return isProblemPaused(problem);
  return true;
}

function matchesFacets(problem: ProblemRecord, filters: ProblemFilters, context: FilterContext): boolean {
  return anyOf(filters.difficulties, (value) => problem.difficulty === value)
    && anyOf(filters.groups, (value) => problemGroupKey(problem, context) === value)
    && anyOf(filters.tags, (value) => problem.tags.includes(value))
    && anyOf(filters.lists, (value) => isSlugInBuiltinList(problem.slug, value));
}

/** 没选任何值时不限；否则满足其中任一即可。 */
function anyOf<T>(selected: readonly T[], test: (value: T) => boolean): boolean {
  return selected.length === 0 || selected.some(test);
}

function matchesQuery(problem: ProblemRecord, query: string): boolean {
  if (!query) return true;
  return [problem.frontendId, problem.title, problem.slug, ...problem.tags].some((value) =>
    value.toLocaleLowerCase('zh-CN').includes(query),
  );
}

type ProblemDateField = 'CREATED_AT' | 'LAST_REVIEW_AT';
type SortDirection = 'ASC' | 'DESC';

const SORT_OPTIONS: Readonly<
  Record<ProblemSort, Readonly<{ dateField: ProblemDateField; direction: SortDirection }>>
> = {
  CREATED_AT_ASC: { dateField: 'CREATED_AT', direction: 'ASC' },
  CREATED_AT_DESC: { dateField: 'CREATED_AT', direction: 'DESC' },
  LAST_REVIEW_AT_ASC: { dateField: 'LAST_REVIEW_AT', direction: 'ASC' },
  LAST_REVIEW_AT_DESC: { dateField: 'LAST_REVIEW_AT', direction: 'DESC' },
};

function compareProblems(left: ProblemRecord, right: ProblemRecord, sort: ProblemSort): number {
  const { dateField, direction } = SORT_OPTIONS[sort];
  const bySelectedDate = compareOptionalTimestamp(
    getProblemTimestamp(left, dateField),
    getProblemTimestamp(right, dateField),
    direction,
  );
  if (bySelectedDate !== 0) return bySelectedDate;
  const byCreated = compareTimestamp(left.createdAt, right.createdAt, direction);
  return byCreated !== 0 ? byCreated : left.problemId.localeCompare(right.problemId);
}

/** 没有该日期的题目（如从未复习）始终排在最后。 */
function compareOptionalTimestamp(
  left: number | undefined,
  right: number | undefined,
  direction: SortDirection,
): number {
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
