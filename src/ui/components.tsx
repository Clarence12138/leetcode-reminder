import type { ButtonHTMLAttributes, CSSProperties, PropsWithChildren, ReactNode } from 'react';
import type { Difficulty } from '../domain/types';
import { cx } from './cx';
import { difficultyLabel } from './format';
import { Icon, type IconName } from './Icon';

export { cx } from './cx';
export { Checkbox, Segmented, Stepper, Switch, type SegmentedOption } from './controls';
export { Chip, ChipMenu, type ChipMenuOption } from './chip-menu';
export { Select, type SelectOption, type SelectProps } from './select';
export { ToastProvider, useToast, type ToastApi, type ToastOptions } from './toast';

export function Brand({ compact = false }: { readonly compact?: boolean }): React.ReactElement {
  return (
    <div className="brand">
      <span aria-hidden="true" className="mark">记</span>
      {!compact && <b>小刷记</b>}
    </div>
  );
}

export type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon?: IconName | undefined;
  readonly iconRight?: IconName | undefined;
  readonly tone?: ButtonTone | undefined;
  readonly size?: ButtonSize | undefined;
  /** 加载中：转圈，宽度不变，并暂时禁用。 */
  readonly loading?: boolean | undefined;
  /** 撑满父容器宽度。 */
  readonly block?: boolean | undefined;
  /** 右侧快捷键提示，如 “⏎”。 */
  readonly kbd?: ReactNode;
}

export function Button({ block, children, className, disabled, icon, iconRight, kbd, loading, size, tone, type = 'button', ...props }: ButtonProps): React.ReactElement {
  const iconSize = size === 'sm' ? 14 : 16;
  return (
    <button
      aria-busy={loading || undefined}
      className={buttonClassName({ block, className, loading, size, tone })}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      <span className="btn-label">
        {icon && <Icon name={icon} size={iconSize} />}
        {children}
        {iconRight && <Icon name={iconRight} size={iconSize} />}
        {kbd !== undefined && <span aria-hidden="true" className="kbd">{kbd}</span>}
      </span>
    </button>
  );
}

/** 按钮的 className，也可用于把 <a> 渲染成按钮样式。 */
export function buttonClassName({ block, className, loading, size = 'md', tone = 'secondary' }: {
  readonly block?: boolean | undefined;
  readonly className?: string | undefined;
  readonly loading?: boolean | undefined;
  readonly size?: ButtonSize | undefined;
  readonly tone?: ButtonTone | undefined;
}): string {
  return cx('btn', tone, size !== 'md' && size, loading && 'loading', block && 'block', className);
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly icon: IconName;
  /** 无障碍名称，同时作为悬停提示。 */
  readonly label: string;
  readonly size?: 'sm' | 'md' | undefined;
  /** 无边框背景。 */
  readonly bare?: boolean | undefined;
  /** 右上角红点。 */
  readonly dot?: boolean | undefined;
}

export function IconButton({ bare = false, className, dot = false, icon, label, size = 'md', title, type = 'button', ...props }: IconButtonProps): React.ReactElement {
  return (
    <button
      aria-label={label}
      className={cx('iconbtn', size === 'sm' && 'sm', bare && 'bare', dot && 'dot', className)}
      title={title ?? label}
      type={type}
      {...props}
    >
      <Icon name={icon} size={size === 'sm' ? 15 : 17} />
    </button>
  );
}

export function Kbd({ children }: PropsWithChildren): React.ReactElement {
  return <kbd className="key">{children}</kbd>;
}

export function DifficultyBadge({ difficulty }: { readonly difficulty: Difficulty }): React.ReactElement {
  return <span className={`diff ${difficulty.toLowerCase()}`}>{difficultyLabel[difficulty]}</span>;
}

export type PillTone = 'default' | 'brand' | 'group' | 'paused' | 'pending' | 'danger' | 'success' | 'again' | 'hard' | 'good' | 'easy';

export function Pill({ children, className, tone = 'default' }: PropsWithChildren<{ readonly className?: string; readonly tone?: PillTone }>): React.ReactElement {
  return <span className={cx('pill', tone !== 'default' && tone, className)}>{children}</span>;
}

