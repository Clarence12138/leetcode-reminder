import { buildReviewHistory, computeRetrievability } from '../domain/mastery';
import { isProblemPaused, pickNextDueProblem, resolveRequestRetention } from '../domain/queue-policy';
import type {
  MasteryRating,
  NextReview,
  ReviewContext,
  Settings,
  SubmissionReview,
} from '../domain/types';
import { withReviewResetIntent } from '../leetcode/url';
import type { XiaoshuajiDatabase } from './database';
import { AppError } from './errors';
import { getFsrsDecay } from './fsrs';
import type { Replay } from './store-import';

export interface RatingContext {
  readonly db: XiaoshuajiDatabase;
  readonly now: () => number;
  readonly replay: Replay;
}

export interface RatingResult {
  readonly review: SubmissionReview;
  readonly nextReviewAt: number | null;
}

/** 设置或清空（rating 为 null，即撤销评分）一次提交的评分，并在同一事务内重放 FSRS。 */
export function applySubmissionRating(
  ctx: RatingContext,
  change: { readonly submissionId: string; readonly rating: MasteryRating | null; readonly expectedRating?: MasteryRating },
  settings?: Settings,
): Promise<RatingResult> {
  const { db } = ctx;
  const { submissionId, rating, expectedRating } = change;
  return db.transaction('rw', db.problems, db.submissions, async () => {
    const stored = await db.submissions.get(submissionId);
    if (!stored) throw new AppError('SUBMISSION_NOT_FOUND', `未找到提交 ${submissionId}`);
    if (rating === null) assertCanClear(stored, expectedRating);
    const problem = await db.problems.get(stored.problemId);
    if (!problem) throw new AppError('DATA_INTEGRITY_ERROR', `提交 ${submissionId} 缺少题目记录`);
    const reviews = await db.submissions.where('problemId').equals(stored.problemId).toArray();
    const changed = reviews.map((review) => (review.submissionId === submissionId ? { ...review, rating } : review));
    const replayed = ctx.replay(changed, { requestRetention: resolveRequestRetention(problem, settings) });
    const updated = replayed.reviews.find((review) => review.submissionId === submissionId);
    if (!updated) throw new AppError('DATA_INTEGRITY_ERROR', `FSRS 未返回提交 ${submissionId}`);
    await db.submissions.bulkPut([...replayed.reviews]);
    const nextReviewAt = replayed.card?.due ?? null;
    await db.problems.put({ ...problem, fsrsCard: replayed.card, nextReviewAt, updatedAt: ctx.now() });
    return { review: updated, nextReviewAt };
  });
}

function assertCanClear(stored: SubmissionReview, expectedRating: MasteryRating | undefined): void {
  if (stored.rating === null) {
    throw new AppError('SUBMISSION_NOT_RATED', `提交 ${stored.submissionId} 还没有评分，无需撤销`);
  }
  if (expectedRating !== undefined && stored.rating !== expectedRating) {
    throw new AppError('SUBMISSION_RATING_CHANGED', '这条提交的评分已在别处修改，无法撤销');
  }
}

/** 今日队列里的下一题；开启“复习时还原代码”时链接带上还原标记。 */
export async function queryNextReview(
  ctx: Pick<RatingContext, 'db' | 'now'>,
  settings: Settings,
  excludeProblemId?: string,
): Promise<NextReview> {
  const now = ctx.now();
  const { db } = ctx;
  const [dueProblems, reviews] = await db.transaction('r', db.problems, db.submissions, () => Promise.all([
    db.problems.where('nextReviewAt').belowOrEqual(now).toArray(),
    db.submissions.toArray(),
  ]));
  const picked = pickNextDueProblem({
    dueProblems: dueProblems.filter((problem) => !isProblemPaused(problem)),
    reviews,
    settings,
    now,
    excludeProblemId,
  });
  const problem = picked.problem;
  const url = problem ? (settings.resetCodeOnReview ? withReviewResetIntent(problem.url) : problem.url) : null;
  return { problem, url, remainingToday: picked.remainingToday };
}

/** 一道题的已评分轨迹与当前记忆概率；题目不存在时返回空。 */
export async function queryReviewContext(
  ctx: Pick<RatingContext, 'db' | 'now'>,
  problemId: string,
  settings?: Settings,
): Promise<ReviewContext> {
  const { db } = ctx;
  const { problem, reviews } = await db.transaction('r', db.problems, db.submissions, async () => ({
    problem: await db.problems.get(problemId),
    reviews: await db.submissions.where('problemId').equals(problemId).toArray(),
  }));
  if (!problem) return { problem: null, history: [], retrievability: null };
  const decay = getFsrsDecay(resolveRequestRetention(problem, settings));
  return {
    problem,
    history: buildReviewHistory(reviews, problem.fsrsCard),
    retrievability: computeRetrievability(problem.fsrsCard, ctx.now(), decay),
  };
}
