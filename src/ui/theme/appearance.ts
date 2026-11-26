import { useSyncExternalStore } from 'react';
import { buildPaletteCss, DEFAULT_THEME, isThemeId, type EffectiveMode, type ThemeId } from './palettes';

/**
 * 外观设置：主题色 + 模式（浅色 / 深色 / 跟随系统）。
 *
 * - 真值存在 chrome.storage.local 的 `appearance` 键，扩展各页面通过 storage.onChanged 实时同步。
 * - 扩展页额外在 localStorage 缓存一份，启动时同步读出来先套上，避免首屏闪色。
 *   （页内卡运行在力扣页面里，localStorage 属于力扣，不写缓存，只用 readAppearance / subscribeAppearance。）
 * - 模式为“跟随系统”时监听 prefers-color-scheme，系统切换时实时变化。
 * - chrome.storage / matchMedia / localStorage 任一不存在时安全降级（测试环境）。
 */

export type AppearanceMode = 'light' | 'dark' | 'system';
export type { EffectiveMode, ThemeId } from './palettes';

export interface Appearance {
  readonly theme: ThemeId;
  readonly mode: AppearanceMode;
}

export interface AppearanceSnapshot {
  readonly appearance: Appearance;
  readonly systemDark: boolean;
  /** 实际生效的浅/深色。 */
  readonly effectiveMode: EffectiveMode;
}

export const APPEARANCE_STORAGE_KEY = 'appearance';
export const APPEARANCE_CACHE_KEY = 'xsj-appearance';
export const DEFAULT_APPEARANCE: Appearance = { theme: DEFAULT_THEME, mode: 'system' };
export const APPEARANCE_MODES: readonly AppearanceMode[] = ['light', 'dark', 'system'];
export const APPEARANCE_MODE_LABEL: Readonly<Record<AppearanceMode, string>> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

const PALETTE_STYLE_ATTR = 'data-xsj-palettes';
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return typeof value === 'string' && (APPEARANCE_MODES as readonly string[]).includes(value);
}

/** 把任意值规整成合法的外观设置，非法字段回落到默认值。 */
export function normalizeAppearance(value: unknown): Appearance {
  if (typeof value !== 'object' || value === null) return DEFAULT_APPEARANCE;
  const theme: unknown = Reflect.get(value, 'theme');
  const mode: unknown = Reflect.get(value, 'mode');
  return {
    theme: isThemeId(theme) ? theme : DEFAULT_APPEARANCE.theme,
    mode: isAppearanceMode(mode) ? mode : DEFAULT_APPEARANCE.mode,
  };
}

export function resolveMode(mode: AppearanceMode, systemDark: boolean): EffectiveMode {
  if (mode === 'system') return systemDark ? 'dark' : 'light';
  return mode;
}

// ---------------------------------------------------------------------------
// 依赖（可注入，便于测试）

export interface AppearanceStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

type StorageChangeListener = (changes: Record<string, { readonly newValue?: unknown }>, areaName: string) => void;

export interface AppearanceStorageEvents {
  addListener(listener: StorageChangeListener): void;
  removeListener(listener: StorageChangeListener): void;
}

export interface AppearanceMediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { readonly matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { readonly matches: boolean }) => void): void;
}

export interface AppearanceDeps {
  readonly storage: AppearanceStorageArea | null;
  readonly events: AppearanceStorageEvents | null;
  readonly cache: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly media: AppearanceMediaQuery | null;
}

function chromeApi(): typeof chrome | undefined {
  return (globalThis as { chrome?: typeof chrome }).chrome;
}

function defaultStorage(): AppearanceStorageArea | null {
  const local = chromeApi()?.storage?.local;
  if (!local || typeof local.get !== 'function' || typeof local.set !== 'function') return null;
  return local as unknown as AppearanceStorageArea;
}

function defaultEvents(): AppearanceStorageEvents | null {
  const events = chromeApi()?.storage?.onChanged;
  if (!events || typeof events.addListener !== 'function') return null;
  return events as unknown as AppearanceStorageEvents;
}

function defaultMedia(): AppearanceMediaQuery | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    const query = window.matchMedia(SYSTEM_DARK_QUERY);
    return typeof query?.addEventListener === 'function' ? query : null;
  } catch {
    return null;
  }
}

