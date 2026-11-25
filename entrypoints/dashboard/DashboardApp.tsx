import { useEffect, useState } from 'react';
import { partitionDueProblems } from '../../src/domain/queue-policy';
import { Brand, Button, InlineNotice, LoadingState } from '../../src/ui/components';
import { Icon } from '../../src/ui/Icon';
import { HistoryView } from './views/HistoryView';
import { HomeView } from './views/HomeView';
import { IssuesView } from './views/IssuesView';
import { ProblemsView } from './views/ProblemsView';
import { QueueView } from './views/QueueView';
import { SettingsView } from './views/SettingsView';
import { navigationItems, setViewHash, type ViewKey, viewFromHash } from './navigation';
import { useDashboardData, type DashboardData } from './useDashboardData';
import { HistoryImportContext, useHistoryImport } from './useHistoryImport';

export function DashboardApp(): React.ReactElement {
  const [view, setView] = useState<ViewKey>(() => viewFromHash(window.location.hash));
  const { data, error, refresh } = useDashboardData();
  const historyImport = useHistoryImport(refresh);

  useEffect(() => {
    const handleHash = (): void => setView(viewFromHash(window.location.hash));
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigate = (next: ViewKey): void => {
    setView(next);
    setViewHash(next);
  };

  return (
    <HistoryImportContext.Provider value={historyImport}>
      <div className="dashboard-shell">
        <Sidebar current={view} data={data} importing={historyImport.status === 'running'} onNavigate={navigate} />
        <main className="dashboard-main">
          <MobileNavigation current={view} onNavigate={navigate} />
          <DashboardContent data={data} error={error} refresh={refresh} view={view} />
        </main>
      </div>
    </HistoryImportContext.Provider>
  );
}

function DashboardContent({ data, error, refresh, view }: { readonly data: DashboardData | null; readonly error: string | null; readonly refresh: () => Promise<void>; readonly view: ViewKey }): React.ReactElement {
  if (!data && !error) return <LoadingState />;
  if (!data) {
    return <div className="dashboard-error"><InlineNotice tone="error">{error ?? '未知错误'}</InlineNotice><Button onClick={() => void refresh()}>重试</Button></div>;
  }
  const props = { summary: data.summary, refresh };
  const resetCodeOnReview = data.settings.resetCodeOnReview;
  if (view === 'queue') return <QueueView {...props} resetCodeOnReview={resetCodeOnReview} settings={data.settings} />;
  if (view === 'problems') return <ProblemsView {...props} settings={data.settings} />;
  if (view === 'history') return <HistoryView summary={data.summary} />;
  if (view === 'issues') return <IssuesView {...props} />;
  if (view === 'settings') return <SettingsView {...props} settings={data.settings} />;
  return <HomeView onNavigate={setViewHash} resetCodeOnReview={resetCodeOnReview} settings={data.settings} summary={data.summary} />;
}

function Sidebar({ current, data, importing, onNavigate }: { readonly current: ViewKey; readonly data: DashboardData | null; readonly importing: boolean; readonly onNavigate: (view: ViewKey) => void }): React.ReactElement {
  const queueBadge = computeQueueBadge(data);
  const unreadIssues = data?.summary.issues.filter((issue) => issue.readAt === null).length ?? 0;
  return (
    <aside className="sidebar">
      <Brand />
      <nav aria-label="主导航">
        {navigationItems.map((item) => (
          <button className={current === item.key ? 'is-active' : ''} key={item.key} onClick={() => onNavigate(item.key)} type="button">
            <Icon name={item.icon} /><span>{item.label}</span>
            {item.key === 'settings' && importing && <b>导入中</b>}
            {item.key === 'queue' && queueBadge > 0 && <b>{queueBadge}</b>}
            {item.key === 'issues' && unreadIssues > 0 && <b className="issue-count">{unreadIssues}</b>}
          </button>
        ))}
      </nav>
      <div className="sidebar__privacy"><Icon name="archive" size={15} /><span>仅保存在本机<br />不上传代码与账号</span></div>
    </aside>
  );
}

function computeQueueBadge(data: DashboardData | null): number {
  if (!data) return 0;
  const { quota } = partitionDueProblems({
    dueProblems: data.summary.dueProblems,
    reviews: data.summary.recentReviews,
    settings: data.settings,
  });
  return quota.remainingDue + data.summary.pendingReviews.length;
}

function MobileNavigation({ current, onNavigate }: { readonly current: ViewKey; readonly onNavigate: (view: ViewKey) => void }): React.ReactElement {
  return (
    <nav aria-label="移动端导航" className="mobile-navigation">
      {navigationItems.map((item) => (
        <button aria-label={item.label} className={current === item.key ? 'is-active' : ''} key={item.key} onClick={() => onNavigate(item.key)} type="button">
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
