/**
 * 主题色板：每套只由“色相 + 饱和度”按固定的 OKLCH 明暗台阶生成整套变量，
 * 所以 5 套的层次感一致。算法移植自 design-drafts/b-kit.js 的 tokens()。
 *
 * 生成的变量：
 * - 背景与文字：--bg --surface --surface-2 --surface-3 --line --line-2 --line-strong --ink --ink-2 --muted
 * - 图表序数色阶：--s0…--s5，以及色阶上的文字色 --on-s2…--on-s5
 * - 品牌色：--brand --brand-hover --brand-press --on-brand --brand-text --brand-50 --focus --knob
 *
 * 语义色（评分四色、难度色、逾期色）不随主题变，见 src/ui/tokens.css。
 */

export type ThemeId = 'pine' | 'indigo' | 'violet' | 'mocha' | 'slate';
export type EffectiveMode = 'light' | 'dark';

export interface Palette {
  readonly id: ThemeId;
  /** 中文名，用于设置页。 */
  readonly name: string;
  /** 一句话说明。 */
  readonly note: string;
  /** 色相（OKLCH h）。 */
  readonly hue: number;
  /** 品牌色饱和度（OKLCH c）。 */
  readonly chroma: number;
  /** 中性色饱和度，默认 0.006。 */
  readonly neutralChroma?: number;
  /** 中性色色相，默认与 hue 相同（可可用 80，避免浅色背景发粉）。 */
  readonly neutralHue?: number;
}

export const PALETTES: readonly Palette[] = [
  { id: 'pine', name: '松绿', hue: 163, chroma: 0.115, note: '延续图标的绿色（默认）' },
  { id: 'indigo', name: '靛蓝', hue: 277, chroma: 0.17, note: '冷静、偏工具感' },
  { id: 'violet', name: '紫藤', hue: 302, chroma: 0.15, note: '更有个性的紫色' },
  { id: 'mocha', name: '可可', hue: 55, chroma: 0.075, neutralChroma: 0.008, neutralHue: 80, note: '暖棕色，米色背景，久看不累' },
  { id: 'slate', name: '岩灰', hue: 250, chroma: 0.05, neutralChroma: 0.008, note: '低饱和灰蓝，安静、不抢眼' },
];

export const DEFAULT_THEME: ThemeId = 'pine';
export const THEME_IDS: readonly ThemeId[] = PALETTES.map((palette) => palette.id);
export const MODES: readonly EffectiveMode[] = ['light', 'dark'];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function getPalette(id: ThemeId): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0]!;
}

function ok(l: number, c: number, h: number): string {
  return `oklch(${l} ${c.toFixed(4)} ${h})`;
}

function withAlpha(color: string, alpha: number): string {
  return color.replace(/\)$/, ` / ${alpha})`);
}

/** 色卡用的代表色（浅色模式下的品牌色）。 */
export function paletteSwatch(palette: Palette): string {
  return ok(0.5, palette.chroma, palette.hue);
}

export type PaletteTokens = Readonly<Record<string, string>>;

export function paletteTokens(palette: Palette, mode: EffectiveMode): PaletteTokens {
  const h = palette.hue;
  const c = palette.chroma;
  const n = palette.neutralChroma ?? 0.006;
  const hn = palette.neutralHue ?? h;
  if (mode === 'light') {
    return {
      bg: ok(0.972, n, hn), surface: '#fff', 'surface-2': ok(0.982, n * 0.6, hn), 'surface-3': ok(0.952, n, hn),
      line: ok(0.91, n * 1.2, hn), 'line-2': ok(0.945, n, hn), 'line-strong': ok(0.84, n * 1.4, hn),
      ink: ok(0.2, n * 2, hn), 'ink-2': ok(0.39, n * 2, hn), muted: ok(0.54, n * 1.8, hn),
      s0: ok(0.93, n, hn), s1: ok(0.885, Math.min(0.05, c * 0.45), h), s2: ok(0.76, c * 0.75, h),
      s3: ok(0.63, c * 0.95, h), s4: ok(0.5, c, h), s5: ok(0.37, c * 0.8, h),
      'on-s2': ok(0.2, 0.02, h), 'on-s3': '#fff', 'on-s4': '#fff', 'on-s5': '#fff', knob: '#fff',
      brand: ok(0.5, c, h), 'brand-hover': ok(0.45, c, h), 'brand-press': ok(0.4, c * 0.95, h), 'on-brand': '#fff',
      'brand-text': ok(0.45, c, h), 'brand-50': ok(0.955, 0.025, h), focus: withAlpha(ok(0.5, c, h), 0.45),
    };
  }
  const d = n * 1.3;
  return {
    bg: ok(0.165, d, hn), surface: ok(0.205, d, hn), 'surface-2': ok(0.235, d, hn), 'surface-3': ok(0.275, d, hn),
    line: ok(0.3, d, hn), 'line-2': ok(0.245, d, hn), 'line-strong': ok(0.37, d, hn),
    ink: ok(0.94, d * 0.8, hn), 'ink-2': ok(0.81, d, hn), muted: ok(0.65, d, hn),
    s0: ok(0.265, d, hn), s1: ok(0.34, Math.min(0.06, c * 0.5), h), s2: ok(0.46, c * 0.8, h),
    s3: ok(0.58, c * 0.9, h), s4: ok(0.72, c * 0.8, h), s5: ok(0.85, c * 0.45, h),
    'on-s2': '#fff', 'on-s3': '#fff', 'on-s4': ok(0.18, 0.02, h), 'on-s5': ok(0.18, 0.02, h), knob: '#fff',
    brand: ok(0.72, c * 0.8, h), 'brand-hover': ok(0.77, c * 0.75, h), 'brand-press': ok(0.66, c * 0.85, h), 'on-brand': ok(0.17, 0.03, h),
    'brand-text': ok(0.79, c * 0.7, h), 'brand-50': ok(0.27, Math.min(0.05, c * 0.4), h), focus: withAlpha(ok(0.72, c * 0.8, h), 0.5),
  };
}

function declarations(tokens: PaletteTokens): string {
  return Object.entries(tokens).map(([key, value]) => `--${key}:${value}`).join(';');
}

/**
 * 生成 5 套 × 浅/深 的色板 CSS。
 * 规则形如 `${scope}[data-theme="pine"][data-mode="light"]{--bg:…}`，
 * 页面传 `:root`（变量挂在 <html> 上），页内卡传自己根节点的选择器。
 */
export function buildPaletteCss(scope = ':root'): string {
  return PALETTES.flatMap((palette) =>
    MODES.map((mode) => `${scope}[data-theme="${palette.id}"][data-mode="${mode}"]{${declarations(paletteTokens(palette, mode))}}`),
  ).join('\n');
}
