import { computeTodayProgress } from '../../src/domain/stats';
import type { DailySummary, Settings } from '../../src/domain/types';

/**
 * 面板路由：hash 与页面的对应关系。
 * 导航只有 4 个标签（概览 / 题库 / 记录 / 设置），旧 hash 继续可用：
 * `''` / `#home` / `#queue` → 概览（`#queue` 时滚到今日队列）、`#history` → 记录·复习记录、`#issues` → 记录·检测异常。
 */
export type RouteKey = 'home' | 'queue' | 'problems' | 'history' | 'issues' | 'settings';
export type TabKey = 'overview' | 'problems' | 'records' | 'settings';

export interface NavigationItem {
  readonly tab: TabKey;
  readonly label: string;
  /** 点标签时去的路由。 */
  readonly route: RouteKey;
}

export const navigationItems: readonly NavigationItem[] = [
  { tab: 'overview', label: '概览', route: 'home' },
  { tab: 'problems', label: '题库', route: 'problems' },
  { tab: 'records', label: '记录', route: 'history' },
  { tab: 'settings', label: '设置', route: 'settings' },
];

const ROUTE_TAB: Readonly<Record<RouteKey, TabKey>> = {
  home: 'overview',
  queue: 'overview',
  problems: 'problems',
  history: 'records',
  issues: 'records',
  settings: 'settings',
};

function isRouteKey(value: string): value is RouteKey {
  return Object.hasOwn(ROUTE_TAB, value);
}

export function routeFromHash(hash: string): RouteKey {
  const value = hash.replace(/^#/, '');
  return isRouteKey(value) ? value : 'home';
}

export function tabOfRoute(route: RouteKey): TabKey {
  return ROUTE_TAB[route];
}

export function routeHref(route: RouteKey): string {
  return `#${route}`;
}

/** 写入 hash（相同则不动，避免多余的 hashchange）。 */
export function setRouteHash(route: RouteKey): void {
  if (window.location.hash === routeHref(route)) return;
  window.location.hash = route;
}

export interface NavigationBadges {
  /** 概览：今日还要复习的题（受配额限制）+ 待评估。 */
  readonly overview: number;
  /** 记录：未读的检测异常。 */
  readonly records: number;
}

export function computeNavigationBadges(summary: DailySummary, settings: Settings): NavigationBadges {
  const progress = computeTodayProgress({ dueProblems: summary.dueProblems, reviews: summary.recentReviews, settings });
  return {
    overview: progress.remaining + summary.pendingReviews.length,
    records: summary.issues.filter((issue) => issue.readAt === null).length,
  };
}
