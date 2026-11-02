import { useContext, useState } from 'react';
import type { ExtensionRequest } from '../../../src/domain/messages';
import type { HistoryImportResult, HistoryRatingMode, MasteryRating } from '../../../src/domain/types';
import type { HistoryFetchResult } from '../../../src/leetcode/history-fetcher';
import type { HistoryImportState } from '../../../src/shared/history-import-state';
import { sendExtensionRequest } from '../../../src/shared/messaging';
import { Button, InlineNotice } from '../../../src/ui/components';
import { ratingLabel } from '../../../src/ui/format';
import { HistoryImportContext } from '../useHistoryImport';
import { Panel } from './ViewParts';

const RATINGS: readonly MasteryRating[] = ['AGAIN', 'HARD', 'GOOD', 'EASY'];

type Mode = HistoryRatingMode['mode'];
type HistoryJobRequest = Extract<ExtensionRequest, { readonly type: 'history.start' | 'history.cancel' }>;
interface Notice { readonly text: string; readonly tone: 'error' | 'success' | 'info' }

export function LeetCodeImportPanel(): React.ReactElement {
  const [mode, setMode] = useState<Mode>('uniform');
  const [rating, setRating] = useState<MasteryRating>('GOOD');
  const state = useContext(HistoryImportContext);
  const [error, setError] = useState<string | null>(null);
  const running = state.status === 'running';
  const notice = error ? { tone: 'error' as const, text: error } : stateNotice(state);
  // 导入在后台执行，面板只负责发起/取消并展示后台状态。
  const send = async (request: HistoryJobRequest): Promise<void> => {
    setError(null);
    try {
      await sendExtensionRequest(request);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入请求失败');
    }
  };
  const ratingMode: HistoryRatingMode = mode === 'uniform' ? { mode, rating } : { mode };
  return (
    <Panel title="从力扣导入">
      <p className="panel__hint">读取你在力扣中文站已通过的题目和 AC 记录，导入本地还没有的题目；本地已有的题目保持不变。需要先在本浏览器登录 leetcode.cn。导入时会临时打开一个力扣后台标签页并逐个请求，题目较多时需要几分钟，导入在后台进行，可以切换页面或关闭面板，完成后自动关闭临时标签页。</p>
      <div className="settings-form">
        <div className="setting-row">
          <div><strong>评分方式</strong><p>{modeDescription(mode)}</p></div>
          <div className="import-actions">
            <select aria-label="导入评分方式" disabled={running} onChange={(event) => setMode(event.target.value as Mode)} value={mode}>
              <option value="uniform">统一评为</option>
              <option value="manual">导入后自己补评</option>
            </select>
            {mode === 'uniform' && (
              <select aria-label="统一评分档位" disabled={running} onChange={(event) => setRating(event.target.value as MasteryRating)} value={rating}>
                {RATINGS.map((value) => <option key={value} value={value}>{ratingLabel[value]}</option>)}
              </select>
            )}
          </div>
        </div>
        {running && <InlineNotice>{progressText(state)}</InlineNotice>}
        {!running && notice && <InlineNotice tone={notice.tone}>{notice.text}</InlineNotice>}
        <div className="settings-actions">
          {running
            ? <Button disabled={state.status === 'running' && state.phase === 'committing'} onClick={() => void send({ type: 'history.cancel' })}>取消导入</Button>
            : <Button icon="download" onClick={() => void send({ type: 'history.start', payload: { rating: ratingMode } })} tone="primary">开始导入</Button>}
        </div>
      </div>
    </Panel>
  );
}

function stateNotice(state: HistoryImportState): Notice | null {
  if (state.status === 'done') return resultNotice(state.fetched, state.result, state.rating.mode);
  if (state.status === 'failed') return { tone: 'error', text: state.message };
  if (state.status === 'cancelled') return { tone: 'info', text: '已取消导入，本地数据没有变化。' };
  return null;
}

function modeDescription(mode: Mode): string {
  return mode === 'uniform'
    ? '每题的历史 AC（同一天多次只算一次）都按所选档位计算复习排期。'
    : '每题只导入最近一次 AC，放进待评估队列，由你逐题评分后再生成排期。';
}

function progressText(progress: HistoryImportState): string {
  if (progress.status !== 'running' || progress.phase === 'opening') return '正在打开力扣页面…';
  if (progress.phase === 'committing') return '正在保存导入结果…';
  if (progress.phase === 'problems') return `正在读取已通过题目（${progress.done}/${progress.total}）…`;
  return `正在读取 AC 记录（${progress.done}/${progress.total} 道）…`;
}

function resultNotice(fetched: Omit<HistoryFetchResult, 'problems'>, result: HistoryImportResult | null, mode: Mode): Notice {
  if (result && result.importedProblems > 0) return importedNotice(fetched, result, mode);
  if (fetched.withoutAccepted > 0) {
    return { tone: 'error', text: `有 ${fetched.withoutAccepted} 道已通过题目没有读到可识别的 AC 记录，未导入任何题目。力扣接口可能已调整，请反馈给开发者。` };
  }
  return { tone: 'success', text: `力扣上共 ${fetched.solvedTotal} 道已通过题目，本地都已记录，没有需要导入的新题目。` };
}

function importedNotice(fetched: Omit<HistoryFetchResult, 'problems'>, result: HistoryImportResult, mode: Mode): Notice {
  const kept = fetched.skippedLocal + result.skippedProblems;
  const details = [
    kept > 0 ? `${kept} 道本地已有，保持不变` : '',
    fetched.withoutAccepted > 0 ? `${fetched.withoutAccepted} 道没有读到可识别的 AC 记录` : '',
  ].filter(Boolean);
  const suffix = details.length > 0 ? `；${details.join('，')}` : '';
  const followUp = mode === 'manual' ? '请到待处理队列逐题补评。' : '复习排期已生成。';
  return { tone: 'success', text: `已导入 ${result.importedProblems} 道题、${result.importedSubmissions} 条 AC 记录${suffix}。${followUp}` };
}
