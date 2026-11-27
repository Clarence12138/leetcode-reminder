export interface NavigationLike {
  addEventListener(
    type: 'currententrychange',
    listener: () => void,
    options?: { readonly signal?: AbortSignal },
  ): void;
}

export interface CommittedLocationSource {
  readonly signal: AbortSignal;
  readonly getHref: () => string;
  readonly navigation?: NavigationLike | null;
  readonly target?: Pick<Window, 'addEventListener'>;
  readonly setInterval?: (handler: () => void, ms: number) => number;
  readonly intervalMs?: number;
}

export function getNavigationApi(scope: object = globalThis): NavigationLike | null {
  if (!('navigation' in scope)) return null;
  const nav = (scope as { readonly navigation?: unknown }).navigation;
  if (typeof nav !== 'object' || nav === null) return null;
  if (!('addEventListener' in nav) || typeof nav.addEventListener !== 'function') return null;
  return nav as NavigationLike;
}

/**
 * 监听已提交的同页 URL 变化（如 Next.js pushState / replaceState、前进后退、hash）。
 * 不监听 pre-commit 的 `navigate` 事件，避免跨文档跳转（如 `<a href>`）在离开前被误判为同页切换。
 */
export function watchCommittedLocation(
  source: CommittedLocationSource,
  onChange: (url: URL) => void,
): void {
  if (source.signal.aborted) return;
  let lastHref = source.getHref();
  const sync = (): void => {
    const href = source.getHref();
    if (href === lastHref) return;
    lastHref = href;
    onChange(new URL(href));
  };

  if (source.navigation) {
    source.navigation.addEventListener('currententrychange', sync, { signal: source.signal });
    return;
  }

  const target = source.target ?? window;
  target.addEventListener('popstate', sync, { signal: source.signal });
  target.addEventListener('hashchange', sync, { signal: source.signal });
  startFallbackPolling(source, sync);
}

function startFallbackPolling(source: CommittedLocationSource, sync: () => void): void {
  const intervalMs = source.intervalMs ?? 1_000;
  if (source.setInterval) {
    source.setInterval(sync, intervalMs);
    return;
  }
  const timerId = window.setInterval(sync, intervalMs);
  source.signal.addEventListener('abort', () => window.clearInterval(timerId), { once: true });
}
