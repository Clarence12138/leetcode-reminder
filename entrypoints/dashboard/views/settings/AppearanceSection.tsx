import { useState } from 'react';
import { Icon } from '../../../../src/ui/Icon';
import {
  APPEARANCE_MODES,
  APPEARANCE_MODE_LABEL,
  useAppearance,
  type AppearanceMode,
} from '../../../../src/ui/theme/appearance';
import { PALETTES, paletteTokens, type Palette, type ThemeId } from '../../../../src/ui/theme/palettes';
import { InlineNotice } from '../../../../src/ui/components';
import { useMarkSaved } from './saved';
import { Section } from './parts';

export function AppearanceSection(): React.ReactElement {
  const { mode, setMode, setTheme, systemDark, theme } = useAppearance();
  const markSaved = useMarkSaved();
  const [error, setError] = useState<string | null>(null);

  const apply = async (task: () => Promise<void>): Promise<void> => {
    setError(null);
    try {
      await task();
      markSaved();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : '外观设置保存失败');
    }
  };
  const chooseTheme = (id: ThemeId): void => {
    if (id !== theme) void apply(() => setTheme(id));
  };
  const chooseMode = (next: AppearanceMode): void => {
    if (next !== mode) void apply(() => setMode(next));
  };
  const system = systemDark ? '深色' : '浅色';
  return (
    <Section description="主题色和外观模式分开选，立即生效。" id="settings-appearance" title="外观">
      <div className="ap-grid">
        <div>
          <div className="ap-label" id="theme-label">主题色</div>
          <div aria-labelledby="theme-label" className="theme-cards" role="radiogroup">
            {PALETTES.map((palette) => (
              <ThemeCard checked={palette.id === theme} key={palette.id} onSelect={() => chooseTheme(palette.id)} palette={palette} />
            ))}
          </div>
        </div>
        <ModeCards mode={mode} onSelect={chooseMode} systemLabel={system} />
      </div>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </Section>
  );
}

function ThemeCard({ checked, onSelect, palette }: { readonly checked: boolean; readonly onSelect: () => void; readonly palette: Palette }): React.ReactElement {
  // 每张卡用自己的浅色色板，直接比较各主题的样子。
  // paletteTokens 的键不带 `--`，要转成 CSS 自定义属性才会生效。
  const style = Object.fromEntries(
    Object.entries(paletteTokens(palette, 'light')).map(([key, value]) => [`--${key}`, value]),
  ) as React.CSSProperties;
  return (
    <button aria-checked={checked} aria-label={palette.name} className={`tcard${checked ? ' on' : ''}`} onClick={onSelect} role="radio" style={style} title={palette.note} type="button">
      <span aria-hidden="true" className="pv">
        <i style={{ height: '30%', background: 'var(--s2)' }} />
        <i style={{ height: '55%', background: 'var(--s3)' }} />
        <i style={{ height: '80%', background: 'var(--s4)' }} />
        <i style={{ height: '100%', background: 'var(--s5)' }} />
        <span className="mini">按钮</span>
      </span>
      <span className="nm">{palette.name}<span aria-hidden="true" className="ck"><Icon name="check" size={10} /></span></span>
    </button>
  );
}

function ModeCards({ mode, onSelect, systemLabel }: { readonly mode: AppearanceMode; readonly onSelect: (mode: AppearanceMode) => void; readonly systemLabel: string }): React.ReactElement {
  return (
    <div>
      <div className="ap-label" id="mode-label">外观模式</div>
      <div aria-labelledby="mode-label" className="mode-cards" role="radiogroup">
        {APPEARANCE_MODES.map((value) => (
          <button aria-checked={value === mode} className={`mcard${value === mode ? ' on' : ''}`} key={value} onClick={() => onSelect(value)} role="radio" type="button">
            <span className={`win ${value === 'system' ? 'sys' : value}`}><i /><b /><em /></span>
            {APPEARANCE_MODE_LABEL[value]}
          </button>
        ))}
      </div>
      <p className="ap-hint">
        {mode === 'system'
          ? <>跟随系统：系统当前是<b>{systemLabel}</b>，系统切换外观时会实时跟着变。</>
          : <>固定为<b>{APPEARANCE_MODE_LABEL[mode]}</b>，不受系统设置影响。</>}
      </p>
    </div>
  );
}
