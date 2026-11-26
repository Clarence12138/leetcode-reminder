import {
  useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type Ref, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { Icon } from './Icon';

export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  /** 列表项右侧及触发器中的补充说明（如保持率 90%）。 */
  readonly hint?: string | undefined;
  readonly disabled?: boolean | undefined;
}

export interface SelectProps<T extends string = string> {
  readonly ariaLabel: string;
  readonly onChange: (value: T) => void;
  readonly options: readonly SelectOption<T>[];
  readonly value: T;
  readonly align?: 'left' | 'right' | undefined;
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly placeholder?: string | undefined;
  readonly size?: 'sm' | 'md' | undefined;
}

interface PopPosition { readonly above: boolean; readonly style: CSSProperties }
const POP_GAP = 6;
const VIEWPORT_PAD = 8;
const MAX_POP_HEIGHT = 280;
const OPEN_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);

/** 自定义下拉选择框：统一浅/深色与 5 套主题视觉，支持键盘导航与视口防裁切定位。 */
export function Select<T extends string = string>(props: SelectProps<T>): React.ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const state = useSelectState({ ...props, popRef, triggerRef });
  const position = usePopPosition({ align: props.align ?? 'left', open: state.open, popRef, triggerRef });
  const selected = props.options.find((item) => item.value === props.value);
  const activeId = state.open && state.activeIndex >= 0 ? `${listId}-opt-${state.activeIndex}` : undefined;

  return (
    <>
      <SelectTrigger
        activeDescendant={activeId}
        ariaLabel={props.ariaLabel}
        className={props.className}
        disabled={props.disabled}
        listId={listId}
        onClick={state.toggle}
        onKeyDown={state.onKeyDown}
        open={state.open}
        placeholder={props.placeholder ?? '请选择'}
        ref={triggerRef}
        selected={selected}
        size={props.size ?? 'md'}
      />
      {state.open && createPortal(
        <SelectPopover
          activeIndex={state.activeIndex}
          ariaLabel={props.ariaLabel}
          listId={listId}
          onChoose={state.commit}
          onHover={state.setActiveIndex}
          options={props.options}
          popRef={popRef}
          position={position}
          value={props.value}
        />,
        document.body,
      )}
    </>
  );
}

function SelectTrigger<T extends string>({
  activeDescendant, ariaLabel, className, disabled, listId, onClick, onKeyDown, open, placeholder, ref, selected, size,
}: {
  readonly activeDescendant: string | undefined;
  readonly ariaLabel: string;
  readonly className: string | undefined;
  readonly disabled: boolean | undefined;
  readonly listId: string;
  readonly onClick: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  readonly open: boolean;
  readonly placeholder: string;
  readonly ref: Ref<HTMLButtonElement>;
  readonly selected: SelectOption<T> | undefined;
  readonly size: 'sm' | 'md';
}): React.ReactElement {
  return (
    <button
      aria-activedescendant={activeDescendant}
      aria-controls={open ? listId : undefined}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label={ariaLabel}
      className={cx('select-trigger', size === 'sm' && 'sm', open && 'is-open', className)}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
      ref={ref}
      role="combobox"
      type="button"
    >
      <span className="select-value">
        {selected ? selected.label : placeholder}
        {selected?.hint !== undefined && <small>{selected.hint}</small>}
      </span>
      <Icon className="select-caret" name="chevron-down" size={14} />
    </button>
  );
}

function useSelectState<T extends string>({ disabled, onChange, options, popRef, triggerRef, value }: {
  readonly disabled?: boolean | undefined;
  readonly onChange: (value: T) => void;
  readonly options: readonly SelectOption<T>[];
  readonly popRef: RefObject<HTMLDivElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly value: T;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useDismissPop({ onClose: () => close(false), open, popRef, triggerRef });

  const openMenu = (): void => {
    if (disabled) return;
    setOpen(true);
    setActiveIndex(defaultActiveIndex(options, value));
  };
  const toggle = (): void => (open ? close(false) : openMenu());
  const commit = (option: SelectOption<T>): void => {
    if (option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!open) return handleClosedKey(event, openMenu);
    handleOpenKey({ activeIndex, close, commit, event, options, setActiveIndex });
  };
  return { activeIndex, commit, onKeyDown, open, setActiveIndex, toggle };
}

function SelectPopover<T extends string>({ activeIndex, ariaLabel, listId, onChoose, onHover, options, popRef, position, value }: {
  readonly activeIndex: number;
  readonly ariaLabel: string;
  readonly listId: string;
  readonly onChoose: (option: SelectOption<T>) => void;
  readonly onHover: (index: number) => void;
  readonly options: readonly SelectOption<T>[];
  readonly popRef: RefObject<HTMLDivElement | null>;
  readonly position: PopPosition;
  readonly value: T;
}): React.ReactElement {
  return (
    <div aria-label={ariaLabel} className={cx('select-pop', position.above && 'is-above')} id={listId} ref={popRef} role="listbox" style={position.style}>
      {options.map((option, index) => (
        <SelectOptionRow active={index === activeIndex} id={`${listId}-opt-${index}`} key={option.value} onChoose={() => onChoose(option)} onHover={() => onHover(index)} option={option} selected={option.value === value} />
      ))}
    </div>
  );
}

function SelectOptionRow<T extends string>({ active, id, onChoose, onHover, option, selected }: {
  readonly active: boolean;
  readonly id: string;
  readonly onChoose: () => void;
  readonly onHover: () => void;
  readonly option: SelectOption<T>;
  readonly selected: boolean;
}): React.ReactElement {
  return (
    <button
      aria-selected={selected}
      className={cx('select-opt', selected && 'is-selected', active && 'is-active')}
      disabled={option.disabled}
      id={id}
      onClick={onChoose}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span className="select-opt-label">{option.label}</span>
      {option.hint !== undefined && <span className="select-opt-hint">{option.hint}</span>}
      <span aria-hidden="true" className="select-opt-tick">{selected && <Icon name="check" size={14} />}</span>
    </button>
  );
}

function handleClosedKey(event: KeyboardEvent<HTMLButtonElement>, openMenu: () => void): void {
  if (!OPEN_KEYS.has(event.key)) return;
  event.preventDefault();
  openMenu();
}

function handleOpenKey<T extends string>({ activeIndex, close, commit, event, options, setActiveIndex }: {
  readonly activeIndex: number;
  readonly close: (restoreFocus: boolean) => void;
  readonly commit: (option: SelectOption<T>) => void;
  readonly event: KeyboardEvent<HTMLButtonElement>;
  readonly options: readonly SelectOption<T>[];
  readonly setActiveIndex: (index: number) => void;
}): void {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return close(true); }
  if (event.key === 'Tab') return close(false);
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    const target = options[activeIndex];
    if (target) commit(target);
    return;
  }
  const next = nextOptionIndex({ activeIndex, key: event.key, options });
  if (next !== null) { event.preventDefault(); setActiveIndex(next); }
}

