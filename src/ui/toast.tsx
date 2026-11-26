import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { cx } from './cx';

export interface ToastAction {
  readonly label: string;
  readonly onAction: () => void | Promise<void>;
}

export interface ToastOptions {
  readonly message: ReactNode;
  readonly tone?: 'success' | 'info' | 'error';
  /** 如“撤销”。有操作时底部显示倒计时进度条。 */
  readonly action?: ToastAction;
  /** 显示时长，默认 5 秒（无操作时 3 秒）。 */
  readonly durationMs?: number;
}

export interface ToastApi {
  /** 是否挂在 ToastProvider 内；不在时 show 什么也不做。 */
  readonly available: boolean;
  /** 显示一条提示（会替换当前那条），返回提示 id。 */
  show(options: ToastOptions): number;
  /** 关闭指定提示；不传 id 关闭当前提示。 */
  dismiss(id?: number): void;
}

export const TOAST_DEFAULT_MS = 5_000;
const TOAST_PLAIN_MS = 3_000;

const noopToast: ToastApi = { available: false, show: () => 0, dismiss: () => undefined };
const ToastContext = createContext<ToastApi>(noopToast);

interface ActiveToast extends ToastOptions {
  readonly id: number;
  readonly duration: number;
}

/** 在应用根部挂一次。提示条固定在视口底部居中，同一时间只显示一条。 */
export function ToastProvider({ children }: PropsWithChildren): React.ReactElement {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const dismiss = useCallback((id?: number): void => {
    setToast((current) => {
      if (!current || (id !== undefined && current.id !== id)) return current;
      clearTimer();
      return null;
    });
  }, []);

  const show = useCallback((options: ToastOptions): number => {
    counter.current += 1;
    const id = counter.current;
    const duration = options.durationMs ?? (options.action ? TOAST_DEFAULT_MS : TOAST_PLAIN_MS);
    clearTimer();
    setToast({ ...options, id, duration });
    timer.current = setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  useEffect(() => clearTimer, []);

  const api = useMemo<ToastApi>(() => ({ available: true, show, dismiss }), [dismiss, show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="toast-region">
        {toast && <ToastView key={toast.id} onDismiss={dismiss} show={show} toast={toast} />}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ onDismiss, show, toast }: {
  readonly onDismiss: (id: number) => void;
  readonly show: (options: ToastOptions) => number;
  readonly toast: ActiveToast;
}): React.ReactElement {
  const tone = toast.tone ?? 'success';
  const style = { '--toast-duration': `${toast.duration}ms` } as CSSProperties;
  const runAction = async (action: ToastAction): Promise<void> => {
    onDismiss(toast.id);
    try {
      await action.onAction();
    } catch (cause) {
      show({ tone: 'error', message: `${action.label}失败：${cause instanceof Error ? cause.message : String(cause)}` });
    }
  };
  return (
    <div className={cx('toast', tone, !toast.action && 'no-action')} role={tone === 'error' ? 'alert' : 'status'} style={style}>
      <span aria-hidden="true" className="ok">{tone === 'error' ? '!' : tone === 'info' ? 'i' : '✓'}</span>
      <span className="toast-msg">{toast.message}</span>
      {toast.action && (
        <button onClick={() => void runAction(toast.action!)} type="button">{toast.action.label}</button>
      )}
      {toast.action && <i aria-hidden="true" className="bar" />}
    </div>
  );
}

/** 取得提示条接口；不在 ToastProvider 内时返回 available=false 的空实现。 */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}
