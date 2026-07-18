import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  type Card,
  type Grade,
  type ReviewLog,
} from 'ts-fsrs';

import {
  FSRS_MAXIMUM_INTERVAL_DAYS,
  FSRS_REQUEST_RETENTION,
} from '../domain/constants';
import type {
  MasteryRating,
  ReviewPreview,
  SerializedFsrsCard,
  SerializedFsrsLog,
  SubmissionReview,
} from '../domain/types';
import { AppError } from './errors';

const PARAMETERS = generatorParameters({
  request_retention: FSRS_REQUEST_RETENTION,
  maximum_interval: FSRS_MAXIMUM_INTERVAL_DAYS,
  enable_fuzz: false,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
});

const RATING_MAP: Readonly<Record<MasteryRating, Grade>> = {
  AGAIN: Rating.Again,
  HARD: Rating.Hard,
  GOOD: Rating.Good,
  EASY: Rating.Easy,
};

const PREVIEW_RATINGS = Object.freeze([
  'AGAIN',
  'HARD',
  'GOOD',
  'EASY',
] as const satisfies readonly MasteryRating[]);

export interface ReplayResult {
  readonly card: SerializedFsrsCard | null;
  readonly reviews: readonly SubmissionReview[];
}

export function getFsrsParameters() {
  return PARAMETERS;
}

export function replayReviews(reviews: readonly SubmissionReview[]): ReplayResult {
  const ordered = orderReviews(reviews);
  const rated = ordered.filter(hasRating);
  if (rated.length === 0) {
    return { card: null, reviews: reviews.map(clearLog) };
  }

  const scheduler = fsrs(PARAMETERS);
  let card: Card = createEmptyCard(new Date(rated[0]!.acceptedAt));
  const logs = new Map<string, SerializedFsrsLog>();

  for (const review of rated) {
    const result = scheduler.next(card, new Date(review.acceptedAt), RATING_MAP[review.rating]);
    card = result.card;
    logs.set(review.submissionId, serializeLog(result.log));
  }

  return {
    card: serializeCard(card),
    reviews: reviews.map((review) => ({
      ...review,
      fsrsLog: review.rating === null ? null : (logs.get(review.submissionId) ?? null),
    })),
  };
}

export function previewPendingReview(
  reviews: readonly SubmissionReview[],
  submissionId: string,
): ReviewPreview {
  const pending = reviews.find((review) => review.submissionId === submissionId);
  if (!pending) {
    throw new AppError('SUBMISSION_NOT_FOUND', `未找到提交 ${submissionId}`);
  }
  if (pending.rating !== null) {
    throw new AppError('REVIEW_ALREADY_RATED', `提交 ${submissionId} 已完成评估`);
  }

  return Object.fromEntries(
    PREVIEW_RATINGS.map((rating) => {
      const hypothetical = reviews.map((review) =>
        review.submissionId === pending.submissionId ? { ...review, rating } : review,
      );
      const due = replayReviews(hypothetical).card?.due;
      if (due === undefined) {
        throw new AppError('FSRS_PREVIEW_FAILED', '无法生成 FSRS 预览');
      }
      return [rating, due];
    }),
  ) as unknown as ReviewPreview;
}

function orderReviews(reviews: readonly SubmissionReview[]): SubmissionReview[] {
  return [...reviews].sort((left, right) => {
    const byTime = left.acceptedAt - right.acceptedAt;
    return byTime === 0 ? left.submissionId.localeCompare(right.submissionId) : byTime;
  });
}

function hasRating(
  review: SubmissionReview,
): review is SubmissionReview & { readonly rating: MasteryRating } {
  return review.rating !== null;
}

function clearLog(review: SubmissionReview): SubmissionReview {
  return review.fsrsLog === null ? review : { ...review, fsrsLog: null };
}

function serializeCard(card: Card): SerializedFsrsCard {
  const serialized = {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state,
  };
  return card.last_review
    ? { ...serialized, last_review: card.last_review.getTime() }
    : serialized;
}

function serializeLog(log: ReviewLog): SerializedFsrsLog {
  return {
    rating: log.rating,
    state: log.state,
    due: log.due.getTime(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    review: log.review.getTime(),
  };
}
