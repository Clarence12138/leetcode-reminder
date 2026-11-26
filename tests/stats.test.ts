import { describe, expect, it } from 'vitest';
import { fsrs, forgetting_curve, generatorParameters, createEmptyCard, Rating } from 'ts-fsrs';

import {
  buildReviewHistory,
  computeForecast,
  computeHeatmap,
  computeIntervalChanges,
  computeMasteryDistribution,
  computeRetention,
  computeRetrievability,
  computeStreak,
  computeTodayProgress,
  localDayKey,
} from '../src/domain/stats';
import type { MasteryRating, ProblemRecord, SerializedFsrsCard, SubmissionReview } from '../src/domain/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const TZ = 'Asia/Shanghai';
/** 2026-03-11 周三 12:00（北京时间）。 */
const NOW = Date.UTC(2026, 2, 11, 4);

describe('分天', () => {
  it('按时区分天：UTC 前一天 16:30 在北京已是第二天', () => {
    expect(localDayKey(Date.UTC(2026, 2, 10, 16, 30), TZ)).toBe('2026-03-11');
    expect(localDayKey(Date.UTC(2026, 2, 10, 16, 30), 'UTC')).toBe('2026-03-10');
  });
});

describe('连续天数', () => {
  it('今天复习过时从今天往前数，断档后重新计数，并给出最长连续', () => {
    const reviews = [
      rated('a', NOW - 9 * DAY_MS), rated('a', NOW - 8 * DAY_MS), rated('a', NOW - 7 * DAY_MS), rated('a', NOW - 6 * DAY_MS),
      rated('b', NOW - 2 * DAY_MS), rated('b', NOW - DAY_MS), rated('c', NOW),
    ];
    const streak = computeStreak(reviews, { timezone: TZ, now: NOW });
    expect(streak).toMatchObject({ current: 3, longest: 4, activeToday: true, lastActiveDay: '2026-03-11' });
    expect(streak.week.map((day) => day.active)).toEqual([true, false, false, false, true, true, true]);
    expect(streak.week.at(-1)).toMatchObject({ day: '2026-03-11', isToday: true });
  });

  it('今天还没复习时算到昨天；跨时区边界按本地日期', () => {
    const lateYesterday = Date.UTC(2026, 2, 10, 15, 50); // 北京 3 月 10 日 23:50
    const reviews = [rated('a', lateYesterday), rated('a', lateYesterday - DAY_MS)];
    expect(computeStreak(reviews, { timezone: TZ, now: NOW })).toMatchObject({ current: 2, activeToday: false });
    expect(computeStreak(reviews, { timezone: TZ, now: NOW + 2 * DAY_MS }).current).toBe(0);
  });

  it('待评估和空数据不算复习', () => {
    expect(computeStreak([pending('a', NOW)], { timezone: TZ, now: NOW })).toMatchObject({ current: 0, longest: 0, lastActiveDay: null });
  });
});

describe('热力图', () => {
  it('按周一开头排列，本周今天之后标为未来，分档至少按 4 次封顶', () => {
    const reviews = [rated('a', NOW), rated('b', NOW), rated('c', NOW - DAY_MS), pending('d', NOW)];
    const heatmap = computeHeatmap(reviews, { timezone: TZ, now: NOW, weeks: 2 });
    expect(heatmap.cells).toHaveLength(14);
    expect(heatmap.cells[0]).toMatchObject({ day: '2026-03-02', weekday: 0 });
    const today = heatmap.cells.find((cell) => cell.isToday);
    expect(today).toMatchObject({ day: '2026-03-11', count: 2, level: 2, weekday: 2 });
    expect(heatmap.cells.filter((cell) => cell.isFuture)).toHaveLength(4);
    expect(heatmap).toMatchObject({ total: 3, activeDays: 2, max: 2 });
  });

  it('空数据全是 0 档', () => {
    const heatmap = computeHeatmap([], { timezone: TZ, now: NOW });
    expect(heatmap.cells).toHaveLength(43 * 7);
    expect(heatmap.cells.every((cell) => cell.level === 0)).toBe(true);
    expect(heatmap).toMatchObject({ total: 0, activeDays: 0, max: 0 });
  });
});

