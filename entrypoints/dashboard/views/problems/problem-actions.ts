import { useState } from 'react';
import type { ProblemRecord } from '../../../../src/domain/types';
import { sendExtensionRequest } from '../../../../src/shared/messaging';
import { useToast, type ToastOptions } from '../../../../src/ui/components';

/** 操作结果：在提示条里显示；没挂 ToastProvider 时退回页面内的行内提示。 */
export type ProblemNotice = Pick<ToastOptions, 'action'> & {
  readonly tone: 'success' | 'error';
  readonly message: string;
};

export interface ProblemAction {
  /** 区分哪个按钮在转圈，如 `batch:delete`、`row:pause:<id>`。 */
  readonly key: string;
  /** 失败提示的前缀，如「删除」→「删除失败：…」。 */
  readonly label: string;
  readonly task: () => Promise<ProblemNotice>;
}

export interface ActionRunner {
  /** 正在执行的操作 key；没有时为 null。 */
  readonly pending: string | null;
  readonly busy: boolean;
  /** 执行操作并刷新数据，成功返回 true。 */
  readonly run: (action: ProblemAction) => Promise<boolean>;
  /** 没有提示条时显示在页面里的结果。 */
  readonly inlineNotice: ProblemNotice | null;
  readonly dismissInline: () => void;
}

export function useActionRunner(refresh: () => Promise<void>): ActionRunner {
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [inlineNotice, setInlineNotice] = useState<ProblemNotice | null>(null);
  const notify = (notice: ProblemNotice): void => {
    if (toast.available) toast.show(notice);
    else setInlineNotice(notice);
  };
  const run = async ({ key, label, task }: ProblemAction): Promise<boolean> => {
    setPending(key);
    setInlineNotice(null);
    try {
      const notice = await task();
      await refresh();
      notify(notice);
      return true;
    } catch (cause) {
      notify({ tone: 'error', message: `${label}失败：${cause instanceof Error ? cause.message : String(cause)}` });
      return false;
    } finally {
      setPending(null);
    }
  };
  return { pending, busy: pending !== null, run, inlineNotice, dismissInline: () => setInlineNotice(null) };
}

export interface ProblemSelection {
  readonly selectedIds: ReadonlySet<string>;
  /** 当前可见且被勾选的题目；批量操作只作用于它们。 */
  readonly selected: readonly ProblemRecord[];
  readonly allSelected: boolean;
  readonly partlySelected: boolean;
  readonly toggle: (problemId: string, checked: boolean) => void;
  readonly setAll: (checked: boolean) => void;
  readonly clear: () => void;
}

/** 勾选状态跨筛选保留，但只有当前可见的已选题会被操作。 */
export function useProblemSelection(visible: readonly ProblemRecord[]): ProblemSelection {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selected = visible.filter((problem) => selectedIds.has(problem.problemId));
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const update = (problemIds: readonly string[], checked: boolean): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const problemId of problemIds) {
        if (checked) next.add(problemId);
        else next.delete(problemId);
      }
      return next;
    });
  };
  return {
    selectedIds,
    selected,
    allSelected,
    partlySelected: selected.length > 0 && !allSelected,
    toggle: (problemId, checked) => update([problemId], checked),
    setAll: (checked) => update(visible.map((problem) => problem.problemId), checked),
    clear: () => setSelectedIds(new Set()),
  };
}

export async function requestSetPaused(problemIds: readonly string[], paused: boolean): Promise<void> {
  await sendExtensionRequest({ type: 'problem.set-paused', payload: { problemIds, paused } });
}

export async function requestSetGroup(problemIds: readonly string[], groupId: string | null): Promise<void> {
  await sendExtensionRequest({ type: 'problem.set-group', payload: { problemIds, groupId } });
}

export async function requestDelete(problemIds: readonly string[]): Promise<void> {
  await sendExtensionRequest({ type: 'problem.delete', payload: { problemIds } });
}

/** 暂停/恢复后的提示，带「撤销」（把这几题改回去）。 */
export function pauseNotice({ paused, problemIds, refresh, subject }: {
  readonly paused: boolean;
  readonly problemIds: readonly string[];
  readonly refresh: () => Promise<void>;
  /** 「「两数之和」」或「 3 题」。 */
  readonly subject: string;
}): ProblemNotice {
  return {
    tone: 'success',
    message: `${paused ? '已暂停' : '已恢复'}${subject}的复习`,
    action: {
      label: '撤销',
      onAction: async () => {
        await requestSetPaused(problemIds, !paused);
        await refresh();
      },
    },
  };
}
