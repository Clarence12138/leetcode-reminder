import { useState } from 'react';
import { isProblemPaused } from '../../../src/domain/queue-policy';
import type { ProblemRecord, ReviewGroup } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, InlineNotice } from '../../../src/ui/components';

interface ProblemBatchToolbarProps {
  readonly groups: readonly ReviewGroup[];
  readonly onDone: () => void;
  readonly refresh: () => Promise<void>;
  readonly selectedProblems: readonly ProblemRecord[];
}

export function ProblemBatchToolbar(props: ProblemBatchToolbarProps): React.ReactElement | null {
  const [targetGroup, setTargetGroup] = useState('');
  const { busy, notice, runAction } = useBatchActionRunner(props.refresh, props.onDone);
  if (props.selectedProblems.length === 0) return null;

  const ids = props.selectedProblems.map((problem) => problem.problemId);
  const hasActive = props.selectedProblems.some((problem) => !isProblemPaused(problem));
  const hasPaused = props.selectedProblems.some((problem) => isProblemPaused(problem));
  return (
    <div className="batch-toolbar" role="region" aria-label="批量管理所选题目">
      <div className="batch-toolbar__row">
        <span className="batch-toolbar__count">已选 <strong>{props.selectedProblems.length}</strong> 道题</span>
        <div className="batch-toolbar__actions">
          {hasActive && <Button disabled={busy} icon="pause" onClick={() => void runAction(() => pauseProblems(ids, true))}>批量暂停复习</Button>}
          {hasPaused && <Button disabled={busy} icon="play" onClick={() => void runAction(() => pauseProblems(ids, false))}>批量恢复复习</Button>}
          <BatchGroupPicker
            busy={busy}
            groups={props.groups}
            onApply={() => void runAction(() => assignGroup(ids, targetGroup))}
            onChange={setTargetGroup}
            value={targetGroup}
          />
        </div>
      </div>
      {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
    </div>
  );
}

function BatchGroupPicker({
  busy,
  groups,
  onApply,
  onChange,
  value,
}: {
  readonly busy: boolean;
  readonly groups: readonly ReviewGroup[];
  readonly onApply: () => void;
  readonly onChange: (groupId: string) => void;
  readonly value: string;
}): React.ReactElement {
  return (
    <div className="batch-toolbar__group">
      <select aria-label="选择目标分组" disabled={busy} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="">默认分组</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}（{Math.round(group.requestRetention * 100)}%）
          </option>
        ))}
      </select>
      <Button disabled={busy} icon="layers" onClick={onApply}>设为该分组</Button>
    </div>
  );
}

function useBatchActionRunner(refresh: () => Promise<void>, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ readonly tone: 'error' | 'success'; readonly text: string } | null>(null);
  const runAction = async (task: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const text = await task();
      await refresh();
      onDone();
      setNotice({ tone: 'success', text });
    } catch (cause) {
      setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : '批量操作失败' });
    } finally {
      setBusy(false);
    }
  };
  return { busy, notice, runAction };
}

async function pauseProblems(problemIds: readonly string[], paused: boolean): Promise<string> {
  const result = await sendExtensionRequest({ type: 'problem.set-paused', payload: { problemIds, paused } });
  return paused ? `已暂停 ${result.updatedCount} 道题的复习。` : `已恢复 ${result.updatedCount} 道题的复习。`;
}

async function assignGroup(problemIds: readonly string[], targetGroup: string): Promise<string> {
  const groupId = targetGroup === '' ? null : targetGroup;
  const result = await sendExtensionRequest({ type: 'problem.set-group', payload: { problemIds, groupId } });
  return `已更新 ${result.updatedCount} 道题的分组并重算复习排期。`;
}
