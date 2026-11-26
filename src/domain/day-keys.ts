/**
 * 按时区把时间戳归到“本地日期”。日期统一用 `YYYY-MM-DD` 字符串表示，
 * 日期之间的加减按 UTC 日历计算，与时区无关。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function localDayKey(timestamp: number, timezone: string): string {
  return getFormatter(timezone).format(timestamp);
}

export function shiftDayKey(day: string, delta: number): string {
  return new Date(dayKeyToUtc(day) + delta * DAY_MS).toISOString().slice(0, 10);
}

/** `to - from` 相差的天数。 */
export function dayKeyDiff(from: string, to: string): number {
  return Math.round((dayKeyToUtc(to) - dayKeyToUtc(from)) / DAY_MS);
}

/** 0 = 周一 … 6 = 周日。 */
export function dayKeyWeekday(day: string): number {
  return (new Date(dayKeyToUtc(day)).getUTCDay() + 6) % 7;
}

function dayKeyToUtc(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
}

function getFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatterCache.set(timezone, formatter);
  return formatter;
}
