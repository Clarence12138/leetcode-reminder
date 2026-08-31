const RESET_LABELS = ['还原到默认的代码模版', '还原到默认的代码模板', 'Reset to default code definition'] as const;
const RESET_ICON_SELECTORS = [
  'svg[data-icon="arrow-rotate-left"]',
  '[data-icon="arrow-rotate-left"]',
  '.fa-arrow-rotate-left',
] as const;
const CONFIRM_MARKERS = ['您将放弃所有更改并初始化代码', 'You will lose all changes'] as const;
const CONFIRM_LABELS = new Set(['确认', '确定', 'Confirm', 'OK']);
const CANCEL_LABELS = new Set(['取消', 'Cancel']);
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_SETTLE_MS = 600;
const DEFAULT_INTERVAL_MS = 150;
const CONFIRM_TIMEOUT_MS = 3_000;

export interface CodeResetClock {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface CodeResetOptions {
  readonly root?: ParentNode;
  readonly timeoutMs?: number;
  readonly settleMs?: number;
  readonly intervalMs?: number;
  readonly confirmTimeoutMs?: number;
  readonly editorTimeoutMs?: number;
  readonly clock?: CodeResetClock;
}

const defaultClock: CodeResetClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  }),
};

export async function resetEditorToDefaultTemplate(
  options: CodeResetOptions = {},
): Promise<boolean> {
  try {
    return await runReset(options);
  } catch {
    return false;
  }
}

async function runReset(options: CodeResetOptions): Promise<boolean> {
  const root = options.root ?? document;
  const clock = options.clock ?? defaultClock;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const resetButton = await waitFor(() => findResetButton(root), {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    intervalMs,
    clock,
  });
  if (!resetButton) return false;
  await waitForEditor(root, options, clock);
  await clock.sleep(options.settleMs ?? DEFAULT_SETTLE_MS);
  resetButton.click();
  const confirmButton = await waitFor(() => findConfirmButton(root), {
    timeoutMs: options.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS,
    intervalMs,
    clock,
  });
  confirmButton?.click();
  return true;
}

async function waitForEditor(
  root: ParentNode,
  options: CodeResetOptions,
  clock: CodeResetClock,
): Promise<void> {
  const timeoutMs = options.editorTimeoutMs ?? 8_000;
  if (timeoutMs <= 0) return;
  await waitFor(() => root.querySelector('.monaco-editor .view-line'), {
    timeoutMs,
    intervalMs: options.intervalMs ?? DEFAULT_INTERVAL_MS,
    clock,
  });
}

function findResetButton(root: ParentNode): HTMLElement | null {
  const labeled = findClickable(root, isResetLabel);
  if (labeled) return labeled;
  for (const selector of RESET_ICON_SELECTORS) {
    const icon = root.querySelector(selector);
    const clickable = icon?.closest('button, [role="button"]');
    if (clickable instanceof HTMLElement && isEnabled(clickable)) return clickable;
  }
  return null;
}

function isResetLabel(element: HTMLElement): boolean {
  const label = normalize(buttonLabel(element));
  if (label.includes('最新提交')) return false;
  return RESET_LABELS.some((item) => label.includes(normalize(item)));
}

function findConfirmButton(root: ParentNode): HTMLElement | null {
  const marker = findConfirmMarker(root);
  if (!marker) return null;
  let scope: HTMLElement | null = marker;
  for (let depth = 0; depth < 8 && scope; depth += 1) {
    const confirm = findClickable(scope, (element) => CONFIRM_LABELS.has(normalize(element.textContent)));
    const cancel = findClickable(scope, (element) => CANCEL_LABELS.has(normalize(element.textContent)));
    if (confirm && cancel) return confirm;
    scope = scope.parentElement;
  }
  return null;
}

function findConfirmMarker(root: ParentNode): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const element of root.querySelectorAll('h3, div, p, span')) {
    if (!(element instanceof HTMLElement)) continue;
    const text = normalize(element.textContent);
    if (CONFIRM_MARKERS.some((marker) => text.includes(normalize(marker)))) found = element;
  }
  return found;
}

function findClickable(
  root: ParentNode,
  match: (element: HTMLElement) => boolean,
): HTMLElement | null {
  for (const node of root.querySelectorAll('button, [role="button"]')) {
    if (node instanceof HTMLElement && isEnabled(node) && match(node)) return node;
  }
  return null;
}

function isEnabled(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement && element.disabled) return false;
  return element.getAttribute('aria-disabled') !== 'true';
}

function buttonLabel(element: HTMLElement): string {
  return [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

function normalize(value: string | null): string {
  return (value ?? '').replace(/\s+/g, '');
}

interface WaitOptions {
  readonly timeoutMs: number;
  readonly intervalMs: number;
  readonly clock: CodeResetClock;
}

async function waitFor<T>(probe: () => T | null, options: WaitOptions): Promise<T | null> {
  const deadline = options.clock.now() + options.timeoutMs;
  while (true) {
    const found = probe();
    if (found) return found;
    if (options.clock.now() >= deadline) return null;
    await options.clock.sleep(options.intervalMs);
  }
}
