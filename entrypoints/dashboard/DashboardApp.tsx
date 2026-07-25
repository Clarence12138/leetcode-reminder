import { useEffect, useState } from 'react';
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

export function DashboardApp(): React.ReactElement {
  const [view, setView] = useState<ViewKey>(() => viewFromHash(window.location.hash));
  const { data, error, refresh } = useDashboardData();

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
    <div className="dashboard-shell">
      <Sidebar current={view} data={data} onNavigate={navigate} />
      <main className="dashboard-main">
        <MobileNavigation current={view} onNavigate={navigate} />
        <DashboardContent data={data} error={error} refresh={refresh} view={view} />
      </main>
    </div>
  );
}

function DashboardContent({ data, error, refresh, view }: { readonly data: DashboardData | null; readonly error: string | null; readonly refresh: () => Promise<void>; readonly view: ViewKey }): React.ReactElement {
  if (!data && !error) return <LoadingState />;
  if (!data) {
    return <div className="dashboard-error"><InlineNotice tone="error">{error ?? '未知错误'}</InlineNotice><Button onClick={() => void refresh()}>重试</Button></div>;
  }
  const props = { summary: data.summary, refresh };
  if (view === 'queue') return <QueueView {...props} />;
  if (view === 'problems') return <ProblemsView {...props} />;
  if (view === 'history') return <HistoryView summary={data.summary} />;
  if (view === 'issues') return <IssuesView {...props} />;
  if (view === 'settings') return <SettingsView {...props} settings={data.settings} />;
  return <HomeView summary={data.summary} onNavigate={setViewHash} />;
}

function Sidebar({ current, data, onNavigate }: { readonly current: ViewKey; readonly data: DashboardData | null; readonly onNavigate: (view: ViewKey) => void }): React.ReactElement {
  const pending = data ? data.summary.dueProblems.length + data.summary.pendingReviews.length : 0;
  const unreadIssues = data?.summary.issues.filter((issue) => issue.readAt === null).length ?? 0;
  return (
    <aside className="sidebar">
      <Brand />
      <nav aria-label="主导航">
        {navigationItems.map((item) => (
          <button className={current === item.key ? 'is-active' : ''} key={item.key} onClick={() => onNavigate(item.key)} type="button">
            <Icon name={item.icon} /><span>{item.label}</span>
            {item.key === 'queue' && pending > 0 && <b>{pending}</b>}
            {item.key === 'issues' && unreadIssues > 0 && <b className="issue-count">{unreadIssues}</b>}
          </button>
        ))}
      </nav>
      <div className="sidebar__privacy"><Icon name="archive" size={15} /><span>仅保存在本机<br />不上传代码与账号</span></div>
    </aside>
  );
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
