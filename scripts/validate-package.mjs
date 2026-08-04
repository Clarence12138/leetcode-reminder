import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

const EXPECTED_PERMISSIONS = Object.freeze(['alarms', 'notifications', 'storage']);
const EXPECTED_HOSTS = Object.freeze(['https://leetcode.cn/*']);
const EXPECTED_CONTENT_MATCHES = Object.freeze(['https://leetcode.cn/problems/*']);
const EXPECTED_DEFAULT_LOCALE = 'zh_CN';
const EXPECTED_NAME = '__MSG_extensionName__';
const FORBIDDEN_PERMISSIONS = Object.freeze([
  'cookies',
  'downloads',
  'tabs',
  'unlimitedStorage',
  'webRequest',
  'webRequestBlocking',
]);
const ICON_SIZES = Object.freeze([16, 32, 48, 128]);
const SCREENSHOT_SIZE = Object.freeze({ width: 1280, height: 800 });
const PROMO_SIZE = Object.freeze({ width: 440, height: 280 });
const PNG_SIGNATURE = '89504e470d0a1a0a';
const REQUIRED_LICENSES = Object.freeze([
  'LICENSE.txt',
  'THIRD_PARTY_NOTICES.txt',
  'licenses/dexie-LICENSE.txt',
  'licenses/react-LICENSE.txt',
  'licenses/ts-fsrs-LICENSE.txt',
  'licenses/zod-LICENSE.txt',
]);

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeArray(value) {
  return Array.isArray(value) ? [...value].sort() : [];
}

function assertExactArray(actual, expected, label) {
  const actualJson = JSON.stringify(normalizeArray(actual));
  const expectedJson = JSON.stringify(normalizeArray(expected));
  invariant(actualJson === expectedJson, `${label} 不符合预期：${actualJson}`);
}

