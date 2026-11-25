import { useRef, useState } from 'react';
import type { DailySummary, QueueSortStrategy, Settings } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, InlineNotice, PageHeading } from '../../../src/ui/components';
import { parseTimeValue, toTimeValue } from '../../../src/ui/format';
import { downloadJson } from '../../../src/ui/runtime';
import { ConfirmDialog } from './ConfirmDialog';
import { LeetCodeImportPanel } from './LeetCodeImportPanel';
import { ReviewGroupsPanel } from './ReviewGroupsPanel';
import { Panel } from './ViewParts';

interface SettingsProps {
  readonly refresh: () => Promise<void>;
  readonly settings: Settings;
  readonly summary: DailySummary;
}

const DAILY_LIMIT_PRESETS: readonly (number | null)[] = [null, 3, 5, 8];

export function SettingsView({ refresh, settings, summary }: SettingsProps): React.ReactElement {
  const [reminderNotice, setReminderNotice] = useState<Notice | null>(null);
  return (
    <div className="view-content settings-view">
      <PageHeading description="调整每日提醒、复习配额、分组目标保持率，或管理仅保存在本机的复习数据。" title="设置" />
      <ReminderPanel
        key={`${settings.notificationsEnabled}-${settings.reminderHour}-${settings.reminderMinute}-${settings.timezone}`}
        notice={reminderNotice}
        onNotice={setReminderNotice}
        refresh={refresh}
        settings={settings}
      />
      <ReviewPanel
        key={`${settings.resetCodeOnReview}-${settings.dailyReviewLimit ?? 'none'}-${settings.queueSortStrategy}`}
        refresh={refresh}
        settings={settings}
      />
      <ReviewGroupsPanel refresh={refresh} settings={settings} summary={summary} />
      <LeetCodeImportPanel />
      <BackupPanel refresh={refresh} />
      <DataOverview settings={settings} summary={summary} />
      <DangerZone refresh={refresh} />
    </div>
  );
}

