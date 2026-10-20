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

const idSchema = z.union([z.string().min(1), z.number().int()]).transform(String);

const progressQuestionSchema = z.object({
  frontendId: idSchema,
  title: z.string().nullish(),
  translatedTitle: z.string().nullish(),
  titleSlug: z.string().min(1),
  difficulty: difficultySchema,
  topicTags: z
    .array(z.object({ name: z.string().min(1), nameTranslated: z.string().nullish() }))
    .nullish(),
});

export const progressQuestionListResponseSchema = z.object({
  data: z.object({
    userProgressQuestionList: z
      .object({
        totalNum: z.number().int().nonnegative(),
        questions: z.array(progressQuestionSchema),
      })
      .nullable(),
  }),
});

const EARLIEST_SUBMISSION_MS = Date.UTC(2015, 0, 1);
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

// 力扣返回 Unix 秒（字符串或数字）；已是毫秒时原样保留，其他量级或越界时间直接判为结构变化。
const submissionTimestampSchema = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((value) => {
    const numeric = Number(value);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  })
  .refine((ms) => ms >= EARLIEST_SUBMISSION_MS && ms <= Date.now() + FUTURE_TOLERANCE_MS, {
    message: '提交时间不在合理范围内',
  });

export const submissionListResponseSchema = z.object({
  data: z.object({
    submissionList: z
      .object({
        lastKey: z.string().nullish(),
        hasNext: z.boolean().nullish(),
        submissions: z.array(
          z.object({
            id: idSchema,
            status: z.union([z.string(), z.number()]).nullish(),
            statusDisplay: z.string().nullish(),
            timestamp: submissionTimestampSchema,
          }),
        ),
      })
      .nullable(),
  }),
});

export type ProgressQuestion = z.output<typeof progressQuestionSchema>;

export type SubmissionStatus = z.output<typeof submissionStatusSchema>;
