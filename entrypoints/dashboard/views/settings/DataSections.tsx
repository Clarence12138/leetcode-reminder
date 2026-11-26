import { useRef, useState } from 'react';
import type { DailySummary, Settings } from '../../../../src/domain/types';
import { sendExtensionRequest } from '../../../../src/shared/messaging';
import { Button, InlineNotice, Segmented } from '../../../../src/ui/components';
import { downloadJson } from '../../../../src/ui/runtime';
import { ConfirmDialog } from '../ConfirmDialog';
import { SettingRow, Section } from './parts';
import { toErrorNotice, type Notice } from './use-saver';

type ImportMode = 'merge' | 'replace';
interface PendingBackup { readonly backup: unknown; readonly filename: string }
type Refresh = () => Promise<void>;

const IMPORT_MODES = [
  { value: 'merge', label: '合并导入' },
  { value: 'replace', label: '覆盖恢复' },
] as const;

export function DataSection({ refresh, settings, summary }: { readonly refresh: Refresh; readonly settings: Settings; readonly summary: DailySummary }): React.ReactElement {
  return (
    <Section description="所有数据只保存在这台电脑的浏览器里。" id="settings-data" title="数据">
      <BackupBlock refresh={refresh} />
      <DataOverview settings={settings} summary={summary} />
    </Section>
  );
}

function useBackup(refresh: Refresh) {
  const [mode, setMode] = useState<ImportMode>('merge');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [replacement, setReplacement] = useState<PendingBackup | null>(null);

  const exportBackup = async (): Promise<void> => {
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
  };
  const chooseBackup = async (file: File): Promise<void> => {
    setNotice(null);
    try {
      const backup: unknown = JSON.parse(await file.text());
      if (mode === 'replace') { setReplacement({ backup, filename: file.name }); return; }
      await importBackup(backup, 'merge', refresh);
      setNotice({ tone: 'success', text: `已合并导入 ${file.name}。` });
    } catch (cause) {
      setNotice(toErrorNotice(cause, '备份导入失败'));
    }
  };
  const confirmReplacement = async (): Promise<void> => {
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
  };

  return { busy, chooseBackup, confirmReplacement, exportBackup, mode, notice, replacement, setMode, setReplacement };
}

function BackupBlock({ refresh }: { readonly refresh: Refresh }): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const { busy, chooseBackup, confirmReplacement, exportBackup, mode, notice, replacement, setMode, setReplacement } = useBackup(refresh);
  return (
    <>
      <SettingRow description="包含题目、提交评分、检测异常和设置，不包含提交代码或账号凭据。" label="导出 JSON 备份">
        <Button disabled={busy} icon="download" onClick={() => void exportBackup()} size="sm">导出备份</Button>
      </SettingRow>
      <SettingRow description="导入前会完整校验；发现提交 ID 冲突时会终止，不会部分写入。" label="导入 JSON 备份">
        <Segmented ariaLabel="备份导入方式" onChange={setMode} options={IMPORT_MODES} size="sm" value={mode} />
        <Button icon="upload" onClick={() => inputRef.current?.click()} size="sm">选择备份</Button>
        <input
          accept="application/json,.json"
          aria-label="备份文件"
          className="visually-hidden"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void chooseBackup(file); }}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
      </SettingRow>
      {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
      {replacement && (
        <ConfirmDialog
          busy={busy}
          confirmText="覆盖"
          description={`覆盖恢复会先删除当前本地数据，再导入 ${replacement.filename}。`}
          onCancel={() => setReplacement(null)}
          onConfirm={() => void confirmReplacement()}
          title="确认覆盖恢复"
        />
      )}
    </>
  );
}

function DataOverview({ settings, summary }: { readonly settings: Settings; readonly summary: DailySummary }): React.ReactElement {
  const items = [
    { label: '道题目', value: summary.problems.length },
    { label: '条可见提交', value: summary.recentReviews.length + summary.pendingReviews.length },
    { label: '条异常', value: summary.issues.length },
    { label: '数据版本', value: `v${settings.schemaVersion}` },
  ];
  return (
    <div aria-label="本地数据概况" className="data-overview" role="group">
      {items.map((item) => <span key={item.label}><b>{item.value}</b>{item.label}</span>)}
    </div>
  );
}

export function DangerSection({ refresh }: { readonly refresh: Refresh }): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const clearData = async (): Promise<void> => {
    setBusy(true);
    try {
      await sendExtensionRequest({ type: 'data.clear' });
      await refresh();
      setNotice({ tone: 'success', text: '所有本地复习数据已清空。' });
    } catch (cause) {
      setNotice(toErrorNotice(cause, '清空数据失败'));
    } finally {
      setConfirming(false);
      setBusy(false);
    }
  };
  return (
    <Section className="danger-sec" description="以下操作无法撤销。" id="settings-danger" title="危险操作">
      <SettingRow description="删除所有题目、提交、复习排期和异常记录。此操作无法撤销。" label="清空全部数据">
        <Button icon="trash" onClick={() => setConfirming(true)} size="sm" tone="danger">清空全部数据</Button>
      </SettingRow>
      {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
      {confirming && (
        <ConfirmDialog
          busy={busy}
          confirmText="清空"
          description="这会永久删除当前浏览器中的所有小刷记数据。"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void clearData()}
          title="确认清空全部数据"
        />
      )}
    </Section>
  );
}

async function importBackup(backup: unknown, mode: ImportMode, refresh: Refresh): Promise<void> {
  await sendExtensionRequest({ type: 'backup.import', payload: { backup, mode } });
  await refresh();
}
