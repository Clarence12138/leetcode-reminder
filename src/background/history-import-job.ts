import type { HistoryImportResult, HistoryRatingMode, LeetCodeHistoryProblem } from '../domain/types';
import type { HistoryFetchResult } from '../leetcode/history-fetcher';
import { HISTORY_IMPORT_STATE_KEY, type HistoryImportState } from '../shared/history-import-state';
import type { LeetCodeHistoryRequest } from './leetcode-history';

interface JobPorts {
  readonly storage: { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };
  readonly skipSlugs: () => Promise<readonly string[]>;
  readonly fetch: (request: LeetCodeHistoryRequest) => Promise<HistoryFetchResult>;
  readonly closeTab: (id: number) => Promise<void>;
  readonly commit: (problems: readonly LeetCodeHistoryProblem[], rating: HistoryRatingMode) => Promise<HistoryImportResult>;
}

/** 后台单实例导入任务：状态写入 session storage，面板关闭或切页都不影响执行。 */
export class HistoryImportJob {
  private state: HistoryImportState = { status: 'idle' };
  private controller: AbortController | null = null;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly ports: JobPorts) {}

  async recover(): Promise<void> {
    const saved = (await this.ports.storage.get(HISTORY_IMPORT_STATE_KEY))[HISTORY_IMPORT_STATE_KEY] as HistoryImportState | undefined;
    if (saved?.status !== 'running') return;
    if (saved.tabId !== null) await this.ports.closeTab(saved.tabId).catch(() => undefined);
    await this.publish({ status: 'failed', message: '导入被中断，本地已有的题目再次导入时会自动跳过，可以重新开始。' });
  }

  async start(rating: HistoryRatingMode): Promise<void> {
    if (this.controller) throw new Error('已有导入正在进行，请等待完成或取消后重试。');
    const controller = new AbortController();
    this.controller = controller;
    try {
      await this.publish({ status: 'running', phase: 'opening', done: 0, total: 0, tabId: null, startedAt: Date.now() });
    } catch (error) {
      this.controller = null;
      throw error;
    }
    void this.run(rating, controller).catch((error: unknown) => console.error('[小刷记] 保存导入状态失败', error));
  }

  cancel(): void {
    if (this.state.status === 'running' && this.state.phase !== 'committing') this.controller?.abort();
  }

  private async run(rating: HistoryRatingMode, controller: AbortController): Promise<void> {
    try {
      const skipSlugs = await this.ports.skipSlugs();
      controller.signal.throwIfAborted();
      const fetched = await this.ports.fetch({
        skipSlugs, signal: controller.signal,
        onTab: (tabId) => this.update({ tabId }),
        onProgress: (progress) => { void this.update(progress).catch(() => controller.abort()); },
      });
      controller.signal.throwIfAborted();
      // 在任何异步等待前锁定提交阶段，避免取消与写库交错。
      await this.update({ phase: 'committing' });
      const result = fetched.problems.length ? await this.ports.commit(fetched.problems, rating) : null;
      const { solvedTotal, skippedLocal, withoutAccepted } = fetched;
      await this.publish({ status: 'done', fetched: { solvedTotal, skippedLocal, withoutAccepted }, result, rating });
    } catch (error) {
      await this.publish(controller.signal.aborted
        ? { status: 'cancelled' }
        : { status: 'failed', message: error instanceof Error ? error.message : '从力扣导入失败' });
    } finally {
      this.controller = null;
    }
  }

  private update(patch: Partial<Extract<HistoryImportState, { status: 'running' }>>): Promise<void> {
    if (this.state.status !== 'running') return Promise.resolve();
    return this.publish({ ...this.state, ...patch });
  }

  private publish(state: HistoryImportState): Promise<void> {
    this.state = state;
    // 进度回调不可等待；串行持久化，防止旧进度覆盖终态。
    this.writes = this.writes.catch(() => undefined).then(() => this.ports.storage.set({ [HISTORY_IMPORT_STATE_KEY]: state }));
    return this.writes;
  }
}
