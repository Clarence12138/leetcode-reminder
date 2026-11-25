import type { ExtensionRequest, ExtensionResponse } from '../domain/messages';
import { parseExtensionRequest } from '../domain/schemas';
import type { Difficulty, Settings } from '../domain/types';
import type { BackupManager } from './backup';
import { toPublicError } from './errors';
import { importLeetCodeHistory } from './history-import';
import type { HistoryImportJob } from './history-import-job';
import type { DataMirror } from './mirror';
import type { ReminderCoordinator } from './reminders';
import type { SettingsRepository } from './settings';
import type { DashboardFilter, ReviewStore } from './store';

export interface BackgroundServices {
  readonly store: ReviewStore;
  readonly settings: SettingsRepository;
  readonly backups: BackupManager;
  readonly reminders: ReminderCoordinator;
  readonly mirror?: DataMirror;
  readonly historyJob?: Pick<HistoryImportJob, 'start' | 'cancel'>;
}

const READ_ONLY_REQUESTS: ReadonlySet<ExtensionRequest['type']> = new Set([
  'history.start',
  'history.cancel',
  'review.preview',
  'dashboard.query',
  'settings.get',
  'settings.update',
  'backup.export',
  'notification.test',
]);

export function createMessageHandler(services: BackgroundServices) {
  return async (rawRequest: unknown): Promise<ExtensionResponse> => {
    try {
      const request = parseExtensionRequest(rawRequest) as ExtensionRequest;
      try {
        const data = await dispatchRequest(request, services);
        return data === undefined ? { ok: true } : { ok: true, data };
      } finally {
        // 即使后续步骤失败，主数据可能已经写入，镜像仍需跟上。
        if (!READ_ONLY_REQUESTS.has(request.type)) await syncMirror(services.mirror);
      }
    } catch (error) {
      return { ok: false, error: toPublicError(error) };
    }
  };
}

async function dispatchRequest(
  request: ExtensionRequest,
  services: BackgroundServices,
): Promise<unknown> {
  switch (request.type) {
    case 'history.start':
    case 'history.cancel':
      return dispatchHistoryJob(request, services);
    case 'submission.accepted': {
      const result = await services.store.recordAccepted(request.payload);
      await services.reminders.refreshBadge();
      return result;
    }
    case 'submission.rate': {
      const result = await services.store.rateSubmission(
        request.payload.submissionId,
        request.payload.rating,
      );
      await services.reminders.refreshBadge();
      return result;
    }
    case 'submission.discard': {
      const result = await services.store.discardSubmission(request.payload.submissionId);
      await services.reminders.refreshBadge();
      return result;
    }
    case 'review.preview':
      return services.store.preview(request.payload.problemId, request.payload.submissionId);
    case 'dashboard.query':
      return services.store.queryDashboard(toDashboardFilter(request.payload));
    case 'settings.get':
      return services.settings.get();
    case 'settings.update':
      return handleSettingsUpdate(request.payload, services);
    default:
      return dispatchMaintenanceRequest(request, services);
  }
}

type MaintenanceRequest = Exclude<
  ExtensionRequest,
  {
    readonly type:
      | 'history.start'
      | 'history.cancel'
      | 'submission.accepted'
      | 'submission.rate'
      | 'submission.discard'
      | 'review.preview'
      | 'dashboard.query'
      | 'settings.get'
      | 'settings.update';
  }
>;

