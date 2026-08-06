import type { ProblemMetadata } from '../domain/types';
import { LeetCodeIntegrationError } from './errors';
import {
  questionResponseSchema,
  submissionStatusSchema,
  type SubmissionStatus,
} from './schemas';
import { buildProblemId, buildProblemUrl } from './url';

const QUESTION_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionFrontendId
      translatedTitle
      titleSlug
      difficulty
      topicTags { name translatedName }
    }
  }
`;

export interface LeetCodeClient {
  getSubmissionStatus(submissionId: string, signal: AbortSignal): Promise<SubmissionStatus>;
  getProblemMetadata(slug: string, signal: AbortSignal): Promise<ProblemMetadata>;
}

export interface LeetCodeCnClientOptions {
  readonly fetcher?: typeof fetch;
  readonly origin?: string;
  readonly csrfTokenProvider?: () => string | null;
}

export class LeetCodeCnClient implements LeetCodeClient {
  private readonly fetcher: typeof fetch;
  private readonly origin: string;
  private readonly csrfTokenProvider: () => string | null;

  constructor(options: LeetCodeCnClientOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.origin = options.origin ?? 'https://leetcode.cn';
    this.csrfTokenProvider = options.csrfTokenProvider ?? (() => null);
  }

  async getSubmissionStatus(
    submissionId: string,
    signal: AbortSignal,
  ): Promise<SubmissionStatus> {
    const path = `/submissions/detail/${encodeURIComponent(submissionId)}/v2/check/`;
    const response = await this.request(
      path,
      { method: 'GET', signal },
      '判题状态',
    );
    const status = await this.parseResponse(response, submissionStatusSchema, '判题状态');
    if (status.submissionId && status.submissionId !== submissionId) {
      throw new LeetCodeIntegrationError(
        'UNKNOWN_RESPONSE',
        `判题状态 submission_id 不匹配：预期 ${submissionId}，实际 ${status.submissionId}`,
        false,
      );
    }
    return status;
  }

  async getProblemMetadata(slug: string, signal: AbortSignal): Promise<ProblemMetadata> {
    const response = await this.request('/graphql/', {
      method: 'POST',
      signal,
      headers: this.graphqlHeaders(),
      body: JSON.stringify({ query: QUESTION_QUERY, variables: { titleSlug: slug } }),
    }, '题目信息');
    const parsed = await this.parseResponse(response, questionResponseSchema, '题目信息');
    if (parsed.data.question.titleSlug !== slug) {
      throw new LeetCodeIntegrationError(
        'UNKNOWN_RESPONSE',
        `题目信息 slug 不匹配：预期 ${slug}，实际 ${parsed.data.question.titleSlug}`,
        false,
      );
    }
    return toProblemMetadata(parsed.data.question);
  }

  private async request(path: string, init: RequestInit, label: string): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetcher.call(
        globalThis,
        new URL(path, this.origin),
        { ...init, credentials: 'include' },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new LeetCodeIntegrationError('NETWORK_ERROR', `网络请求失败：${reason}`, true);
    }
    if (response.status === 401) {
      throw new LeetCodeIntegrationError('AUTH_REQUIRED', '请先登录力扣中文站。', false);
    }
    if (!response.ok) {
      throw new LeetCodeIntegrationError(
        'NETWORK_ERROR',
        `力扣${label}接口返回 HTTP ${response.status}。`,
        response.status >= 500 || response.status === 429,
      );
    }
    return response;
  }

  private graphqlHeaders(): HeadersInit {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrfToken = this.csrfTokenProvider();
    if (csrfToken) headers['X-CSRFToken'] = csrfToken;
    return headers;
  }

  private async parseResponse<T>(
    response: Response,
    schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: Error } },
    label: string,
  ): Promise<T> {
    const raw = await readJson(response, label);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new LeetCodeIntegrationError(
        'UNKNOWN_RESPONSE',
        `${label}接口结构发生变化：${parsed.error.message}`,
        false,
      );
    }
    return parsed.data;
  }
}

async function readJson(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new LeetCodeIntegrationError(
      'UNKNOWN_RESPONSE',
      `${label}接口未返回有效 JSON：${reason}`,
      false,
    );
  }
}

function toProblemMetadata(question: {
  readonly questionFrontendId: string;
  readonly translatedTitle: string;
  readonly titleSlug: string;
  readonly difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  readonly topicTags: readonly {
    readonly name: string;
    readonly translatedName: string | null;
  }[];
}): ProblemMetadata {
  return {
    problemId: buildProblemId(question.titleSlug),
    slug: question.titleSlug,
    frontendId: question.questionFrontendId,
    title: question.translatedTitle,
    difficulty: question.difficulty,
    tags: question.topicTags.map((tag) => tag.translatedName ?? tag.name),
    url: buildProblemUrl(question.titleSlug),
  };
}