function defaultActiveIndex<T extends string>(options: readonly SelectOption<T>[], value: T): number {
  const selected = options.findIndex((item) => item.value === value && !item.disabled);
  return selected >= 0 ? selected : options.findIndex((item) => !item.disabled);
}

function nextOptionIndex<T extends string>({ activeIndex, key, options }: {
  readonly activeIndex: number;
  readonly key: string;
  readonly options: readonly SelectOption<T>[];
}): number | null {
  if (key === 'Home') return options.findIndex((item) => !item.disabled);
  if (key === 'End') return findLastEnabledIndex(options);
  const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (step === 0 || options.length === 0) return null;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const candidate = (activeIndex + step * offset + options.length) % options.length;
    if (!options[candidate]?.disabled) return candidate;
  }
  return null;
}

function findLastEnabledIndex<T extends string>(options: readonly SelectOption<T>[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function usePopPosition({ align, open, popRef, triggerRef }: {
  readonly align: 'left' | 'right';
  readonly open: boolean;
  readonly popRef: RefObject<HTMLDivElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
}): PopPosition {
  const [position, setPosition] = useState<PopPosition>({ above: false, style: {} });
  const update = useEffectEvent((): void => {
    const trigger = triggerRef.current;
    if (trigger) setPosition(computePopPosition({ align, pop: popRef.current, trigger }));
  });
  useLayoutEffect(() => {
    if (!open) return undefined;
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [open]);
  return position;
}

function computePopPosition({ align, pop, trigger }: {
  readonly align: 'left' | 'right';
  readonly pop: HTMLDivElement | null;
  readonly trigger: HTMLButtonElement;
}): PopPosition {
  const rect = trigger.getBoundingClientRect();
  const minWidth = Math.max(rect.width, 160);
  const popWidth = Math.max(pop?.offsetWidth ?? 0, minWidth);
  const popHeight = Math.min(pop?.scrollHeight ?? 180, MAX_POP_HEIGHT);
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD;
  const spaceAbove = rect.top - VIEWPORT_PAD;
  const above = spaceBelow < popHeight + POP_GAP && spaceAbove > spaceBelow;
  const maxHeight = Math.max(120, Math.min(MAX_POP_HEIGHT, (above ? spaceAbove : spaceBelow) - POP_GAP));
  const rawLeft = align === 'right' ? rect.right - popWidth : rect.left;
  const left = Math.min(Math.max(VIEWPORT_PAD, rawLeft), Math.max(VIEWPORT_PAD, window.innerWidth - popWidth - VIEWPORT_PAD));
  const style: CSSProperties = above
    ? { bottom: `${window.innerHeight - rect.top + POP_GAP}px`, left: `${left}px`, maxHeight: `${maxHeight}px`, minWidth: `${minWidth}px` }
    : { left: `${left}px`, maxHeight: `${maxHeight}px`, minWidth: `${minWidth}px`, top: `${rect.bottom + POP_GAP}px` };
  return { above, style };
}

function useDismissPop({ onClose, open, popRef, triggerRef }: {
  readonly onClose: () => void;
  readonly open: boolean;
  readonly popRef: RefObject<HTMLDivElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
}): void {
  const handleOutside = useEffectEvent((event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (triggerRef.current?.contains(target) || popRef.current?.contains(target)) return;
    onClose();
  });
  useEffect(() => {
    if (!open) return undefined;
    const listener = (event: Event): void => handleOutside(event);
    document.addEventListener('pointerdown', listener, true);
    document.addEventListener('mousedown', listener, true);
    return () => { document.removeEventListener('pointerdown', listener, true); document.removeEventListener('mousedown', listener, true); };
  }, [open]);
}
