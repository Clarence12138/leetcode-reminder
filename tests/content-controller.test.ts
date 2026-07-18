import { describe, expect, it, vi } from 'vitest';
import { ContentController, type ContentNotice } from '../src/leetcode/content-controller';

const ACCEPTED_AT = Date.UTC(2026, 6, 17, 11);
const NEXT_REVIEW_AT = Date.UTC(2026, 6, 20, 11);

describe('ContentController', () => {
  it('评分成功提示使用卡片的下一次排期，而不是本次 FSRS 日志的旧 due', async () => {
    const sendMessage = vi.fn().mockImplementation((request: { readonly type: string }) => {
      if (request.type === 'submission.accepted') {
        return Promise.resolve({
          ok: true,
          data: { created: true, review: review(null, null), nextReviewAt: null },
        });
      }
      if (request.type === 'review.preview') {
        return Promise.resolve({
          ok: true,
          data: {
            AGAIN: ACCEPTED_AT + 86_400_000,
            HARD: ACCEPTED_AT + 172_800_000,
            GOOD: NEXT_REVIEW_AT,
            EASY: ACCEPTED_AT + 691_200_000,
          },
        });
      }
      if (request.type === 'submission.rate') {
        return Promise.resolve({
          ok: true,
          data: {
            review: review('GOOD', ACCEPTED_AT),
            nextReviewAt: NEXT_REVIEW_AT,
          },
        });
      }
      throw new Error(`unexpected request: ${request.type}`);
    });
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage } },
    });
    const notices: ContentNotice[] = [];
    const controller = new ContentController();
    controller.subscribe((notice) => notices.push(notice));

    await controller.handleAccepted({
      metadata: {
        problemId: 'leetcode-cn:two-sum',
        slug: 'two-sum',
        frontendId: '1',
        title: '两数之和',
        difficulty: 'EASY',
        tags: ['数组'],
        url: 'https://leetcode.cn/problems/two-sum/',
      },
      submissionId: '736466958',
      acceptedAt: ACCEPTED_AT,
      trigger: 'button',
    });
    await controller.rate('GOOD');

    expect(notices.at(-1)).toEqual({
      kind: 'success',
      title: '两数之和',
      nextReviewAt: NEXT_REVIEW_AT,
    });
  });
});

function review(rating: 'GOOD' | null, logDue: number | null) {
  return {
    submissionId: '736466958',
    problemId: 'leetcode-cn:two-sum',
    trigger: 'button' as const,
    acceptedAt: ACCEPTED_AT,
    detectedAt: ACCEPTED_AT + 1_000,
    rating,
    fsrsLog: logDue === null ? null : {
      rating: 3,
      state: 0,
      due: logDue,
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      last_elapsed_days: 0,
      scheduled_days: 3,
      review: ACCEPTED_AT,
    },
  };
}
