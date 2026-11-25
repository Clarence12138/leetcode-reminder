import { useMemo, useState } from 'react';
import type { BuiltinProblemListId } from '../../../src/domain/problem-lists';
import type { AutoGroupRule, DailySummary, ReviewGroup, Settings } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, InlineNotice } from '../../../src/ui/components';
import { BuiltinListsSection, countProblemsByList } from './BuiltinListsSection';
import { Panel } from './ViewParts';

const RETENTION_PRESETS = [0.8, 0.85, 0.9] as const;

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
    <Panel title="目标保持率与题目分组">
      <div className="settings-form">
        <DefaultRetentionRow busy={controller.busy} defaultCount={countsByGroup.get(null) ?? 0} onChange={(value) => void controller.updateDefaultRetention(value)} value={settings.defaultRequestRetention} />
        <GroupManagerSection
          busy={controller.busy}
          countsByGroup={countsByGroup}
          groupName={controller.groupName}
          groupRetention={controller.groupRetention}
          groups={settings.reviewGroups}
          onAdd={() => void controller.addGroup(controller.groupName, controller.groupRetention)}
          onDelete={(group) => void controller.deleteGroup(group)}
          onNameChange={controller.setGroupName}
          onQuickAdd={() => void controller.addGroup('高频核心', 0.9)}
          onRetentionChange={controller.setGroupRetention}
          onUpdateRetention={(id, value) => void controller.updateGroupRetention(id, value)}
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
      </div>
    </Panel>
  );
}

function useReviewGroupsController(settings: Settings, refresh: () => Promise<void>) {
  const [groupName, setGroupName] = useState('');
  const [groupRetention, setGroupRetention] = useState(0.9);
  const [selectedLists, setSelectedLists] = useState<readonly BuiltinProblemListId[]>(['hot-100']);
  const [applyTargetGroup, setApplyTargetGroup] = useState<string>(() => settings.reviewGroups[0]?.id ?? '');
  const { busy, notice, runUpdate } = useNoticeRunner(refresh);

  const updateDefaultRetention = (retention: number) => runUpdate(() => saveDefaultRetention(retention));
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
    updateDefaultRetention, updateGroupRetention,
  };
}

async function saveDefaultRetention(retention: number): Promise<string> {
  await sendExtensionRequest({ type: 'settings.update', payload: { defaultRequestRetention: retention } });
  return `默认目标保持率已更新为 ${formatPercent(retention)}，已重算相关题目排期。`;
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
): Promise<string> {
  const reviewGroups = groups.map((group) =>
    group.id === groupId ? { ...group, requestRetention: retention } : group,
  );
  await sendExtensionRequest({ type: 'settings.update', payload: { reviewGroups } });
  return `分组保持率已调整为 ${formatPercent(retention)}，已重算该组排期。`;
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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const runUpdate = async (task: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await task();
      await refresh();
      setNotice({ tone: 'success', text });
    } catch (cause) {
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : '操作失败' });
    } finally {
      setBusy(false);
    }
  };
  return { busy, notice, runUpdate };
}

function DefaultRetentionRow({ busy, defaultCount, onChange, value }: {
  readonly busy: boolean;
  readonly defaultCount: number;
  readonly onChange: (retention: number) => void;
  readonly value: number;
}): React.ReactElement {
  return (
    <div className="setting-row">
      <div>
        <strong>默认目标保持率（当前默认组 {defaultCount} 题）</strong>
        <p>保持率越低，FSRS 复习间隔越长、负担越轻；可将低频题留在默认组 80%，高频题单独设为 90%。</p>
      </div>
      <div className="preset-group">
        {RETENTION_PRESETS.map((preset) => (
          <button className={`preset-pill${Math.abs(value - preset) < 0.001 ? ' is-active' : ''}`} disabled={busy} key={preset} onClick={() => onChange(preset)} type="button">
            {formatPercent(preset)}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupManagerSection(props: {
  readonly busy: boolean;
  readonly countsByGroup: ReadonlyMap<string | null, number>;
  readonly groupName: string;
  readonly groupRetention: number;
  readonly groups: readonly ReviewGroup[];
  readonly onAdd: () => void;
  readonly onDelete: (group: ReviewGroup) => void;
  readonly onNameChange: (value: string) => void;
  readonly onQuickAdd: () => void;
  readonly onRetentionChange: (value: number) => void;
  readonly onUpdateRetention: (groupId: string, value: number) => void;
}): React.ReactElement {
  return (
    <div className="groups-section">
      <div className="groups-section__header">
        <div>
          <strong>自定义复习分组</strong>
          <p>为高频面试题和低频巩固题分别设置 FSRS 目标保持率（70%–95%）。</p>
        </div>
        {props.groups.length === 0 && (
          <Button disabled={props.busy} icon="plus" onClick={props.onQuickAdd}>快捷创建「高频核心 90%」</Button>
        )}
      </div>
      {props.groups.length > 0 && (
        <div className="group-list">
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
        </div>
      )}
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

function GroupRow({ busy, count, group, onDelete, onUpdateRetention }: {
  readonly busy: boolean;
  readonly count: number;
  readonly group: ReviewGroup;
  readonly onDelete: () => void;
  readonly onUpdateRetention: (value: number) => void;
}): React.ReactElement {
  return (
    <div className="group-item">
      <div><strong>{group.name}</strong><span>{count} 道题</span></div>
      <div className="group-item__controls">
        <select aria-label={`${group.name}保持率`} disabled={busy} onChange={(event) => onUpdateRetention(Number(event.target.value))} value={group.requestRetention}>
          {retentionOptions(group.requestRetention).map((rate) => <option key={rate} value={rate}>{formatPercent(rate)}</option>)}
        </select>
        <Button disabled={busy} icon="trash" onClick={onDelete} tone="ghost">删除</Button>
      </div>
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
      <input aria-label="新分组名称" disabled={busy} maxLength={32} onChange={(event) => onNameChange(event.target.value)} placeholder="如：大厂高频、冲刺核心" type="text" value={groupName} />
      <select aria-label="新分组目标保持率" disabled={busy} onChange={(event) => onRetentionChange(Number(event.target.value))} value={groupRetention}>
        {[0.75, 0.8, 0.85, 0.9, 0.92, 0.95].map((rate) => <option key={rate} value={rate}>保持率 {formatPercent(rate)}</option>)}
      </select>
      <Button disabled={busy || !groupName.trim()} icon="plus" onClick={onAdd} tone="primary">新建分组</Button>
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

function retentionOptions(current: number): readonly number[] {
  const base = [0.75, 0.8, 0.85, 0.9, 0.92, 0.95];
  return base.includes(current) ? base : [...base, current].sort((left, right) => left - right);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
