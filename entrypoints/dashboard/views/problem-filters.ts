import { isSlugInBuiltinList, type BuiltinProblemListId } from '../../../src/domain/problem-lists';
import { isProblemPaused } from '../../../src/domain/queue-policy';
import type { Difficulty, ProblemRecord } from '../../../src/domain/types';

export type DifficultyFilter = Difficulty | 'ALL';
export type StatusFilter = 'ALL' | 'ACTIVE' | 'PAUSED';
export type GroupFilter = string;
export type ListFilter = 'ALL' | BuiltinProblemListId;
export type ProblemSort =
  | 'CREATED_AT_ASC'
  | 'CREATED_AT_DESC'
  | 'LAST_REVIEW_AT_ASC'
  | 'LAST_REVIEW_AT_DESC';

export type ProblemFilters = Readonly<{
  difficulty: DifficultyFilter;
  group: GroupFilter;
  list: ListFilter;
  search: string;
  status: StatusFilter;
  tag: string;
}>;

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

export function getProblemTags(problems: readonly ProblemRecord[]): readonly string[] {
  return [...new Set(problems.flatMap((problem) => problem.tags))].sort((left, right) =>
    left.localeCompare(right, 'zh-CN'),
  );
}

export function filterAndSortProblems(
  problems: readonly ProblemRecord[],
  filters: ProblemFilters,
  sort: ProblemSort,
): ProblemRecord[] {
  const query = filters.search.trim().toLocaleLowerCase('zh-CN');
  return problems
    .filter((problem) => matchesAllFilters(problem, filters, query))
    .sort((left, right) => compareProblems(left, right, sort));
}

function matchesAllFilters(
  problem: ProblemRecord,
  filters: ProblemFilters,
  query: string,
): boolean {
  return (
    matchesStatus(problem, filters.status) &&
    matchesGroup(problem, filters.group) &&
    matchesDifficultyAndList(problem, filters) &&
    matchesTagAndQuery(problem, filters.tag, query)
  );
}

function matchesStatus(problem: ProblemRecord, status: StatusFilter): boolean {
  if (status === 'ACTIVE') return !isProblemPaused(problem);
  if (status === 'PAUSED') return isProblemPaused(problem);
  return true;
}

function matchesGroup(problem: ProblemRecord, group: GroupFilter): boolean {
  if (group === 'ALL') return true;
  if (group === 'DEFAULT') return !problem.groupId;
  return problem.groupId === group;
}

function matchesDifficultyAndList(problem: ProblemRecord, filters: ProblemFilters): boolean {
  if (filters.difficulty !== 'ALL' && problem.difficulty !== filters.difficulty) return false;
  if (filters.list !== 'ALL' && !isSlugInBuiltinList(problem.slug, filters.list)) return false;
  return true;
}

function matchesTagAndQuery(problem: ProblemRecord, tag: string, query: string): boolean {
  if (tag !== 'ALL' && !problem.tags.includes(tag)) return false;
  if (!query) return true;
  return [problem.frontendId, problem.title, problem.slug, ...problem.tags].some((value) =>
    value.toLocaleLowerCase('zh-CN').includes(query),
  );
}

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
