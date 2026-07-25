import { useState } from 'react';
import type { DailySummary, DetectionIssue } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, EmptyState, InlineNotice, PageHeading } from '../../../src/ui/components';
import { formatDateTime, issueLabel } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';

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
  return (
    <div className="view-content">
      <IssuesHeading
        activeIssues={activeIssues}
        busy={busy}
        onAction={updateIssues}
        unreadIssues={unreadIssues}
      />
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      <section className="issues-list">
        {sorted.length === 0
          ? <EmptyState description="提交检测运行正常，这里暂时没有记录。" icon="check" title="没有检测异常" />
          : sorted.map((issue, index) => (
              <IssueItem
                busy={busy !== null}
                issue={issue}
                key={issue.id ?? `${issue.occurredAt}-${index}`}
                onAction={(action) => void updateIssues(action, [issue])}
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

function IssuesHeading({
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
    <PageHeading
      action={(
        <div className="issue-bulk-actions">
          <Button disabled={busy !== null || unreadIssues.length === 0} onClick={() => void onAction('issue.mark-read', unreadIssues)}>
            {busy === 'issue.mark-read' ? '处理中…' : '全部标记已读'}
          </Button>
          <Button disabled={busy !== null || activeIssues.length === 0} onClick={() => void onAction('issue.resolve', activeIssues)} tone="primary">
            {busy === 'issue.resolve' ? '处理中…' : '全部标记已解决'}
          </Button>
        </div>
      )}
      description={`当力扣登录、网络或内部接口异常时会如实记录。当前 ${activeIssues.length} 条未解决，${unreadIssues.length} 条未读。`}
      title="检测异常"
    />
  );
}

function IssueItem({
  busy,
  issue,
  onAction,
}: {
  readonly busy: boolean;
  readonly issue: DetectionIssue;
  readonly onAction: (action: IssueAction) => void;
}): React.ReactElement {
  const resolved = issue.resolvedAt !== null;
  const unread = issue.readAt === null;
  return (
    <article className={`issue-item ${resolved ? 'is-resolved' : ''} ${unread ? 'is-unread' : ''}`}>
      <span className="issue-item__icon"><Icon name={resolved ? 'check' : 'alert'} /></span>
      <div className="issue-item__main">
        <IssueStatus issue={issue} />
        <p>题目：{issue.slug} · {formatDateTime(issue.occurredAt)}</p>
        <code>{issue.diagnostic}</code>
      </div>
      <IssueActions busy={busy} issue={issue} onAction={onAction} />
    </article>
  );
}

function IssueStatus({ issue }: { readonly issue: DetectionIssue }): React.ReactElement {
  const resolved = issue.resolvedAt !== null;
  return (
    <div>
      <strong>{issueLabel[issue.code]}</strong>
      <span className={resolved ? 'status-resolved' : 'status-active'}>{resolved ? '已解决' : '未解决'}</span>
      {issue.readAt === null && <span className="status-unread">未读</span>}
      {issue.retryable && !resolved && <span className="status-retry">可重试</span>}
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
    <div className="issue-item__actions">
      {issue.readAt === null && <Button disabled={busy} onClick={() => onAction('issue.mark-read')}>标记已读</Button>}
      <Button disabled={busy} onClick={() => onAction('issue.resolve')} tone="primary">标记已解决</Button>
    </div>
  );
}

function getIssueIds(issues: readonly DetectionIssue[]): readonly number[] | null {
  if (issues.length === 0) return null;
  const issueIds = issues.map((issue) => issue.id);
  if (issueIds.some((id) => !Number.isInteger(id) || (id ?? 0) <= 0)) return null;
  return issueIds as readonly number[];
}
