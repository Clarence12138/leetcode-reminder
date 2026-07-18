import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import type { Difficulty } from '../domain/types';
import { difficultyLabel } from './format';
import { Icon, type IconName } from './Icon';

export function Brand({ compact = false }: { readonly compact?: boolean }): React.ReactElement {
  return (
    <div className="brand">
      <span className="brand__mark" aria-hidden="true">记</span>
      {!compact && (
        <span className="brand__copy">
          <strong>小刷记</strong>
          <small>力扣复习助手</small>
        </span>
      )}
    </div>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon?: IconName;
  readonly tone?: 'primary' | 'secondary' | 'danger' | 'ghost';
}

export function Button({ children, className = '', icon, tone = 'secondary', ...props }: ButtonProps): React.ReactElement {
  return (
    <button className={`button button--${tone} ${className}`.trim()} {...props}>
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

export function DifficultyBadge({ difficulty }: { readonly difficulty: Difficulty }): React.ReactElement {
  return <span className={`difficulty difficulty--${difficulty.toLowerCase()}`}>{difficultyLabel[difficulty]}</span>;
}

export function EmptyState({
  description,
  icon = 'inbox',
  title,
}: {
  readonly description: string;
  readonly icon?: IconName;
  readonly title: string;
}): React.ReactElement {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon name={icon} size={24} /></span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function InlineNotice({ children, tone = 'info' }: PropsWithChildren<{ readonly tone?: 'info' | 'error' | 'success' }>): React.ReactElement {
  return (
    <div className={`inline-notice inline-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'alert' : 'check'} size={16} />
      <span>{children}</span>
    </div>
  );
}

export function LoadingState(): React.ReactElement {
  return (
    <div className="loading-state" role="status">
      <span className="spinner" />
      <span>正在读取本地复习数据…</span>
    </div>
  );
}

export function PageHeading({
  action,
  description,
  title,
}: {
  readonly action?: ReactNode;
  readonly description: string;
  readonly title: string;
}): React.ReactElement {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function StatCard({
  icon,
  label,
  tone,
  value,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly tone: 'green' | 'orange' | 'blue' | 'violet';
  readonly value: number | string;
}): React.ReactElement {
  return (
    <article className="stat-card">
      <span className={`stat-card__icon stat-card__icon--${tone}`}><Icon name={icon} /></span>
      <div><strong>{value}</strong><span>{label}</span></div>
    </article>
  );
}
