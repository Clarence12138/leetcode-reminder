import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { XiaoshuajiDatabase } from '../../src/background/database';
import { DexieReviewStore } from '../../src/background/store';
import { LeetCodeCnClient } from '../../src/leetcode/api-client';
import { SubmissionDetector } from '../../src/leetcode/detector';

const SUBMISSION_ID = 'integration-100';
const databases: XiaoshuajiDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('独立本地端点集成流', () => {
  it('从结构化 Accepted 走到待评估并生成 FSRS 排期', async () => {
    const acceptedAt = Date.now();
    const endpoint = await startMockLeetCodeEndpoint(acceptedAt);
    const database = new XiaoshuajiDatabase(`integration-${acceptedAt}`);
    databases.push(database);
    const store = new DexieReviewStore({ database, now: () => acceptedAt + 1_000 });
    const issues: string[] = [];
    const detector = new SubmissionDetector(
      new LeetCodeCnClient({ fetcher: fetch, origin: endpoint.origin }),
      {
        onAccepted: async (submission) => { await store.recordAccepted(submission); },
        onIssue: (issue) => { issues.push(issue.code); return Promise.resolve(); },
        onMonitoringChange: () => undefined,
      },
      () => acceptedAt,
    );

    try {
      detector.updateRoute({ slug: 'two-sum', submissionId: null });
      const detection = detector.recordIntent('keyboard');
      detector.updateRoute({ slug: 'two-sum', submissionId: SUBMISSION_ID });
      await detection;
      const pending = await store.queryDashboard();
      expect(pending.pendingReviews).toHaveLength(1);
      expect(pending.problems[0]).toMatchObject({ title: '两数之和', nextReviewAt: null });

      await store.rateSubmission(SUBMISSION_ID, 'GOOD');
      const rated = await store.queryDashboard();
      expect(rated.pendingReviews).toHaveLength(0);
      expect(rated.problems[0]?.nextReviewAt).not.toBeNull();
      expect(issues).toEqual([]);
      expect(endpoint.requestPaths.some((path) => path.startsWith('/api/submissions/'))).toBe(false);
    } finally {
      await endpoint.close();
    }
  });
});

async function startMockLeetCodeEndpoint(acceptedAt: number): Promise<MockEndpoint> {
  const requestPaths: string[] = [];
  const server = createServer((request, response) => {
    requestPaths.push(request.url ?? '');
    routeStructuredResponse(request, response, acceptedAt);
  });
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => reject(error);
    server.once('error', handleError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', handleError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('本地模拟端点未取得端口');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requestPaths,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function routeStructuredResponse(
  request: IncomingMessage,
  response: ServerResponse,
  acceptedAt: number,
): void {
  if (request.url === `/submissions/detail/${SUBMISSION_ID}/v2/check/`) {
    sendJson(response, {
      state: 'SUCCESS',
      status_code: 10,
      submission_id: SUBMISSION_ID,
      task_finish_time: acceptedAt,
    });
    return;
  }
  if (request.url === '/graphql/') {
    sendJson(response, {
      data: {
        question: {
          questionFrontendId: '1', translatedTitle: '两数之和', titleSlug: 'two-sum',
          difficulty: 'Easy', topicTags: [{ translatedName: '数组' }],
        },
      },
    });
    return;
  }
  response.writeHead(404).end();
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

interface MockEndpoint {
  readonly origin: string;
  readonly requestPaths: readonly string[];
  readonly close: () => Promise<void>;
}
