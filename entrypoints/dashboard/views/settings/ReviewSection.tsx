import { useState } from 'react';
import type { QueueSortStrategy, Settings } from '../../../../src/domain/types';
import { InlineNotice, Segmented, Switch } from '../../../../src/ui/components';
import { RetentionStepper } from './RetentionStepper';
import { SettingRow, Section } from './parts';
import { useDraft, useSettingsSaver } from './use-saver';

const LIMIT_PRESETS = [null, 3, 5, 8] as const;
type LimitChoice = 'none' | '3' | '5' | '8' | 'custom';

const LIMIT_OPTIONS: readonly { readonly value: LimitChoice; readonly label: string }[] = [
  { value: 'none', label: '不限' },
  { value: '3', label: '3 题' },
  { value: '5', label: '5 题' },
  { value: '8', label: '8 题' },
  { value: 'custom', label: '自定义' },
];

const SORT_OPTIONS: readonly { readonly value: QueueSortStrategy; readonly label: string }[] = [
  { value: 'due_asc', label: '最早到期优先（默认）' },
  { value: 'priority', label: '智能优先（高保持率 / 薄弱 / 难题）' },
  { value: 'stability_asc', label: '薄弱与新题优先' },
];

export function ReviewSection({ refresh, settings }: { readonly refresh: () => Promise<void>; readonly settings: Settings }): React.ReactElement {
  const { error, save, saving, setError } = useSettingsSaver(refresh, '复习设置保存失败');
  const [reset, setReset, rollbackReset] = useDraft(settings.resetCodeOnReview);
  const [sort, setSort, rollbackSort] = useDraft<QueueSortStrategy>(settings.queueSortStrategy);

  const toggleReset = async (next: boolean): Promise<void> => {
    setReset(next);
    if (!(await save({ resetCodeOnReview: next }))) rollbackReset();
  };
  const changeSort = async (next: QueueSortStrategy): Promise<void> => {
    setSort(next);
    if (!(await save({ queueSortStrategy: next }))) rollbackSort();
  };
  return (
    <Section description="控制每天的量、顺序和保持率。" id="settings-review" title="复习">
      <DailyLimitRow limit={settings.dailyReviewLimit} onError={setError} onSave={save} saving={saving} />
      <SettingRow description="默认按最早到期排序；积压较多时可切换为智能优先，先复习高频分组、薄弱题和近期新题。" label="队列排序策略">
        <select aria-label="默认队列排序策略" className="select" disabled={saving} onChange={(event) => void changeSort(event.target.value as QueueSortStrategy)} value={sort}>
          {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </SettingRow>
      <SettingRow description="保持率越高复习越频繁、负担越重；分组可以单独设置。" label="默认目标保持率">
        <RetentionStepper
          label="默认保持率"
          onCommit={(value) => save({ defaultRequestRetention: value })}
          value={settings.defaultRequestRetention}
        />
      </SettingRow>
      <SettingRow description="仅从概览或待处理队列打开今日/逾期题目时生效：先遮住编辑器再还原，避免看到上次写的代码。历史提交仍保留在力扣中。" label="打开复习题时还原代码模板">
        <Switch checked={reset} disabled={saving} label="打开复习题时还原代码模板" onChange={(next) => void toggleReset(next)} />
      </SettingRow>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </Section>
  );
}

function choiceOf(limit: number | null): LimitChoice {
  const preset = LIMIT_PRESETS.find((item) => item === limit);
  return preset === undefined ? 'custom' : preset === null ? 'none' : (String(preset) as LimitChoice);
}

function DailyLimitRow({ limit, onError, onSave, saving }: {
  readonly limit: number | null;
  readonly onError: (message: string | null) => void;
  readonly onSave: (patch: { readonly dailyReviewLimit: number | null }) => Promise<boolean>;
  readonly saving: boolean;
}): React.ReactElement {
  const [limitDraft, setLimitDraft, rollbackLimit] = useDraft(limit);
  const [customOpen, setCustomOpen] = useState(false);
  const choice: LimitChoice = customOpen ? 'custom' : choiceOf(limitDraft);

  const apply = async (next: number | null): Promise<void> => {
    onError(null);
    setLimitDraft(next);
    if (!(await onSave({ dailyReviewLimit: next }))) rollbackLimit();
  };
  const select = (value: LimitChoice): void => {
    setCustomOpen(value === 'custom');
    if (value !== 'custom') void apply(value === 'none' ? null : Number(value));
  };
  const commitCustom = (parsed: number): void => {
    setCustomOpen(choiceOf(parsed) === 'custom');
    if (parsed !== limitDraft) void apply(parsed);
  };
  return (
    <SettingRow description="超出配额的到期题会折叠为积压，完成配额即清零扩展角标，想多刷随时展开。" label="今日复习配额">
      <div className="quota-controls">
        <Segmented ariaLabel="今日复习配额" disabled={saving} onChange={select} options={LIMIT_OPTIONS} size="sm" value={choice} />
        {choice === 'custom' && (
          <CustomLimitInput disabled={saving} initial={limitDraft !== null && choiceOf(limitDraft) === 'custom' ? String(limitDraft) : ''} onCommit={commitCustom} onError={onError} />
        )}
      </div>
    </SettingRow>
  );
}

/** 自定义配额：输入完成（失焦或回车）后校验并提交。 */
function CustomLimitInput({ disabled, initial, onCommit, onError }: {
  readonly disabled: boolean;
  readonly initial: string;
  readonly onCommit: (value: number) => void;
  readonly onError: (message: string | null) => void;
}): React.ReactElement {
  const [state, setState] = useState({ seen: initial, text: initial });
  // 外层值变化（比如保存失败回滚）时，输入框跟着回到该值。
  if (state.seen !== initial) setState({ seen: initial, text: initial });
  const text = state.seen === initial ? state.text : initial;
  const setText = (next: string): void => setState({ seen: initial, text: next });
  const commit = (): void => {
    const parsed = Number(text.trim());
    if (!text.trim() || !Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
      onError('每日配额需为 1–200 之间的整数。');
      return;
    }
    onError(null);
    onCommit(parsed);
  };
  return (
    <input
      aria-label="自定义每日复习配额"
      autoFocus
      className="input quota-input"
      disabled={disabled}
      max={200}
      min={1}
      onBlur={commit}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
      placeholder="1–200"
      type="number"
      value={text}
    />
  );
}
