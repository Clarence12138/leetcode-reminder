import {
  BUILTIN_PROBLEM_LISTS,
  isSlugInBuiltinList,
  type BuiltinProblemList,
  type BuiltinProblemListId,
} from '../../../src/domain/problem-lists';
import type { AutoGroupRule, DailySummary, ReviewGroup } from '../../../src/domain/types';
import { Button } from '../../../src/ui/components';

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
    <div className="groups-section">
      <div className="groups-section__header">
        <div>
          <strong>高频题单一键选择 & 新题自动归组</strong>
          <p>纯本地静态题单匹配，不发起额外网络请求。可一键批量归组本地已做题，也可开启新题命中自动归组。</p>
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
        <select aria-label="一键归组目标分组" disabled={props.busy} onChange={(event) => props.onTargetGroupChange(event.target.value)} value={props.applyTargetGroup}>
          <option value="">默认分组</option>
          {props.groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}（{formatPercent(group.requestRetention)}）</option>
          ))}
        </select>
        <Button disabled={props.busy || props.selectedLists.length === 0} icon="layers" onClick={props.onApply} tone="primary">
          一键归组所选题单命中题目
        </Button>
      </div>
    </div>
  );
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
      <label className="builtin-list-card__check">
        <input checked={checked} disabled={busy} onChange={onToggle} type="checkbox" />
        <div>
          <strong>{list.name}</strong>
          <span>{list.description} · 本地已命中 {matchedCount} 题</span>
        </div>
      </label>
      <label className="builtin-list-card__auto">
        <span>新题命中自动归入</span>
        <select aria-label={`${list.name}自动归组`} disabled={busy || groups.length === 0} onChange={(event) => onAutoRuleChange(event.target.value)} value={autoGroupId}>
          <option value="">不自动归组</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}（{formatPercent(group.requestRetention)}）</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
