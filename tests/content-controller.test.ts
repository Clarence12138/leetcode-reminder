import { describe, expect, it, vi } from 'vitest';
import { ContentController, UNDO_WINDOW_MS, type ContentNotice } from '../src/leetcode/content-controller';

const ACCEPTED_AT = Date.UTC(2026, 6, 17, 11);
const NEXT_REVIEW_AT = Date.UTC(2026, 6, 20, 11);
const CONTEXT = { problem: null, history: [], retrievability: null };
const ACCEPTED = {
  metadata: {
    problemId: 'leetcode-cn:two-sum',
    slug: 'two-sum',
    frontendId: '1',
    title: '两数之和',
    difficulty: 'EASY' as const,
    tags: ['数组'],
    url: 'https://leetcode.cn/problems/two-sum/',
  },
  submissionId: '736466958',
  acceptedAt: ACCEPTED_AT,
  trigger: 'button' as const,
};

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
      if (request.type === 'review.context') return Promise.resolve({ ok: true, data: CONTEXT });
      if (request.type === 'review.next') return Promise.resolve({ ok: true, data: { problem: null, url: null, remainingToday: 0 } });
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

    expect(notices.at(-1)).toMatchObject({
      kind: 'success',
      title: '两数之和',
      rating: 'GOOD',
      nextReviewAt: NEXT_REVIEW_AT,
    });
  });

  it('不记录本次会丢弃待评估提交并展示确认提示', async () => {
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
      if (request.type === 'submission.discard') {
        return Promise.resolve({ ok: true, data: { problemDeleted: true } });
      }
      if (request.type === 'review.context') return Promise.resolve({ ok: true, data: CONTEXT });
      if (request.type === 'review.next') return Promise.resolve({ ok: true, data: { problem: null, url: null, remainingToday: 0 } });
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
    await controller.discard();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'submission.discard',
      payload: { submissionId: '736466958' },
    });
    expect(notices.at(-1)).toEqual({
      kind: 'discarded',
      title: '两数之和',
    });
  });
  describe('页内卡新增流程', () => {
    const PREVIEW = {
      AGAIN: ACCEPTED_AT + 86_400_000,
      HARD: ACCEPTED_AT + 172_800_000,
      GOOD: NEXT_REVIEW_AT,
      EASY: ACCEPTED_AT + 691_200_000,
    };
    const NEXT = {
      problem: { frontendId: '42', title: '接雨水', difficulty: 'HARD', problemId: 'leetcode-cn:trapping-rain-water' },
      url: 'https://leetcode.cn/problems/trapping-rain-water/',
      remainingToday: 3,
    };

    function install(overrides: Record<string, () => unknown> = {}) {
      const handlers: Record<string, () => unknown> = {
        'submission.accepted': () => ({ created: true, review: review(null, null), nextReviewAt: null }),
        'review.preview': () => PREVIEW,
        'review.context': () => CONTEXT,
        'submission.rate': () => ({ review: review('GOOD', ACCEPTED_AT), nextReviewAt: NEXT_REVIEW_AT }),
        'submission.unrate': () => ({ review: review(null, null), nextReviewAt: null }),
        'review.next': () => NEXT,
        ...overrides,
      };
      const sendMessage = vi.fn().mockImplementation((request: { readonly type: string }) => {
        const handler = handlers[request.type];
        if (!handler) throw new Error(`unexpected request: ${request.type}`);
        try {
          return Promise.resolve({ ok: true, data: handler() });
        } catch (error) {
          return Promise.resolve({ ok: false, error: { code: 'X', message: error instanceof Error ? error.message : 'x' } });
        }
      });
      Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage } } });
      const controller = new ContentController();
      const notices: ContentNotice[] = [];
      controller.subscribe((notice) => notices.push(notice));
      return { controller, sendMessage, last: () => notices.at(-1) };
    }

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('检测到 Accepted 后同时加载预览和复习轨迹', async () => {
      const { controller, last } = install();
      await controller.handleAccepted(ACCEPTED);
      expect(last()).toMatchObject({ kind: 'rating', preview: PREVIEW, context: CONTEXT, contextLoading: false });
    });

    it('轨迹加载失败不影响评分', async () => {
      const { controller, last } = install({ 'review.context': () => { throw new Error('boom'); } });
      await controller.handleAccepted(ACCEPTED);
      expect(last()).toMatchObject({ kind: 'rating', preview: PREVIEW, context: null, contextLoading: false });
      await controller.rate('GOOD');
      expect(last()).toMatchObject({ kind: 'success', rating: 'GOOD' });
    });

    it('评分后取下一题，排除当前题', async () => {
      const { controller, sendMessage, last } = install();
      await controller.handleAccepted(ACCEPTED);
      await controller.rate('GOOD');
      expect(last()).toMatchObject({ kind: 'success', next: { status: 'loading' } });
      await flush();
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'review.next',
        payload: { excludeProblemId: 'leetcode-cn:two-sum' },
      });
      expect(last()).toMatchObject({ kind: 'success', next: { status: 'ready', next: NEXT } });
    });

    it('取下一题失败只标记错误，不阻断完成态', async () => {
      const { controller, last } = install({ 'review.next': () => { throw new Error('nope'); } });
      await controller.handleAccepted(ACCEPTED);
      await controller.rate('GOOD');
      await flush();
      expect(last()).toMatchObject({ kind: 'success', next: { status: 'error' } });
    });

    it('撤销评分回到评分态并重新拉取预览和轨迹', async () => {
      const { controller, sendMessage, last } = install();
      await controller.handleAccepted(ACCEPTED);
      await controller.rate('GOOD');
      await flush();
      sendMessage.mockClear();
      await controller.undo();
      expect(sendMessage).toHaveBeenCalledWith({ type: 'submission.unrate', payload: { submissionId: '736466958', rating: 'GOOD' } });
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'review.preview',
        payload: { problemId: 'leetcode-cn:two-sum', submissionId: '736466958' },
      });
      expect(sendMessage).toHaveBeenCalledWith({ type: 'review.context', payload: { problemId: 'leetcode-cn:two-sum' } });
      expect(last()).toMatchObject({ kind: 'rating', preview: PREVIEW, context: CONTEXT });
    });

    it('评分响应返回前卡片已被关闭：旧响应不再重开卡片', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const { controller, sendMessage, last } = install();
      await controller.handleAccepted(ACCEPTED);
      const original = sendMessage.getMockImplementation()!;
      sendMessage.mockImplementation(async (request: { readonly type: string }) => {
        if (request.type === 'submission.rate') await gate;
        return original(request) as unknown;
      });
      const pending = controller.rate('GOOD');
      controller.dismiss();
      release();
      await pending;
      await flush();
      expect(last()).toEqual({ kind: 'idle' });
      expect(sendMessage.mock.calls.some(([req]) => req.type === 'review.next')).toBe(false);
    });

    it('超过撤销窗口后撤销被忽略', async () => {
      const { controller, sendMessage, last } = install();
      await controller.handleAccepted(ACCEPTED);
      await controller.rate('GOOD');
      await flush();
      sendMessage.mockClear();
      const now = Date.now();
      const spy = vi.spyOn(Date, 'now').mockReturnValue(now + UNDO_WINDOW_MS + 1_000);
      await controller.undo();
      spy.mockRestore();
      expect(sendMessage).not.toHaveBeenCalled();
      expect(last()).toMatchObject({ kind: 'success' });
    });

    it('已评分的重复提交不提供撤销', async () => {
      const { controller, sendMessage, last } = install({
        'submission.accepted': () => ({ created: false, review: review('GOOD', ACCEPTED_AT), nextReviewAt: NEXT_REVIEW_AT }),
      });
      await controller.handleAccepted(ACCEPTED);
      expect(last()).toMatchObject({ kind: 'success', undoUntil: null });
      sendMessage.mockClear();
      await controller.undo();
      expect(sendMessage).not.toHaveBeenCalled();
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
