import { describe, expect, it } from 'vitest';

import { getFsrsParameters, previewPendingReview, replayReviews } from '../src/background/fsrs';
import type { MasteryRating, SubmissionReview } from '../src/domain/types';

const DAY_MS = 24 * 60 * 60 * 1_000;
const START = Date.UTC(2026, 0, 1, 9);

describe('FSRS 重放', () => {
  it('使用规定的 FSRS-6 参数且关闭短期步骤和随机扰动', () => {
    const parameters = getFsrsParameters();

    expect(parameters).toMatchObject({
      request_retention: 0.9,
      maximum_interval: 36_500,
      enable_fuzz: false,
      enable_short_term: false,
      learning_steps: [],
      relearning_steps: [],
    });
    expect(parameters.w).toHaveLength(21);
  });

  it('待评估记录不创建排期', () => {
    const pending = makeReview({ submissionId: '1', acceptedAt: START, rating: null });

    expect(replayReviews([pending])).toEqual({ card: null, reviews: [pending] });
  });

  it('四档评分生成从短到长的确定性预览', () => {
    const pending = makeReview({ submissionId: '1', acceptedAt: START, rating: null });
    const first = previewPendingReview([pending], pending.submissionId);
    const second = previewPendingReview([pending], pending.submissionId);

    expect(first).toEqual(second);
    expect(first.AGAIN).toBeLessThanOrEqual(first.HARD);
    expect(first.HARD).toBeLessThanOrEqual(first.GOOD);
    expect(first.GOOD).toBeLessThanOrEqual(first.EASY);
  });

  it('每个新 Accepted 都会增加一次复习', () => {
    const reviews = [
      makeReview({ submissionId: '1', acceptedAt: START, rating: 'GOOD' }),
      makeReview({ submissionId: '2', acceptedAt: START + DAY_MS, rating: 'EASY' }),
    ];

    const result = replayReviews(reviews);

    expect(result.card?.reps).toBe(2);
    expect(result.reviews.every((review) => review.fsrsLog !== null)).toBe(true);
  });

  it('晚补早期评分时会按 acceptedAt 重建后续日志', () => {
    const earlyPending = makeReview({ submissionId: 'early', acceptedAt: START, rating: null });
    const laterRated = makeReview({
      submissionId: 'later',
      acceptedAt: START + 10 * DAY_MS,
      rating: 'GOOD',
    });
    const before = replayReviews([laterRated, earlyPending]);
    const after = replayReviews([{ ...earlyPending, rating: 'HARD' }, laterRated]);
    const chronological = replayReviews([{ ...earlyPending, rating: 'HARD' }, laterRated]);

    expect(after).toEqual(chronological);
    expect(after.card?.reps).toBe(2);
    expect(after.reviews.find((review) => review.submissionId === 'early')?.fsrsLog).not.toBeNull();
    expect(after.reviews.find((review) => review.submissionId === 'later')?.fsrsLog).not.toEqual(
      before.reviews.find((review) => review.submissionId === 'later')?.fsrsLog,
    );
  });
});

function makeReview(options: {
  readonly submissionId: string;
  readonly acceptedAt: number;
  readonly rating: MasteryRating | null;
}): SubmissionReview {
  return {
    submissionId: options.submissionId,
    problemId: 'leetcode-cn:two-sum',
    trigger: 'button',
    acceptedAt: options.acceptedAt,
    detectedAt: options.acceptedAt + 100,
    rating: options.rating,
    fsrsLog: null,
  };
}
