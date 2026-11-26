import { z } from 'zod';

import {
  builtinProblemListIdSchema,
  detectionIssueSchema,
  difficultySchema,
  masteryRatingSchema,
  problemMetadataSchema,
  settingsPatchSchema,
  submissionTriggerSchema,
  timestampSchema,
} from './entity-schemas';

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

const discardRequestSchema = z
  .object({
    type: z.literal('submission.discard'),
    payload: z.object({ submissionId: z.string().min(1) }).strict(),
  })
  .strict();

const unrateRequestSchema = z
  .object({
    type: z.literal('submission.unrate'),
    payload: z.object({ submissionId: z.string().min(1), rating: masteryRatingSchema.optional() }).strict(),
  })
  .strict();

const reviewNextRequestSchema = z
  .object({
    type: z.literal('review.next'),
    payload: z.object({ excludeProblemId: z.string().min(1).optional() }).strict().optional(),
  })
  .strict();

const reviewContextRequestSchema = z
  .object({
    type: z.literal('review.context'),
    payload: z.object({ problemId: z.string().min(1) }).strict(),
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
  .object({ type: z.literal('settings.update'), payload: settingsPatchSchema })
  .strict();

const backupImportRequestSchema = z
  .object({
    type: z.literal('backup.import'),
    payload: z.object({ backup: z.unknown(), mode: z.enum(['merge', 'replace']) }).strict(),
  })
  .strict();

const historyRatingModeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('uniform'), rating: masteryRatingSchema }).strict(),
  z.object({ mode: z.literal('manual') }).strict(),
]);

const historyImportRequestSchema = z
  .object({
    type: z.literal('history.import'),
    payload: z
      .object({
        problems: z.array(
          z
            .object({
              metadata: problemMetadataSchema,
              submissions: z
                .array(
                  z.object({ submissionId: z.string().min(1), acceptedAt: timestampSchema }).strict(),
                )
                .min(1),
            })
            .strict(),
        ),
        rating: historyRatingModeSchema,
      })
      .strict(),
  })
  .strict();

const issueRecordRequestSchema = z
  .object({
    type: z.literal('issue.record'),
    payload: detectionIssueSchema.omit({ id: true }),
  })
  .strict();

const issueIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .refine((issueIds) => new Set(issueIds).size === issueIds.length, {
    message: '异常 ID 不能重复',
  });

const issueStatusRequestSchemas = [
  z
    .object({
      type: z.literal('issue.mark-read'),
      payload: z.object({ issueIds: issueIdsSchema }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('issue.resolve'),
      payload: z.object({ issueIds: issueIdsSchema }).strict(),
    })
    .strict(),
] as const;

const problemIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .refine((problemIds) => new Set(problemIds).size === problemIds.length, {
    message: '题目 ID 不能重复',
  });

const listIdsSchema = z
  .array(builtinProblemListIdSchema)
  .min(1)
  .refine((listIds) => new Set(listIds).size === listIds.length, {
    message: '题单 ID 不能重复',
  });

const problemMutationRequestSchemas = [
  z
    .object({
      type: z.literal('problem.delete'),
      payload: z.object({ problemIds: problemIdsSchema }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('problem.set-paused'),
      payload: z.object({ problemIds: problemIdsSchema, paused: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('problem.set-group'),
      payload: z
        .object({ problemIds: problemIdsSchema, groupId: z.string().trim().min(1).nullable() })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('problem.apply-list-group'),
      payload: z
        .object({ listIds: listIdsSchema, groupId: z.string().trim().min(1).nullable() })
        .strict(),
    })
    .strict(),
] as const;

export const extensionRequestSchema = z.discriminatedUnion('type', [
  acceptedRequestSchema,
  rateRequestSchema,
  discardRequestSchema,
  unrateRequestSchema,
  reviewNextRequestSchema,
  reviewContextRequestSchema,
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
  historyImportRequestSchema,
  z
    .object({
      type: z.literal('history.start'),
      payload: z.object({ rating: historyRatingModeSchema }).strict(),
    })
    .strict(),
  z.object({ type: z.literal('history.cancel') }).strict(),
  issueRecordRequestSchema,
  ...issueStatusRequestSchemas,
  z.object({ type: z.literal('notification.test') }).strict(),
  z.object({ type: z.literal('data.clear') }).strict(),
  ...problemMutationRequestSchemas,
]);

export function parseExtensionRequest(input: unknown) {
  return extensionRequestSchema.parse(input);
}
