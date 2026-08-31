import { describe, expect, it } from 'vitest';
import {
  captureReviewResetIntent,
  clearReviewResetIntent,
  extractProblemSlug,
  hasReviewResetIntent,
  REVIEW_RESET_STORAGE_PREFIX,
  withReviewResetIntent,
} from '../src/leetcode/url';

describe('复习跳转标记', () => {
  it('给题目链接加上一次性还原标记', () => {
    expect(withReviewResetIntent('https://leetcode.cn/problems/two-sum/')).toBe(
      'https://leetcode.cn/problems/two-sum/?xiaoshuaji=review',
    );
  });

  it('把查询参数写入 session 并立刻从地址栏移除', () => {
    const storage = memoryStorage();
    const calls: string[] = [];
    const history = {
      state: null,
      replaceState(_state: unknown, _title: string, url: string) {
        calls.push(url);
      },
    };

    expect(
      captureReviewResetIntent('https://leetcode.cn/problems/two-sum/?xiaoshuaji=review', storage, history),
    ).toBe(true);
    expect(calls).toEqual(['/problems/two-sum/']);
    expect(hasReviewResetIntent('two-sum', storage)).toBe(true);
    expect(
      captureReviewResetIntent('https://leetcode.cn/problems/two-sum/', storage, history),
    ).toBe(false);
  });

  it('客户端跳转到 description 后仍能靠 slug 识别本次复习', () => {
    const storage = memoryStorage();
    captureReviewResetIntent(
      'https://leetcode.cn/problems/two-sum/?xiaoshuaji=review',
      storage,
      silentHistory(),
    );
    expect(extractProblemSlug({ pathname: '/problems/two-sum/description/' })).toBe('two-sum');
    expect(hasReviewResetIntent('two-sum', storage)).toBe(true);
  });

  it('过期或清除后不再还原', () => {
    const storage = memoryStorage();
    storage.setItem(`${REVIEW_RESET_STORAGE_PREFIX}two-sum`, String(1));
    expect(hasReviewResetIntent('two-sum', storage, 90_000)).toBe(false);
    captureReviewResetIntent(
      'https://leetcode.cn/problems/two-sum/?xiaoshuaji=review',
      storage,
      silentHistory(),
    );
    clearReviewResetIntent('two-sum', storage);
    expect(hasReviewResetIntent('two-sum', storage)).toBe(false);
  });
});

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

function silentHistory() {
  return {
    state: null,
    replaceState() {},
  };
}
