import { afterEach, describe, expect, it, vi } from 'vitest';
import { DETECTION_DEADLINE_MS } from '../src/domain/constants';
import type { ProblemMetadata } from '../src/domain/types';
import type { LeetCodeClient } from '../src/leetcode/api-client';
import { SubmissionDetector, type AcceptedSubmission } from '../src/leetcode/detector';

const FINISHED_AT = 1_784_284_605_541;
const metadata: ProblemMetadata = {
  problemId: 'leetcode-cn:two-sum',
  slug: 'two-sum',
  frontendId: '1',
  title: '两数之和',
  difficulty: 'EASY',
  tags: ['数组'],
  url: 'https://leetcode.cn/problems/two-sum/',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('SubmissionDetector 路由驱动检测', () => {
  it('同题提交详情路由直达结构化判题并记录 Accepted', async () => {
    const context = setup();
    context.detector.updateRoute(route('two-sum'));

    const detection = context.detector.recordIntent('keyboard');
    expect(context.client.getSubmissionStatus).not.toHaveBeenCalled();
    context.detector.updateRoute(route('two-sum', '736464467'));
    await detection;

    expect(context.client.getSubmissionStatus).toHaveBeenCalledWith(
      '736464467', expect.any(AbortSignal),
    );
    expect(context.accepted).toEqual([{
      metadata,
      submissionId: '736464467',
      acceptedAt: FINISHED_AT,
      trigger: 'keyboard',
    }]);
    expect(context.issues).toEqual([]);
  });

  it('同 slug 的中间页面变化不会取消正在进行的提交', async () => {
    const context = setup();
    context.detector.updateRoute(route('two-sum'));

    const detection = context.detector.recordIntent('button');
    context.detector.updateRoute(route('two-sum'));
    expect(context.client.getSubmissionStatus).not.toHaveBeenCalled();
    context.detector.updateRoute(route('two-sum', 'new-id'));
    await detection;

    expect(context.accepted).toHaveLength(1);
  });

  it('初始历史详情 ID 与重复路由不会绑定到新的提交意图', async () => {
    const context = setup();
    context.detector.updateRoute(route('two-sum', 'old-id'));

    const detection = context.detector.recordIntent('button');
    context.detector.updateRoute(route('two-sum', 'old-id'));
    expect(context.client.getSubmissionStatus).not.toHaveBeenCalled();
    context.detector.updateRoute(route('two-sum', 'new-id'));
    context.detector.updateRoute(route('two-sum', 'new-id'));
    await detection;

    expect(context.client.getSubmissionStatus).toHaveBeenCalledTimes(1);
    expect(context.client.getSubmissionStatus).toHaveBeenCalledWith(
      'new-id', expect.any(AbortSignal),
    );
  });

  it('绑定首个新 ID 后不会被后续路由换绑', async () => {
    const context = setup();
    let finishStatus: ((value: ReturnType<typeof acceptedStatus>) => void) | undefined;
    context.client.getSubmissionStatus.mockImplementation(() => new Promise((resolve) => {
      finishStatus = resolve;
    }));
    context.detector.updateRoute(route('two-sum'));

    const detection = context.detector.recordIntent('button');
    context.detector.updateRoute(route('two-sum', 'first-id'));
    await vi.waitFor(() => expect(finishStatus).toBeTypeOf('function'));
    context.detector.updateRoute(route('two-sum', 'second-id'));
    finishStatus?.(acceptedStatus('first-id'));
    await detection;

    expect(context.client.getSubmissionStatus).toHaveBeenCalledTimes(1);
    expect(context.accepted[0]?.submissionId).toBe('first-id');
  });

  it('非 Accepted 终态不创建记录或读取元数据', async () => {
    const context = setup();
    context.client.getSubmissionStatus.mockResolvedValue({
      ...acceptedStatus('wrong-id'), statusCode: 11,
    });
    context.detector.updateRoute(route('two-sum'));

    const detection = context.detector.recordIntent('button');
    context.detector.updateRoute(route('two-sum', 'wrong-id'));
    await detection;

    expect(context.accepted).toEqual([]);
    expect(context.client.getProblemMetadata).not.toHaveBeenCalled();
    expect(context.issues).toEqual([]);
  });

  it('终态缺失 status_code 时显式记录接口变化', async () => {
    const context = setup();
    context.client.getSubmissionStatus.mockResolvedValue({
      ...acceptedStatus('unknown-id'), statusCode: undefined,
    });
    context.detector.updateRoute(route('two-sum'));

    const detection = context.detector.recordIntent('button');
    context.detector.updateRoute(route('two-sum', 'unknown-id'));
    await detection;

    expect(context.accepted).toEqual([]);
    expect(context.issues).toContain('UNKNOWN_RESPONSE');
  });

  it('真正切换题目会中止等待且不记录异常', async () => {
    const context = setup();
    context.detector.updateRoute(route('two-sum'));

    const detection = context.detector.recordIntent('button');
    context.detector.updateRoute(route('add-two-numbers'));
    await detection;

    expect(context.client.getSubmissionStatus).not.toHaveBeenCalled();
    expect(context.issues).toEqual([]);
  });

  it('两分钟没有提交详情路由时显式超时', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    const context = setup(Date.now);
    context.detector.updateRoute(route('two-sum'));

    const detection = context.detector.recordIntent('button');
    await vi.advanceTimersByTimeAsync(DETECTION_DEADLINE_MS);
    await detection;

    expect(context.client.getSubmissionStatus).not.toHaveBeenCalled();
    expect(context.issues).toContain('TIMEOUT');
  });

  it('判题请求悬挂时仍受共享两分钟截止时间约束', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    const context = setup(Date.now);
    context.client.getSubmissionStatus.mockImplementation(() => new Promise(() => undefined));
    context.detector.updateRoute(route('two-sum'));

    const detection = context.detector.recordIntent('button');
    context.detector.updateRoute(route('two-sum', 'pending-id'));
    await vi.advanceTimersByTimeAsync(DETECTION_DEADLINE_MS);
    await detection;

    expect(context.accepted).toEqual([]);
    expect(context.issues).toContain('TIMEOUT');
  });

  it('取得 ID 后的重试复用同一 ID，不等待第二次路由', async () => {
    const context = setup();
    context.client.getSubmissionStatus
      .mockRejectedValueOnce(new TypeError('temporary network error'))
      .mockResolvedValueOnce(acceptedStatus('retry-id'));
    context.detector.updateRoute(route('two-sum'));

    const first = context.detector.recordIntent('button');
    context.detector.updateRoute(route('two-sum', 'retry-id'));
    await first;
    await context.detector.retryLast();

    expect(context.client.getSubmissionStatus).toHaveBeenCalledTimes(2);
    expect(context.accepted[0]?.submissionId).toBe('retry-id');
  });
});

function setup(now: () => number = Date.now) {
  const accepted: AcceptedSubmission[] = [];
  const issues: string[] = [];
  const client = createClient();
  const detector = new SubmissionDetector(client, {
    onAccepted: (submission) => { accepted.push(submission); return Promise.resolve(); },
    onIssue: (issue) => { issues.push(issue.code); return Promise.resolve(); },
    onMonitoringChange: vi.fn(),
  }, now);
  return { accepted, client, detector, issues };
}

function createClient() {
  return {
    getSubmissionStatus: vi.fn<LeetCodeClient['getSubmissionStatus']>()
      .mockImplementation((submissionId) => Promise.resolve(acceptedStatus(submissionId))),
    getProblemMetadata: vi.fn<LeetCodeClient['getProblemMetadata']>()
      .mockResolvedValue(metadata),
  };
}

function acceptedStatus(submissionId: string) {
  return {
    state: 'SUCCESS',
    statusCode: 10,
    statusMessage: 'Accepted',
    submissionId,
    taskFinishTime: FINISHED_AT,
  };
}

function route(slug: string | null, submissionId: string | null = null) {
  return { slug, submissionId };
}
