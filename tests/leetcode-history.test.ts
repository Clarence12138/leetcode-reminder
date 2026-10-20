import { describe, expect, it } from 'vitest';

import type { GraphqlRequest } from '../src/leetcode/api-client';
import { LeetCodeHistoryClient, type GraphqlPort } from '../src/leetcode/history-client';
import { fetchLeetCodeHistory, type HistoryFetchProgress } from '../src/leetcode/history-fetcher';

const signal = new AbortController().signal;
const T1 = 1_700_000_000;
const T2 = 1_700_086_400;

describe('LeetCodeHistoryClient', () => {
  it('把已通过题目转换为题目元数据', async () => {
    const client = new LeetCodeHistoryClient(fakePort({
      progress: [progressPage(1, [question('two-sum', '1')])],
    }));

    await expect(client.listSolvedProblems(0, 50, signal)).resolves.toEqual({
      total: 1,
      problems: [{
        problemId: 'leetcode-cn:two-sum',
        slug: 'two-sum',
        frontendId: '1',
        title: '题目 two-sum',
        difficulty: 'EASY',
        tags: ['数组', 'Hash Table'],
        url: 'https://leetcode.cn/problems/two-sum/',
      }],
    });
  });

  it('未登录时力扣返回 null，映射为 AUTH_REQUIRED', async () => {
    const client = new LeetCodeHistoryClient(fakePort({ progress: [{ data: { userProgressQuestionList: null } }] }));

    await expect(client.listSolvedProblems(0, 50, signal)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('秒级时间戳转为毫秒，并过滤混入的非 AC 提交', async () => {
    const client = new LeetCodeHistoryClient(fakePort({
      submissions: {
        'two-sum': [submissionPage([
          { id: '11', status: 'AC', statusDisplay: 'Accepted', timestamp: '1700000000' },
          { id: 12, status: 'WA', statusDisplay: 'Wrong Answer', timestamp: 1700000100 },
        ])],
      },
    }));

    const page = await client.listAcceptedSubmissions({ slug: 'two-sum', offset: 0, limit: 20, lastKey: null }, signal);

    expect(page.submissions).toEqual([{ submissionId: '11', acceptedAt: 1_700_000_000_000 }]);
    expect(page.fetchedIds).toEqual(['11', '12']);
  });

  it('status 为权威字段，与 statusDisplay 冲突时不算 AC', async () => {
    const client = new LeetCodeHistoryClient(fakePort({
      submissions: {
        'two-sum': [submissionPage([
          { id: '1', status: 'WA', statusDisplay: 'Accepted', timestamp: 1700000000 },
          { id: '2', statusDisplay: 'Accepted', timestamp: 1700000000 },
          { id: '3', status: '10', timestamp: 1700000000 },
        ])],
      },
    }));

    const page = await client.listAcceptedSubmissions({ slug: 'two-sum', offset: 0, limit: 20, lastKey: null }, signal);

    expect(page.submissions.map((submission) => submission.submissionId)).toEqual(['2', '3']);
  });

  it('缺少 hasNext 时按整页且有游标判断还有下一页', async () => {
    const full = Array.from({ length: 20 }, (_, index) => ({ id: String(index), status: 'AC', timestamp: 1700000000 }));
    const client = new LeetCodeHistoryClient(fakePort({
      submissions: { 'two-sum': [{ data: { submissionList: { lastKey: 'k', submissions: full } } }] },
    }));

    const page = await client.listAcceptedSubmissions({ slug: 'two-sum', offset: 0, limit: 20, lastKey: null }, signal);

    expect(page.hasNext).toBe(true);
  });

  it('提交时间超出合理范围时判为结构变化', async () => {
    const client = new LeetCodeHistoryClient(fakePort({
      submissions: { 'two-sum': [submissionPage([{ id: '1', status: 'AC', timestamp: 1_700_000_000_000_000 }])] },
    }));

    await expect(client.listAcceptedSubmissions({ slug: 'two-sum', offset: 0, limit: 20, lastKey: null }, signal))
      .rejects.toThrow();
  });
});

describe('fetchLeetCodeHistory', () => {
  it('翻页读取全部题目和提交，跳过本地已有题目并汇报进度', async () => {
    const port = fakePort({
      progress: [
        progressPage(3, [question('two-sum', '1'), question('add-two-numbers', '2')]),
        progressPage(3, [question('no-ac', '3')]),
      ],
      submissions: {
        'add-two-numbers': [
          submissionPage([{ id: '21', status: 'AC', timestamp: T1 }], { hasNext: true, lastKey: 'k1' }),
          submissionPage([{ id: '22', status: 'AC', timestamp: T2 }]),
        ],
        'no-ac': [submissionPage([])],
      },
    });
    const progress: HistoryFetchProgress[] = [];

    const history = await fetchLeetCodeHistory(new LeetCodeHistoryClient(port), {
      skipSlugs: new Set(['two-sum']),
      signal,
      intervalMs: 0,
      onProgress: (next) => progress.push(next),
    });

    expect(history).toEqual({
      problems: [{
        metadata: expect.objectContaining({ slug: 'add-two-numbers' }),
        submissions: [{ submissionId: '21', acceptedAt: T1 * 1000 }, { submissionId: '22', acceptedAt: T2 * 1000 }],
      }],
      solvedTotal: 3,
      skippedLocal: 1,
      withoutAccepted: 1,
    });
    expect(port.variables.filter((variables) => variables.questionSlug === 'add-two-numbers')).toEqual([
      expect.objectContaining({ offset: 0, lastKey: null }),
      expect.objectContaining({ offset: 1, lastKey: 'k1' }),
    ]);
    expect(port.variables.some((variables) => variables.questionSlug === 'two-sum')).toBe(false);
    expect(progress.at(-1)).toEqual({ phase: 'submissions', done: 2, total: 2 });
  });

  it('分页不推进时报错，不把不完整历史当作成功', async () => {
    const repeated = submissionPage([{ id: '1', status: 'AC', timestamp: T1 }], { hasNext: true, lastKey: 'same' });
    const port = fakePort({
      progress: [progressPage(1, [question('two-sum', '1')])],
      submissions: { 'two-sum': [repeated, repeated] },
    });

    await expect(fetchLeetCodeHistory(new LeetCodeHistoryClient(port), {
      skipSlugs: new Set(), signal, intervalMs: 0, onProgress: () => undefined,
    })).rejects.toThrow('未能读完');
  });

  it('超过分页上限仍有下一页时报错', async () => {
    const pages = Array.from({ length: 50 }, (_, index) =>
      submissionPage([{ id: String(index), status: 'AC', timestamp: T1 }], { hasNext: true, lastKey: `k${index}` }));
    const port = fakePort({
      progress: [progressPage(1, [question('two-sum', '1')])],
      submissions: { 'two-sum': pages },
    });

    await expect(fetchLeetCodeHistory(new LeetCodeHistoryClient(port), {
      skipSlugs: new Set(), signal, intervalMs: 0, onProgress: () => undefined,
    })).rejects.toThrow('超过 50 页');
  });

  it('取消后立即停止请求', async () => {
    const controller = new AbortController();
    const port = fakePort({ progress: [progressPage(1, [question('two-sum', '1')])] });

    const pending = fetchLeetCodeHistory(new LeetCodeHistoryClient(port), {
      skipSlugs: new Set(),
      signal: controller.signal,
      intervalMs: 60_000,
      onProgress: () => controller.abort(new DOMException('已取消', 'AbortError')),
    });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(port.variables).toHaveLength(1);
  });
});

interface FakeResponses {
  readonly progress?: unknown[];
  readonly submissions?: Record<string, unknown[]>;
}

function fakePort(responses: FakeResponses): GraphqlPort & { readonly variables: Record<string, unknown>[] } {
  const progress = [...(responses.progress ?? [])];
  const submissions = Object.fromEntries(
    Object.entries(responses.submissions ?? {}).map(([slug, pages]) => [slug, [...pages]]),
  );
  const variables: Record<string, unknown>[] = [];
  const graphql = <T,>(request: GraphqlRequest<T>): Promise<T> => {
    variables.push(request.variables);
    const slug = request.variables.questionSlug;
    const raw = typeof slug === 'string' ? submissions[slug]?.shift() : progress.shift();
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) return Promise.reject(parsed.error);
    return Promise.resolve(parsed.data);
  };
  return { graphql, variables };
}

function question(slug: string, frontendId: string) {
  return {
    frontendId,
    title: slug,
    translatedTitle: `题目 ${slug}`,
    titleSlug: slug,
    difficulty: 'EASY',
    topicTags: [{ name: 'Array', nameTranslated: '数组' }, { name: 'Hash Table', nameTranslated: null }],
  };
}

function progressPage(totalNum: number, questions: unknown[]) {
  return { data: { userProgressQuestionList: { totalNum, questions } } };
}

function submissionPage(
  submissions: unknown[],
  { hasNext = false, lastKey = null }: { readonly hasNext?: boolean; readonly lastKey?: string | null } = {},
) {
  return { data: { submissionList: { hasNext, lastKey, submissions } } };
}
