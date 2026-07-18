import type { PropsWithChildren, ReactNode } from 'react';
import type { ProblemRecord, SubmissionReview } from '../../../src/domain/types';
import { DifficultyBadge } from '../../../src/ui/components';
import { formatDateTime, formatDue, problemName } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';

export function Panel({ children, className = '', title, action }: PropsWithChildren<{ readonly action?: ReactNode; readonly className?: string; readonly title: string }>): React.ReactElement {
  return (
    <section className={`panel ${className}`.trim()}>
      <header className="panel__header"><h2>{title}</h2>{action}</header>
      {children}
    </section>
  );
}

export function ProblemRow({ problem, compact = false }: { readonly compact?: boolean; readonly problem: ProblemRecord }): React.ReactElement {
  const dueLabel = formatDue(problem.nextReviewAt);
  const isOverdue = dueLabel.startsWith('逾期') || dueLabel === '昨天到期';
  return (
    <article className="problem-row">
      <span className="problem-row__number">{problem.frontendId}</span>
      <div className="problem-row__main">
        <a href={problem.url} rel="noreferrer" target="_blank">{problem.title} <Icon name="external" size={13} /></a>
        {!compact && <span className="tag-line">{problem.tags.slice(0, 3).map((tag) => <i key={tag}>{tag}</i>)}</span>}
      </div>
      <DifficultyBadge difficulty={problem.difficulty} />
      <time className={isOverdue ? 'is-overdue' : ''}>{dueLabel}</time>
    </article>
  );
}

export function ReviewRow({ problem, review }: { readonly problem: ProblemRecord | undefined; readonly review: SubmissionReview }): React.ReactElement {
  return (
    <article className="review-row">
      <span className="review-row__icon"><Icon name="check" size={15} /></span>
      <div><strong>{problemName(problem, review)}</strong><span>{review.trigger === 'keyboard' ? '快捷键提交' : '按钮提交'}</span></div>
      <time>{formatDateTime(review.acceptedAt)}</time>
    </article>
  );
}
