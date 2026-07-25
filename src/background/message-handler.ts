import type { ExtensionRequest, ExtensionResponse } from '../domain/messages';
import { parseExtensionRequest } from '../domain/schemas';
import type { Difficulty } from '../domain/types';
import type { BackupManager } from './backup';
import { toPublicError } from './errors';
import type { ReminderCoordinator } from './reminders';
import type { SettingsRepository } from './settings';
import type { DashboardFilter, ReviewStore } from './store';

export interface BackgroundServices {
  readonly store: ReviewStore;
  readonly settings: SettingsRepository;
  readonly backups: BackupManager;
  readonly reminders: ReminderCoordinator;
}

export function createMessageHandler(services: BackgroundServices) {
  return async (rawRequest: unknown): Promise<ExtensionResponse> => {
    try {
      const request = parseExtensionRequest(rawRequest) as ExtensionRequest;
      const data = await dispatchRequest(request, services);
      return data === undefined ? { ok: true } : { ok: true, data };
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
    case 'review.preview':
      return services.store.preview(request.payload.problemId, request.payload.submissionId);
    case 'dashboard.query':
      return services.store.queryDashboard(toDashboardFilter(request.payload));
    case 'settings.get':
      return services.settings.get();
    case 'settings.update': {
      const settings = await services.settings.update(request.payload);
      await services.reminders.settingsChanged(settings);
      return settings;
    }
    default:
      return dispatchMaintenanceRequest(request, services);
  }
}

type MaintenanceRequest = Exclude<
  ExtensionRequest,
  { readonly type: 'submission.accepted' | 'submission.rate' | 'review.preview' | 'dashboard.query' | 'settings.get' | 'settings.update' }
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
    case 'problem.delete': {
      const deleted = await services.store.deleteProblem(request.payload.problemId);
      await services.reminders.refreshBadge();
      return { deleted };
    }
    default:
      return assertNever(request);
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
