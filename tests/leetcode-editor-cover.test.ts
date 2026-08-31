import { afterEach, describe, expect, it } from 'vitest';
import {
  coverEditorCode,
  EDITOR_COVER_ATTR,
  EDITOR_COVER_STYLE_ID,
} from '../src/leetcode/editor-cover';

afterEach(() => {
  document.documentElement.removeAttribute(EDITOR_COVER_ATTR);
  document.getElementById(EDITOR_COVER_STYLE_ID)?.remove();
});

describe('coverEditorCode', () => {
  it('给 html 加上遮罩标记，并注入隐藏编辑器代码的样式', () => {
    const uncover = coverEditorCode();
    expect(document.documentElement.getAttribute(EDITOR_COVER_ATTR)).toBe('');
    const style = document.getElementById(EDITOR_COVER_STYLE_ID);
    expect(style?.textContent).toContain('.overflow-guard');
    expect(style?.textContent).toContain('.view-lines');
    uncover();
    expect(document.documentElement.hasAttribute(EDITOR_COVER_ATTR)).toBe(false);
    expect(document.getElementById(EDITOR_COVER_STYLE_ID)).toBeNull();
  });

  it('重复释放是安全的', () => {
    const uncover = coverEditorCode();
    uncover();
    uncover();
    expect(document.getElementById(EDITOR_COVER_STYLE_ID)).toBeNull();
  });
});
