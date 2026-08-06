import { z } from 'zod';

export const submissionStatusSchema = z
  .object({
    state: z.string(),
    status_code: z.number().int().optional(),
    status_msg: z.string().optional(),
    submission_id: z.union([z.string(), z.number()]).optional(),
    task_finish_time: z.number().finite().optional(),
  })
  .passthrough()
  .transform((value) => ({
    state: value.state,
    statusCode: value.status_code,
    statusMessage: value.status_msg,
    submissionId: value.submission_id === undefined ? undefined : String(value.submission_id),
    taskFinishTime: value.task_finish_time,
  }));

const difficultySchema = z.string().transform((value, context) => {
  const normalized = value.toUpperCase();
  if (normalized === 'EASY' || normalized === 'MEDIUM' || normalized === 'HARD') {
    return normalized;
  }
  context.addIssue({ code: 'custom', message: `未知难度：${value}` });
  return z.NEVER;
});

const topicTagSchema = z.object({
  name: z.string().min(1),
  translatedName: z.string().min(1).nullable(),
});

export const questionResponseSchema = z.object({
  data: z.object({
    question: z.object({
      questionFrontendId: z.string().min(1),
      translatedTitle: z.string().min(1),
      titleSlug: z.string().min(1),
      difficulty: difficultySchema,
      topicTags: z.array(topicTagSchema),
    }),
  }),
});

export type SubmissionStatus = z.output<typeof submissionStatusSchema>;