function ReminderPanel({ notice, onNotice, refresh, settings }: { readonly notice: Notice | null; readonly onNotice: (notice: Notice | null) => void; readonly refresh: () => Promise<void>; readonly settings: Settings }): React.ReactElement {
  const [enabled, setEnabled] = useState(settings.notificationsEnabled);
  const [time, setTime] = useState(toTimeValue(settings.reminderHour, settings.reminderMinute));
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    onNotice(null);
    try {
      const { hour, minute } = parseTimeValue(time);
      await sendExtensionRequest({ type: 'settings.update', payload: { notificationsEnabled: enabled, reminderHour: hour, reminderMinute: minute } });
      await refresh();
      onNotice({ tone: 'success', text: '提醒设置已保存，下一次提醒已重新计算。' });
    } catch (cause) {
      onNotice(toErrorNotice(cause, '提醒设置保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const testNotification = async (): Promise<void> => {
    onNotice(null);
    try {
      await sendExtensionRequest({ type: 'notification.test' });
      onNotice({ tone: 'success', text: 'Chrome 通知 API 已成功创建测试通知；系统是否展示取决于操作系统通知设置。' });
    } catch (cause) {
      onNotice(toErrorNotice(cause, '测试通知创建失败'));
    }
  };

  return (
    <Panel title="每日提醒">
      <div className="settings-form">
        <SettingRow description="每天按当前时区汇总到期题目和待评估提交。" label="启用复习通知">
          <label className="switch"><input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /><span /></label>
        </SettingRow>
        <SettingRow description={`当前时区：${settings.timezone}`} label="提醒时间">
          <input aria-label="每日提醒时间" className="time-input" disabled={!enabled} onChange={(event) => setTime(event.target.value)} type="time" value={time} />
        </SettingRow>
        {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
        <div className="settings-actions"><Button onClick={() => void testNotification()}>发送测试通知</Button><Button disabled={saving} onClick={() => void save()} tone="primary">{saving ? '保存中…' : '保存设置'}</Button></div>
      </div>
    </Panel>
  );
}

function ReviewPanel({ refresh, settings }: { readonly refresh: () => Promise<void>; readonly settings: Settings }): React.ReactElement {
  const [resetEnabled, setResetEnabled] = useState(settings.resetCodeOnReview);
  const [limitText, setLimitText] = useState(settings.dailyReviewLimit === null ? '' : String(settings.dailyReviewLimit));
  const { notice, saving, setNotice, updatePatch } = useSettingsPatch(refresh);

  const toggleReset = async (next: boolean): Promise<void> => {
    setResetEnabled(next);
    if (!(await updatePatch({ resetCodeOnReview: next }))) setResetEnabled(!next);
  };
  const applyDailyLimit = async (limit: number | null): Promise<void> => {
    setLimitText(limit === null ? '' : String(limit));
    await updatePatch({ dailyReviewLimit: limit }, limit === null ? '已取消每日复习配额限制。' : `今日复习配额已设为每天 ${limit} 题。`);
  };
  const applyCustomLimit = async (): Promise<void> => {
    const parsed = parseDailyLimitInput(limitText);
    if (parsed === 'invalid') { setNotice({ tone: 'error', text: '每日配额需为 1–200 之间的整数，或留空表示不限。' }); return; }
    await applyDailyLimit(parsed);
  };
  return (
    <Panel title="复习">
      <div className="settings-form">
        <SettingRow description="仅从首页或待处理队列打开今日/逾期题目时生效。打开后会先遮住编辑器再还原，避免看到上次写的代码。历史提交仍保留在力扣中。" label="打开复习题时还原代码模板">
          <label className="switch"><input aria-label="打开复习题时还原代码模板" checked={resetEnabled} disabled={saving} onChange={(event) => void toggleReset(event.target.checked)} type="checkbox" /><span /></label>
        </SettingRow>
        <DailyLimitRow currentLimit={settings.dailyReviewLimit} limitText={limitText} onApplyCustom={() => void applyCustomLimit()} onLimitTextChange={setLimitText} onSelectPreset={(limit) => void applyDailyLimit(limit)} saving={saving} />
        <SettingRow description="默认按最早到期时间排序；积压较多时可切换为智能优先，先复习高频分组、薄弱题和近期新题。" label="队列排序策略">
          <select aria-label="默认队列排序策略" className="setting-select" disabled={saving} onChange={(event) => void updatePatch({ queueSortStrategy: event.target.value as QueueSortStrategy }, '队列排序策略已保存。')} value={settings.queueSortStrategy}>
            <option value="due_asc">最早到期优先（默认）</option>
            <option value="priority">智能优先（高保持率 / 薄弱 / 难题）</option>
            <option value="stability_asc">薄弱与新题优先</option>
          </select>
        </SettingRow>
        {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
      </div>
    </Panel>
  );
}

function DailyLimitRow({ currentLimit, limitText, onApplyCustom, onLimitTextChange, onSelectPreset, saving }: {
  readonly currentLimit: number | null;
  readonly limitText: string;
  readonly onApplyCustom: () => void;
  readonly onLimitTextChange: (value: string) => void;
  readonly onSelectPreset: (limit: number | null) => void;
  readonly saving: boolean;
}): React.ReactElement {
  return (
    <SettingRow description="设置后，队列只优先展示今日配额题数，完成即清零扩展角标；其余积压题会折叠保留，想多刷可随时展开。" label="今日复习配额">
      <div className="quota-controls">
        <div className="preset-group">
          {DAILY_LIMIT_PRESETS.map((preset) => (
            <button className={`preset-pill${currentLimit === preset ? ' is-active' : ''}`} disabled={saving} key={preset ?? 'unlimited'} onClick={() => onSelectPreset(preset)} type="button">
              {preset === null ? '不限' : `${preset} 题`}
            </button>
          ))}
        </div>
        <div className="quota-custom">
          <input aria-label="自定义每日复习配额" disabled={saving} max={200} min={1} onChange={(event) => onLimitTextChange(event.target.value)} placeholder="自定义" type="number" value={limitText} />
          <Button disabled={saving} onClick={onApplyCustom}>应用</Button>
        </div>
      </div>
    </SettingRow>
  );
}

function useSettingsPatch(refresh: () => Promise<void>) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const updatePatch = async (patch: Partial<Settings>, successText?: string): Promise<boolean> => {
    setSaving(true);
    setNotice(null);
    try {
      await sendExtensionRequest({ type: 'settings.update', payload: patch });
      await refresh();
      if (successText) setNotice({ tone: 'success', text: successText });
      return true;
    } catch (cause) {
      setNotice(toErrorNotice(cause, '复习设置保存失败'));
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { notice, saving, setNotice, updatePatch };
}

function parseDailyLimitInput(value: string): number | null | 'invalid' {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 200 ? parsed : 'invalid';
}

function BackupPanel({ refresh }: { readonly refresh: () => Promise<void> }): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [replacement, setReplacement] = useState<PendingBackup | null>(null);

  const exportBackup = (): Promise<void> => performExport({ setBusy, setNotice });
  const chooseBackup = (file: File): Promise<void> => performImport({ file, mode, refresh, setNotice, setReplacement });
  const confirmReplacement = (): Promise<void> => performReplacement({ refresh, replacement, setBusy, setNotice, setReplacement });

  return (
    <Panel title="备份与恢复">
      <div className="backup-layout">
        <div><h3>导出 JSON 备份</h3><p>包含题目、提交评分、检测异常和设置，不包含提交代码或账号凭据。</p><Button disabled={busy} icon="download" onClick={() => void exportBackup()}>导出备份</Button></div>
        <div><h3>导入 JSON 备份</h3><p>导入前会完整校验；发现提交 ID 冲突时会终止，不会部分写入。</p><div className="import-actions"><select aria-label="备份导入方式" onChange={(event) => setMode(event.target.value as 'merge' | 'replace')} value={mode}><option value="merge">合并导入</option><option value="replace">覆盖恢复</option></select><Button icon="upload" onClick={() => inputRef.current?.click()}>选择备份</Button><input accept="application/json,.json" className="visually-hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseBackup(file); }} ref={inputRef} type="file" /></div></div>
      </div>
      {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
      {replacement && <ConfirmDialog busy={busy} confirmText="覆盖" description={`覆盖恢复会先删除当前本地数据，再导入 ${replacement.filename}。`} onCancel={() => setReplacement(null)} onConfirm={() => void confirmReplacement()} title="确认覆盖恢复" />}
    </Panel>
  );
}

async function performExport({ setBusy, setNotice }: BackupStateSetters): Promise<void> {
  setBusy(true);
  setNotice(null);
  try {
    const backup = await sendExtensionRequest({ type: 'backup.export' });
    downloadJson(backup, `xiaoshuaji-backup-${backup.exportedAt.slice(0, 10)}.json`);
    setNotice({ tone: 'success', text: '备份已生成并下载。' });
  } catch (cause) {
    setNotice(toErrorNotice(cause, '备份导出失败'));
  } finally {
    setBusy(false);
  }
}

async function performImport({ file, mode, refresh, setNotice, setReplacement }: ImportOptions): Promise<void> {
  setNotice(null);
  try {
    const backup: unknown = JSON.parse(await file.text());
    if (mode === 'replace') { setReplacement({ backup, filename: file.name }); return; }
    await importBackup(backup, 'merge', refresh);
    setNotice({ tone: 'success', text: `已合并导入 ${file.name}。` });
  } catch (cause) {
    setNotice(toErrorNotice(cause, '备份导入失败'));
  }
}

async function performReplacement(options: ReplacementOptions): Promise<void> {
  const { refresh, replacement, setBusy, setNotice, setReplacement } = options;
  if (!replacement) return;
  setBusy(true);
  try {
    await importBackup(replacement.backup, 'replace', refresh);
    setNotice({ tone: 'success', text: `已使用 ${replacement.filename} 覆盖恢复。` });
  } catch (cause) {
    setNotice(toErrorNotice(cause, '覆盖恢复失败'));
  } finally {
    setReplacement(null);
    setBusy(false);
  }
}

function DataOverview({ settings, summary }: { readonly settings: Settings; readonly summary: DailySummary }): React.ReactElement {
  return (
    <Panel title="本地数据概况"><div className="data-overview"><span><strong>{summary.problems.length}</strong>道题目</span><span><strong>{summary.recentReviews.length + summary.pendingReviews.length}</strong>条可见提交</span><span><strong>{summary.issues.length}</strong>条异常</span><span><strong>v{settings.schemaVersion}</strong>数据版本</span></div></Panel>
  );
}

function DangerZone({ refresh }: { readonly refresh: () => Promise<void> }): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const clearData = async (): Promise<void> => {
    setBusy(true);
    try {
      await sendExtensionRequest({ type: 'data.clear' });
      await refresh();
      setConfirming(false);
      setNotice({ tone: 'success', text: '所有本地复习数据已清空。' });
    } catch (cause) {
      setNotice(toErrorNotice(cause, '清空数据失败'));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="danger-panel" title="危险操作"><div className="danger-row"><div><strong>清空全部数据</strong><p>删除所有题目、提交、复习排期和异常记录。此操作无法撤销。</p></div><Button icon="trash" onClick={() => setConfirming(true)} tone="danger">清空全部数据</Button></div>{notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}{confirming && <ConfirmDialog busy={busy} confirmText="清空" description="这会永久删除当前浏览器中的所有小刷记数据。" onCancel={() => setConfirming(false)} onConfirm={() => void clearData()} title="确认清空全部数据" />}</Panel>
  );
}

function SettingRow({ children, description, label }: React.PropsWithChildren<{ readonly description: string; readonly label: string }>): React.ReactElement {
  return <div className="setting-row"><div><strong>{label}</strong><p>{description}</p></div>{children}</div>;
}

interface Notice { readonly text: string; readonly tone: 'error' | 'success' }
interface PendingBackup { readonly backup: unknown; readonly filename: string }
interface BackupStateSetters { readonly setBusy: (busy: boolean) => void; readonly setNotice: (notice: Notice | null) => void }
interface ImportOptions { readonly file: File; readonly mode: 'merge' | 'replace'; readonly refresh: () => Promise<void>; readonly setNotice: (notice: Notice | null) => void; readonly setReplacement: (backup: PendingBackup | null) => void }
interface ReplacementOptions extends BackupStateSetters { readonly refresh: () => Promise<void>; readonly replacement: PendingBackup | null; readonly setReplacement: (backup: PendingBackup | null) => void }

function toErrorNotice(cause: unknown, fallback: string): Notice {
  return { tone: 'error', text: cause instanceof Error ? cause.message : fallback };
}

async function importBackup(backup: unknown, mode: 'merge' | 'replace', refresh: () => Promise<void>): Promise<void> {
  await sendExtensionRequest({ type: 'backup.import', payload: { backup, mode } });
  await refresh();
}
