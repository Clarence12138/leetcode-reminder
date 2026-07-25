import Dexie, { type EntityTable } from 'dexie';

import type { DetectionIssue, ProblemRecord, SubmissionReview } from '../domain/types';

type MutableDetectionIssue = { -readonly [Key in keyof DetectionIssue]: DetectionIssue[Key] };

export const DATABASE_NAME = 'xiaoshuaji-leetcode-review';

export class XiaoshuajiDatabase extends Dexie {
  readonly problems!: EntityTable<ProblemRecord, 'problemId'>;
  readonly submissions!: EntityTable<SubmissionReview, 'submissionId'>;
  readonly issues!: EntityTable<DetectionIssue, 'id'>;

  constructor(name = DATABASE_NAME) {
    super(name);
    this.version(1).stores({
      problems: 'problemId, slug, nextReviewAt, updatedAt, difficulty, *tags',
      submissions: 'submissionId, problemId, acceptedAt, rating',
      issues: '++id, slug, occurredAt, code, resolvedAt',
    });
    this.version(2)
      .stores({
        problems: 'problemId, slug, nextReviewAt, updatedAt, difficulty, *tags',
        submissions: 'submissionId, problemId, acceptedAt, rating',
        issues: '++id, slug, occurredAt, code, resolvedAt',
      })
      .upgrade((transaction) =>
        transaction
          .table<MutableDetectionIssue>('issues')
          .toCollection()
          .modify((issue) => {
            issue.readAt = issue.resolvedAt ?? null;
          }),
      );
  }
}
