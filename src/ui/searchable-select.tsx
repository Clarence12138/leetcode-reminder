import {
  useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { fuzzyFilter } from './fuzzy';
import { Icon } from './Icon';
import { SelectOptionRow, useDismissPop, usePopPosition, type PopPosition, type SelectOption } from './select';

export interface SearchableSelectOption<T extends string = string> extends SelectOption<T> {
  /** 额外的搜索关键词（别名、缩写等），不展示。 */
  readonly keywords?: readonly string[] | undefined;
}

export interface SearchableSelectProps<T extends string = string> {
  readonly ariaLabel: string;
  readonly onChange: (value: T) => void;
  readonly options: readonly SearchableSelectOption<T>[];
  readonly value: T;
  readonly align?: 'left' | 'right' | undefined;
  readonly className?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly emptyText?: string | undefined;
  readonly searchPlaceholder?: string | undefined;
}

const POP_MAX_HEIGHT = 360;

/** 可搜索的下拉框：外观与 Select 一致，展开后顶部是搜索框，边输入边模糊筛选。 */
export function SearchableSelect<T extends string = string>(props: SearchableSelectProps<T>): React.ReactElement {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const state = useSearchState({ ...props, popRef, triggerRef });
  const position = usePopPosition({ align: props.align ?? 'left', maxHeight: POP_MAX_HEIGHT, open: state.open, popRef, triggerRef });
  const selected = props.options.find((item) => item.value === props.value);

  return (
    <>
      <button
        aria-expanded={state.open}
        aria-haspopup="listbox"
        aria-label={props.ariaLabel}
        className={cx('select-trigger', state.open && 'is-open', props.className)}
        disabled={props.disabled}
        onClick={state.toggle}
        onKeyDown={state.onTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span className="select-value">
          {selected?.label ?? props.value}
          {selected?.hint !== undefined && <small>{selected.hint}</small>}
        </span>
        <Icon className="select-caret" name="chevron-down" size={14} />
      </button>
      {state.open && createPortal(
        <SearchPopover {...props} listId={listId} popRef={popRef} position={position} state={state} />,
        document.body,
      )}
    </>
  );
}

type SearchState<T extends string> = ReturnType<typeof useSearchState<T>>;

function SearchPopover<T extends string>({ ariaLabel, emptyText, listId, popRef, position, searchPlaceholder, state, value }: SearchableSelectProps<T> & {
  readonly listId: string;
  readonly popRef: RefObject<HTMLDivElement | null>;
  readonly position: PopPosition;
  readonly state: SearchState<T>;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const centeredRef = useRef(false);
  const limited = position.style.maxHeight !== undefined;
  useEffect(() => { inputRef.current?.focus(); }, []);
  // 弹层定位（限高）后才有滚动容器：首次把选中项滚到中间，之后键盘移动只保证可见。
  useLayoutEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>('.select-opt.is-active');
    if (!list || !active || !limited) return;
    scrollOptionIntoView(list, active, centeredRef.current ? 'nearest' : 'center');
    centeredRef.current = true;
  }, [state.activeIndex, state.filtered, limited]);
  const activeId = state.activeIndex >= 0 ? `${listId}-opt-${state.activeIndex}` : undefined;

  return (
    <div className={cx('select-pop', 'combo-pop', position.above && 'is-above')} ref={popRef} style={position.style}>
      <label className="combo-search">
        <Icon name="search" size={14} />
        <input
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded
          aria-label={`搜索${ariaLabel}`}
          autoComplete="off"
          onChange={(event) => state.search(event.target.value)}
          onKeyDown={state.onSearchKeyDown}
          placeholder={searchPlaceholder ?? '输入以筛选'}
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="text"
          value={state.query}
        />
      </label>
      <div aria-label={ariaLabel} className="combo-list" id={listId} ref={listRef} role="listbox">
        {state.filtered.length === 0
          ? <p className="combo-empty">{emptyText ?? '没有匹配项'}</p>
          : <OptionRows listId={listId} state={state} value={value} />}
      </div>
    </div>
  );
}

function OptionRows<T extends string>({ listId, state, value }: {
  readonly listId: string;
  readonly state: SearchState<T>;
  readonly value: T;
}): React.ReactElement {
  return (
    <>
      {state.filtered.map((option, index) => (
        <SelectOptionRow
          active={index === state.activeIndex}
          id={`${listId}-opt-${index}`}
          key={option.value}
          onChoose={() => state.commit(option)}
          onHover={() => state.setActiveIndex(index)}
          option={option}
          selected={option.value === value}
        />
      ))}
    </>
  );
}

function scrollOptionIntoView(list: HTMLElement, option: HTMLElement, mode: 'center' | 'nearest'): void {
  const top = option.offsetTop - list.offsetTop;
  const bottom = top + option.offsetHeight;
  if (mode === 'center') {
    list.scrollTop = top - (list.clientHeight - option.offsetHeight) / 2;
  } else if (top < list.scrollTop) {
    list.scrollTop = top - 5;
  } else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight + 5;
  }
}

