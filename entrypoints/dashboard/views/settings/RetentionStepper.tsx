import { useEffect, useRef, useState } from 'react';
import { Stepper } from '../../../../src/ui/components';

const COMMIT_DELAY_MS = 350;

export const RETENTION_MIN = 0.7;
export const RETENTION_MAX = 0.95;

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 保持率步进器：连点只在停手后保存一次；失败时回到已保存的值。 */
export function RetentionStepper({ disabled, label, onCommit, value }: {
  readonly disabled?: boolean;
  readonly label: string;
  readonly onCommit: (value: number) => Promise<boolean>;
  readonly value: number;
}): React.ReactElement {
  const [draft, setDraft] = useState<{ readonly base: number; readonly value: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  useEffect(() => { commitRef.current = onCommit; });
  /** 还没保存的值；卸载时如果还在等防抖，立即保存而不是丢掉。 */
  const pendingRef = useRef<{ readonly next: number; readonly base: number } | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending && Math.abs(pending.next - pending.base) >= 0.0001) void commitRef.current(pending.next);
  }, []);

  const shown = draft && draft.base === value ? draft.value : value;
  const change = (next: number): void => {
    setDraft({ base: value, value: next });
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = { next, base: value };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = null;
      if (Math.abs(next - value) < 0.0001) { setDraft(null); return; }
      void commitRef.current(next).then((ok) => { if (!ok) setDraft(null); });
    }, COMMIT_DELAY_MS);
  };
  return <Stepper disabled={disabled ?? false} format={formatPercent} label={label} max={RETENTION_MAX} min={RETENTION_MIN} onChange={change} step={0.01} value={shown} />;
}
