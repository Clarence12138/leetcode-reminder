import { describe, expect, it, vi } from 'vitest';
import { LeetCodeCnClient } from '../src/leetcode/api-client';
import { readCookieValue } from '../src/leetcode/cookies';
import type { LeetCodeIntegrationError } from '../src/leetcode/errors';
import { extractProblemSlug, extractSubmissionRoute } from '../src/leetcode/url';

const signal = new AbortController().signal;

describe('LeetCodeCnClient', () => {
  it('以浏览器全局对象作为原生 fetch 的调用接收者', async () => {
    const fetcher = function (this: unknown): Promise<Response> {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(response(statusBody('42')));
    } as typeof fetch;
    const client = new LeetCodeCnClient({ fetcher });

    await expect(client.getSubmissionStatus('42', signal)).resolves.toMatchObject({
      state: 'SUCCESS', statusCode: 10, submissionId: '42',
    });
  });

  it('判题 GET 使用当前 v2 端点且不自行注入认证请求头', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(statusBody('42')));
    const client = new LeetCodeCnClient({
      fetcher,
      csrfTokenProvider: () => 'csrf-token',
    });

    await client.getSubmissionStatus('42', signal);

    expect((fetcher.mock.calls[0]?.[0] as URL).href).toBe(
      'https://leetcode.cn/submissions/detail/42/v2/check/',
    );
    expect(fetcher.mock.calls[0]?.[1]).toEqual({ method: 'GET', signal, credentials: 'include' });
  });

  it('保留结构化提交 ID 与毫秒完成时间', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(statusBody(42)));
    const client = new LeetCodeCnClient({ fetcher });

    await expect(client.getSubmissionStatus('42', signal)).resolves.toEqual({
      state: 'SUCCESS',
      statusCode: 10,
      statusMessage: 'Accepted',
      submissionId: '42',
      taskFinishTime: 1_784_284_605_541,
    });
  });

  it('将 401 暴露为登录错误', async () => {
    const client = new LeetCodeCnClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({}, 401)),
    });

    await expect(client.getSubmissionStatus('42', signal)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      retryable: false,
    } satisfies Partial<LeetCodeIntegrationError>);
  });

  it('403 错误包含具体接口阶段且不推测认证方式', async () => {
    const client = new LeetCodeCnClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({}, 403)),
    });

    await expect(client.getSubmissionStatus('42', signal)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: '力扣判题状态接口返回 HTTP 403。',
    });
  });

  it('拒绝未知判题响应结构', async () => {
    const client = new LeetCodeCnClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({ state: 1 })),
    });

    await expect(client.getSubmissionStatus('42', signal)).rejects.toMatchObject({
      code: 'UNKNOWN_RESPONSE',
    } satisfies Partial<LeetCodeIntegrationError>);
  });

  it('拒绝判题响应中的其他 submission_id', async () => {
    const client = new LeetCodeCnClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(statusBody('43'))),
    });

    await expect(client.getSubmissionStatus('42', signal)).rejects.toMatchObject({
      code: 'UNKNOWN_RESPONSE',
      message: '判题状态 submission_id 不匹配：预期 42，实际 43',
    });
  });

  it('将无效 JSON 显式报告为未知响应', async () => {
    const client = new LeetCodeCnClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>维护中</html>')),
    });

    await expect(client.getSubmissionStatus('42', signal)).rejects.toMatchObject({
      code: 'UNKNOWN_RESPONSE',
      retryable: false,
    } satisfies Partial<LeetCodeIntegrationError>);
  });

  it('读取中文题目信息且不构造默认难度', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(questionBody('two-sum')));
    const client = new LeetCodeCnClient({ fetcher });

    await expect(client.getProblemMetadata('two-sum', signal)).resolves.toMatchObject({
      problemId: 'leetcode-cn:two-sum',
      title: '两数之和',
      difficulty: 'EASY',
      tags: ['数组', '哈希表'],
    });
  });

  it('GraphQL POST 仅携带 Content-Type 与临时 CSRF 头', async () => {
    const token = readCookieValue('session=opaque; csrftoken=csrf-token==', 'csrftoken');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(questionBody('two-sum')));
    const client = new LeetCodeCnClient({ fetcher, csrfTokenProvider: () => token });

    await client.getProblemMetadata('two-sum', signal);

    expect(token).toBe('csrf-token==');
    expect(fetcher).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': 'csrf-token==' },
    }));
  });

  it('拒绝 GraphQL 返回的其他题目 slug', async () => {
    const client = new LeetCodeCnClient({
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response(questionBody('add-two-numbers'))),
    });

    await expect(client.getProblemMetadata('two-sum', signal)).rejects.toMatchObject({
      code: 'UNKNOWN_RESPONSE',
    } satisfies Partial<LeetCodeIntegrationError>);
  });
});

describe('力扣题目路由解析', () => {
  it('从普通题目页提取 slug', () => {
    expect(extractProblemSlug(path('/problems/two-sum/description/'))).toBe('two-sum');
    expect(extractProblemSlug(path('/contest/weekly/problems/two-sum/'))).toBeNull();
  });

  it('只从精确的数字提交详情路由提取 submissionId', () => {
    expect(extractSubmissionRoute(path('/problems/two-sum/submissions/736464467/'))).toEqual({
      slug: 'two-sum', submissionId: '736464467',
    });
    expect(extractSubmissionRoute(path('/problems/two-sum/submissions/'))).toBeNull();
    expect(extractSubmissionRoute(path('/problems/two-sum/submissions/not-an-id/'))).toBeNull();
    expect(extractSubmissionRoute(path('/problems/two-sum/description/'))).toBeNull();
  });
});

function statusBody(submissionId: string | number) {
  return {
    state: 'SUCCESS',
    status_code: 10,
    status_msg: 'Accepted',
    submission_id: submissionId,
    task_finish_time: 1_784_284_605_541,
  };
}

function questionBody(titleSlug: string) {
  return {
    data: {
      question: {
        questionFrontendId: titleSlug === 'two-sum' ? '1' : '2',
        translatedTitle: titleSlug === 'two-sum' ? '两数之和' : '两数相加',
        titleSlug,
        difficulty: titleSlug === 'two-sum' ? 'Easy' : 'Medium',
        topicTags: [{ translatedName: '数组' }, { translatedName: '哈希表' }],
      },
    },
  };
}

function path(pathname: string): Pick<Location, 'pathname'> {
  return { pathname };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