function findPackageZip(root, explicitPath) {
  if (explicitPath) {
    const resolved = resolve(root, explicitPath);
    invariant(existsSync(resolved), `找不到指定 ZIP：${resolved}`);
    return resolved;
  }

  const outputDir = join(root, '.output');
  invariant(existsSync(outputDir), '找不到 .output，请先执行 pnpm zip。');
  const candidates = readdirSync(outputDir)
    .filter((name) => name.endsWith('.zip') && !name.includes('sources'))
    .map((name) => join(outputDir, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  invariant(candidates.length > 0, '.output 中没有可校验的 Chrome ZIP。');
  return candidates[0];
}

function listZipEntries(zipPath) {
  const output = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  return output.trim().split('\n').filter(Boolean);
}

function readZipEntry(zipPath, entry) {
  return execFileSync('unzip', ['-p', zipPath, entry], {
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function parsePngDimensions(buffer, label) {
  invariant(buffer.length >= 24, `${label} 不是有效 PNG。`);
  invariant(buffer.subarray(0, 8).toString('hex') === PNG_SIGNATURE, `${label} PNG 签名错误。`);
  invariant(buffer.subarray(12, 16).toString('ascii') === 'IHDR', `${label} 缺少 IHDR。`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function assertDimensions(buffer, expected, label) {
  const actual = parsePngDimensions(buffer, label);
  invariant(
    actual.width === expected.width && actual.height === expected.height,
    `${label} 尺寸应为 ${expected.width}×${expected.height}，实际为 ${actual.width}×${actual.height}。`,
  );
}

function validateManifest(manifest, packageVersion) {
  invariant(manifest.manifest_version === 3, 'manifest_version 必须为 3。');
  invariant(manifest.version === packageVersion, `Manifest 版本必须为 ${packageVersion}。`);
  invariant(manifest.name === EXPECTED_NAME, 'Manifest 名称必须使用本地化键。');
  invariant(manifest.default_locale === EXPECTED_DEFAULT_LOCALE, 'default_locale 必须为 zh_CN。');
  assertExactArray(manifest.permissions, EXPECTED_PERMISSIONS, 'permissions');
  assertExactArray(manifest.host_permissions, EXPECTED_HOSTS, 'host_permissions');
  const contentMatches = manifest.content_scripts?.flatMap((script) => script.matches ?? []) ?? [];
  assertExactArray(contentMatches, EXPECTED_CONTENT_MATCHES, 'content_scripts.matches');
  invariant(!manifest.optional_permissions, '禁止声明 optional_permissions。');
  invariant(!manifest.optional_host_permissions, '禁止声明 optional_host_permissions。');
  invariant(!manifest.externally_connectable, '禁止声明 externally_connectable。');
  invariant(!manifest.update_url, '提交商店的 ZIP 不应包含 update_url。');

  const permissions = normalizeArray(manifest.permissions);
  for (const permission of FORBIDDEN_PERMISSIONS) {
    invariant(!permissions.includes(permission), `禁止权限：${permission}`);
  }

  const extensionCsp = manifest.content_security_policy?.extension_pages ?? '';
  invariant(!/https?:\/\//u.test(extensionCsp), '扩展 CSP 不应允许远程脚本来源。');
  invariant(!extensionCsp.includes("'unsafe-eval'"), "扩展 CSP 不应允许 'unsafe-eval'。");
}

function validateZipIcons({ entries, manifest, zipPath }) {
  for (const size of ICON_SIZES) {
    const entry = manifest.icons?.[String(size)];
    invariant(typeof entry === 'string', `Manifest 缺少 ${size}px 图标声明。`);
    invariant(entries.includes(entry), `ZIP 缺少图标：${entry}`);
    assertDimensions(readZipEntry(zipPath, entry), { width: size, height: size }, entry);
  }
}

function validateNoPackagedRemoteCode({ entries, zipPath }) {
  const forbiddenFiles = entries.filter((entry) => /\.(?:crx|pem)$/iu.test(entry));
  invariant(forbiddenFiles.length === 0, `ZIP 包含禁止文件：${forbiddenFiles.join(', ')}`);

  const htmlEntries = entries.filter((entry) => entry.endsWith('.html'));
  for (const entry of htmlEntries) {
    const html = readZipEntry(zipPath, entry).toString('utf8');
    invariant(!/<script[^>]+src=["']https?:\/\//iu.test(html), `${entry} 引用了远程脚本。`);
  }

  const scriptEntries = entries.filter((entry) => entry.endsWith('.js'));
  for (const entry of scriptEntries) {
    const script = readZipEntry(zipPath, entry).toString('utf8');
    invariant(!/\beval\s*\(/u.test(script), `${entry} 包含 eval。`);
    invariant(!/\bnew\s+Function\s*\(/u.test(script), `${entry} 包含 new Function。`);
    invariant(
      !/\bimport\s*\(\s*["']https?:\/\//u.test(script),
      `${entry} 包含远程动态 import。`,
    );
  }
}

function validateThirdPartyLicenses(entries) {
  for (const entry of REQUIRED_LICENSES) {
    invariant(entries.includes(entry), `ZIP 缺少第三方许可证：${entry}`);
  }
}

function validateRepositoryAssets(root) {
  for (const size of ICON_SIZES) {
    const iconPath = join(root, 'public', 'icons', `icon-${size}.png`);
    invariant(existsSync(iconPath), `缺少源图标：${iconPath}`);
    assertDimensions(readFileSync(iconPath), { width: size, height: size }, iconPath);
  }

  const promoPath = join(root, 'store-assets', 'promo-440x280.png');
  invariant(existsSync(promoPath), `缺少宣传图：${promoPath}`);
  assertDimensions(readFileSync(promoPath), PROMO_SIZE, promoPath);

  const screenshotDir = join(root, 'store-assets', 'screenshots');
  invariant(existsSync(screenshotDir), `缺少截图目录：${screenshotDir}`);
  const screenshots = readdirSync(screenshotDir).filter((name) => name.endsWith('.png'));
  invariant(screenshots.length === 4, '商店提交必须恰好包含 4 张截图。');
  for (const screenshot of screenshots) {
    const path = join(screenshotDir, screenshot);
    assertDimensions(readFileSync(path), SCREENSHOT_SIZE, path);
  }

  return screenshots.length;
}

function main() {
  const root = process.cwd();
  const explicitPath = process.argv[2];
  const screenshotCount = validateRepositoryAssets(root);
  if (explicitPath === '--assets-only') {
    console.log(`素材校验通过：${ICON_SIZES.length} 个图标；${screenshotCount} 张商店截图。`);
    return;
  }

  const zipPath = findPackageZip(root, explicitPath);
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const entries = listZipEntries(zipPath);
  invariant(entries.includes('manifest.json'), 'ZIP 根目录缺少 manifest.json。');
  const manifest = JSON.parse(readZipEntry(zipPath, 'manifest.json').toString('utf8'));

  validateManifest(manifest, packageJson.version);
  validateZipIcons({ entries, manifest, zipPath });
  validateNoPackagedRemoteCode({ entries, zipPath });
  validateThirdPartyLicenses(entries);
  console.log(`校验通过：${zipPath}`);
  console.log(`Manifest V3；${ICON_SIZES.length} 个图标；${screenshotCount} 张商店截图。`);
}

main();
