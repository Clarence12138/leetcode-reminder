/**
 * 力扣页面自身的浅/深色检测。页内卡的浅深色跟随力扣，而不是扩展的外观设置。
 * 检测顺序：html / body 的 class → data-theme 类属性 → 内联 / 计算的 color-scheme → 系统偏好。
 */

export type PageMode = 'light' | 'dark';

export interface PageThemeSignals {
  /** 依次为 html、body 的 class 列表。 */
  readonly classNames: readonly (readonly string[])[];
  /** html、body 上 data-theme / data-color-mode / data-bs-theme 等属性值。 */
  readonly dataValues: readonly (string | null | undefined)[];
  /** color-scheme 的值，如 "dark"、"light"、"light dark"（后者含糊，忽略）。 */
  readonly colorSchemes: readonly (string | null | undefined)[];
  readonly systemDark: boolean;
}

const DATA_ATTRIBUTES = ['data-theme', 'data-color-mode', 'data-color-scheme', 'data-bs-theme', 'data-mode'] as const;

function tokenMode(value: string): PageMode | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const dark = /(^|[-_\s])dark($|[-_\s])/.test(text);
  const light = /(^|[-_\s])light($|[-_\s])/.test(text);
  if (dark === light) return null;
  return dark ? 'dark' : 'light';
}

function firstMode(values: readonly (string | null | undefined)[]): PageMode | null {
  for (const value of values) {
    const mode = value ? tokenMode(value) : null;
    if (mode) return mode;
  }
  return null;
}

export function detectPageMode(signals: PageThemeSignals): PageMode {
  for (const classes of signals.classNames) {
    const mode = firstMode(classes);
    if (mode) return mode;
  }
  const fromData = firstMode(signals.dataValues);
  if (fromData) return fromData;
  // "light dark" 表示页面同时支持两种，没法判断，交给系统偏好。
  const fromScheme = firstMode(signals.colorSchemes);
  if (fromScheme) return fromScheme;
  return signals.systemDark ? 'dark' : 'light';
}

function systemPrefersDark(win: Window): boolean {
  try {
    return typeof win.matchMedia === 'function' && win.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function readPageThemeSignals(doc: Document, win: Window = window): PageThemeSignals {
  const elements = [doc.documentElement, doc.body].filter((el): el is HTMLElement => el instanceof HTMLElement);
  const dataValues = elements.flatMap((el) => DATA_ATTRIBUTES.map((name) => el.getAttribute(name)));
  const colorSchemes = elements.flatMap((el) => {
    let computed = '';
    try {
      computed = win.getComputedStyle(el).colorScheme;
    } catch {
      computed = '';
    }
    return [el.style.colorScheme, computed];
  });
  return {
    classNames: elements.map((el) => Array.from(el.classList)),
    dataValues,
    colorSchemes,
    systemDark: systemPrefersDark(win),
  };
}

export function readPageMode(doc: Document = document, win: Window = window): PageMode {
  return detectPageMode(readPageThemeSignals(doc, win));
}

/** 监听页面浅/深色变化（属性变更 + 系统偏好变更），返回取消函数。模式没变时不触发回调。 */
export function watchPageMode(
  onChange: (mode: PageMode) => void,
  doc: Document = document,
  win: Window = window,
): () => void {
  let current = readPageMode(doc, win);
  const check = (): void => {
    const next = readPageMode(doc, win);
    if (next === current) return;
    current = next;
    onChange(next);
  };
  const observer = new MutationObserver(check);
  const options: MutationObserverInit = {
    attributes: true,
    attributeFilter: ['class', 'style', ...DATA_ATTRIBUTES],
  };
  observer.observe(doc.documentElement, options);
  const watchBody = (): void => {
    if (doc.body) observer.observe(doc.body, options);
  };
  watchBody();
  // content script 在 document_start 运行，body 可能还没有。
  const onReady = (): void => { watchBody(); check(); };
  if (!doc.body) doc.addEventListener('DOMContentLoaded', onReady, { once: true });

  let media: MediaQueryList | null = null;
  try {
    media = typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-color-scheme: dark)') : null;
  } catch {
    media = null;
  }
  media?.addEventListener?.('change', check);

  return () => {
    observer.disconnect();
    doc.removeEventListener('DOMContentLoaded', onReady);
    media?.removeEventListener?.('change', check);
  };
}
