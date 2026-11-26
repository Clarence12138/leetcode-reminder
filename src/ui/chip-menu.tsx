import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { Checkbox } from './controls';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 选中/生效态（品牌色描边与底色）。 */
  readonly active?: boolean | undefined;
  readonly icon?: IconName | undefined;
  /** 右侧下拉箭头。 */
  readonly caret?: boolean | undefined;
  readonly ref?: Ref<HTMLButtonElement> | undefined;
}

/** 圆角筛选标签按钮。用作开关时请传 aria-pressed。 */
export function Chip({ active, caret, children, className, icon, type = 'button', ...props }: ChipProps): React.ReactElement {
  return (
    <button className={cx('chip', active && 'on', className)} type={type} {...props}>
      {icon && <Icon name={icon} size={14} />}
      {children}
      {caret && <Icon className="caret" name="chevron-down" size={14} />}
    </button>
  );
}

export interface ChipMenuOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** 右侧的小字，如题目数量。 */
  readonly hint?: ReactNode;
}

export interface ChipMenuProps<T extends string> {
  readonly label: string;
  readonly options: readonly ChipMenuOption<T>[];
  readonly selected: readonly T[];
  readonly onChange: (next: T[]) => void;
  /** 默认多选；单选时点一项就关闭，适合“排序”。 */
  readonly multiple?: boolean | undefined;
  /** 是否显示 × 清除；多选默认显示，单选默认不显示。 */
  readonly clearable?: boolean | undefined;
  readonly align?: 'left' | 'right' | undefined;
  readonly icon?: IconName | undefined;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
  /** 自定义标签上的文字（默认“难度”/“难度：困难”/“难度 · 2”）。 */
  readonly summary?: ((selected: readonly T[]) => ReactNode) | undefined;
}

/**
 * 带下拉菜单的筛选标签。
 * - 多选（默认）：菜单里是复选框，选中后标签显示“难度：困难”或“难度 · 2”，右侧出现 × 一键清除。
 * - 单选（multiple={false}）：菜单项点一下就关闭。
 * 点菜单外部或按 Esc 关闭；Esc 后焦点回到标签。
 */
export function ChipMenu<T extends string>(props: ChipMenuProps<T>): React.ReactElement {
  const { label, multiple = true, onChange, selected } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const active = (props.clearable ?? multiple) && selected.length > 0;
  useDismissOnOutside({ open, rootRef, menuRef, onClose: () => setOpen(false) });

  const close = (): void => { setOpen(false); chipRef.current?.focus(); };
  const choose = (next: T[], shouldClose: boolean): void => {
    onChange(next);
    if (shouldClose) close();
  };

  return (
    <div
      className={cx('chipm', active && 'has-x', props.className)}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); close(); } }}
      ref={rootRef}
    >
      <Chip
        active={active}
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="true"
        caret={!active}
        disabled={props.disabled}
        icon={props.icon}
        onClick={() => setOpen((current) => !current)}
        ref={chipRef}
      >
        {props.summary ? props.summary(selected) : summarize({ label, options: props.options, selected, multiple })}
      </Chip>
      {active && (
        <button aria-label={`清除${label}筛选`} className="chip-x" disabled={props.disabled} onClick={() => choose([], true)} type="button">
          <Icon name="close" size={12} />
        </button>
      )}
      {open && <MenuPanel choose={choose} id={menuId} menuRef={menuRef} multiple={multiple} props={props} />}
    </div>
  );
}

function MenuPanel<T extends string>({ choose, id, menuRef, multiple, props }: {
  readonly choose: (next: T[], close: boolean) => void;
  readonly id: string;
  readonly menuRef: RefObject<HTMLDivElement | null>;
  readonly multiple: boolean;
  readonly props: ChipMenuProps<T>;
}): React.ReactElement {
  return (
    <div aria-label={props.label} className={cx('menu', props.align === 'right' && 'right')} id={id} ref={menuRef} role={multiple ? 'group' : 'menu'}>
      {multiple
        ? <MultiOptions onChoose={choose} options={props.options} selected={props.selected} />
        : <SingleOptions onChoose={(value) => choose([value], true)} options={props.options} selected={props.selected} />}
    </div>
  );
}

function MultiOptions<T extends string>({ onChoose, options, selected }: {
  readonly onChoose: (next: T[], close: boolean) => void;
  readonly options: readonly ChipMenuOption<T>[];
  readonly selected: readonly T[];
}): React.ReactElement {
  const toggle = (value: T, checked: boolean): void => {
    const next = checked ? [...selected, value] : selected.filter((item) => item !== value);
    // 按选项顺序输出，便于比较
    onChoose(options.map((option) => option.value).filter((item) => next.includes(item)), false);
  };
  return (
    <>
      {options.map((option) => (
        <Checkbox checked={selected.includes(option.value)} key={option.value} onChange={(checked) => toggle(option.value, checked)}>
          {option.label}{option.hint !== undefined && <em>{option.hint}</em>}
        </Checkbox>
      ))}
      {selected.length > 0 && (
        <>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => onChoose([], true)} type="button">清除</button>
        </>
      )}
    </>
  );
}

function SingleOptions<T extends string>({ onChoose, options, selected }: {
  readonly onChoose: (value: T) => void;
  readonly options: readonly ChipMenuOption<T>[];
  readonly selected: readonly T[];
}): React.ReactElement {
  return (
    <>
      {options.map((option) => {
        const checked = selected.includes(option.value);
        return (
          <button aria-checked={checked} className="menu-item" key={option.value} onClick={() => onChoose(option.value)} role="menuitemradio" type="button">
            <span aria-hidden="true" className="tick">{checked && <Icon name="check" size={14} />}</span>
            {option.label}
            {option.hint !== undefined && <em>{option.hint}</em>}
          </button>
        );
      })}
    </>
  );
}

/** 菜单打开时：把焦点放到第一项；点击组件外部时关闭。 */
function useDismissOnOutside({ menuRef, onClose, open, rootRef }: {
  readonly menuRef: RefObject<HTMLDivElement | null>;
  readonly onClose: () => void;
  readonly open: boolean;
  readonly rootRef: RefObject<HTMLDivElement | null>;
}): void {
  const handleOutside = useEffectEvent((event: Event): void => {
    if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
    onClose();
  });
  useEffect(() => {
    if (!open) return undefined;
    const listener = (event: Event): void => handleOutside(event);
    document.addEventListener('pointerdown', listener, true);
    document.addEventListener('mousedown', listener, true);
    menuRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', listener, true);
      document.removeEventListener('mousedown', listener, true);
    };
  }, [menuRef, open]);
}

function summarize<T extends string>({ label, multiple, options, selected }: {
  readonly label: string;
  readonly multiple: boolean;
  readonly options: readonly ChipMenuOption<T>[];
  readonly selected: readonly T[];
}): string {
  if (selected.length === 0) return label;
  if (selected.length > 1 && multiple) return `${label} · ${selected.length}`;
  const option = options.find((item) => item.value === selected[0]);
  return option ? `${label}：${option.label}` : label;
}
