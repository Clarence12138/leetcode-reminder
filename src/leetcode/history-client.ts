import type { ProblemMetadata } from '../domain/types';
import type { GraphqlRequest } from './api-client';
import { LeetCodeIntegrationError } from './errors';
import {
  progressQuestionListResponseSchema,
  submissionListResponseSchema,
  type ProgressQuestion,
} from './schemas';
import { buildProblemId, buildProblemUrl } from './url';

const PROGRESS_QUERY = `
  query userProgressQuestionList($filters: UserProgressQuestionListInput) {
    userProgressQuestionList(filters: $filters) {
      totalNum
      questions {
        frontendId
        title
        translatedTitle
        titleSlug
        difficulty
        topicTags { name nameTranslated }
      }
    }
  }
`;

const SUBMISSIONS_QUERY = `
  query submissionList(
    $offset: Int!
    $limit: Int!
    $lastKey: String
    $questionSlug: String!
    $status: SubmissionStatusEnum
  ) {
    submissionList(
      offset: $offset
      limit: $limit
      lastKey: $lastKey
      questionSlug: $questionSlug
      status: $status
    ) {
      lastKey
      hasNext
      submissions { id status statusDisplay timestamp }
    }
  }
`;

const AUTH_MESSAGE = '无法读取力扣做题记录，请先在浏览器中登录力扣中文站。';

export interface GraphqlPort {
  graphql<T>(request: GraphqlRequest<T>, signal: AbortSignal): Promise<T>;
}

export interface SolvedProblemPage {
  readonly total: number;
  readonly problems: readonly ProblemMetadata[];
}

export interface AcceptedSubmissionPage {
  readonly submissions: readonly { readonly submissionId: string; readonly acceptedAt: number }[];
  readonly hasNext: boolean;
  readonly lastKey: string | null;
  /** 本页原始提交 ID（含未通过的），用于判断分页是否推进。 */
  readonly fetchedIds: readonly string[];
}

export interface SubmissionPageQuery {
  readonly slug: string;
  readonly offset: number;
  readonly limit: number;
  readonly lastKey: string | null;
}

export class LeetCodeHistoryClient {
  constructor(private readonly port: GraphqlPort) {}

  async listSolvedProblems(skip: number, limit: number, signal: AbortSignal): Promise<SolvedProblemPage> {
    const response = await this.port.graphql({
      query: PROGRESS_QUERY,
      variables: { filters: { questionStatus: 'SOLVED', skip, limit } },
      schema: progressQuestionListResponseSchema,
      label: '已通过题目',
    }, signal);
    const list = response.data.userProgressQuestionList;
    if (!list) throw new LeetCodeIntegrationError('AUTH_REQUIRED', AUTH_MESSAGE, false);
    return { total: list.totalNum, problems: list.questions.map(toProblemMetadata) };
  }

  async listAcceptedSubmissions(query: SubmissionPageQuery, signal: AbortSignal): Promise<AcceptedSubmissionPage> {
    const response = await this.port.graphql({
      query: SUBMISSIONS_QUERY,
      variables: {
        offset: query.offset,
        limit: query.limit,
        lastKey: query.lastKey,
        questionSlug: query.slug,
        status: 'AC',
      },
      schema: submissionListResponseSchema,
      label: '提交记录',
    }, signal);
    const list = response.data.submissionList;
    if (!list) throw new LeetCodeIntegrationError('AUTH_REQUIRED', AUTH_MESSAGE, false);
    const lastKey = list.lastKey ?? null;
    return {
      submissions: list.submissions
        .filter(isAccepted)
        .map((submission) => ({ submissionId: submission.id, acceptedAt: submission.timestamp })),
      // 缺少 hasNext 时不默认为末页：本页已满且有游标就继续读，避免静默只读第一页。
      hasNext: list.hasNext ?? (lastKey !== null && list.submissions.length >= query.limit),
      lastKey,
      fetchedIds: list.submissions.map((submission) => submission.id),
    };
  }
}

const ACCEPTED_STATUS_CODES: ReadonlySet<unknown> = new Set(['AC', 10, '10']);
const ACCEPTED_DISPLAYS: ReadonlySet<unknown> = new Set(['Accepted', '通过']);

// 已按 status: AC 过滤，这里再兜底一次，避免服务端忽略过滤条件时混入未通过的提交。
// status 为权威字段；只有缺失时才参考 statusDisplay。
function isAccepted(submission: { readonly status?: unknown; readonly statusDisplay?: unknown }): boolean {
  if (submission.status !== null && submission.status !== undefined) return ACCEPTED_STATUS_CODES.has(submission.status);
  return ACCEPTED_DISPLAYS.has(submission.statusDisplay);
}

function toProblemMetadata(question: ProgressQuestion): ProblemMetadata {
  return {
    problemId: buildProblemId(question.titleSlug),
    slug: question.titleSlug,
    frontendId: question.frontendId,
    title: question.translatedTitle || question.title || question.titleSlug,
    difficulty: question.difficulty,
    tags: (question.topicTags ?? []).map((tag) => tag.nameTranslated || tag.name),
    url: buildProblemUrl(question.titleSlug),
  };
}
