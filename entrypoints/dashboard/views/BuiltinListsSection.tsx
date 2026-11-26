import {
  BUILTIN_PROBLEM_LISTS,
  isSlugInBuiltinList,
  type BuiltinProblemList,
  type BuiltinProblemListId,
} from '../../../src/domain/problem-lists';
import type { AutoGroupRule, DailySummary, ReviewGroup } from '../../../src/domain/types';
import { Button, Checkbox, Select, type SelectOption } from '../../../src/ui/components';
import { formatPercent } from './settings/RetentionStepper';

export function countProblemsByList(problems: DailySummary['problems']): Map<BuiltinProblemListId, number> {
  const counts = new Map<BuiltinProblemListId, number>();
  for (const list of BUILTIN_PROBLEM_LISTS) {
    counts.set(list.id, problems.filter((problem) => isSlugInBuiltinList(problem.slug, list.id)).length);
  }
  return counts;
}

export function BuiltinListsSection(props: {
  readonly applyTargetGroup: string;
  readonly autoGroupRules: readonly AutoGroupRule[];
  readonly busy: boolean;
  readonly countsByList: ReadonlyMap<BuiltinProblemListId, number>;
  readonly groups: readonly ReviewGroup[];
  readonly onApply: () => void;
  readonly onAutoRuleChange: (listId: BuiltinProblemListId, groupId: string) => void;
  readonly onTargetGroupChange: (groupId: string) => void;
  readonly onToggleList: (listId: BuiltinProblemListId) => void;
  readonly selectedLists: readonly BuiltinProblemListId[];
}): React.ReactElement {
  return (
    <div className="groups-block">
      <div className="block-head">
        <div>
          <b>高频题单一键选择 &amp; 新题自动归组</b>
          <small>纯本地静态题单匹配，不发起额外网络请求。可一键批量归组本地已做题，也可开启新题命中自动归组。</small>
        </div>
      </div>
      <div className="builtin-list-grid">
        {BUILTIN_PROBLEM_LISTS.map((list) => (
          <BuiltinListCard
            autoGroupId={props.autoGroupRules.find((rule) => rule.listId === list.id)?.groupId ?? ''}
            busy={props.busy}
            checked={props.selectedLists.includes(list.id)}
            groups={props.groups}
            key={list.id}
            list={list}
            matchedCount={props.countsByList.get(list.id) ?? 0}
            onAutoRuleChange={(groupId) => props.onAutoRuleChange(list.id, groupId)}
            onToggle={() => props.onToggleList(list.id)}
          />
        ))}
      </div>
      <div className="builtin-list-apply">
        <Select
          ariaLabel="一键归组目标分组"
          disabled={props.busy}
          onChange={props.onTargetGroupChange}
          options={groupSelectOptions('默认分组', props.groups)}
          value={props.applyTargetGroup}
        />
        <Button disabled={props.busy || props.selectedLists.length === 0} icon="layers" onClick={props.onApply} tone="primary">
          一键归组所选题单命中题目
        </Button>
      </div>
    </div>
  );
}

function groupSelectOptions(emptyLabel: string, groups: readonly ReviewGroup[]): readonly SelectOption[] {
  return [
    { value: '', label: emptyLabel },
    ...groups.map((group) => ({ value: group.id, label: group.name, hint: formatPercent(group.requestRetention) })),
  ];
}

function BuiltinListCard({
  autoGroupId,
  busy,
  checked,
  groups,
  list,
  matchedCount,
  onAutoRuleChange,
  onToggle,
}: {
  readonly autoGroupId: string;
  readonly busy: boolean;
  readonly checked: boolean;
  readonly groups: readonly ReviewGroup[];
  readonly list: BuiltinProblemList;
  readonly matchedCount: number;
  readonly onAutoRuleChange: (groupId: string) => void;
  readonly onToggle: () => void;
}): React.ReactElement {
  return (
    <div className={`builtin-list-card${checked ? ' is-selected' : ''}`}>
      <Checkbox ariaLabel={list.name} checked={checked} disabled={busy} onChange={onToggle}>
        <span className="builtin-list-card__text">
          <b>{list.name}</b>
          <small>{list.description} · 本地已命中 {matchedCount} 题</small>
        </span>
      </Checkbox>
      <div className="builtin-list-card__auto">
        <span>新题命中自动归入</span>
        <Select
          align="right"
          ariaLabel={`${list.name}自动归组`}
          disabled={busy || groups.length === 0}
          onChange={onAutoRuleChange}
          options={groupSelectOptions('不自动归组', groups)}
          size="sm"
          value={autoGroupId}
        />
      </div>
    </div>
  );
}
