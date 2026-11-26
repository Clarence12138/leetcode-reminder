import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../../../../src/domain/types';
import { sendExtensionRequest } from '../../../../src/shared/messaging';
import { useMarkSaved } from './saved';

export interface Notice {
  readonly text: string;
  readonly tone: 'error' | 'success';
}

export function toErrorNotice(cause: unknown, fallback: string): Notice {
  return { tone: 'error', text: cause instanceof Error && cause.message ? cause.message : fallback };
}

/** 立即把一次改动写入设置：成功后刷新并提示「已保存」，失败返回 false 并给出错误，调用方负责回滚控件。 */
export function useSettingsSaver(refresh: () => Promise<void>, failureText = '设置保存失败') {
  const markSaved = useMarkSaved();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  const save = async (patch: Partial<Settings>): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await sendExtensionRequest({ type: 'settings.update', payload: patch });
      await refresh();
      markSaved();
      return true;
    } catch (cause) {
      if (aliveRef.current) setError(toErrorNotice(cause, failureText).text);
      return false;
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  };
  return { error, save, saving, setError };
}

/**
 * 乐观值：改动后立刻显示新值；保存失败时 `rollback()` 回到服务端值。
 * 服务端值变化（刷新后）会自动丢弃草稿。
 */
export function useDraft<T>(server: T): readonly [T, (value: T) => void, () => void] {
  const [draft, setDraft] = useState<{ readonly base: T; readonly value: T } | null>(null);
  const value = draft && Object.is(draft.base, server) ? draft.value : server;
  return [value, (next) => setDraft({ base: server, value: next }), () => setDraft(null)];
}
