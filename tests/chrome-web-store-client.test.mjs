// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  createChromeWebStoreClient,
  runCommand,
} from '../scripts/chrome-web-store.mjs';

const BASE_CONFIG = {
  accessToken: 'test-access-token',
  publisherId: 'publisher-id',
  extensionId: 'extension-id',
  releaseTag: 'v0.1.5',
  uploadTimeoutMs: 300_000,
};

function jsonResponse(payload, init = {}) {
  return new globalThis.Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createClient(responses, overrides = {}) {
  const fetchImpl = vi.fn();
  for (const response of responses) {
    fetchImpl.mockResolvedValueOnce(jsonResponse(response));
  }
  const dependencies = {
    fetchImpl,
    readFileImpl: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    sleep: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return {
    client: createChromeWebStoreClient(BASE_CONFIG, dependencies),
    ...dependencies,
  };
}

describe('Chrome Web Store API v2 client', () => {
  it('fetches and returns item status', async () => {
    const status = { itemId: 'extension-id', lastAsyncUploadState: 'SUCCEEDED' };
    const { client, fetchImpl } = createClient([status]);

    await expect(client.fetchStatus()).resolves.toEqual(status);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://chromewebstore.googleapis.com/v2/publishers/publisher-id/items/extension-id:fetchStatus',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer test-access-token');
  });

  it('publishes immediately after a synchronous upload', async () => {
    const upload = { uploadState: 'SUCCEEDED', crxVersion: '0.1.5' };
    const submission = { state: 'PENDING_REVIEW' };
    const { client, fetchImpl, readFileImpl } = createClient([upload, submission]);

    await expect(client.publish('/exact/release.zip', '0.1.5')).resolves.toEqual({
      upload,
      submission,
    });
    expect(readFileImpl).toHaveBeenCalledWith('/exact/release.zip');
    expect(fetchImpl.mock.calls[1][1]).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        publishType: 'DEFAULT_PUBLISH',
        skipReview: false,
        blockOnWarnings: true,
      }),
    }));
  });

  it('polls every five seconds until an asynchronous upload succeeds', async () => {
    const responses = [
      { uploadState: 'IN_PROGRESS' },
      { lastAsyncUploadState: 'IN_PROGRESS' },
      { lastAsyncUploadState: 'SUCCEEDED' },
      { state: 'PENDING_REVIEW' },
    ];
    const { client, sleep, fetchImpl } = createClient(responses);

    await client.publish('/exact/release.zip', '0.1.5');

    expect(sleep).toHaveBeenNthCalledWith(1, 5_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('exposes the complete API error payload', async () => {
    const details = [{ reason: 'VERSION_NOT_INCREASED', metadata: { version: '0.1.5' } }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(
      { error: { code: 400, message: 'Invalid package', details } },
      { status: 400, statusText: 'Bad Request' },
    ));
    const client = createChromeWebStoreClient(BASE_CONFIG, { fetchImpl });

    await expect(client.fetchStatus()).rejects.toThrow(
      /VERSION_NOT_INCREASED[\s\S]*version/,
    );
  });

  it.each(['FAILED', 'NOT_FOUND'])('fails when upload state is %s', async (uploadState) => {
    const { client } = createClient([{ uploadState }]);

    await expect(client.publish('/exact/release.zip', '0.1.5')).rejects.toThrow(uploadState);
  });

  it('fails when an asynchronous upload exceeds the timeout', async () => {
    const config = { ...BASE_CONFIG, uploadTimeoutMs: 5_000 };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ uploadState: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(jsonResponse({ lastAsyncUploadState: 'IN_PROGRESS' }));
    const client = createChromeWebStoreClient(config, {
      fetchImpl,
      readFileImpl: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(client.publish('/exact/release.zip', '0.1.5')).rejects.toThrow(
      'timed out after 5000ms',
    );
  });

  it('fails and reports every publish warning', async () => {
    const warnings = [
      { reason: 'MISSING_JUSTIFICATION', description: 'Permission needs justification' },
      { reason: 'LISTING_WARNING', description: 'Listing needs an update' },
    ];
    const { client } = createClient([
      { uploadState: 'SUCCEEDED' },
      { state: 'PENDING_REVIEW', warningInfo: { warnings } },
    ]);

    await expect(client.publish('/exact/release.zip', '0.1.5')).rejects.toThrow(
      /MISSING_JUSTIFICATION[\s\S]*LISTING_WARNING/,
    );
  });

  it('rejects a release tag that does not exactly match package.json', async () => {
    const environment = {
      CHROME_WEB_STORE_ACCESS_TOKEN: 'test-access-token',
      CHROME_WEB_STORE_PUBLISHER_ID: 'publisher-id',
      CHROME_EXTENSION_ID: 'extension-id',
      RELEASE_TAG: 'v0.1.6',
    };
    const packageContents = JSON.stringify({ version: '0.1.5' });
    const readFileImpl = vi.fn()
      .mockResolvedValueOnce(packageContents)
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    await expect(runCommand(
      ['publish', '/exact/release.zip'],
      environment,
      { readFileImpl, fetchImpl: vi.fn() },
    )).rejects.toThrow('expected v0.1.5, received v0.1.6');
  });
});
