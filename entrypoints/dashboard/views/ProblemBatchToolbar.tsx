import { useState, type ButtonHTMLAttributes, type KeyboardEvent } from 'react';
import { isProblemPaused } from '../../../src/domain/queue-policy';
import type { ProblemRecord, ReviewGroup } from '../../../src/domain/types';
import { ChipMenu, cx, IconButton, type ChipMenuOption } from '../../../src/ui/components';
import { Icon, type IconName } from '../../../src/ui/Icon';
import { DEFAULT_GROUP } from './problem-filters';
import {
  pauseNotice,
  requestDelete,
  requestSetGroup,
  requestSetPaused,
  type ActionRunner,
  type ProblemAction,
} from './problems/problem-actions';

export interface ProblemBatchToolbarProps {
  /** 当前可见且被勾选的题目；为空时不显示。 */
  readonly selected: readonly ProblemRecord[];
  readonly groups: readonly ReviewGroup[];
  readonly defaultRetention: number | undefined;
  readonly onClear: () => void;
  readonly refresh: () => Promise<void>;
  readonly runner: ActionRunner;
}

/** 勾选题目后从底部浮出的批量操作条。 */
export function ProblemBatchToolbar(props: ProblemBatchToolbarProps): React.ReactElement | null {
  const actions = useBatchActions(props);
  const { runner, selected } = props;
  if (selected.length === 0) return null;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    if (actions.confirming) actions.cancelDelete();
    else props.onClear();
  };
  return (
    <div aria-label="批量操作" className="pbatch" onKeyDown={onKeyDown} role="region">
      <span aria-live="polite" className="pbatch-count">已选 <b className="num">{selected.length}</b> 题</span>
      <BarButton disabled={runner.busy || actions.toPause.length === 0} icon="pause" loading={runner.pending === 'batch:pause'} onClick={() => actions.setPaused(true)}>暂停</BarButton>
      <BarButton disabled={runner.busy || actions.toResume.length === 0} icon="play" loading={runner.pending === 'batch:resume'} onClick={() => actions.setPaused(false)}>恢复</BarButton>
      {props.groups.length > 0 && (
        <ChipMenu
          className="pbatch-move"
          disabled={runner.busy}
          icon="folder"
          label="移到分组"
          multiple={false}
          onChange={(next) => { if (next[0]) actions.moveTo(next[0]); }}
          options={groupOptions(props.groups, props.defaultRetention)}
          selected={[]}
        />
      )}
      <i aria-hidden="true" className="pbatch-sep" />
      <BarButton
        className={cx(actions.confirming && 'confirm')}
        danger
        disabled={runner.busy}
        icon="trash"
        loading={runner.pending === 'batch:delete'}
        onBlur={actions.cancelDelete}
        onClick={actions.remove}
      >
        {actions.confirming ? `确认删除 ${selected.length} 题` : '删除'}
      </BarButton>
      <IconButton bare className="pbatch-x" disabled={runner.busy} icon="close" label="取消选择" onClick={props.onClear} size="sm" />
    </div>
  );
}

function useBatchActions({ groups, onClear, refresh, runner, selected }: ProblemBatchToolbarProps) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const ids = selected.map((problem) => problem.problemId);
  const selectionKey = ids.join('\0');
  const confirming = ids.length > 0 && confirmKey === selectionKey;
  const toPause = selected.filter((problem) => !isProblemPaused(problem)).map((problem) => problem.problemId);
  const toResume = selected.filter((problem) => isProblemPaused(problem)).map((problem) => problem.problemId);

  const run = (action: ProblemAction): void => {
    void runner.run(action).then((ok) => {
      if (!ok) return;
      setConfirmKey(null);
      onClear();
    });
  };
  const setPaused = (paused: boolean): void => {
    const targets = paused ? toPause : toResume;
    run({
      key: paused ? 'batch:pause' : 'batch:resume',
      label: paused ? '暂停复习' : '恢复复习',
      task: async () => {
        await requestSetPaused(targets, paused);
        return pauseNotice({ paused, problemIds: targets, refresh, subject: ` ${targets.length} 题` });
      },
    });
  };
  const moveTo = (groupId: string): void => {
    const name = groups.find((group) => group.id === groupId)?.name ?? '默认分组';
    run({
      key: 'batch:group',
      label: '移动分组',
      task: async () => {
        await requestSetGroup(ids, groupId === DEFAULT_GROUP ? null : groupId);
        return { tone: 'success', message: `已把 ${ids.length} 题移到「${name}」，复习排期已重算` };
      },
    });
  };
  const remove = (): void => {
    if (!confirming) { setConfirmKey(selectionKey); return; }
    run({
      key: 'batch:delete',
      label: '删除',
      task: async () => {
        await requestDelete(ids);
        return { tone: 'success', message: `已删除 ${ids.length} 题` };
      },
    });
  };
  return { cancelDelete: () => setConfirmKey(null), confirming, moveTo, remove, setPaused, toPause, toResume };
}

function groupOptions(groups: readonly ReviewGroup[], defaultRetention: number | undefined): ChipMenuOption<string>[] {
  const option = (value: string, label: string, retention: number | undefined): ChipMenuOption<string> => (
    retention === undefined
      ? { value, label }
      : { value, label, hint: <><span className="visually-hidden">，目标记住率 </span>{Math.round(retention * 100)}%</> }
  );
  return [
    option(DEFAULT_GROUP, '默认分组', defaultRetention),
    ...groups.map((group) => option(group.id, group.name, group.requestRetention)),
  ];
}

function BarButton({ children, className, danger = false, icon, loading = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly danger?: boolean;
  readonly icon: IconName;
  readonly loading?: boolean;
}): React.ReactElement {
  return (
    <button aria-busy={loading || undefined} className={cx('bb', danger && 'danger', loading && 'loading', className)} type="button" {...props}>
      <Icon name={icon} size={15} />
      <span>{children}</span>
    </button>
  );
}
