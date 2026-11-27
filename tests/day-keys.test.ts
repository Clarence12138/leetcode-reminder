import { describe, expect, it } from 'vitest';
import { isValidTimezone, localDayKey, timezoneOffset, zonedTimeToEpoch } from '../src/domain/day-keys';

describe('时区换算', () => {
  it('把指定时区的墙上时间换成时间戳', () => {
    expect(zonedTimeToEpoch('2026-01-01', { hour: 9, minute: 0 }, 'Asia/Shanghai')).toBe(Date.UTC(2026, 0, 1, 1));
    expect(zonedTimeToEpoch('2026-01-01', { hour: 9, minute: 0 }, 'America/New_York')).toBe(Date.UTC(2026, 0, 1, 14));
    expect(zonedTimeToEpoch('2026-07-01', { hour: 9, minute: 0 }, 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 13));
    expect(zonedTimeToEpoch('2026-01-01', { hour: 0, minute: 0 }, 'Asia/Kolkata')).toBe(Date.UTC(2025, 11, 31, 18, 30));
  });

  it('夏令时跳过的时刻顺延，重复的时刻取较早一次', () => {
    // 纽约 2026-03-08 02:30 不存在，应落在跳变后的 03:30（EDT）。
    expect(zonedTimeToEpoch('2026-03-08', { hour: 2, minute: 30 }, 'America/New_York')).toBe(Date.UTC(2026, 2, 8, 7, 30));
    // 纽约 2026-11-01 01:30 出现两次，取 EDT 那次。
    expect(zonedTimeToEpoch('2026-11-01', { hour: 1, minute: 30 }, 'America/New_York')).toBe(Date.UTC(2026, 10, 1, 5, 30));
  });

  it('计算偏移并按时区划分日期', () => {
    expect(timezoneOffset(Date.UTC(2026, 0, 1), 'Asia/Tokyo')).toBe(9 * 3_600_000);
    expect(timezoneOffset(Date.UTC(2026, 0, 1), 'America/Los_Angeles')).toBe(-8 * 3_600_000);
    expect(localDayKey(Date.UTC(2026, 0, 1, 2), 'America/New_York')).toBe('2025-12-31');
  });

  it('识别合法时区名', () => {
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('  ')).toBe(false);
  });
});

describe('展示时区', () => {
  it('日期展示和“今天/明天”按设置时区计算', async () => {
    const { calendarDaysBetween, formatDue, formatInDisplayZone, setDisplayTimezone } = await import('../src/ui/format');
    // UTC 2026-01-01 15:00：上海已是 1 月 1 日 23:00，东京已是 1 月 2 日 00:00。
    const now = Date.UTC(2026, 0, 1, 15);
    const due = Date.UTC(2026, 0, 1, 16);
    try {
      setDisplayTimezone('Asia/Shanghai');
      expect(calendarDaysBetween(due, now)).toBe(1);
      expect(formatDue(due, now)).toBe('明天复习');
      setDisplayTimezone('Asia/Tokyo');
      expect(calendarDaysBetween(due, now)).toBe(0);
      expect(formatInDisplayZone(now, { month: 'numeric', day: 'numeric' })).toBe('1/2');
    } finally {
      setDisplayTimezone(undefined);
    }
  });
});
