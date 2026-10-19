import { DATA_MIRROR_FORMAT } from '../domain/constants';
import { dataMirrorSchema } from '../domain/schemas';
import { AppError } from './errors';
import type { LocalStoragePort } from './settings';
import type { PersistedSnapshot } from './store-import';
import type { ReviewStore } from './store';

export const DATA_MIRROR_STORAGE_KEY = 'dataMirror';

export type MirrorInitializeResult =
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'refreshed' }>
  | Readonly<{ status: 'restored'; problemCount: number; savedAt: number }>;

export interface DataMirror {
  initialize(): Promise<MirrorInitializeResult>;
  sync(): Promise<void>;
}

/**
 * 在 chrome.storage.local 中保留一份 IndexedDB 数据镜像。
 * IndexedDB 被浏览器清理而 chrome.storage.local 仍在时，启动时自动恢复。
 */
export class ChromeDataMirror implements DataMirror {
  private queue: Promise<void> = Promise.resolve();
  private writable = true;

  constructor(
    private readonly store: ReviewStore,
    private readonly storage: LocalStoragePort,
    private readonly now: () => number = Date.now,
  ) {}

  async initialize(): Promise<MirrorInitializeResult> {
    const current = await this.store.getSnapshot();
    if (!isEmpty(current)) {
      await this.sync();
      return { status: 'refreshed' };
    }

    const stored = (await this.storage.get(DATA_MIRROR_STORAGE_KEY))[DATA_MIRROR_STORAGE_KEY];
    if (stored === undefined) return { status: 'empty' };

    // 镜像无法恢复时停止覆盖它，保留现场供后续排查。
    this.writable = false;
    const parsed = dataMirrorSchema.safeParse(stored);
    if (!parsed.success) {
      throw new AppError('MIRROR_INVALID', `本地数据镜像校验失败：${parsed.error.message}`);
    }
    const { problems, submissions, issues, savedAt } = parsed.data;
    if (isEmpty({ problems, submissions, issues })) {
      this.writable = true;
      return { status: 'empty' };
    }
    await this.store.importSnapshot({ problems, submissions, issues }, 'replace');
    this.writable = true;
    return { status: 'restored', problemCount: problems.length, savedAt };
  }

  sync(): Promise<void> {
    const next = this.queue.then(() => this.write());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async write(): Promise<void> {
    if (!this.writable) return;
    const snapshot = await this.store.getSnapshot();
    await this.storage.set({
      [DATA_MIRROR_STORAGE_KEY]: {
        format: DATA_MIRROR_FORMAT,
        savedAt: this.now(),
        problems: snapshot.problems,
        submissions: snapshot.submissions,
        issues: snapshot.issues,
      },
    });
  }
}

function isEmpty(snapshot: PersistedSnapshot): boolean {
  return snapshot.problems.length === 0 && snapshot.submissions.length === 0;
}
