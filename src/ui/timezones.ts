import { isValidTimezone, timezoneOffset } from '../domain/day-keys';

export interface TimezoneOption {
  readonly value: string;
  readonly label: string;
  /** 当前 UTC 偏移，如 `UTC+08:00`。 */
  readonly hint: string;
  /** 供搜索的补充关键词：中文城市名、`+8`、`utc+8`、`gmt+0800` 等。 */
  readonly keywords: readonly string[];
}

/**
 * 常用时区的中文名，便于用中文搜索；未列出的时区仍可按英文名或偏移搜索。
 * Chrome 的 Intl 用 ICU 旧名（如 Asia/Calcutta），新旧两种写法都收录，并把新名放进关键词。
 */
const ZONE_ALIASES: Readonly<Record<string, string>> = {
  'Asia/Shanghai': '上海 北京 中国',
  'Asia/Hong_Kong': '香港',
  'Asia/Macau': '澳门',
  'Asia/Taipei': '台北',
  'Asia/Tokyo': '东京 日本',
  'Asia/Seoul': '首尔 韩国',
  'Asia/Singapore': '新加坡',
  'Asia/Kuala_Lumpur': '吉隆坡 马来西亚',
  'Asia/Bangkok': '曼谷 泰国',
  'Asia/Ho_Chi_Minh': '胡志明 越南',
  'Asia/Saigon': '胡志明 越南 Ho_Chi_Minh',
  'Asia/Jakarta': '雅加达 印尼',
  'Asia/Manila': '马尼拉 菲律宾',
  'Asia/Kolkata': '印度 孟买 新德里',
  'Asia/Calcutta': '印度 孟买 新德里 Kolkata',
  'Asia/Katmandu': '加德满都 尼泊尔 Kathmandu',
  'Asia/Rangoon': '仰光 缅甸 Yangon',
  'Asia/Dubai': '迪拜 阿联酋',
  'Europe/London': '伦敦 英国',
  'Europe/Paris': '巴黎 法国',
  'Europe/Berlin': '柏林 德国',
  'Europe/Amsterdam': '阿姆斯特丹 荷兰',
  'Europe/Zurich': '苏黎世 瑞士',
  'Europe/Moscow': '莫斯科 俄罗斯',
  'Europe/Kiev': '基辅 乌克兰 Kyiv',
  'Europe/Kyiv': '基辅 乌克兰',
  'America/New_York': '纽约 美东',
  'America/Chicago': '芝加哥 美中',
  'America/Denver': '丹佛 美山地',
  'America/Los_Angeles': '洛杉矶 旧金山 西雅图 美西',
  'America/Toronto': '多伦多 加拿大',
  'America/Vancouver': '温哥华',
  'America/Sao_Paulo': '圣保罗 巴西',
  'Australia/Sydney': '悉尼 澳大利亚',
  'Australia/Melbourne': '墨尔本',
  'Pacific/Auckland': '奥克兰 新西兰',
  UTC: '协调世界时 格林尼治',
};

/** 运行环境支持的全部 IANA 时区（含 UTC 和当前值），按偏移从西到东；同偏移常用城市在前，其余按名称。 */
export function buildTimezoneOptions(extra: readonly string[] = [], now = Date.now()): TimezoneOption[] {
  const supported = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const names = [...new Set(['UTC', ...supported, ...extra])].filter(isValidTimezone);
  return names
    .map((name) => ({ name, offset: offsetMinutes(name, now) }))
    .sort((a, b) => a.offset - b.offset || commonFirst(a.name, b.name) || a.name.localeCompare(b.name))
    .map(({ name, offset }) => toOption(name, offset));
}

/** `Asia/Tokyo（UTC+09:00）`；无效时区只显示名称。 */
export function describeZone(timezone: string, now = Date.now()): string {
  if (!isValidTimezone(timezone)) return timezone;
  return `${timezone}（${formatUtcOffset(offsetMinutes(timezone, now))}）`;
}

export function formatUtcOffset(minutes: number): string {
  const { hh, mm, sign } = splitOffset(minutes);
  return `UTC${sign}${hh}:${mm}`;
}

const COMMON_RANK = new Map(Object.keys(ZONE_ALIASES).map((name, index) => [name, index]));

/** 常用城市按别名表顺序排在前面。 */
function commonFirst(a: string, b: string): number {
  return (COMMON_RANK.get(a) ?? COMMON_RANK.size) - (COMMON_RANK.get(b) ?? COMMON_RANK.size);
}

function toOption(name: string, offset: number): TimezoneOption {
  const alias = ZONE_ALIASES[name];
  return {
    value: name,
    label: alias ? `${name}（${alias.split(' ')[0]}）` : name,
    hint: formatUtcOffset(offset),
    keywords: [...(alias ? [alias] : []), ...offsetKeywords(offset)],
  };
}

/** `+8`、`utc+8`、`gmt+8`、`+08:00`、`+0800` 等写法都能搜到对应偏移的时区。 */
function offsetKeywords(minutes: number): string[] {
  const { hh, mm, sign } = splitOffset(minutes);
  const short = mm === '00' ? `${sign}${Number(hh)}` : `${sign}${Number(hh)}:${mm}`;
  const forms = [short, `${sign}${hh}:${mm}`, `${sign}${hh}${mm}`];
  return forms.flatMap((form) => [form, `utc${form}`, `gmt${form}`]);
}

function splitOffset(minutes: number): { readonly hh: string; readonly mm: string; readonly sign: '+' | '-' } {
  const abs = Math.abs(minutes);
  return {
    hh: String(Math.floor(abs / 60)).padStart(2, '0'),
    mm: String(abs % 60).padStart(2, '0'),
    sign: minutes < 0 ? '-' : '+',
  };
}

function offsetMinutes(timezone: string, now: number): number {
  return Math.round(timezoneOffset(now, timezone) / 60_000);
}
