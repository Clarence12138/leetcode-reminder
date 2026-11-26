import { useEffect, useState } from 'react';
import { Brand, Button, InlineNotice, LoadingState, ToastProvider } from '../../src/ui/components';
import {
  computeNavigationBadges,
  navigationItems,
  routeFromHash,
  setRouteHash,
  tabOfRoute,
  type NavigationBadges,
  type RouteKey,
  type TabKey,
} from './navigation';
import { useDashboardData, type DashboardData } from './useDashboardData';
import { HistoryImportContext, useHistoryImport } from './useHistoryImport';
import { OverviewView } from './views/OverviewView';
import { ProblemsView } from './views/ProblemsView';
import { RecordsView } from './views/RecordsView';
import { SettingsView } from './views/SettingsView';

export function DashboardApp(): React.ReactElement {
  const [route, setRoute] = useState<RouteKey>(() => routeFromHash(window.location.hash));
  const { data, error, refresh } = useDashboardData();
  const historyImport = useHistoryImport(refresh);

  useEffect(() => {
    const handleHash = (): void => setRoute(routeFromHash(window.location.hash));
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const navigate = (next: RouteKey): void => {
    setRoute(next);
    setRouteHash(next);
  };
  const badges = data ? computeNavigationBadges(data.summary, data.settings) : null;

  return (
    <ToastProvider>
      <HistoryImportContext.Provider value={historyImport}>
        <div className="dashboard-shell">
          <TopBar badges={badges} current={tabOfRoute(route)} importing={historyImport.status === 'running'} onNavigate={navigate} />
          <main className="dashboard-main">
            <DashboardContent data={data} error={error} navigate={navigate} refresh={refresh} route={route} />
          </main>
        </div>
      </HistoryImportContext.Provider>
    </ToastProvider>
  );
}

function DashboardContent({ data, error, navigate, refresh, route }: {
  readonly data: DashboardData | null;
  readonly error: string | null;
  readonly navigate: (route: RouteKey) => void;
  readonly refresh: () => Promise<void>;
  readonly route: RouteKey;
}): React.ReactElement {
  if (!data && !error) return <LoadingState />;
  if (!data) {
    return <div className="dashboard-error"><InlineNotice tone="error">{error ?? '未知错误'}</InlineNotice><Button onClick={() => void refresh()}>重试</Button></div>;
  }
  const { settings, summary } = data;
  switch (tabOfRoute(route)) {
    case 'problems':
      return <ProblemsView refresh={refresh} settings={settings} summary={summary} />;
    case 'records':
      return <RecordsView onTabChange={(tab) => navigate(tab)} refresh={refresh} settings={settings} summary={summary} tab={route === 'issues' ? 'issues' : 'history'} />;
    case 'settings':
      return <SettingsView refresh={refresh} settings={settings} summary={summary} />;
    default:
      return <OverviewView onNavigate={navigate} refresh={refresh} scrollToQueue={route === 'queue'} settings={settings} summary={summary} />;
  }
}

function TopBar({ badges, current, importing, onNavigate }: {
  readonly badges: NavigationBadges | null;
  readonly current: TabKey;
  readonly importing: boolean;
  readonly onNavigate: (route: RouteKey) => void;
}): React.ReactElement {
  const countOf = (tab: TabKey): number => (tab === 'overview' ? badges?.overview : tab === 'records' ? badges?.records : 0) ?? 0;
  return (
    <header className="topbar">
      <Brand />
      <nav aria-label="主导航" className="tabs">
        {navigationItems.map((item) => {
          const count = countOf(item.tab);
          return (
            <button
              aria-current={current === item.tab ? 'page' : undefined}
              className={current === item.tab ? 'is-active' : ''}
              key={item.tab}
              onClick={() => onNavigate(item.route)}
              type="button"
            >
              {item.label}
              {item.tab === 'settings' && importing && <b className="is-info">导入中</b>}
              {count > 0 && <b className={item.tab === 'records' ? 'is-alert' : ''}>{count}</b>}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
