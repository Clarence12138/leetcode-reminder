import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const API_ROOT = 'https://chromewebstore.googleapis.com';
const DEFAULT_UPLOAD_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;
const PACKAGE_JSON_PATH = fileURLToPath(new URL('../package.json', import.meta.url));

function requireEnvironmentValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseTimeout(value) {
  if (value === undefined || value === '') {
    return DEFAULT_UPLOAD_TIMEOUT_MS;
  }
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('CHROME_UPLOAD_TIMEOUT_MS must be a positive integer');
  }
  return timeoutMs;
}

export function readConfig(environment = process.env) {
  return {
    accessToken: requireEnvironmentValue(environment, 'CHROME_WEB_STORE_ACCESS_TOKEN'),
    publisherId: requireEnvironmentValue(environment, 'CHROME_WEB_STORE_PUBLISHER_ID'),
    extensionId: requireEnvironmentValue(environment, 'CHROME_EXTENSION_ID'),
    releaseTag: environment.RELEASE_TAG?.trim(),
    uploadTimeoutMs: parseTimeout(environment.CHROME_UPLOAD_TIMEOUT_MS),
  };
}

function itemName(config) {
  const publisherId = encodeURIComponent(config.publisherId);
  const extensionId = encodeURIComponent(config.extensionId);
  return `publishers/${publisherId}/items/${extensionId}`;
}

function formatPayload(payload) {
  if (typeof payload === 'string') {
    return payload;
  }
  return JSON.stringify(payload, null, 2);
}

async function parseResponseBody(response) {
  const body = await response.text();
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`Chrome Web Store API returned invalid JSON: ${body}`, {
      cause: error,
    });
  }
}

async function requestJson(fetchImpl, accessToken, url, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  const payload = await parseResponseBody(response);
  if (!response.ok) {
    throw new Error(
      `Chrome Web Store API request failed (${response.status} ${response.statusText}): ${formatPayload(payload)}`,
    );
  }
  return payload;
}

function validateUploadState(state) {
  if (state === 'SUCCEEDED' || state === 'IN_PROGRESS') {
    return state;
  }
  if (state === 'FAILED' || state === 'NOT_FOUND') {
    throw new Error(`Chrome Web Store upload ${state}: the package was not accepted`);
  }
  throw new Error(`Unexpected Chrome Web Store upload state: ${String(state)}`);
}

function assertReleaseTag(releaseTag, packageVersion) {
  const expectedTag = `v${packageVersion}`;
  if (releaseTag !== expectedTag) {
    throw new Error(
      `RELEASE_TAG must exactly match package version: expected ${expectedTag}, received ${releaseTag ?? '(missing)'}`,
    );
  }
}

function assertNoWarnings(response) {
  const warnings = response.warningInfo?.warnings ?? [];
  if (warnings.length > 0) {
    throw new Error(`Chrome Web Store publish warnings: ${formatPayload(warnings)}`);
  }
}

async function waitForUpload(initialState, options) {
  let elapsedMs = 0;
  let state = validateUploadState(initialState);
  while (state === 'IN_PROGRESS') {
    if (elapsedMs >= options.timeoutMs) {
      throw new Error(`Chrome Web Store upload timed out after ${options.timeoutMs}ms`);
    }
    const delayMs = Math.min(POLL_INTERVAL_MS, options.timeoutMs - elapsedMs);
    await options.sleep(delayMs);
    elapsedMs += delayMs;
    const status = await options.fetchStatus();
    state = validateUploadState(status.lastAsyncUploadState);
  }
}

export function createChromeWebStoreClient(config, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const readFileImpl = dependencies.readFileImpl ?? readFile;
  const resourceName = itemName(config);

  async function fetchStatus() {
    const url = `${API_ROOT}/v2/${resourceName}:fetchStatus`;
    return requestJson(fetchImpl, config.accessToken, url, { method: 'GET' });
  }

  async function uploadPackage(zipPath) {
    const packageBytes = await readFileImpl(zipPath);
    const url = `${API_ROOT}/upload/v2/${resourceName}:upload`;
    return requestJson(fetchImpl, config.accessToken, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: packageBytes,
    });
  }

  async function submitForPublishing() {
    const url = `${API_ROOT}/v2/${resourceName}:publish`;
    const response = await requestJson(fetchImpl, config.accessToken, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publishType: 'DEFAULT_PUBLISH',
        skipReview: false,
        blockOnWarnings: true,
      }),
    });
    assertNoWarnings(response);
    return response;
  }

  async function publish(zipPath, packageVersion) {
    assertReleaseTag(config.releaseTag, packageVersion);
    const upload = await uploadPackage(zipPath);
    await waitForUpload(upload.uploadState, {
      timeoutMs: config.uploadTimeoutMs,
      sleep,
      fetchStatus,
    });
    const submission = await submitForPublishing();
    return { upload, submission };
  }

  return { fetchStatus, publish };
}

async function readPackageVersion(readFileImpl = readFile) {
  const contents = await readFileImpl(PACKAGE_JSON_PATH, 'utf8');
  const packageJson = JSON.parse(contents);
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json must contain a non-empty version');
  }
  return packageJson.version;
}

export async function runCommand(argv, environment = process.env, dependencies = {}) {
  const [command, zipPath, ...extraArguments] = argv;
  if (extraArguments.length > 0 || (command !== 'status' && command !== 'publish')) {
    throw new Error('Usage: node scripts/chrome-web-store.mjs status | publish <zip>');
  }
  const config = readConfig(environment);
  const client = createChromeWebStoreClient(config, dependencies);
  if (command === 'status') {
    if (zipPath !== undefined) {
      throw new Error('The status command does not accept a ZIP path');
    }
    return client.fetchStatus();
  }
  if (!zipPath) {
    throw new Error('The publish command requires an exact ZIP path');
  }
  const packageVersion = await readPackageVersion(dependencies.readFileImpl);
  return client.publish(zipPath, packageVersion);
}

async function main() {
  try {
    const result = await runCommand(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1]
  && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`));
if (isDirectExecution) {
  await main();
}
