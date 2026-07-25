import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { XiaoshuajiDatabase } from '../src/background/database';

let sequence = 0;
const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('IndexedDB 迁移', () => {
  it('升级到 v2 时将已解决异常迁移为已读，未解决异常保持未读', async () => {
    const name = `test-database-migration-${sequence++}`;
    databaseNames.push(name);
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      problems: 'problemId, slug, nextReviewAt, updatedAt, difficulty, *tags',
      submissions: 'submissionId, problemId, acceptedAt, rating',
      issues: '++id, slug, occurredAt, code, resolvedAt',
    });
    await legacy.table('issues').bulkAdd([
      legacyIssue(null, '未解决'),
      legacyIssue(2_000, '已解决'),
    ]);
    legacy.close();

    const current = new XiaoshuajiDatabase(name);
    const issues = await current.issues.orderBy('occurredAt').toArray();

    expect(issues[0]).toMatchObject({ diagnostic: '未解决', readAt: null });
    expect(issues[1]).toMatchObject({ diagnostic: '已解决', readAt: 2_000 });
    current.close();
  });
});

function legacyIssue(resolvedAt: number | null, diagnostic: string) {
  return {
    slug: 'two-sum',
    occurredAt: resolvedAt ?? 1_000,
    code: 'NETWORK_ERROR',
    retryable: true,
    diagnostic,
    resolvedAt,
  };
}
