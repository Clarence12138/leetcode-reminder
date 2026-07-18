import { useRef, useState } from 'react';
import type { DailySummary, Settings } from '../../../src/domain/types';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, InlineNotice, PageHeading } from '../../../src/ui/components';
import { parseTimeValue, toTimeValue } from '../../../src/ui/format';
import { downloadJson } from '../../../src/ui/runtime';
import { ConfirmDialog } from './ConfirmDialog';
import { Panel } from './ViewParts';

interface SettingsProps {
  readonly refresh: () => Promise<void>;
  readonly settings: Settings;
  readonly summary: DailySummary;
}

export function SettingsView({ refresh, settings, summary }: SettingsProps): React.ReactElement {
  const [reminderNotice, setReminderNotice] = useState<Notice | null>(null);
  return (
    <div className="view-content settings-view">
      <PageHeading description="调整每日提醒，或管理仅保存在本机的复习数据。" title="设置" />
      <ReminderPanel
        key={`${settings.notificationsEnabled}-${settings.reminderHour}-${settings.reminderMinute}-${settings.timezone}`}
        notice={reminderNotice}
        onNotice={setReminderNotice}
        refresh={refresh}
        settings={settings}
      />
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
    <BackupPanelContent
      busy={busy}
      inputRef={inputRef}
      mode={mode}
      notice={notice}
      onChoose={chooseBackup}
      onConfirm={confirmReplacement}
      onExport={exportBackup}
      onModeChange={setMode}
      onReplacementChange={setReplacement}
      replacement={replacement}
    />
  );
}

interface BackupPanelContentProps {
  readonly busy: boolean;
  readonly inputRef: React.RefObject<HTMLInputElement | null>;
  readonly mode: 'merge' | 'replace';
  readonly notice: Notice | null;
  readonly onChoose: (file: File) => Promise<void>;
  readonly onConfirm: () => Promise<void>;
  readonly onExport: () => Promise<void>;
  readonly onModeChange: (mode: 'merge' | 'replace') => void;
  readonly onReplacementChange: (backup: PendingBackup | null) => void;
  readonly replacement: PendingBackup | null;
}

interface BackupStateSetters {
  readonly setBusy: (busy: boolean) => void;
  readonly setNotice: (notice: Notice | null) => void;
}

interface ImportOptions {
  readonly file: File;
  readonly mode: 'merge' | 'replace';
  readonly refresh: () => Promise<void>;
  readonly setNotice: (notice: Notice | null) => void;
  readonly setReplacement: (backup: PendingBackup | null) => void;
}

interface ReplacementOptions extends BackupStateSetters {
  readonly refresh: () => Promise<void>;
  readonly replacement: PendingBackup | null;
  readonly setReplacement: (backup: PendingBackup | null) => void;
}

function BackupPanelContent({ busy, inputRef, mode, notice, onChoose, onConfirm, onExport, onModeChange, onReplacementChange, replacement }: BackupPanelContentProps): React.ReactElement {
  return (
    <Panel title="备份与恢复">
      <div className="backup-layout">
        <div><h3>导出 JSON 备份</h3><p>包含题目、提交评分、检测异常和设置，不包含提交代码或账号凭据。</p><Button disabled={busy} icon="download" onClick={() => void onExport()}>导出备份</Button></div>
        <div><h3>导入 JSON 备份</h3><p>导入前会完整校验；发现提交 ID 冲突时会终止，不会部分写入。</p><div className="import-actions"><select aria-label="备份导入方式" onChange={(event) => onModeChange(event.target.value as 'merge' | 'replace')} value={mode}><option value="merge">合并导入</option><option value="replace">覆盖恢复</option></select><Button icon="upload" onClick={() => inputRef.current?.click()}>选择备份</Button><input accept="application/json,.json" className="visually-hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void onChoose(file); }} ref={inputRef} type="file" /></div></div>
      </div>
      {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
      {replacement && <ConfirmDialog busy={busy} confirmText="覆盖" description={`覆盖恢复会先删除当前本地数据，再导入 ${replacement.filename}。`} onCancel={() => onReplacementChange(null)} onConfirm={() => void onConfirm()} title="确认覆盖恢复" />}
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

function toErrorNotice(cause: unknown, fallback: string): Notice {
  return { tone: 'error', text: cause instanceof Error ? cause.message : fallback };
}

async function importBackup(backup: unknown, mode: 'merge' | 'replace', refresh: () => Promise<void>): Promise<void> {
  await sendExtensionRequest({ type: 'backup.import', payload: { backup, mode } });
  await refresh();
}
