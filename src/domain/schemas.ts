import { z } from 'zod';

import { BACKUP_FORMAT, CURRENT_SCHEMA_VERSION } from './constants';

const timestampSchema = z.number().int().nonnegative();
const nullableTimestampSchema = timestampSchema.nullable();

export const difficultySchema = z.enum(['EASY', 'MEDIUM', 'HARD']);
export const masteryRatingSchema = z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']);
export const submissionTriggerSchema = z.enum(['button', 'keyboard']);

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
    resolvedAt: nullableTimestampSchema,
  })
  .strict();

export const settingsSchema = z
  .object({
    notificationsEnabled: z.boolean(),
    reminderHour: z.number().int().min(0).max(23),
    reminderMinute: z.number().int().min(0).max(59),
    timezone: z.string().min(1),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
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
    format: z.literal(BACKUP_FORMAT),
    exportedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: '必须是有效的 ISO 时间',
    }),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    settings: settingsSchema,
    problems: z.array(problemRecordSchema),
    submissions: z.array(submissionReviewSchema),
    issues: z.array(detectionIssueSchema),
  })
  .strict();

const acceptedRequestSchema = z
  .object({
    type: z.literal('submission.accepted'),
    payload: z
      .object({
        metadata: problemMetadataSchema,
        submissionId: z.string().min(1),
        trigger: submissionTriggerSchema,
        acceptedAt: timestampSchema,
      })
      .strict(),
  })
  .strict();

const rateRequestSchema = z
  .object({
    type: z.literal('submission.rate'),
    payload: z
      .object({ submissionId: z.string().min(1), rating: masteryRatingSchema })
      .strict(),
  })
  .strict();

const dashboardRequestSchema = z
  .object({
    type: z.literal('dashboard.query'),
    payload: z
      .object({
        search: z.string().optional(),
        difficulty: difficultySchema.optional(),
        tag: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const settingsUpdateRequestSchema = z
  .object({ type: z.literal('settings.update'), payload: settingsSchema.partial().strict() })
  .strict();

const backupImportRequestSchema = z
  .object({
    type: z.literal('backup.import'),
    payload: z.object({ backup: z.unknown(), mode: z.enum(['merge', 'replace']) }).strict(),
  })
  .strict();

const issueRecordRequestSchema = z
  .object({
    type: z.literal('issue.record'),
    payload: detectionIssueSchema.omit({ id: true }),
  })
  .strict();

const problemDeleteRequestSchema = z
  .object({
    type: z.literal('problem.delete'),
    payload: z.object({ problemId: z.string().min(1) }).strict(),
  })
  .strict();

export const extensionRequestSchema = z.discriminatedUnion('type', [
  acceptedRequestSchema,
  rateRequestSchema,
  z
    .object({
      type: z.literal('review.preview'),
      payload: z
        .object({ problemId: z.string().min(1), submissionId: z.string().min(1) })
        .strict(),
    })
    .strict(),
  dashboardRequestSchema,
  settingsUpdateRequestSchema,
  z.object({ type: z.literal('settings.get') }).strict(),
  z.object({ type: z.literal('backup.export') }).strict(),
  backupImportRequestSchema,
  issueRecordRequestSchema,
  z.object({ type: z.literal('notification.test') }).strict(),
  z.object({ type: z.literal('data.clear') }).strict(),
  problemDeleteRequestSchema,
]);

export function parseBackup(input: unknown) {
  return backupV1Schema.parse(input);
}

export function parseExtensionRequest(input: unknown) {
  return extensionRequestSchema.parse(input);
}
