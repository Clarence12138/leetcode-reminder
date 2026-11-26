import { useMemo, useState } from 'react';
import type { BuiltinProblemListId } from '../../../src/domain/problem-lists';
import type { AutoGroupRule, DailySummary, ReviewGroup, Settings } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, InlineNotice, Pill, Stepper } from '../../../src/ui/components';
import { BuiltinListsSection, countProblemsByList } from './BuiltinListsSection';
import { RetentionStepper, formatPercent, RETENTION_MAX, RETENTION_MIN } from './settings/RetentionStepper';
import { Section } from './settings/parts';
import { useMarkSaved } from './settings/saved';

interface Notice {
  readonly tone: 'error' | 'success';
  readonly text: string;
}

export function ReviewGroupsPanel({ refresh, settings, summary }: {
  readonly refresh: () => Promise<void>;
  readonly settings: Settings;
  readonly summary: DailySummary;
}): React.ReactElement {
  const controller = useReviewGroupsController(settings, refresh);
  const countsByGroup = useMemo(() => countProblemsByGroup(summary.problems), [summary.problems]);
  const countsByList = useMemo(() => countProblemsByList(summary.problems), [summary.problems]);
  return (
    <Section description="不同分组可以设不同的目标保持率，比如面试前把高频题调高；也可用内置高频题单一键归组。" id="settings-groups" title="分组与题单">
      <GroupManagerSection
        busy={controller.busy}
        countsByGroup={countsByGroup}
        defaultRetention={settings.defaultRequestRetention}
        groupName={controller.groupName}
        groupRetention={controller.groupRetention}
        groups={settings.reviewGroups}
        onAdd={() => void controller.addGroup(controller.groupName, controller.groupRetention)}
        onDelete={(group) => void controller.deleteGroup(group)}
        onNameChange={controller.setGroupName}
        onQuickAdd={() => void controller.addGroup('高频核心', 0.9)}
        onRetentionChange={controller.setGroupRetention}
        onUpdateRetention={(id, value) => controller.updateGroupRetention(id, value)}
      />
      <BuiltinListsSection
        applyTargetGroup={controller.applyTargetGroup}
        autoGroupRules={settings.autoGroupRules}
        busy={controller.busy}
        countsByList={countsByList}
        groups={settings.reviewGroups}
        onApply={() => void controller.applyLists()}
        onAutoRuleChange={(listId, groupId) => void controller.setAutoRule(listId, groupId)}
        onTargetGroupChange={controller.setApplyTargetGroup}
        onToggleList={controller.toggleList}
        selectedLists={controller.selectedLists}
      />
      {controller.notice && <InlineNotice tone={controller.notice.tone}>{controller.notice.text}</InlineNotice>}
    </Section>
  );
}

function useReviewGroupsController(settings: Settings, refresh: () => Promise<void>) {
  const [groupName, setGroupName] = useState('');
  const [groupRetention, setGroupRetention] = useState(0.9);
  const [selectedLists, setSelectedLists] = useState<readonly BuiltinProblemListId[]>(['hot-100']);
  const [applyTargetGroup, setApplyTargetGroup] = useState<string>(() => settings.reviewGroups[0]?.id ?? '');
  const { busy, notice, runUpdate } = useNoticeRunner(refresh);

  const addGroup = (name: string, retention: number) => runUpdate(async () => {
    const { id, text } = await createReviewGroup(name, retention, settings.reviewGroups);
    setGroupName('');
    setApplyTargetGroup(id);
    return text;
  });
  const updateGroupRetention = (groupId: string, retention: number) =>
    runUpdate(() => saveGroupRetention(settings.reviewGroups, groupId, retention));
  const deleteGroup = (group: ReviewGroup) => runUpdate(async () => {
    const remaining = await removeReviewGroup(settings.reviewGroups, group);
    if (applyTargetGroup === group.id) setApplyTargetGroup(remaining[0]?.id ?? '');
    return `已删除分组「${group.name}」，原组内题目已回归默认分组。`;
  });
  const setAutoRule = (listId: BuiltinProblemListId, groupId: string) =>
    runUpdate(() => saveAutoGroupRule(settings.autoGroupRules, listId, groupId));
  const applyLists = () => runUpdate(() => applyListsToGroup(selectedLists, applyTargetGroup));
  const toggleList = (listId: BuiltinProblemListId): void => {
    setSelectedLists((current) =>
      current.includes(listId) ? current.filter((item) => item !== listId) : [...current, listId],
    );
  };
  return {
    addGroup, applyLists, applyTargetGroup, busy, deleteGroup, groupName, groupRetention, notice,
    selectedLists, setApplyTargetGroup, setAutoRule, setGroupName, setGroupRetention, toggleList,
    updateGroupRetention,
  };
}

