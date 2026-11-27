import type {
  DetectionIssueCode,
  Difficulty,
  MasteryRating,
  ProblemRecord,
  SubmissionReview,
} from '../domain/types';
import { dayKeyDiff, localDayKey, runtimeTimezone } from '../domain/day-keys';

export const difficultyLabel: Readonly<Record<Difficulty, string>> = {
  EASY: '简单',
  MEDIUM: '中等',
  HARD: '困难',
};

export const ratingLabel: Readonly<Record<MasteryRating, string>> = {
  AGAIN: '未掌握',
  HARD: '吃力',
  GOOD: '掌握',
  EASY: '熟练',
};

export const issueLabel: Readonly<Record<DetectionIssueCode, string>> = {
  AUTH_REQUIRED: '需要登录',
  NETWORK_ERROR: '网络异常',
  TIMEOUT: '检测超时',
  UNKNOWN_RESPONSE: '响应结构变更',
  METADATA_ERROR: '题目信息异常',
  CONTEXT_CHANGED: '页面已切换',
};

/**
 * 页面展示用的时区：拿到设置后由各入口调用 `setDisplayTimezone`，
 * 未设置时回退到运行环境时区。所有“今天/明天/日期”展示都按它计算。
 */
let displayTimezone: string | undefined;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function setDisplayTimezone(timezone: string | undefined): void {
  displayTimezone = timezone;
}

export function getDisplayTimezone(): string {
  return displayTimezone ?? runtimeTimezone();
}

/** 按展示时区格式化，`options` 不含 timeZone。 */
export function formatInDisplayZone(timestamp: number, options: Intl.DateTimeFormatOptions): string {
  const timezone = getDisplayTimezone();
  const key = `${timezone}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('zh-CN', { ...options, timeZone: timezone });
    formatterCache.set(key, formatter);
  }
  return formatter.format(timestamp);
}

export function formatDateTime(timestamp: number): string {
  return formatInDisplayZone(timestamp, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(timestamp: number): string {
  return formatInDisplayZone(timestamp, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDue(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return '待首次评估';
  const days = calendarDaysBetween(timestamp, now);
  if (days < -1) return `逾期 ${Math.abs(days)} 天`;
  if (days === -1) return '昨天到期';
  if (days === 0) return '今天到期';
  if (days === 1) return '明天复习';
  return `${days} 天后复习`;
}

/** 从 now 所在日期到 timestamp 所在日期相差的天数（按展示时区的日历日，不按 24 小时）。 */
export function calendarDaysBetween(timestamp: number, now = Date.now()): number {
  const timezone = getDisplayTimezone();
  return dayKeyDiff(localDayKey(now, timezone), localDayKey(timestamp, timezone));
}

/** 间隔天数的简短写法：今天 / 明天 / 9 天 / 3 个月 / 1.5 年。 */
export function formatInterval(days: number): string {
  if (days <= 0) return '今天';
  if (days === 1) return '明天';
  if (days < 60) return `${days} 天`;
  if (days < 365) return `${Math.round(days / 30)} 个月`;
  return `${(Math.round((days / 365) * 10) / 10).toString()} 年`;
}

/** “明天复习 / 9 天后复习 / 今天复习”，用于评分后的提示。 */
export function formatNextReviewIn(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return '暂无排期';
  const days = calendarDaysBetween(timestamp, now);
  if (days <= 0) return '今天复习';
  if (days === 1) return '明天复习';
  return `${formatInterval(days)}后复习`;
}

export function problemName(problem: ProblemRecord | undefined, review: SubmissionReview): string {
  if (!problem) return review.problemId;
  return `${problem.frontendId}. ${problem.title}`;
}

export function toTimeValue(hour: number, minute: number): string {
  return `${padTime(hour)}:${padTime(minute)}`;
}

export function parseTimeValue(value: string): { readonly hour: number; readonly minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error('提醒时间格式无效');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('提醒时间超出范围');
  return { hour, minute };
}

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}
