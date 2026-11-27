/**
 * 轻量模糊匹配：按空格拆成多个词，每个词都要命中候选文本才算匹配。
 * 命中方式按得分从高到低：整词相等 > 文本开头 > 词首 > 子串 > 子序列（字母按顺序出现即可）。
 * `/`、`_`、括号视为分词符（`-` 保留，以便搜 `utc-5` 这类偏移），所以 `new york`、`newyork`、`ny` 都能找到 `America/New_York`。
 */

export interface FuzzyCandidate {
  /** 主要文本，命中时得分更高。 */
  readonly primary: string;
  /** 补充关键词（别名、偏移等），命中时得分打折。 */
  readonly keywords?: readonly string[] | undefined;
}

const SECONDARY_WEIGHT = 0.8;

export function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[/_()（）]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 0 表示不匹配；分数越高越靠前。空查询返回 1。 */
export function fuzzyScore(query: string, candidate: FuzzyCandidate): number {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  if (terms.length === 0) return 1;
  const primary = normalizeSearchText(candidate.primary);
  const secondary = (candidate.keywords ?? []).map(normalizeSearchText);
  let total = 0;
  for (const term of terms) {
    const best = Math.max(
      scoreTerm(term, primary),
      ...secondary.map((text) => scoreTerm(term, text) * SECONDARY_WEIGHT),
    );
    if (best <= 0) return 0;
    total += best;
  }
  return total;
}

/** 按得分筛选并排序；同分保持原顺序。 */
export function fuzzyFilter<T>(items: readonly T[], query: string, toCandidate: (item: T) => FuzzyCandidate): T[] {
  if (!normalizeSearchText(query)) return [...items];
  return items
    .map((item, index) => ({ index, item, score: fuzzyScore(query, toCandidate(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

function scoreTerm(term: string, text: string): number {
  if (!text) return 0;
  const words = text.split(' ');
  if (words.includes(term)) return 100;
  if (text.startsWith(term)) return 90;
  if (words.some((word) => word.startsWith(term))) return 80;
  if (text.includes(term)) return 60;
  if (text.replace(/ /g, '').includes(term)) return 55;
  return subsequenceScore(term, text);
}

/** 字母按顺序出现即算命中，间隔越小分越高（1–40）。 */
function subsequenceScore(term: string, text: string): number {
  let position = -1;
  let gaps = 0;
  for (const char of term) {
    const next = text.indexOf(char, position + 1);
    if (next < 0) return 0;
    if (position >= 0) gaps += next - position - 1;
    position = next;
  }
  return Math.max(1, 40 - gaps);
}
