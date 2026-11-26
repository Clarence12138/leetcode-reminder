import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../../src/ui/components';

interface ConfirmDialogProps {
  readonly busy: boolean;
  readonly confirmText: string;
  readonly description: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
}

export function ConfirmDialog({ busy, confirmText, description, onCancel, onConfirm, title }: ConfirmDialogProps): React.ReactElement {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useEffect(() => { inputRef.current?.focus(); }, []);
  const ready = value === confirmText && !busy;
  return (
    <div
      className="dialog-backdrop"
      onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onCancel(); }}
    >
      <div aria-labelledby={titleId} aria-modal="true" className="dialog confirm-dialog" role="dialog">
        <h2 id={titleId}>{title}</h2>
        <p>{description}</p>
        <label className="confirm-field">
          输入“{confirmText}”以继续
          <input className="input" onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && ready) onConfirm(); }} ref={inputRef} value={value} />
        </label>
        <div className="dialog-actions">
          <Button disabled={busy} onClick={onCancel}>取消</Button>
          <Button disabled={!ready} loading={busy} onClick={onConfirm} tone="danger">{`确认${confirmText}`}</Button>
        </div>
      </div>
    </div>
  );
}
