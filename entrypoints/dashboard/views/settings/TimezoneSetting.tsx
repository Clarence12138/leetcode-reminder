import { useMemo } from 'react';
import { runtimeTimezone } from '../../../../src/domain/day-keys';
import type { Settings } from '../../../../src/domain/types';
import { Switch } from '../../../../src/ui/components';
import { SearchableSelect } from '../../../../src/ui/searchable-select';
import { buildTimezoneOptions, describeZone } from '../../../../src/ui/timezones';
import { SettingRow } from './parts';
import { useDraft } from './use-saver';

interface TimezoneSettingProps {
  readonly settings: Settings;
  readonly saving: boolean;
  readonly save: (patch: Partial<Settings>) => Promise<boolean>;
}

/** 时区：默认跟随系统；关闭后可从全部 IANA 时区里搜索选择，影响“今天”的划分和每日提醒时间。 */
export function TimezoneSetting({ save, saving, settings }: TimezoneSettingProps): React.ReactElement {
  const [followSystem, setFollowSystem, rollbackFollow] = useDraft(settings.timezoneMode === 'system');
  const system = runtimeTimezone();
  const toggle = async (next: boolean): Promise<void> => {
    setFollowSystem(next);
    if (!(await save({ timezoneMode: next ? 'system' : 'manual' }))) rollbackFollow();
  };
  return (
    <>
      <SettingRow
        description={followSystem ? `当前：${describeZone(system)}` : `系统时区为 ${describeZone(system)}`}
        label="跟随系统时区"
      >
        <Switch checked={followSystem} disabled={saving} label="跟随系统时区" onChange={(next) => void toggle(next)} />
      </SettingRow>
      {!followSystem && <ManualZoneRow save={save} settings={settings} />}
    </>
  );
}

/** 保存期间不禁用触发器：禁用会让刚选完的焦点丢失，后台写设置本身是串行的。 */
function ManualZoneRow({ save, settings }: Omit<TimezoneSettingProps, 'saving'>): React.ReactElement {
  const [zone, setZone, rollbackZone] = useDraft(settings.timezone);
  const options = useMemo(() => buildTimezoneOptions([settings.timezone]), [settings.timezone]);
  const choose = async (next: string): Promise<void> => {
    setZone(next);
    if (!(await save({ timezone: next }))) rollbackZone();
  };
  return (
    <SettingRow description="按该时区划分“今天”并触发每日提醒" label="手动时区">
      <SearchableSelect
        align="right"
        ariaLabel="手动时区"
        className="tz-trigger"
        emptyText="没有匹配的时区"
        onChange={(next) => void choose(next)}
        options={options}
        searchPlaceholder="搜索城市、时区或偏移，如 东京、+8"
        value={zone}
      />
    </SettingRow>
  );
}
