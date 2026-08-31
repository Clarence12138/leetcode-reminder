const PROBLEM_PATH = /^\/problems\/([^/]+)(?:\/|$)/;
const SUBMISSION_PATH = /^\/problems\/([^/]+)\/submissions\/(\d+)\/?$/;

export interface SubmissionRoute {
  readonly slug: string;
  readonly submissionId: string;
}

export function extractProblemSlug(location: Pick<Location, 'pathname'>): string | null {
  const match = PROBLEM_PATH.exec(location.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function extractSubmissionRoute(
  location: Pick<Location, 'pathname'>,
): SubmissionRoute | null {
  const match = SUBMISSION_PATH.exec(location.pathname);
  if (!match?.[1] || !match[2]) return null;
  return { slug: decodeURIComponent(match[1]), submissionId: match[2] };
}

export function buildProblemId(slug: string): string {
  return `leetcode-cn:${slug}`;
}

export function buildProblemUrl(slug: string): string {
  return `https://leetcode.cn/problems/${encodeURIComponent(slug)}/`;
}

export const REVIEW_RESET_PARAM = 'xiaoshuaji';
export const REVIEW_RESET_VALUE = 'review';
export const REVIEW_RESET_STORAGE_PREFIX = 'xiaoshuaji:reset:';
export const REVIEW_RESET_TTL_MS = 60_000;

export interface ReviewResetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function withReviewResetIntent(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(REVIEW_RESET_PARAM, REVIEW_RESET_VALUE);
  return parsed.toString();
}

export function captureReviewResetIntent(
  href: string,
  storage: Pick<ReviewResetStorage, 'setItem'>,
  history: Pick<History, 'replaceState' | 'state'>,
): boolean {
  const url = new URL(href, 'https://leetcode.cn');
  if (url.searchParams.get(REVIEW_RESET_PARAM) !== REVIEW_RESET_VALUE) return false;
  const slug = extractProblemSlug(url);
  if (!slug) return false;
  storage.setItem(`${REVIEW_RESET_STORAGE_PREFIX}${slug}`, String(Date.now()));
  url.searchParams.delete(REVIEW_RESET_PARAM);
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}

export function hasReviewResetIntent(
  slug: string | null,
  storage: Pick<ReviewResetStorage, 'getItem' | 'removeItem'>,
  now = Date.now(),
): boolean {
  if (!slug) return false;
  const key = `${REVIEW_RESET_STORAGE_PREFIX}${slug}`;
  const raw = storage.getItem(key);
  if (!raw) return false;
  const created = Number(raw);
  if (!Number.isFinite(created) || now - created > REVIEW_RESET_TTL_MS) {
    storage.removeItem(key);
    return false;
  }
  return true;
}

export function clearReviewResetIntent(
  slug: string,
  storage: Pick<ReviewResetStorage, 'removeItem'>,
): void {
  storage.removeItem(`${REVIEW_RESET_STORAGE_PREFIX}${slug}`);
}
