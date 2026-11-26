import type { DailySummary, Settings } from '../../../src/domain/types';
import { PageHeading, Segmented, type SegmentedOption } from '../../../src/ui/components';
import { HistoryView } from './HistoryView';
import { IssuesView } from './IssuesView';
import './records.css';

export type RecordsTab = 'history' | 'issues';

export interface RecordsViewProps {
  readonly refresh: () => Promise<void>;
  readonly settings: Settings;
  readonly summary: DailySummary;
  readonly tab: RecordsTab;
  readonly onTabChange: (tab: RecordsTab) => void;
}

const description: Readonly<Record<RecordsTab, string>> = {
  history: '每次 Accepted 都会留下一条；补评也会按通过时间排进去。',
  issues: '力扣登录、网络或接口出问题导致没记上时，会留在这里。',
};

export function RecordsView({ onTabChange, refresh, settings, summary, tab }: RecordsViewProps): React.ReactElement {
  const unread = summary.issues.filter((issue) => issue.readAt === null).length;
  const options: readonly SegmentedOption<RecordsTab>[] = [
    { value: 'history', label: '复习记录' },
    {
      value: 'issues',
      label: <>检测异常{unread > 0 && <span aria-hidden="true" className="rec-tab-count num">{unread}</span>}</>,
      ariaLabel: unread > 0 ? `检测异常（${unread} 条未读）` : '检测异常',
    },
  ];
  return (
    <div className="view-content records">
      <PageHeading
        action={<Segmented ariaLabel="记录类型" onChange={onTabChange} options={options} value={tab} />}
        description={description[tab]}
        title="记录"
      />
      {tab === 'issues'
        ? <IssuesView refresh={refresh} summary={summary} />
        : <HistoryView refresh={refresh} settings={settings} summary={summary} />}
    </div>
  );
}
