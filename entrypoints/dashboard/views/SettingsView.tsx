import { useEffect, useState } from 'react';
import type { DailySummary, Settings } from '../../../src/domain/types';
import { PageHeading } from '../../../src/ui/components';
import { LeetCodeImportPanel } from './LeetCodeImportPanel';
import { ReviewGroupsPanel } from './ReviewGroupsPanel';
import { AppearanceSection } from './settings/AppearanceSection';
import { DangerSection, DataSection } from './settings/DataSections';
import { ReminderSection } from './settings/ReminderSection';
import { ReviewSection } from './settings/ReviewSection';
import { Section } from './settings/parts';
import { SavedProvider } from './settings/saved';
import './settings.css';

interface SettingsProps {
  readonly refresh: () => Promise<void>;
  readonly settings: Settings;
  readonly summary: DailySummary;
}

const SECTIONS = [
  { id: 'settings-appearance', label: '外观' },
  { id: 'settings-reminder', label: '提醒' },
  { id: 'settings-review', label: '复习' },
  { id: 'settings-groups', label: '分组与题单' },
  { id: 'settings-import', label: '导入力扣历史' },
  { id: 'settings-data', label: '数据' },
  { id: 'settings-danger', label: '危险操作' },
] as const;

export function SettingsView({ refresh, settings, summary }: SettingsProps): React.ReactElement {
  return (
    <SavedProvider>
      <div className="view-content settings-view">
        <PageHeading description="外观、提醒、复习配额和分组；所有改动会立即保存，数据只存在本机。" title="设置" />
        <div className="set">
          <SettingsNav />
          <div className="set-main">
            <AppearanceSection />
            <ReminderSection refresh={refresh} settings={settings} />
            <ReviewSection refresh={refresh} settings={settings} />
            <ReviewGroupsPanel refresh={refresh} settings={settings} summary={summary} />
            <Section id="settings-import" title="导入力扣历史"><LeetCodeImportPanel /></Section>
            <DataSection refresh={refresh} settings={settings} summary={summary} />
            <DangerSection refresh={refresh} />
          </div>
        </div>
      </div>
    </SavedProvider>
  );
}

/** 左侧锚点导航（窄屏横向）；滚动时高亮当前区块。 */
function SettingsNav(): React.ReactElement {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id); else visible.delete(entry.target.id);
      }
      const first = SECTIONS.find((section) => visible.has(section.id));
      if (first) setActive(first.id);
    }, { rootMargin: '-80px 0px -60% 0px' });
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  const jump = (id: string): void => {
    setActive(id);
    const target = document.getElementById(id);
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <nav aria-label="设置分区" className="set-nav">
      {SECTIONS.map((section) => (
        <button aria-current={active === section.id ? 'true' : undefined} className={active === section.id ? 'on' : undefined} key={section.id} onClick={() => jump(section.id)} type="button">{section.label}</button>
      ))}
    </nav>
  );
}