async function dispatchMaintenanceRequest(
  request: MaintenanceRequest,
  services: BackgroundServices,
): Promise<unknown> {
  switch (request.type) {
    case 'backup.export':
      return services.backups.export();
    case 'backup.import': {
      const backup = await services.backups.import(request.payload.backup, request.payload.mode);
      await services.reminders.initialize();
      return backup;
    }
    case 'history.import': {
      const settings = await services.settings.get();
      const result = await importLeetCodeHistory(services.store, {
        ...request.payload,
        timezone: settings.timezone,
        settings,
        now: Date.now(),
      });
      await services.reminders.refreshBadge().catch((error: unknown) => console.error('[小刷记] 刷新徽标失败', error));
      return result;
    }
    case 'issue.record':
      return services.store.recordIssue(request.payload);
    case 'issue.mark-read':
      return services.store.markIssuesRead(request.payload.issueIds);
    case 'issue.resolve':
      return services.store.resolveIssues(request.payload.issueIds);
    case 'notification.test':
      return services.reminders.testNotification();
    case 'data.clear':
      await services.store.clear();
      await services.settings.reset();
      await services.reminders.initialize();
      return undefined;
    default:
      return dispatchProblemMutationRequest(request, services);
  }
}

type ProblemMutationRequest = Extract<
  MaintenanceRequest,
  { readonly type: 'problem.delete' | 'problem.set-paused' | 'problem.set-group' | 'problem.apply-list-group' }
>;

async function dispatchProblemMutationRequest(
  request: ProblemMutationRequest,
  services: BackgroundServices,
): Promise<unknown> {
  let result: unknown;
  switch (request.type) {
    case 'problem.delete':
      result = await services.store.deleteProblems(request.payload.problemIds);
      break;
    case 'problem.set-paused':
      result = await services.store.setProblemsPaused(
        request.payload.problemIds,
        request.payload.paused,
      );
      break;
    case 'problem.set-group':
      result = await services.store.setProblemsGroup(
        request.payload.problemIds,
        request.payload.groupId,
      );
      break;
    case 'problem.apply-list-group':
      result = await services.store.applyListGroup(
        request.payload.listIds,
        request.payload.groupId,
      );
      break;
    default:
      return assertNever(request);
  }
  await services.reminders.refreshBadge();
  return result;
}

async function handleSettingsUpdate(
  patch: Partial<Settings>,
  services: BackgroundServices,
): Promise<Settings> {
  const previous = await services.settings.get();
  const updated = await services.settings.update(patch);
  if (hasRetentionConfigChanged(previous, updated)) {
    await services.store.recalculateSchedules(updated);
    await syncMirror(services.mirror);
  }
  await services.reminders.settingsChanged(updated);
  return updated;
}

function hasRetentionConfigChanged(previous: Settings, next: Settings): boolean {
  if (previous.defaultRequestRetention !== next.defaultRequestRetention) return true;
  return JSON.stringify(previous.reviewGroups) !== JSON.stringify(next.reviewGroups);
}

function dispatchHistoryJob(
  request: Extract<ExtensionRequest, { type: 'history.start' | 'history.cancel' }>,
  services: BackgroundServices,
): Promise<void> | void {
  if (!services.historyJob) throw new Error('导入服务不可用');
  if (request.type === 'history.start') return services.historyJob.start(request.payload.rating);
  services.historyJob.cancel();
}

async function syncMirror(mirror: DataMirror | undefined): Promise<void> {
  // 主数据已写入成功，镜像失败只记录，不让本次请求失败。
  try {
    await mirror?.sync();
  } catch (error) {
    console.error('[小刷记] 同步本地数据镜像失败', error);
  }
}

function toDashboardFilter(
  payload: Extract<ExtensionRequest, { type: 'dashboard.query' }>['payload'],
): DashboardFilter {
  if (!payload) return {};
  const filter: {
    search?: string;
    difficulty?: Difficulty;
    tag?: string;
  } = {};
  if (payload.search !== undefined) filter.search = payload.search;
  if (payload.difficulty === 'EASY' || payload.difficulty === 'MEDIUM' || payload.difficulty === 'HARD') {
    filter.difficulty = payload.difficulty;
  }
  if (payload.tag !== undefined) filter.tag = payload.tag;
  return filter;
}

function assertNever(value: never): never {
  throw new Error(`未处理的消息：${JSON.stringify(value)}`);
}
