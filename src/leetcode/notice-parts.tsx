import type { ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { difficultyLabel } from '../ui/format';
import type { NoticeProblem } from './content-controller';

export function Card({ children, className, label, role }: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly label: string;
  readonly role?: 'status' | 'alert';
}) {
  return (
    <aside aria-label={label} className={className ? `xsj-card ${className}` : 'xsj-card'} role={role}>
      {children}
    </aside>
  );
}

export function CardHead({ title, subtitle, icon = 'check', tone = 'good', onClose, children }: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly icon?: 'check' | 'alert' | 'minus';
  readonly tone?: 'good' | 'danger' | 'muted';
  readonly onClose: () => void;
  readonly children?: ReactNode;
}) {
  return (
    <header className="xsj-head">
      <div className="xsj-head-main">
        <span className={`xsj-ok xsj-ok--${tone}`}><Icon name={icon} size={16} /></span>
        <div>
          <strong className="xsj-title">{title}</strong>
          {subtitle && <small className="xsj-sub">{subtitle}</small>}
        </div>
      </div>
      {children}
      <button aria-label="关闭" className="xsj-iconbtn" onClick={onClose} type="button">
        <Icon name="close" size={16} />
      </button>
    </header>
  );
}

export function ProblemName({ problem }: { readonly problem: NoticeProblem }) {
  return (
    <>
      <span className="xsj-name">{problem.frontendId}. {problem.title}</span>
      <span className={`xsj-diff xsj-diff--${problem.difficulty.toLowerCase()}`}>{difficultyLabel[problem.difficulty]}</span>
    </>
  );
}