function useSearchState<T extends string>({ disabled, onChange, options, popRef, triggerRef, value }: SearchableSelectProps<T> & {
  readonly popRef: RefObject<HTMLDivElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const filtered = useMemo(
    () => fuzzyFilter(options, query, (option) => ({ primary: option.label, keywords: [option.value, ...(option.keywords ?? [])] })),
    [options, query],
  );
  const close = (restoreFocus: boolean): void => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useDismissPop({ onClose: () => close(false), open, popRef, triggerRef });

  const openWith = (initialQuery: string): void => {
    if (disabled) return;
    setOpen(true);
    setQuery(initialQuery);
    setActiveIndex(initialQuery ? 0 : Math.max(0, options.findIndex((item) => item.value === value)));
  };
  const commit = (option: SearchableSelectOption<T>): void => {
    if (option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close(true);
  };
  const search = (next: string): void => {
    setQuery(next);
    setActiveIndex(0);
  };
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const initial = triggerOpenQuery(event);
    if (initial === null) return;
    event.preventDefault();
    openWith(initial);
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    handleSearchKey({ activeIndex, close, commit, event, filtered, setActiveIndex });
  };
  const toggle = (): void => (open ? close(false) : openWith(''));
  return { activeIndex, commit, filtered, onSearchKeyDown, onTriggerKeyDown, open, query, search, setActiveIndex, toggle };
}

/** 收起时按方向键/回车/空格展开；直接打字则展开并把这个字作为搜索词。返回 null 表示不处理。 */
function triggerOpenQuery(event: KeyboardEvent<HTMLButtonElement>): string | null {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') return '';
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) return event.key;
  return null;
}

function handleSearchKey<T extends string>({ activeIndex, close, commit, event, filtered, setActiveIndex }: {
  readonly activeIndex: number;
  readonly close: (restoreFocus: boolean) => void;
  readonly commit: (option: SearchableSelectOption<T>) => void;
  readonly event: KeyboardEvent<HTMLInputElement>;
  readonly filtered: readonly SearchableSelectOption<T>[];
  readonly setActiveIndex: (index: number) => void;
}): void {
  if (event.nativeEvent.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return close(true); }
  if (event.key === 'Tab') return close(false);
  if (event.key === 'Enter') {
    event.preventDefault();
    const target = filtered[activeIndex];
    if (target) commit(target);
    return;
  }
  const next = moveIndex(event.key, activeIndex, filtered.length);
  if (next !== null) { event.preventDefault(); setActiveIndex(next); }
}

function moveIndex(key: string, current: number, length: number): number | null {
  if (length === 0) return null;
  if (key === 'ArrowDown') return (current + 1) % length;
  if (key === 'ArrowUp') return (current - 1 + length) % length;
  if (key === 'PageDown') return Math.min(length - 1, current + 8);
  if (key === 'PageUp') return Math.max(0, current - 8);
  return null;
}
