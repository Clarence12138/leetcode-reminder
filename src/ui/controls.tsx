import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { cx } from './cx';

// ---------------------------------------------------------------------------
// 分段控件：单选，选中项下面的底块会滑过去

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  readonly disabled?: boolean;
  /** label 不是纯文字时用作无障碍名称。 */
  readonly ariaLabel?: string;
}

export interface SegmentedProps<T extends string> {
  readonly ariaLabel: string;
  readonly onChange: (value: T) => void;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  /** 撑满宽度，各项平分。 */
  readonly block?: boolean | undefined;
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly size?: 'sm' | 'md' | undefined;
}

export function Segmented<T extends string>({ ariaLabel, block, className, disabled, onChange, options, size, value }: SegmentedProps<T>): React.ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  useSlidingIndicator(rootRef, indicatorRef);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    const next = nextSegmentValue({ key: event.key, options, value });
    if (next === null) return;
    event.preventDefault();
    onChange(next);
    const buttons = rootRef.current?.querySelectorAll<HTMLButtonElement>('button[data-value]') ?? [];
    [...buttons].find((button) => button.dataset.value === next)?.focus();
  };

  return (
    <div aria-label={ariaLabel} className={cx('segc', size === 'sm' && 'sm', block && 'block', className)} onKeyDown={onKeyDown} ref={rootRef} role="radiogroup">
      <span aria-hidden="true" className="ind" ref={indicatorRef} />
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            aria-checked={checked}
            aria-label={option.ariaLabel}
            className={checked ? 'on' : undefined}
            data-value={option.value}
            disabled={disabled || option.disabled}
            key={option.value}
            onClick={() => { if (!checked) onChange(option.value); }}
            role="radio"
            tabIndex={checked ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** 方向键在可用选项间循环切换；不是方向键时返回 null。 */
function nextSegmentValue<T extends string>({ key, options, value }: {
  readonly key: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
}): T | null {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[key] ?? 0;
  const enabled = options.filter((option) => !option.disabled);
  if (step === 0 || enabled.length === 0) return null;
  const index = enabled.findIndex((option) => option.value === value);
  return enabled[(index + step + enabled.length) % enabled.length]!.value;
}

/** 每次渲染后把底块对齐到选中项（首次不做过渡）；容器尺寸变化时重新对齐。 */
function useSlidingIndicator(rootRef: RefObject<HTMLDivElement | null>, indicatorRef: RefObject<HTMLSpanElement | null>): void {
  const placedRef = useRef(false);
  useLayoutEffect(() => {
    placeIndicator(rootRef.current, indicatorRef.current, !placedRef.current);
    placedRef.current = true;
  });
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const place = (): void => placeIndicator(root, indicatorRef.current, true);
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', place);
      return () => window.removeEventListener('resize', place);
    }
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [indicatorRef, rootRef]);
}

function placeIndicator(root: HTMLElement | null, indicator: HTMLElement | null, instant: boolean): void {
  if (!root || !indicator) return;
  const active = root.querySelector<HTMLElement>('button[aria-checked="true"]');
  if (!active) {
    indicator.style.width = '0px';
    return;
  }
  if (instant) indicator.style.transition = 'none';
  indicator.style.left = `${active.offsetLeft}px`;
  indicator.style.width = `${active.offsetWidth}px`;
  if (instant) {
    void indicator.offsetWidth; // 强制回流，让下一次变化恢复过渡
    indicator.style.transition = '';
  }
}

// ---------------------------------------------------------------------------
// 开关

export function Switch({
  checked,
  className,
  disabled = false,
  id,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  /** 无障碍名称（开关本身没有可见文字）。 */
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cx('sw', className)}
      disabled={disabled}
      id={id}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    />
  );
}

// ---------------------------------------------------------------------------
// 复选框：原生 input 负责无障碍与键盘，外观由 <i> 画

export interface CheckboxProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** 没有可见文字时的无障碍名称。 */
  readonly ariaLabel?: string | undefined;
  readonly children?: ReactNode;
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** 部分选中（全选框）。 */
  readonly indeterminate?: boolean | undefined;
  readonly size?: 'sm' | 'md' | undefined;
}

export function Checkbox({ ariaLabel, checked, children, className, disabled, indeterminate, onChange, size }: CheckboxProps): React.ReactElement {
  const mixed = Boolean(indeterminate) && !checked;
  return (
    <label className={cx('cb', checked && 'on', mixed && 'mixed', disabled && 'disabled', size === 'sm' && 'sm', className)}>
      <input
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        ref={(element) => { if (element) element.indeterminate = mixed; }}
        type="checkbox"
      />
      <i aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d={mixed ? 'M6 12h12' : 'M5 12.5 10 17.5 19 7'} /></svg>
      </i>
      {children !== undefined && <span>{children}</span>}
    </label>
  );
}

// ---------------------------------------------------------------------------
// 步进器：− 数值 +

export function Stepper({
  disabled = false,
  format = (value) => String(value),
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  readonly disabled?: boolean;
  readonly format?: (value: number) => string;
  /** 无障碍名称前缀，如 “默认保持率”。 */
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly value: number;
}): React.ReactElement {
  const decimals = (String(step).split('.')[1] ?? '').length;
  const clamp = (next: number): number =>
    Math.min(max, Math.max(min, Number((Math.round(next / step) * step).toFixed(decimals))));
  return (
    <div aria-label={label} className="stepper" role="group">
      <button aria-label={`减少${label}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} type="button">−</button>
      <output aria-live="polite">{format(value)}</output>
      <button aria-label={`增加${label}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))} type="button">+</button>
    </div>
  );
}
