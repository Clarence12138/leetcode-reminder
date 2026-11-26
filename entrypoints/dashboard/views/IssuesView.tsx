import { useState } from 'react';
import type { DailySummary, DetectionIssue, ProblemRecord } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, cx, EmptyState, InlineNotice, Pill } from '../../../src/ui/components';
import { formatDateTime, issueLabel } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';
import './records.css';

type IssueAction = 'issue.mark-read' | 'issue.resolve';

export function IssuesView({
  refresh,
  summary,
}: {
  readonly refresh: () => Promise<void>;
  readonly summary: DailySummary;
}): React.ReactElement {
  const { busy, error, updateIssues } = useIssueActions(refresh);
  const sorted = [...summary.issues].sort((left, right) => right.occurredAt - left.occurredAt);
  const activeIssues = sorted.filter((issue) => issue.resolvedAt === null);
  const unreadIssues = sorted.filter((issue) => issue.readAt === null);
  const problemsBySlug = new Map(summary.problems.map((problem) => [problem.slug, problem]));
  return (
    <div className="rec-issues">
      <IssuesToolbar
        activeIssues={activeIssues}
        busy={busy}
        onAction={updateIssues}
        unreadIssues={unreadIssues}
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <section aria-label="检测异常列表" className="card rec-issue-list">
        {sorted.length === 0
          ? <EmptyState description="提交检测运行正常，这里暂时没有记录。" icon="check" title="没有检测异常" />
          : sorted.map((issue, index) => (
              <IssueItem
                busy={busy !== null}
                issue={issue}
                key={issue.id ?? `${issue.occurredAt}-${index}`}
                onAction={(action) => void updateIssues(action, [issue])}
                problem={problemsBySlug.get(issue.slug)}
              />
            ))}
      </section>
    </div>
  );
}

function useIssueActions(refresh: () => Promise<void>): {
  readonly busy: IssueAction | null;
  readonly error: string | null;
  readonly updateIssues: (action: IssueAction, issues: readonly DetectionIssue[]) => Promise<void>;
} {
  const [busy, setBusy] = useState<IssueAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const updateIssues = async (action: IssueAction, issues: readonly DetectionIssue[]): Promise<void> => {
    const issueIds = getIssueIds(issues);
    if (!issueIds) return setError('异常记录缺少有效 ID，无法更新状态。');
    setBusy(action);
    setError(null);
    try {
      await sendExtensionRequest({ type: action, payload: { issueIds } });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新异常状态失败。');
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, updateIssues };
}

function IssuesToolbar({
  activeIssues,
  busy,
  onAction,
  unreadIssues,
}: {
  readonly activeIssues: readonly DetectionIssue[];
  readonly busy: IssueAction | null;
  readonly onAction: (action: IssueAction, issues: readonly DetectionIssue[]) => Promise<void>;
  readonly unreadIssues: readonly DetectionIssue[];
}): React.ReactElement {
  return (
    <div className="rec-issues-bar">
      <p className="num">{`当前 ${activeIssues.length} 条未解决，${unreadIssues.length} 条未读。`}</p>
      <div className="acts">
        <Button disabled={busy !== null || unreadIssues.length === 0} onClick={() => void onAction('issue.mark-read', unreadIssues)} size="sm">
          {busy === 'issue.mark-read' ? '处理中…' : '全部标记已读'}
        </Button>
        <Button disabled={busy !== null || activeIssues.length === 0} onClick={() => void onAction('issue.resolve', activeIssues)} size="sm" tone="primary">
          {busy === 'issue.resolve' ? '处理中…' : '全部标记已解决'}
        </Button>
      </div>
    </div>
  );
}

function IssueItem({
  busy,
  issue,
  onAction,
  problem,
}: {
  readonly busy: boolean;
  readonly issue: DetectionIssue;
  readonly onAction: (action: IssueAction) => void;
  readonly problem: ProblemRecord | undefined;
}): React.ReactElement {
  const resolved = issue.resolvedAt !== null;
  const unread = issue.readAt === null;
  return (
    <article className={cx('rec-issue', resolved && 'resolved', unread && 'unread')}>
      <span className="rec-issue-ic"><Icon name={resolved ? 'check' : 'alert'} /></span>
      <div className="rec-issue-main">
        <IssueStatus issue={issue} problem={problem} />
        <p>{formatDateTime(issue.occurredAt)}</p>
        <code><span className="rec-issue-code">{issue.code}</span><span>{issue.diagnostic}</span></code>
      </div>
      <IssueActions busy={busy} issue={issue} onAction={onAction} />
    </article>
  );
}

function IssueStatus({ issue, problem }: { readonly issue: DetectionIssue; readonly problem: ProblemRecord | undefined }): React.ReactElement {
  const resolved = issue.resolvedAt !== null;
  return (
    <div className="rec-issue-head">
      <b>{issueLabel[issue.code]}</b>
      <span className="rec-issue-problem">· {problem ? `${problem.frontendId}. ${problem.title}` : issue.slug}</span>
      <Pill tone={resolved ? 'good' : 'danger'}>{resolved ? '已解决' : '未解决'}</Pill>
      {issue.readAt === null && <Pill tone="brand">未读</Pill>}
      {issue.retryable && !resolved && <Pill>可重试</Pill>}
    </div>
  );
}

function IssueActions({
  busy,
  issue,
  onAction,
}: {
  readonly busy: boolean;
  readonly issue: DetectionIssue;
  readonly onAction: (action: IssueAction) => void;
}): React.ReactElement | null {
  if (issue.resolvedAt !== null) return null;
  return (
    <div className="rec-issue-acts">
      {issue.readAt === null && <Button disabled={busy} onClick={() => onAction('issue.mark-read')} size="sm" tone="ghost">标记已读</Button>}
      <Button disabled={busy} onClick={() => onAction('issue.resolve')} size="sm">标记已解决</Button>
    </div>
  );
}

function getIssueIds(issues: readonly DetectionIssue[]): readonly number[] | null {
  if (issues.length === 0) return null;
  const issueIds = issues.map((issue) => issue.id);
  if (issueIds.some((id) => !Number.isInteger(id) || (id ?? 0) <= 0)) return null;
  return issueIds as readonly number[];
}
