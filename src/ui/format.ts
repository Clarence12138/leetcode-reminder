import type {
  DetectionIssueCode,
  Difficulty,
  MasteryRating,
  ProblemRecord,
  SubmissionReview,
} from '../domain/types';

const DAY_MS = 24 * 60 * 60 * 1000;

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

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

export function formatDateTime(timestamp: number): string {
  return dateTimeFormatter.format(new Date(timestamp));
}

export function formatDate(timestamp: number): string {
  return dateFormatter.format(new Date(timestamp));
}

export function formatDue(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null) return '待首次评估';
  const days = Math.round((startOfDay(timestamp) - startOfDay(now)) / DAY_MS);
  if (days < -1) return `逾期 ${Math.abs(days)} 天`;
  if (days === -1) return '昨天到期';
  if (days === 0) return '今天到期';
  if (days === 1) return '明天复习';
  return `${days} 天后复习`;
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

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function padTime(value: number): string {
  return String(value).padStart(2, '0');
}
