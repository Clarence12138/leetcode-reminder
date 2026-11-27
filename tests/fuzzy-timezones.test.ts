import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../src/ui/fuzzy';
import { buildTimezoneOptions, describeZone, formatUtcOffset, type TimezoneOption } from '../src/ui/timezones';

const NOW = Date.UTC(2026, 0, 15);
const options = buildTimezoneOptions([], NOW);
const search = (query: string): TimezoneOption[] =>
  fuzzyFilter(options, query, (option) => ({ primary: option.label, keywords: [option.value, ...option.keywords] }));

describe('模糊匹配', () => {
  it('整词 > 开头 > 词首 > 子串 > 子序列', () => {
    const score = (query: string): number => fuzzyScore(query, { primary: 'America/New_York' });
    expect(score('york')).toBeGreaterThan(score('ameri'));
    expect(score('ameri')).toBeGreaterThan(score('yor'));
    expect(score('yor')).toBeGreaterThan(score('ork'));
    expect(score('ork')).toBeGreaterThan(score('amny'));
    expect(score('amny')).toBeGreaterThan(0);
    expect(score('xyz')).toBe(0);
  });

  it('多个词都要命中，空查询保留全部', () => {
    expect(fuzzyScore('new york', { primary: 'America/New_York' })).toBeGreaterThan(0);
    expect(fuzzyScore('new delhi', { primary: 'America/New_York' })).toBe(0);
    expect(fuzzyFilter([1, 2, 3], '  ', () => ({ primary: '' }))).toEqual([1, 2, 3]);
  });
});

describe('时区选项', () => {
  it('包含全部 IANA 时区和 UTC，按偏移从西到东排列', () => {
    expect(options.length).toBeGreaterThan(300);
    expect(options.some((option) => option.value === 'UTC')).toBe(true);
    const offsets = options.map((option) => option.hint);
    expect(offsets[0]).toMatch(/^UTC-1[12]:00$/);
    expect(offsets.at(-1)).toMatch(/^UTC\+1[34]:00$/);
  });

  it('支持中文城市名、英文名、无空格写法和偏移搜索', () => {
    expect(search('东京')[0]?.value).toBe('Asia/Tokyo');
    expect(search('北京')[0]?.value).toBe('Asia/Shanghai');
    expect(search('shang')[0]?.value).toBe('Asia/Shanghai');
    expect(search('new york')[0]?.value).toBe('America/New_York');
    expect(search('losangeles')[0]?.value).toBe('America/Los_Angeles');
    const plusEight = search('+8');
    expect(plusEight.length).toBeGreaterThan(0);
    expect(plusEight.slice(0, 5).every((option) => option.hint === 'UTC+08:00')).toBe(true);
    expect(plusEight[0]?.value).toBe('Asia/Shanghai');
    expect(search('utc-5').some((option) => option.value === 'America/New_York')).toBe(true);
    expect(search('+5:30').length).toBeGreaterThan(0);
    expect(search('kolkata')[0]?.hint).toBe('UTC+05:30');
    expect(search('印度')[0]?.hint).toBe('UTC+05:30');
  });

  it('当前值不在列表里时也能显示', () => {
    expect(buildTimezoneOptions(['Asia/Calcutta'], NOW).some((option) => option.value === 'Asia/Calcutta')).toBe(true);
  });

  it('格式化偏移', () => {
    expect(formatUtcOffset(330)).toBe('UTC+05:30');
    expect(formatUtcOffset(-300)).toBe('UTC-05:00');
    expect(describeZone('Asia/Tokyo', NOW)).toBe('Asia/Tokyo（UTC+09:00）');
    expect(describeZone('Mars/Olympus', NOW)).toBe('Mars/Olympus');
  });
});
