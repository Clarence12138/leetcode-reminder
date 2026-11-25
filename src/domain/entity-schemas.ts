import { z } from 'zod';

import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  DATA_MIRROR_FORMAT,
  FSRS_MAX_RETENTION,
  FSRS_MIN_RETENTION,
  FSRS_REQUEST_RETENTION,
  LEGACY_BACKUP_FORMAT,
  MAX_DAILY_REVIEW_LIMIT,
  MAX_REVIEW_GROUPS,
} from './constants';
import type { BackupV2 } from './types';

export const timestampSchema = z.number().int().nonnegative();
export const nullableTimestampSchema = timestampSchema.nullable();

export const difficultySchema = z.enum(['EASY', 'MEDIUM', 'HARD']);
export const masteryRatingSchema = z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']);
export const submissionTriggerSchema = z.enum(['button', 'keyboard', 'import']);
export const queueSortStrategySchema = z.enum(['due_asc', 'priority', 'stability_asc']);
export const builtinProblemListIdSchema = z.enum([
  'hot-100',
  'top-interview-150',
  'codetop-100',
]);
export const requestRetentionSchema = z
  .number()
  .finite()
  .min(FSRS_MIN_RETENTION)
  .max(FSRS_MAX_RETENTION);

export const reviewGroupSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(32),
    requestRetention: requestRetentionSchema,
  })
  .strict();

export const autoGroupRuleSchema = z
  .object({
    listId: builtinProblemListIdSchema,
    groupId: z.string().trim().min(1).max(64),
  })
  .strict();

export const problemMetadataSchema = z
  .object({
    problemId: z.string().min(1),
    slug: z.string().min(1),
    frontendId: z.string().min(1),
    title: z.string().min(1),
    difficulty: difficultySchema,
    tags: z.array(z.string().min(1)),
    url: z.string().url(),
  })
  .strict();

export const serializedFsrsCardSchema = z
  .object({
    due: timestampSchema,
    stability: z.number().finite(),
    difficulty: z.number().finite(),
    elapsed_days: z.number().finite(),
    scheduled_days: z.number().finite(),
    reps: z.number().int().nonnegative(),
    lapses: z.number().int().nonnegative(),
    learning_steps: z.number().int().nonnegative(),
    state: z.number().int().nonnegative(),
    last_review: timestampSchema.optional(),
  })
  .strict();

export const serializedFsrsLogSchema = z
  .object({
    rating: z.number().int().nonnegative(),
    state: z.number().int().nonnegative(),
    due: timestampSchema,
    stability: z.number().finite(),
    difficulty: z.number().finite(),
    elapsed_days: z.number().finite(),
    last_elapsed_days: z.number().finite(),
    scheduled_days: z.number().finite(),
    review: timestampSchema,
  })
  .strict();

export const problemRecordSchema = problemMetadataSchema.extend({
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  fsrsCard: serializedFsrsCardSchema.nullable(),
  nextReviewAt: nullableTimestampSchema,
  pausedAt: nullableTimestampSchema.default(null),
  groupId: z.string().min(1).nullable().default(null),
  algorithm: z.literal('FSRS-6'),
  algorithmLibrary: z.string().min(1),
  parametersVersion: z.string().min(1),
});

export const submissionReviewSchema = z
  .object({
    submissionId: z.string().min(1),
    problemId: z.string().min(1),
    trigger: submissionTriggerSchema,
    acceptedAt: timestampSchema,
    detectedAt: timestampSchema,
    rating: masteryRatingSchema.nullable(),
    fsrsLog: serializedFsrsLogSchema.nullable(),
  })
  .strict();

export const detectionIssueSchema = z
  .object({
    id: z.number().int().positive().optional(),
    slug: z.string().min(1),
    occurredAt: timestampSchema,
    code: z.enum([
      'AUTH_REQUIRED',
      'NETWORK_ERROR',
      'TIMEOUT',
      'UNKNOWN_RESPONSE',
      'METADATA_ERROR',
      'CONTEXT_CHANGED',
    ]),
    retryable: z.boolean(),
    diagnostic: z.string().min(1),
    readAt: nullableTimestampSchema,
    resolvedAt: nullableTimestampSchema,
  })
  .strict();

export const settingsPatchSchema = z
  .object({
    notificationsEnabled: z.boolean(),
    reminderHour: z.number().int().min(0).max(23),
    reminderMinute: z.number().int().min(0).max(59),
    timezone: z.string().min(1),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    resetCodeOnReview: z.boolean(),
    dailyReviewLimit: z.number().int().min(1).max(MAX_DAILY_REVIEW_LIMIT).nullable(),
    queueSortStrategy: queueSortStrategySchema,
    defaultRequestRetention: requestRetentionSchema,
    reviewGroups: z.array(reviewGroupSchema).max(MAX_REVIEW_GROUPS),
    autoGroupRules: z.array(autoGroupRuleSchema),
  })
  .partial()
  .strict();

export const settingsSchema = z
  .object({
    notificationsEnabled: z.boolean(),
    reminderHour: z.number().int().min(0).max(23),
    reminderMinute: z.number().int().min(0).max(59),
    timezone: z.string().min(1),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    resetCodeOnReview: z.boolean().default(false),
    dailyReviewLimit: z.number().int().min(1).max(MAX_DAILY_REVIEW_LIMIT).nullable().default(null),
    queueSortStrategy: queueSortStrategySchema.default('due_asc'),
    defaultRequestRetention: requestRetentionSchema.default(FSRS_REQUEST_RETENTION),
    reviewGroups: z.array(reviewGroupSchema).max(MAX_REVIEW_GROUPS).default([]),
    autoGroupRules: z.array(autoGroupRuleSchema).default([]),
  })
  .strict();

export const settingsV0Schema = z
  .object({
    notificationsEnabled: z.boolean(),
    reminderHour: z.number().int().min(0).max(23),
    reminderMinute: z.number().int().min(0).max(59),
    timezone: z.string().min(1),
    schemaVersion: z.literal(0),
  })
  .strict();

export const backupV1Schema = z
  .object({
    format: z.literal(LEGACY_BACKUP_FORMAT),
    exportedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: '必须是有效的 ISO 时间',
    }),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    settings: settingsSchema,
    problems: z.array(problemRecordSchema),
    submissions: z.array(submissionReviewSchema),
    issues: z.array(detectionIssueSchema.omit({ readAt: true })),
  })
  .strict();

export const backupV2Schema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    exportedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: '必须是有效的 ISO 时间',
    }),
    schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
    settings: settingsSchema,
    problems: z.array(problemRecordSchema),
    submissions: z.array(submissionReviewSchema),
    issues: z.array(detectionIssueSchema),
  })
  .strict();

export const dataMirrorSchema = z
  .object({
    format: z.literal(DATA_MIRROR_FORMAT),
    savedAt: timestampSchema,
    problems: z.array(problemRecordSchema),
    submissions: z.array(submissionReviewSchema),
    issues: z.array(detectionIssueSchema),
  })
  .strict();

export function parseBackup(input: unknown): BackupV2 {
  const backup = z.discriminatedUnion('format', [backupV1Schema, backupV2Schema]).parse(input);
  if (backup.format === BACKUP_FORMAT) return backup;
  return {
    ...backup,
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    issues: backup.issues.map((issue) => ({
      ...issue,
      readAt: issue.resolvedAt,
    })),
  };
}
