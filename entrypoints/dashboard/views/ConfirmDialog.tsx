import { useEffect, useRef, useState } from 'react';
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
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div aria-labelledby="confirm-title" aria-modal="true" className="dialog-backdrop" role="dialog">
      <div className="confirm-dialog">
        <h2 id="confirm-title">{title}</h2>
        <p>{description}</p>
        <label>输入“{confirmText}”以继续<input onChange={(event) => setValue(event.target.value)} ref={inputRef} value={value} /></label>
        <div><Button disabled={busy} onClick={onCancel}>取消</Button><Button disabled={busy || value !== confirmText} onClick={onConfirm} tone="danger">{busy ? '处理中…' : `确认${confirmText}`}</Button></div>
      </div>
    </div>
  );
}
