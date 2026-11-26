import type {
  ProblemRecord,
  ReviewHistoryEntry,
  SerializedFsrsCard,
  SubmissionReview,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** ts-fsrs 默认参数 w[20]（FSRS-6 遗忘曲线衰减）。 */
export const FSRS6_DEFAULT_DECAY = 0.1542;

/** 间隔低于这个天数算「学习中」。 */
export const LEARNING_INTERVAL_DAYS = 7;
/** 间隔超过这个天数算「已稳定」。 */
export const STABLE_INTERVAL_DAYS = 21;

export type MasteryLevel = 'new' | 'learning' | 'reviewing' | 'stable';

/**
 * 掌握分布的四档，顺序即图表从浅到深的顺序（对应色阶 s2 → s5）：
 * - 新学：只评过 1 次（card.reps === 1）
 * - 学习中：当前间隔 < 7 天
 * - 复习中：当前间隔 7–21 天
 * - 已稳定：当前间隔 > 21 天
 * “当前间隔”取最近一次评分后排的天数（card.scheduled_days）。
 */
export const MASTERY_LEVELS: readonly {
  readonly id: MasteryLevel;
  readonly label: string;
  readonly hint: string;
}[] = [
  { id: 'new', label: '新学', hint: '只评过 1 次' },
  { id: 'learning', label: '学习中', hint: `间隔 < ${LEARNING_INTERVAL_DAYS} 天` },
  { id: 'reviewing', label: '复习中', hint: `${LEARNING_INTERVAL_DAYS}–${STABLE_INTERVAL_DAYS} 天` },
  { id: 'stable', label: '已稳定', hint: `> ${STABLE_INTERVAL_DAYS} 天` },
];

export interface MasteryDistribution {
  /** 已有排期（评过分）的题目数。 */
  readonly total: number;
  /** 还没评过分的题目数（不计入四档）。 */
  readonly unrated: number;
  readonly counts: Readonly<Record<MasteryLevel, number>>;
  /** 与 gainWindowDays 天前相比，「已稳定」增加的题数；没传 reviews 时为 null。 */
  readonly stableGain: number | null;
}

export interface IntervalChange {
  readonly submissionId: string;
  readonly problemId: string;
  /** 这次评分前的间隔；首次评分为 null。 */
  readonly previousDays: number | null;
  /** 这次评分后排的间隔；缺少题目记录时为 null。 */
  readonly nextDays: number | null;
  readonly trend: 'first' | 'up' | 'down' | 'same';
}

/** 最近一次评分后排的间隔（天）。 */
export function currentIntervalDays(card: SerializedFsrsCard): number {
  if (card.scheduled_days > 0) return card.scheduled_days;
  if (card.last_review === undefined) return 0;
  return Math.max(0, Math.round((card.due - card.last_review) / DAY_MS));
}

export function classifyMastery(card: Pick<SerializedFsrsCard, 'reps'>, intervalDays: number): MasteryLevel {
  if (card.reps <= 1) return 'new';
  return levelFromInterval(intervalDays);
}

export function computeMasteryDistribution(
  problems: readonly ProblemRecord[],
  options: { readonly reviews?: readonly SubmissionReview[]; readonly now?: number; readonly gainWindowDays?: number } = {},
): MasteryDistribution {
  const counts: Record<MasteryLevel, number> = { new: 0, learning: 0, reviewing: 0, stable: 0 };
  let unrated = 0;
  for (const problem of problems) {
    const card = problem.fsrsCard;
    if (!card) { unrated += 1; continue; }
    counts[classifyMastery(card, currentIntervalDays(card))] += 1;
  }
  const total = problems.length - unrated;
  const stableGain = options.reviews
    ? counts.stable - countStableAt(problems, options.reviews, (options.now ?? Date.now()) - (options.gainWindowDays ?? 7) * DAY_MS)
    : null;
  return { total, unrated, counts, stableGain };
}

/**
 * 单道题的已评分轨迹（时间正序）。
 * 注意：FSRS 日志里的 scheduled_days 记的是“这次评分之前”排的间隔，
 * 所以第 i 次评分后排的间隔 = 第 i+1 次日志的 scheduled_days；最后一次取题目卡片的当前间隔。
 */
export function buildReviewHistory(
  reviews: readonly SubmissionReview[],
  card: SerializedFsrsCard | null,
): ReviewHistoryEntry[] {
  const rated = orderRated(reviews);
  return rated.map((review, index) => {
    const next = rated[index + 1];
    const scheduledDays = next ? (next.fsrsLog?.scheduled_days ?? 0) : (card ? currentIntervalDays(card) : 0);
    return { submissionId: review.submissionId, acceptedAt: review.acceptedAt, rating: review.rating, scheduledDays };
  });
}

/** 每条已评分记录的间隔变化，键为 submissionId。 */
export function computeIntervalChanges(
  reviews: readonly SubmissionReview[],
  problems: readonly ProblemRecord[],
): ReadonlyMap<string, IntervalChange> {
  const cards = new Map(problems.map((problem) => [problem.problemId, problem.fsrsCard]));
  const changes = new Map<string, IntervalChange>();
  for (const [problemId, problemReviews] of groupByProblem(reviews)) {
    const known = cards.has(problemId);
    const history = buildReviewHistory(problemReviews, cards.get(problemId) ?? null);
    history.forEach((entry, index) => {
      const previousDays = index === 0 ? null : history[index - 1]!.scheduledDays;
      const isLast = index === history.length - 1;
      const nextDays = isLast && !known ? null : entry.scheduledDays;
      changes.set(entry.submissionId, { submissionId: entry.submissionId, problemId, previousDays, nextDays, trend: trendOf(previousDays, nextDays) });
    });
  }
  return changes;
}

/**
 * 当前记忆概率（FSRS-6 遗忘曲线）：R(t, S) = (1 + factor · t / S)^(-decay)，
 * factor = 0.9^(-1/decay) − 1。与 ts-fsrs 的 forgetting_curve 相同（见 tests/stats.test.ts 的对照），
 * 手写是为了不把调度器打进前端包。t 用实际经过的天数（可带小数）。
 */
export function computeRetrievability(
  card: SerializedFsrsCard | null,
  now: number,
  decay = FSRS6_DEFAULT_DECAY,
): number | null {
  if (!card || card.last_review === undefined || card.stability <= 0) return null;
  const elapsedDays = Math.max(0, (now - card.last_review) / DAY_MS);
  const factor = Math.pow(0.9, -1 / decay) - 1;
  return Math.pow(1 + (factor * elapsedDays) / card.stability, -decay);
}

/** 已评分记录按时间正序（同一时间按 submissionId），与 FSRS 重放顺序一致。 */
export function orderRated(
  reviews: readonly SubmissionReview[],
): (SubmissionReview & { readonly rating: NonNullable<SubmissionReview['rating']> })[] {
  return reviews
    .filter((review): review is SubmissionReview & { readonly rating: NonNullable<SubmissionReview['rating']> } => review.rating !== null)
    .sort((left, right) => left.acceptedAt - right.acceptedAt || left.submissionId.localeCompare(right.submissionId));
}

function countStableAt(
  problems: readonly ProblemRecord[],
  reviews: readonly SubmissionReview[],
  at: number,
): number {
  const cards = new Map(problems.map((problem) => [problem.problemId, problem.fsrsCard]));
  let stable = 0;
  for (const [problemId, problemReviews] of groupByProblem(reviews)) {
    if (!cards.has(problemId)) continue;
    const history = buildReviewHistory(problemReviews, cards.get(problemId) ?? null);
    const reached = history.filter((entry) => entry.acceptedAt <= at);
    const last = reached.at(-1);
    if (last && reached.length > 1 && levelFromInterval(last.scheduledDays) === 'stable') stable += 1;
  }
  return stable;
}

function levelFromInterval(intervalDays: number): MasteryLevel {
  if (intervalDays < LEARNING_INTERVAL_DAYS) return 'learning';
  if (intervalDays <= STABLE_INTERVAL_DAYS) return 'reviewing';
  return 'stable';
}

function trendOf(previousDays: number | null, nextDays: number | null): IntervalChange['trend'] {
  if (previousDays === null) return 'first';
  if (nextDays === null || nextDays === previousDays) return 'same';
  if (nextDays > previousDays) return 'up';
  return 'down';
}

function groupByProblem(reviews: readonly SubmissionReview[]): Map<string, SubmissionReview[]> {
  const grouped = new Map<string, SubmissionReview[]>();
  for (const review of reviews) {
    const list = grouped.get(review.problemId) ?? [];
    list.push(review);
    grouped.set(review.problemId, list);
  }
  return grouped;
}
