import { describe, expect, it } from 'vitest';
import { isSubmitShortcut, type ShortcutEvent } from '../src/leetcode/shortcut';

describe('isSubmitShortcut', () => {
  it.each([
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ])('接受 Command/Ctrl + Enter', (modifiers) => {
    expect(isSubmitShortcut(event(modifiers))).toBe(true);
  });

  it.each([
    { key: 'a' },
    { metaKey: false, ctrlKey: false },
    { altKey: true },
    { repeat: true },
    { isComposing: true },
  ])('拒绝不会触发提交的按键 %#', (override) => {
    expect(isSubmitShortcut(event(override))).toBe(false);
  });
});

function event(override: Partial<ShortcutEvent>): ShortcutEvent {
  return {
    key: 'Enter',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    ...override,
  };
}
