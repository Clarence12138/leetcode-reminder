import type { LeetCodeHistoryProblem, ProblemMetadata } from '../domain/types';
import { abortableDelay } from '../shared/abortable-delay';
import { LeetCodeIntegrationError } from './errors';
import type { LeetCodeHistoryClient } from './history-client';

const PROBLEM_PAGE_SIZE = 50;
const SUBMISSION_PAGE_SIZE = 20;
const MAX_SUBMISSION_PAGES = 50;
const REQUEST_TIMEOUT_MS = 20_000;
export const HISTORY_REQUEST_INTERVAL_MS = 600;

export interface HistoryFetchProgress {
  readonly phase: 'problems' | 'submissions';
  readonly done: number;
  readonly total: number;
}

export interface HistoryFetchOptions {
  readonly skipSlugs: ReadonlySet<string>;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: HistoryFetchProgress) => void;
  readonly intervalMs?: number;
}

export interface HistoryFetchResult {
  readonly problems: readonly LeetCodeHistoryProblem[];
  readonly solvedTotal: number;
  readonly skippedLocal: number;
  readonly withoutAccepted: number;
}

type Submissions = LeetCodeHistoryProblem['submissions'];

/** 串行读取当前登录用户的已通过题目及每题 AC 记录；本地已有的题目不再请求提交列表。 */
export async function fetchLeetCodeHistory(
  client: LeetCodeHistoryClient,
  options: HistoryFetchOptions,
): Promise<HistoryFetchResult> {
  const request = createPacer(options.intervalMs ?? HISTORY_REQUEST_INTERVAL_MS, options.signal);
  const solved = await listAllSolved(client, options, request);
  const pending = solved.filter((problem) => !options.skipSlugs.has(problem.slug));
  const problems: LeetCodeHistoryProblem[] = [];
  options.onProgress({ phase: 'submissions', done: 0, total: pending.length });
  for (const [index, metadata] of pending.entries()) {
    const submissions = await listAllAccepted(client, metadata.slug, request);
    if (submissions.length > 0) problems.push({ metadata, submissions });
    options.onProgress({ phase: 'submissions', done: index + 1, total: pending.length });
  }
  return {
    problems,
    solvedTotal: solved.length,
    skippedLocal: solved.length - pending.length,
    withoutAccepted: pending.length - problems.length,
  };
}

async function listAllSolved(
  client: LeetCodeHistoryClient,
  options: HistoryFetchOptions,
  request: () => Promise<AbortSignal>,
): Promise<ProblemMetadata[]> {
  const problems: ProblemMetadata[] = [];
  for (;;) {
    const page = await client.listSolvedProblems(problems.length, PROBLEM_PAGE_SIZE, await request());
    problems.push(...page.problems);
    options.onProgress({ phase: 'problems', done: problems.length, total: page.total });
    if (page.problems.length === 0 || problems.length >= page.total) return problems;
  }
}

async function listAllAccepted(
  client: LeetCodeHistoryClient,
  slug: string,
  request: () => Promise<AbortSignal>,
): Promise<Submissions> {
  const accepted = new Map<string, Submissions[number]>();
  const seen = new Set<string>();
  let offset = 0;
  let lastKey: string | null = null;
  for (let pageIndex = 0; pageIndex < MAX_SUBMISSION_PAGES; pageIndex += 1) {
    const page = await client.listAcceptedSubmissions({ slug, offset, limit: SUBMISSION_PAGE_SIZE, lastKey }, await request());
    const before = seen.size;
    for (const id of page.fetchedIds) seen.add(id);
    for (const submission of page.submissions) accepted.set(submission.submissionId, submission);
    if (!page.hasNext) return [...accepted.values()];
    if (seen.size === before) throw incomplete(slug, '分页没有推进');
    offset += page.fetchedIds.length;
    lastKey = page.lastKey;
  }
  throw incomplete(slug, `超过 ${MAX_SUBMISSION_PAGES} 页`);
}

function incomplete(slug: string, reason: string): LeetCodeIntegrationError {
  return new LeetCodeIntegrationError(
    'UNKNOWN_RESPONSE',
    `题目 ${slug} 的提交记录未能读完（${reason}），为避免导入不完整的历史，本次导入已取消。`,
    false,
  );
}

/** 控制请求间隔，并为每次请求组合用户取消与单次超时。 */
function createPacer(intervalMs: number, signal: AbortSignal): () => Promise<AbortSignal> {
  let first = true;
  return async () => {
    signal.throwIfAborted();
    if (!first) await abortableDelay(intervalMs, signal);
    first = false;
    return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  };
}