describe('未来 14 天负载', () => {
  it('逾期单列，今天包含已到期的，暂停和未排期的不算', () => {
    const problems = [
      problem('a', NOW - 3 * DAY_MS),
      problem('b', NOW - HOUR_MS),
      problem('c', NOW + 2 * DAY_MS),
      problem('d', NOW + 2 * DAY_MS, { pausedAt: NOW }),
      problem('e', null),
      problem('f', NOW + 20 * DAY_MS),
    ];
    const forecast = computeForecast(problems, { timezone: TZ, now: NOW });
    expect(forecast.overdue).toBe(1);
    expect(forecast.days).toHaveLength(14);
    expect(forecast.days[0]).toMatchObject({ day: '2026-03-11', count: 1, isToday: true });
    expect(forecast.days[2]?.count).toBe(1);
    expect(forecast).toMatchObject({ total: 2, max: 1 });
  });
});

describe('记住率', () => {
  it('排除每道题首次评分，统计没评「未掌握」的比例，并给出上一窗口', () => {
    const reviews = [
      rated('a', NOW - 40 * DAY_MS, 'GOOD'),
      rated('a', NOW - 35 * DAY_MS, 'AGAIN'),
      rated('a', NOW - 10 * DAY_MS, 'HARD'),
      rated('a', NOW - 2 * DAY_MS, 'AGAIN'),
      rated('b', NOW - DAY_MS, 'EASY'),
      rated('b', NOW, 'GOOD'),
    ];
    expect(computeRetention(reviews, { now: NOW })).toEqual({
      rate: 2 / 3, sample: 3, remembered: 2, previousRate: 0, previousSample: 1,
    });
  });

  it('没有样本时为 null', () => {
    expect(computeRetention([rated('a', NOW)], { now: NOW })).toMatchObject({ rate: null, sample: 0, previousRate: null });
  });
});

describe('今日进度', () => {
  it('与配额同口径：已复习不含首次评分，剩余受配额限制', () => {
    const due = [problem('a', NOW - DAY_MS), problem('b', NOW - DAY_MS), problem('c', NOW - DAY_MS), problem('p', NOW - DAY_MS, { pausedAt: NOW })];
    const reviews = [rated('x', NOW - 5 * DAY_MS), rated('x', NOW - HOUR_MS), rated('y', NOW - HOUR_MS)];
    const progress = computeTodayProgress({ dueProblems: due, reviews, settings: { dailyReviewLimit: 3, timezone: TZ }, now: NOW });
    expect(progress).toEqual({ completed: 1, remaining: 2, backlog: 1, target: 3, limit: 3, ratio: 1 / 3, done: false });
  });

  it('没有到期题时 ratio 为 0、done 为真', () => {
    expect(computeTodayProgress({ dueProblems: [], reviews: [], settings: { dailyReviewLimit: null, timezone: TZ }, now: NOW }))
      .toMatchObject({ target: 0, ratio: 0, done: true });
  });
});

describe('复习轨迹与间隔变化', () => {
  it('每次评分后的间隔取下一次日志的 scheduled_days，最后一次取卡片', () => {
    const { reviews, card } = replay([['GOOD', 0], ['GOOD', 3], ['AGAIN', 20], ['GOOD', 23]]);
    const history = buildReviewHistory(reviews, card);
    expect(history.map((entry) => entry.scheduledDays)).toEqual([
      reviews[1]!.fsrsLog!.scheduled_days,
      reviews[2]!.fsrsLog!.scheduled_days,
      reviews[3]!.fsrsLog!.scheduled_days,
      card.scheduled_days,
    ]);
    const changes = computeIntervalChanges(reviews, [{ ...problem('a', card.due), fsrsCard: card }]);
    expect(changes.get('a-0')).toMatchObject({ previousDays: null, trend: 'first' });
    expect(changes.get('a-1')?.trend).toBe('up');
    expect(changes.get('a-2')?.trend).toBe('down');
    expect(changes.get('a-3')).toMatchObject({ previousDays: history[2]!.scheduledDays, nextDays: card.scheduled_days });
  });
});