export function Card({
  aside,
  bodyClassName,
  children,
  className,
  id,
  padded = true,
  title,
}: PropsWithChildren<{
  /** 标题右侧的说明文字或操作。 */
  readonly aside?: ReactNode;
  readonly bodyClassName?: string;
  readonly className?: string;
  readonly id?: string;
  /** 为 false 时不包 .card-body，内容自己控制内边距（如表格）。 */
  readonly padded?: boolean;
  readonly title?: ReactNode;
}>): React.ReactElement {
  return (
    <section className={cx('card', className)} id={id}>
      {(title !== undefined || aside !== undefined) && (
        <header>
          {title !== undefined && <h2>{title}</h2>}
          {aside !== undefined && <div className="aside">{aside}</div>}
        </header>
      )}
      {padded ? <div className={cx('card-body', bodyClassName)}>{children}</div> : children}
    </section>
  );
}

export function Tile({
  children,
  className,
  delta,
  dim = false,
  label,
  unit,
  value,
}: PropsWithChildren<{
  readonly className?: string;
  /** 数值下方的小字说明。 */
  readonly delta?: ReactNode;
  /** 数据不足时数值置灰。 */
  readonly dim?: boolean;
  readonly label: ReactNode;
  /** 数值后的单位或补充，如 “/ 8 题配额”。 */
  readonly unit?: ReactNode;
  readonly value: ReactNode;
}>): React.ReactElement {
  return (
    <div className={cx('card tile', className)}>
      <span className="label">{label}</span>
      <span className={cx('value', dim && 'dim')}>{value}{unit !== undefined && <small>{unit}</small>}</span>
      {children}
      {delta !== undefined && <span className="delta">{delta}</span>}
    </div>
  );
}

export function Meter({ className, label, max, soft = false, value }: {
  readonly className?: string;
  readonly label: string;
  readonly max: number;
  /** 用色阶色而不是品牌色。 */
  readonly soft?: boolean;
  readonly value: number;
}): React.ReactElement {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const style: CSSProperties = { width: `${(ratio * 100).toFixed(2)}%` };
  return (
    <div aria-label={label} aria-valuemax={max} aria-valuemin={0} aria-valuenow={value} className={cx('meter', soft && 'soft', className)} role="progressbar">
      <span style={style} />
    </div>
  );
}

export function EmptyState({
  action,
  description,
  icon = 'inbox',
  title,
}: {
  readonly action?: ReactNode;
  readonly description: ReactNode;
  readonly icon?: IconName;
  readonly title: string;
}): React.ReactElement {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={20} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action !== undefined && <div className="acts">{action}</div>}
    </div>
  );
}

export type NoticeTone = 'info' | 'success' | 'warn' | 'error';

const noticeIcon: Readonly<Record<NoticeTone, IconName>> = {
  info: 'alert',
  success: 'check',
  warn: 'alert',
  error: 'alert',
};

export function InlineNotice({ children, className, tone = 'info' }: PropsWithChildren<{ readonly className?: string; readonly tone?: NoticeTone }>): React.ReactElement {
  return (
    <div className={cx('notice', tone, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={noticeIcon[tone]} size={16} />
      <span>{children}</span>
    </div>
  );
}

export function LoadingState({ label = '正在读取本地复习数据…' }: { readonly label?: string }): React.ReactElement {
  return (
    <div className="loading-state" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function PageHeading({
  action,
  description,
  title,
}: {
  readonly action?: ReactNode;
  readonly description?: ReactNode;
  readonly title: ReactNode;
}): React.ReactElement {
  return (
    <header className="ph">
      <div>
        <h1>{title}</h1>
        {description !== undefined && <p>{description}</p>}
      </div>
      {action !== undefined && <div className="acts">{action}</div>}
    </header>
  );
}

/** @deprecated 旧首页的统计卡，新页面请用 Tile。保留只为阶段 2 改版前能编译。 */
export function StatCard({
  label,
  value,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly tone: 'green' | 'orange' | 'blue' | 'violet';
  readonly value: number | string;
}): React.ReactElement {
  return <Tile label={label} value={value} />;
}
