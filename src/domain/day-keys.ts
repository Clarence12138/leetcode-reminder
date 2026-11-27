/**
 * 按时区把时间戳归到“本地日期”。日期统一用 `YYYY-MM-DD` 字符串表示，
 * 日期之间的加减按 UTC 日历计算，与时区无关。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const clockFormatterCache = new Map<string, Intl.DateTimeFormat>();

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

/** 运行环境（浏览器/系统）当前的 IANA 时区。 */
export function runtimeTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 是否为 Intl 能识别的时区名（IANA 名称或 UTC）。 */
export function isValidTimezone(timezone: string): boolean {
  if (!timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 某时区里 `day hour:minute` 这一墙上时间对应的时间戳。
 * 夏令时跳过的不存在时刻会顺延到跳变之后；重复的时刻取较早的一次。
 */
export function zonedTimeToEpoch(
  day: string,
  clock: { readonly hour: number; readonly minute: number },
  timezone: string,
): number {
  const wall = dayKeyToUtc(day) + (clock.hour * 60 + clock.minute) * MINUTE_MS;
  const first = wall - timezoneOffset(wall, timezone);
  const second = wall - timezoneOffset(first, timezone);
  if (first === second) return first;
  // 两次估算落在跳变两侧：取能还原出该墙上时间的较早时刻，都不能还原（跳过的时刻）就取较晚者。
  const candidates = [Math.min(first, second), Math.max(first, second)];
  return candidates.find((t) => t + timezoneOffset(t, timezone) === wall) ?? candidates[1]!;
}

/** 某时区在 `timestamp` 时刻相对 UTC 的偏移（毫秒，东八区为 +8h）。 */
export function timezoneOffset(timestamp: number, timezone: string): number {
  const parts = getClockFormatter(timezone).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour') % 24, value('minute'), value('second'));
  return asUtc - Math.floor(timestamp / 1000) * 1000;
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

function getClockFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = clockFormatterCache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  clockFormatterCache.set(timezone, formatter);
  return formatter;
}
