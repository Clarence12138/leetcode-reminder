import type { IconName } from '../../src/ui/Icon';

export type ViewKey = 'home' | 'queue' | 'problems' | 'history' | 'issues' | 'settings';

export interface NavigationItem {
  readonly icon: IconName;
  readonly key: ViewKey;
  readonly label: string;
}

export const navigationItems: readonly NavigationItem[] = [
  { key: 'home', label: '首页', icon: 'home' },
  { key: 'queue', label: '待复习', icon: 'calendar' },
  { key: 'problems', label: '全部题目', icon: 'book' },
  { key: 'history', label: '复习历史', icon: 'history' },
  { key: 'issues', label: '检测异常', icon: 'alert' },
  { key: 'settings', label: '设置', icon: 'settings' },
];

const validKeys = new Set<ViewKey>(navigationItems.map((item) => item.key));

export function viewFromHash(hash: string): ViewKey {
  const value = hash.replace(/^#/, '') as ViewKey;
  return validKeys.has(value) ? value : 'home';
}

export function setViewHash(view: ViewKey): void {
  window.location.hash = view === 'home' ? '' : view;
}
