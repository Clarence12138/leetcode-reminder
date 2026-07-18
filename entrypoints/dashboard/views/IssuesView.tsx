import type { DailySummary, DetectionIssue } from '../../../src/domain/types';
import { EmptyState, PageHeading } from '../../../src/ui/components';
import { formatDateTime, issueLabel } from '../../../src/ui/format';
import { Icon } from '../../../src/ui/Icon';

export function IssuesView({ summary }: { readonly summary: DailySummary }): React.ReactElement {
  const sorted = [...summary.issues].sort((left, right) => right.occurredAt - left.occurredAt);
  const activeCount = sorted.filter((issue) => issue.resolvedAt === null).length;
  return (
    <div className="view-content">
      <PageHeading description={`当力扣登录、网络或内部接口异常时会如实记录。当前 ${activeCount} 条未解决。`} title="检测异常" />
      <section className="issues-list">
        {sorted.length === 0
          ? <EmptyState description="提交检测运行正常，这里暂时没有记录。" icon="check" title="没有检测异常" />
          : sorted.map((issue, index) => <IssueItem issue={issue} key={issue.id ?? `${issue.occurredAt}-${index}`} />)}
      </section>
    </div>
  );
}

function IssueItem({ issue }: { readonly issue: DetectionIssue }): React.ReactElement {
  const resolved = issue.resolvedAt !== null;
  return (
    <article className={`issue-item ${resolved ? 'is-resolved' : ''}`}>
      <span className="issue-item__icon"><Icon name={resolved ? 'check' : 'alert'} /></span>
      <div className="issue-item__main">
        <div><strong>{issueLabel[issue.code]}</strong><span className={resolved ? 'status-resolved' : 'status-active'}>{resolved ? '已解决' : '未解决'}</span>{issue.retryable && !resolved && <span className="status-retry">可重试</span>}</div>
        <p>题目：{issue.slug} · {formatDateTime(issue.occurredAt)}</p>
        <code>{issue.diagnostic}</code>
      </div>
    </article>
  );
}