async function createReviewGroup(name: string, retention: number, existing: readonly ReviewGroup[]) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('请输入分组名称');
  const id = createGroupId(trimmed, existing);
  const reviewGroups = [...existing, { id, name: trimmed, requestRetention: retention }];
  await sendExtensionRequest({ type: 'settings.update', payload: { reviewGroups } });
  return { id, text: `已创建分组「${trimmed}」（${formatPercent(retention)}）。` };
}

async function saveGroupRetention(
  groups: readonly ReviewGroup[],
  groupId: string,
  retention: number,
): Promise<string | null> {
  const reviewGroups = groups.map((group) =>
    group.id === groupId ? { ...group, requestRetention: retention } : group,
  );
  await sendExtensionRequest({ type: 'settings.update', payload: { reviewGroups } });
  return null;
}

async function removeReviewGroup(groups: readonly ReviewGroup[], target: ReviewGroup) {
  const reviewGroups = groups.filter((item) => item.id !== target.id);
  await sendExtensionRequest({ type: 'settings.update', payload: { reviewGroups } });
  return reviewGroups;
}

async function saveAutoGroupRule(
  existing: readonly AutoGroupRule[],
  listId: BuiltinProblemListId,
  groupId: string,
): Promise<string> {
  const filtered = existing.filter((rule) => rule.listId !== listId);
  const autoGroupRules: AutoGroupRule[] = groupId ? [...filtered, { listId, groupId }] : filtered;
  await sendExtensionRequest({ type: 'settings.update', payload: { autoGroupRules } });
  return groupId ? '已开启该题单的新题自动归组。' : '已关闭该题单的新题自动归组。';
}

async function applyListsToGroup(
  listIds: readonly BuiltinProblemListId[],
  targetGroup: string,
): Promise<string> {
  const groupId = targetGroup === '' ? null : targetGroup;
  const result = await sendExtensionRequest({ type: 'problem.apply-list-group', payload: { listIds, groupId } });
  return `已匹配本地 ${result.matchedCount} 道题，更新了 ${result.updatedCount} 道题的分组并重算排期。`;
}

function useNoticeRunner(refresh: () => Promise<void>) {
  const markSaved = useMarkSaved();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** 返回是否成功；task 返回 null 表示只提示「已保存」、不另显示结果文案。 */
  const runUpdate = async (task: () => Promise<string | null>): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await task();
      await refresh();
      markSaved();
      if (text) setNotice({ tone: 'success', text });
      return true;
    } catch (cause) {
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : '操作失败' });
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, notice, runUpdate };
}

