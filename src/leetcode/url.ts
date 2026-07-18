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
