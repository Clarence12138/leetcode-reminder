import { useState } from 'react';
import type { Settings } from '../../../../src/domain/types';
import { sendExtensionRequest } from '../../../../src/shared/messaging';
import { Button, InlineNotice, Switch } from '../../../../src/ui/components';
import { parseTimeValue, toTimeValue } from '../../../../src/ui/format';
import { SettingRow, Section } from './parts';
import { toErrorNotice, useDraft, useSettingsSaver, type Notice } from './use-saver';

export function ReminderSection({ refresh, settings }: { readonly refresh: () => Promise<void>; readonly settings: Settings }): React.ReactElement {
  const { error, save, saving, setError } = useSettingsSaver(refresh, '提醒设置保存失败');
  const [enabled, setEnabled, rollbackEnabled] = useDraft(settings.notificationsEnabled);
  const savedTime = toTimeValue(settings.reminderHour, settings.reminderMinute);
  const [time, setTime, rollbackTime] = useDraft(savedTime);
  const { send: testNotification, notice: testNotice } = useTestNotification();

  const toggle = async (next: boolean): Promise<void> => {
    setEnabled(next);
    if (!(await save({ notificationsEnabled: next }))) rollbackEnabled();
  };
  const commitTime = async (): Promise<void> => {
    if (time === savedTime) return;
    let parsed: { readonly hour: number; readonly minute: number };
    try {
      parsed = parseTimeValue(time);
    } catch {
      rollbackTime();
      setError('请输入有效的提醒时间');
      return;
    }
    if (!(await save({ reminderHour: parsed.hour, reminderMinute: parsed.minute }))) rollbackTime();
  };
  const notice = error ? { tone: 'error' as const, text: error } : testNotice;
  return (
    <Section description="每天汇总一次到期题目和待评估提交。" id="settings-reminder" title="提醒">
      <SettingRow description="每天按当前时区汇总到期题目和待评估提交。" label="启用复习通知">
        <Switch checked={enabled} disabled={saving} label="启用复习通知" onChange={(next) => void toggle(next)} />
      </SettingRow>
      <SettingRow description={`当前时区：${settings.timezone}；修改后移开焦点或按回车保存`} label="提醒时间">
        <label className="field timef">
          <input
            aria-label="每日提醒时间"
            disabled={!enabled || saving}
            onBlur={() => void commitTime()}
            onChange={(event) => setTime(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void commitTime(); }}
            type="time"
            value={time}
          />
        </label>
      </SettingRow>
      <SettingRow description="发一条测试通知，确认浏览器通知可用" label="测试通知">
        <Button onClick={() => void testNotification()} size="sm">发送测试通知</Button>
      </SettingRow>
      {notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
    </Section>
  );
}

function useTestNotification() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const send = async (): Promise<void> => {
    setNotice(null);
    try {
      await sendExtensionRequest({ type: 'notification.test' });
      setNotice({ tone: 'success', text: 'Chrome 通知 API 已成功创建测试通知；系统是否展示取决于操作系统通知设置。' });
    } catch (cause) {
      setNotice(toErrorNotice(cause, '测试通知创建失败'));
    }
  };
  return { notice, send };
}