function GroupManagerSection(props: {
  readonly busy: boolean;
  readonly countsByGroup: ReadonlyMap<string | null, number>;
  readonly defaultRetention: number;
  readonly groupName: string;
  readonly groupRetention: number;
  readonly groups: readonly ReviewGroup[];
  readonly onAdd: () => void;
  readonly onDelete: (group: ReviewGroup) => void;
  readonly onNameChange: (value: string) => void;
  readonly onQuickAdd: () => void;
  readonly onRetentionChange: (value: number) => void;
  readonly onUpdateRetention: (groupId: string, value: number) => Promise<boolean>;
}): React.ReactElement {
  return (
    <div className="groups-block">
      <GroupsHeader busy={props.busy} empty={props.groups.length === 0} onQuickAdd={props.onQuickAdd} />
      <div className="grow">
        <div><b>默认分组</b><small>未分组的题目</small></div>
        <span className="cnt">{props.countsByGroup.get(null) ?? 0} 道题</span>
        <Pill>跟随默认 {formatPercent(props.defaultRetention)}</Pill>
        <span />
      </div>
      {props.groups.map((group) => (
        <GroupRow
          busy={props.busy}
          count={props.countsByGroup.get(group.id) ?? 0}
          group={group}
          key={group.id}
          onDelete={() => props.onDelete(group)}
          onUpdateRetention={(value) => props.onUpdateRetention(group.id, value)}
        />
      ))}
      <GroupCreateForm
        busy={props.busy}
        groupName={props.groupName}
        groupRetention={props.groupRetention}
        onAdd={props.onAdd}
        onNameChange={props.onNameChange}
        onRetentionChange={props.onRetentionChange}
      />
    </div>
  );
}

function GroupsHeader({ busy, empty, onQuickAdd }: { readonly busy: boolean; readonly empty: boolean; readonly onQuickAdd: () => void }): React.ReactElement {
  return (
    <div className="block-head">
      <div>
        <b>自定义复习分组</b>
        <small>为高频面试题和低频巩固题分别设置 FSRS 目标保持率（{formatPercent(RETENTION_MIN)}–{formatPercent(RETENTION_MAX)}）。</small>
      </div>
      {empty && <Button disabled={busy} icon="plus" onClick={onQuickAdd} size="sm">快捷创建「高频核心 90%」</Button>}
    </div>
  );
}

function GroupRow({ busy, count, group, onDelete, onUpdateRetention }: {
  readonly busy: boolean;
  readonly count: number;
  readonly group: ReviewGroup;
  readonly onDelete: () => void;
  readonly onUpdateRetention: (value: number) => Promise<boolean>;
}): React.ReactElement {
  return (
    <div className="grow">
      <div><b>{group.name}</b></div>
      <span className="cnt">{count} 道题</span>
      <RetentionStepper disabled={busy} label={`${group.name}保持率`} onCommit={onUpdateRetention} value={group.requestRetention} />
      <Button aria-label={`删除分组${group.name}`} disabled={busy} icon="trash" onClick={onDelete} size="sm" tone="ghost">删除</Button>
    </div>
  );
}

function GroupCreateForm({ busy, groupName, groupRetention, onAdd, onNameChange, onRetentionChange }: {
  readonly busy: boolean;
  readonly groupName: string;
  readonly groupRetention: number;
  readonly onAdd: () => void;
  readonly onNameChange: (value: string) => void;
  readonly onRetentionChange: (value: number) => void;
}): React.ReactElement {
  return (
    <div className="group-create">
      <label className="field">
        <input aria-label="新分组名称" disabled={busy} maxLength={32} onChange={(event) => onNameChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && groupName.trim()) onAdd(); }} placeholder="如：大厂高频、冲刺核心" type="text" value={groupName} />
      </label>
      <Stepper disabled={busy} format={formatPercent} label="新分组目标保持率" max={RETENTION_MAX} min={RETENTION_MIN} onChange={onRetentionChange} step={0.01} value={groupRetention} />
      <Button disabled={busy || !groupName.trim()} icon="plus" onClick={onAdd} size="sm" tone="primary">新建分组</Button>
    </div>
  );
}

function countProblemsByGroup(problems: DailySummary['problems']): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const problem of problems) {
    const key = problem.groupId ?? null;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function createGroupId(name: string, existing: readonly ReviewGroup[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') || 'group';
  const taken = new Set(existing.map((group) => group.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