function defaultCache(): Pick<Storage, 'getItem' | 'setItem'> | null {
  // 只在扩展自己的页面缓存，避免写进力扣页面的 localStorage。
  if (typeof location === 'undefined' || location.protocol !== 'chrome-extension:') return null;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createDefaultAppearanceDeps(): AppearanceDeps {
  return { storage: defaultStorage(), events: defaultEvents(), cache: defaultCache(), media: defaultMedia() };
}

// ---------------------------------------------------------------------------
// 控制器：一个页面一份状态，React 通过 useSyncExternalStore 订阅

export class AppearanceController {
  private snapshot: AppearanceSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly disposers: (() => void)[] = [];
  private started = false;
  /** 本地改过之后，忽略还在路上的初次读取结果，避免被旧值覆盖。 */
  private touched = false;
  /** 最近一次确认已持久化（读到或写成功或存储事件）的外观；写入失败时回退到它。 */
  private persisted: Appearance;

  constructor(private readonly deps: AppearanceDeps) {
    const systemDark = deps.media?.matches ?? false;
    this.snapshot = makeSnapshot(readCache(deps.cache) ?? DEFAULT_APPEARANCE, systemDark);
    this.persisted = this.snapshot.appearance;
  }

  readonly getSnapshot = (): AppearanceSnapshot => this.snapshot;

  readonly subscribe = (listener: () => void): (() => void) => {
    void this.start();
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** 开始监听存储变化与系统外观，并读取一次存储里的真值。重复调用无副作用。 */
  start(): Promise<void> {
    if (this.started) return Promise.resolve();
    this.started = true;
    const { events, media } = this.deps;
    if (media) {
      const onMedia = (event: { readonly matches: boolean }): void => {
        this.commit(this.snapshot.appearance, event.matches);
      };
      media.addEventListener('change', onMedia);
      this.disposers.push(() => media.removeEventListener('change', onMedia));
    }
    if (events) {
      const onStorage: StorageChangeListener = (changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[APPEARANCE_STORAGE_KEY];
        if (!change) return;
        this.persisted = normalizeAppearance(change.newValue);
        this.commit(this.persisted, this.snapshot.systemDark);
      };
      events.addListener(onStorage);
      this.disposers.push(() => events.removeListener(onStorage));
    }
    return this.load();
  }

  readonly setTheme = (theme: ThemeId): Promise<void> => this.update({ theme });
  readonly setMode = (mode: AppearanceMode): Promise<void> => this.update({ mode });

  async update(patch: Partial<Appearance>): Promise<void> {
    this.touched = true;
    const next = normalizeAppearance({ ...this.snapshot.appearance, ...patch });
    this.commit(next, this.snapshot.systemDark);
    try {
      await this.deps.storage?.set({ [APPEARANCE_STORAGE_KEY]: next });
      this.persisted = next;
    } catch (error) {
      // 写入失败：界面和缓存都退回最近一次已持久化的外观（期间没有更新的改动时），并让调用方知道以便重试。
      const current = this.snapshot.appearance;
      if (current.theme === next.theme && current.mode === next.mode) {
        this.commit(this.persisted, this.snapshot.systemDark);
      }
      throw error;
    }
  }

  dispose(): void {
    this.disposers.splice(0).forEach((dispose) => dispose());
    this.listeners.clear();
    this.started = false;
  }

  private async load(): Promise<void> {
    const storage = this.deps.storage;
    if (!storage) return;
    try {
      const stored = await storage.get(APPEARANCE_STORAGE_KEY);
      if (this.touched) return;
      const value = stored[APPEARANCE_STORAGE_KEY];
      if (value !== undefined) {
        this.persisted = normalizeAppearance(value);
        this.commit(this.persisted, this.snapshot.systemDark);
      }
    } catch (error) {
      console.error('[小刷记] 读取外观设置失败', error);
    }
  }

  private commit(appearance: Appearance, systemDark: boolean): void {
    const current = this.snapshot;
    if (current.appearance.theme === appearance.theme && current.appearance.mode === appearance.mode && current.systemDark === systemDark) return;
    this.snapshot = makeSnapshot(appearance, systemDark);
    writeCache(this.deps.cache, appearance);
    this.listeners.forEach((listener) => listener());
  }
}

function makeSnapshot(appearance: Appearance, systemDark: boolean): AppearanceSnapshot {
  return { appearance, systemDark, effectiveMode: resolveMode(appearance.mode, systemDark) };
}

function readCache(cache: AppearanceDeps['cache']): Appearance | null {
  if (!cache) return null;
  try {
    const raw = cache.getItem(APPEARANCE_CACHE_KEY);
    return raw ? normalizeAppearance(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(cache: AppearanceDeps['cache'], appearance: Appearance): void {
  try {
    cache?.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(appearance));
  } catch {
    // 缓存只是为了首屏不闪色，写失败可以忽略。
  }
}

let sharedController: AppearanceController | null = null;

export function getAppearanceController(): AppearanceController {
  sharedController ??= new AppearanceController(createDefaultAppearanceDeps());
  return sharedController;
}

/** 测试用：丢弃共享控制器，下次重新按当前全局环境创建。 */
export function resetAppearanceController(): void {
  sharedController?.dispose();
  sharedController = null;
}

// ---------------------------------------------------------------------------
// 应用到 DOM

/** 在 document.head 或 shadow root 里注入一次色板样式（已存在则跳过）。 */
export function ensurePaletteStyle(container: Document | ShadowRoot | HTMLElement, scope = ':root'): HTMLStyleElement {
  const host = container instanceof Document ? container.head : container;
  const existing = host.querySelector<HTMLStyleElement>(`style[${PALETTE_STYLE_ATTR}]`);
  if (existing) return existing;
  const ownerDocument = container instanceof Document ? container : (container.ownerDocument ?? document);
  const style = ownerDocument.createElement('style');
  style.setAttribute(PALETTE_STYLE_ATTR, scope);
  style.textContent = buildPaletteCss(scope);
  host.appendChild(style);
  return style;
}

/** 给元素设上 data-theme / data-mode，色板与语义色变量就挂在它上面。 */
export function applyAppearanceAttributes(element: HTMLElement, theme: ThemeId, mode: EffectiveMode): void {
  if (element.dataset.theme !== theme) element.dataset.theme = theme;
  if (element.dataset.mode !== mode) element.dataset.mode = mode;
}

/**
 * 扩展页面（弹窗、面板）在渲染前调用：同步套上缓存的外观，注入色板样式，
 * 然后跟随存储变化与系统外观实时更新 <html>。返回取消订阅函数。
 */
export function initPageAppearance(
  doc: Document = document,
  controller: AppearanceController = getAppearanceController(),
): () => void {
  ensurePaletteStyle(doc, ':root');
  const apply = (): void => {
    const { appearance, effectiveMode } = controller.getSnapshot();
    applyAppearanceAttributes(doc.documentElement, appearance.theme, effectiveMode);
  };
  apply();
  return controller.subscribe(apply);
}

export interface UseAppearanceResult {
  readonly appearance: Appearance;
  readonly theme: ThemeId;
  readonly mode: AppearanceMode;
  readonly effectiveMode: EffectiveMode;
  readonly systemDark: boolean;
  readonly setTheme: (theme: ThemeId) => Promise<void>;
  readonly setMode: (mode: AppearanceMode) => Promise<void>;
}

export function useAppearance(controller: AppearanceController = getAppearanceController()): UseAppearanceResult {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return {
    appearance: snapshot.appearance,
    theme: snapshot.appearance.theme,
    mode: snapshot.appearance.mode,
    effectiveMode: snapshot.effectiveMode,
    systemDark: snapshot.systemDark,
    setTheme: controller.setTheme,
    setMode: controller.setMode,
  };
}

// ---------------------------------------------------------------------------
// 页内卡用：只读存储、不碰力扣页面的 localStorage

export async function readAppearance(storage: AppearanceStorageArea | null = defaultStorage()): Promise<Appearance> {
  if (!storage) return DEFAULT_APPEARANCE;
  try {
    const stored = await storage.get(APPEARANCE_STORAGE_KEY);
    return normalizeAppearance(stored[APPEARANCE_STORAGE_KEY]);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function subscribeAppearance(
  listener: (appearance: Appearance) => void,
  events: AppearanceStorageEvents | null = defaultEvents(),
): () => void {
  if (!events) return () => undefined;
  const onStorage: StorageChangeListener = (changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[APPEARANCE_STORAGE_KEY];
    if (change) listener(normalizeAppearance(change.newValue));
  };
  events.addListener(onStorage);
  return () => events.removeListener(onStorage);
}
