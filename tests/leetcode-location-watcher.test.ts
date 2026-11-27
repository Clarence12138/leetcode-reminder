import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNavigationApi, watchCommittedLocation, type NavigationLike } from '../src/leetcode/location-watcher';

afterEach(() => {
  vi.useRealTimers();
});

describe('watchCommittedLocation', () => {
  it('使用 currententrychange 监听已提交同页变化并按 href 去重', () => {
    const nav = new EventTarget();
    const abort = new AbortController();
    let href = 'https://leetcode.cn/problems/two-sum/';
    const seen: string[] = [];

    watchCommittedLocation({
      signal: abort.signal,
      getHref: () => href,
      navigation: nav as unknown as NavigationLike,
    }, (url) => {
      seen.push(url.href);
    });

    // 仅 state 变化的 replaceState：href 不变，应去重
    nav.dispatchEvent(new Event('currententrychange'));
    expect(seen).toEqual([]);

    // 模拟 pre-commit navigate 不会触发
    nav.dispatchEvent(new Event('navigate'));
    expect(seen).toEqual([]);

    // 真正提交到 description
    href = 'https://leetcode.cn/problems/two-sum/description/';
    nav.dispatchEvent(new Event('currententrychange'));
    expect(seen).toEqual(['https://leetcode.cn/problems/two-sum/description/']);

    // abort 后不再触发
    abort.abort();
    href = 'https://leetcode.cn/problems/two-sum/submissions/123/';
    nav.dispatchEvent(new Event('currententrychange'));
    expect(seen).toEqual(['https://leetcode.cn/problems/two-sum/description/']);
  });

  it('回调前先更新 lastHref，避免重入 replaceState 污染记录', () => {
    const nav = new EventTarget();
    const abort = new AbortController();
    let href = 'https://leetcode.cn/problems/a/';
    const seen: string[] = [];

    watchCommittedLocation({
      signal: abort.signal,
      getHref: () => href,
      navigation: nav as unknown as NavigationLike,
    }, (url) => {
      seen.push(url.href);
      // 模拟回调内部同步触发一次 replaceState（导致嵌套 currententrychange）
      if (url.searchParams.get('flag') === '1') {
        href = 'https://leetcode.cn/problems/b/';
        nav.dispatchEvent(new Event('currententrychange'));
      }
    });

    href = 'https://leetcode.cn/problems/b/?flag=1';
    nav.dispatchEvent(new Event('currententrychange'));
    expect(seen).toEqual([
      'https://leetcode.cn/problems/b/?flag=1',
      'https://leetcode.cn/problems/b/',
    ]);

    // 之后若再次变为 ?flag=1，应正常识别（lastHref 保持在最终已提交的 /problems/b/）
    href = 'https://leetcode.cn/problems/b/?flag=1';
    nav.dispatchEvent(new Event('currententrychange'));
    expect(seen).toHaveLength(4);
  });

  it('无 Navigation API 时降级为 popstate / hashchange / 轮询，并在 abort 后清理', () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const target = new EventTarget();
    let href = 'https://leetcode.cn/problems/two-sum/';
    const seen: string[] = [];

    watchCommittedLocation({
      signal: abort.signal,
      getHref: () => href,
      navigation: null,
      target: target as unknown as Window,
      intervalMs: 500,
    }, (url) => {
      seen.push(url.href);
    });

    href = 'https://leetcode.cn/problems/two-sum/#tab';
    target.dispatchEvent(new Event('hashchange'));
    expect(seen).toEqual(['https://leetcode.cn/problems/two-sum/#tab']);

    href = 'https://leetcode.cn/problems/two-sum/submissions/42/';
    vi.advanceTimersByTime(500);
    expect(seen).toEqual([
      'https://leetcode.cn/problems/two-sum/#tab',
      'https://leetcode.cn/problems/two-sum/submissions/42/',
    ]);

    abort.abort();
    href = 'https://leetcode.cn/problems/add-two-numbers/';
    target.dispatchEvent(new Event('popstate'));
    vi.advanceTimersByTime(1_000);
    expect(seen).toHaveLength(2);
  });

  it('getNavigationApi 能安全识别是否支持 Navigation API', () => {
    expect(getNavigationApi({})).toBeNull();
    expect(getNavigationApi({ navigation: null })).toBeNull();
    const nav = new EventTarget();
    expect(getNavigationApi({ navigation: nav })).toBe(nav);
  });
});