describe('掌握分布', () => {
  it('新学 / 学习中 / 复习中 / 已稳定 按评分次数与当前间隔分档', () => {
    const problems = [
      withCard('a', { reps: 1, scheduled_days: 30 }),
      withCard('b', { reps: 3, scheduled_days: 6 }),
      withCard('c', { reps: 3, scheduled_days: 7 }),
      withCard('d', { reps: 3, scheduled_days: 21 }),
      withCard('e', { reps: 4, scheduled_days: 22 }),
      problem('f', null),
    ];
    expect(computeMasteryDistribution(problems)).toEqual({
      total: 5, unrated: 1, counts: { new: 1, learning: 1, reviewing: 2, stable: 1 }, stableGain: null,
    });
  });

  it('给出近 7 天新增的已稳定题数', () => {
    const { reviews, card } = replay([['GOOD', 0], ['GOOD', 3], ['EASY', 17]], NOW - 20 * DAY_MS);
    const target = { ...problem('a', card.due), fsrsCard: card };
    const result = computeMasteryDistribution([target], { reviews, now: NOW });
    expect(card.scheduled_days).toBeGreaterThan(21);
    expect(result.counts.stable).toBe(1);
    expect(result.stableGain).toBe(1);
  });
});

describe('记忆概率', () => {
  it('与 ts-fsrs 的遗忘曲线一致，缺少复习时间时为 null', () => {
    const card = withCard('a', { reps: 2, scheduled_days: 10 }).fsrsCard!;
    const now = card.last_review! + 7.5 * DAY_MS;
    expect(computeRetrievability(card, now)).toBeCloseTo(forgetting_curve(0.1542, 7.5, card.stability), 6);
    expect(computeRetrievability(card, card.last_review!)).toBeCloseTo(1, 6);
    expect(computeRetrievability(null, now)).toBeNull();
    expect(computeRetrievability({ ...card, last_review: undefined }, now)).toBeNull();
  });
});

function rated(problemKey: string, acceptedAt: number, rating: MasteryRating = 'GOOD'): SubmissionReview {
  return { submissionId: `${problemKey}-${acceptedAt}`, problemId: problemKey, trigger: 'button', acceptedAt, detectedAt: acceptedAt, rating, fsrsLog: null };
}

function pending(problemKey: string, acceptedAt: number): SubmissionReview {
  return { ...rated(problemKey, acceptedAt), rating: null };
}

function problem(key: string, nextReviewAt: number | null, extra: Partial<ProblemRecord> = {}): ProblemRecord {
  return {
    problemId: key,
    slug: key,
    frontendId: key,
    title: key,
    difficulty: 'MEDIUM',
    tags: [],
    url: `https://leetcode.cn/problems/${key}/`,
    createdAt: 1,
    updatedAt: 1,
    fsrsCard: null,
    nextReviewAt,
    pausedAt: null,
    groupId: null,
    algorithm: 'FSRS-6',
    algorithmLibrary: 'ts-fsrs@5.4.1',
    parametersVersion: 'xiaoshuaji-fsrs-v1',
    ...extra,
  };
}

function withCard(key: string, card: Pick<SerializedFsrsCard, 'reps' | 'scheduled_days'>): ProblemRecord {
  const lastReview = NOW - 2 * DAY_MS;
  return {
    ...problem(key, lastReview + card.scheduled_days * DAY_MS),
    fsrsCard: {
      due: lastReview + card.scheduled_days * DAY_MS,
      stability: 12,
      difficulty: 5,
      elapsed_days: 0,
      scheduled_days: card.scheduled_days,
      reps: card.reps,
      lapses: 0,
      learning_steps: 0,
      state: 2,
      last_review: lastReview,
    },
  };
}

/** 用 ts-fsrs 真实重放一串评分（[评分, 距起点天数]），返回带日志的提交和最终卡片。 */
function replay(steps: readonly (readonly [MasteryRating, number])[], start = NOW - 30 * DAY_MS) {
  const scheduler = fsrs(generatorParameters({ enable_fuzz: false, enable_short_term: false, learning_steps: [], relearning_steps: [] }));
  const grades = { AGAIN: Rating.Again, HARD: Rating.Hard, GOOD: Rating.Good, EASY: Rating.Easy } as const;
  let card = createEmptyCard(new Date(start));
  const reviews: SubmissionReview[] = steps.map(([rating, day], index) => {
    const at = start + day * DAY_MS;
    const result = scheduler.next(card, new Date(at), grades[rating]);
    card = result.card;
    return {
      submissionId: `a-${index}`,
      problemId: 'a',
      trigger: 'button',
      acceptedAt: at,
      detectedAt: at,
      rating,
      fsrsLog: { ...result.log, due: result.log.due.getTime(), review: result.log.review.getTime() },
    };
  });
  const serialized: SerializedFsrsCard = {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state,
    last_review: card.last_review?.getTime() ?? start,
  };
  return { reviews, card: serialized };
}
