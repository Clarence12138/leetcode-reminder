export type BuiltinProblemListId = 'hot-100' | 'top-interview-150' | 'codetop-100';

export interface BuiltinProblemList {
  readonly id: BuiltinProblemListId;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly slugs: readonly string[];
}

const HOT_100_SLUGS = [
  'two-sum', 'group-anagrams', 'longest-consecutive-sequence', 'move-zeroes', 'container-with-most-water',
  '3sum', 'trapping-rain-water', 'longest-substring-without-repeating-characters', 'find-all-anagrams-in-a-string', 'subarray-sum-equals-k',
  'sliding-window-maximum', 'minimum-window-substring', 'maximum-subarray', 'merge-intervals', 'rotate-array',
  'product-of-array-except-self', 'first-missing-positive', 'set-matrix-zeroes', 'spiral-matrix', 'rotate-image',
  'search-a-2d-matrix-ii', 'intersection-of-two-linked-lists', 'reverse-linked-list', 'palindrome-linked-list', 'linked-list-cycle',
  'linked-list-cycle-ii', 'merge-two-sorted-lists', 'add-two-numbers', 'remove-nth-node-from-end-of-list', 'swap-nodes-in-pairs',
  'reverse-nodes-in-k-group', 'copy-list-with-random-pointer', 'sort-list', 'merge-k-sorted-lists', 'lru-cache',
  'binary-tree-inorder-traversal', 'maximum-depth-of-binary-tree', 'invert-binary-tree', 'symmetric-tree', 'diameter-of-binary-tree',
  'binary-tree-level-order-traversal', 'convert-sorted-array-to-binary-search-tree', 'validate-binary-search-tree', 'kth-smallest-element-in-a-bst', 'binary-tree-right-side-view',
  'flatten-binary-tree-to-linked-list', 'construct-binary-tree-from-preorder-and-inorder-traversal', 'path-sum-iii', 'lowest-common-ancestor-of-a-binary-tree', 'binary-tree-maximum-path-sum',
  'number-of-islands', 'rotting-oranges', 'course-schedule', 'implement-trie-prefix-tree', 'permutations',
  'subsets', 'letter-combinations-of-a-phone-number', 'combination-sum', 'generate-parentheses', 'word-search',
  'palindrome-partitioning', 'n-queens', 'search-insert-position', 'search-a-2d-matrix', 'find-first-and-last-position-of-element-in-sorted-array',
  'search-in-rotated-sorted-array', 'find-minimum-in-rotated-sorted-array', 'median-of-two-sorted-arrays', 'valid-parentheses', 'min-stack',
  'decode-string', 'daily-temperatures', 'largest-rectangle-in-histogram', 'kth-largest-element-in-an-array', 'top-k-frequent-elements',
  'find-median-from-data-stream', 'best-time-to-buy-and-sell-stock', 'jump-game', 'jump-game-ii', 'partition-labels',
  'climbing-stairs', 'pascals-triangle', 'house-robber', 'perfect-squares', 'coin-change',
  'word-break', 'longest-increasing-subsequence', 'maximum-product-subarray', 'partition-equal-subset-sum', 'longest-valid-parentheses',
  'unique-paths', 'minimum-path-sum', 'longest-palindromic-substring', 'longest-common-subsequence', 'edit-distance',
  'single-number', 'majority-element', 'sort-colors', 'next-permutation', 'find-the-duplicate-number',
] as const;

const TOP_INTERVIEW_150_SLUGS = [
  'merge-sorted-array', 'remove-element', 'remove-duplicates-from-sorted-array', 'remove-duplicates-from-sorted-array-ii', 'majority-element',
  'rotate-array', 'best-time-to-buy-and-sell-stock', 'best-time-to-buy-and-sell-stock-ii', 'jump-game', 'jump-game-ii',
  'h-index', 'insert-delete-getrandom-o1', 'product-of-array-except-self', 'gas-station', 'candy',
  'trapping-rain-water', 'roman-to-integer', 'integer-to-roman', 'length-of-last-word', 'longest-common-prefix',
  'reverse-words-in-a-string', 'zigzag-conversion', 'find-the-index-of-the-first-occurrence-in-a-string', 'text-justification', 'valid-palindrome',
  'is-subsequence', 'two-sum-ii-input-array-is-sorted', 'container-with-most-water', '3sum', 'minimum-size-subarray-sum',
  'longest-substring-without-repeating-characters', 'substring-with-concatenation-of-all-words', 'minimum-window-substring', 'valid-sudoku', 'spiral-matrix',
  'rotate-image', 'set-matrix-zeroes', 'game-of-life', 'ransom-note', 'isomorphic-strings',
  'word-pattern', 'valid-anagram', 'group-anagrams', 'two-sum', 'happy-number',
  'contains-duplicate-ii', 'longest-consecutive-sequence', 'summary-ranges', 'merge-intervals', 'insert-interval',
  'minimum-number-of-arrows-to-burst-balloons', 'valid-parentheses', 'simplify-path', 'min-stack', 'evaluate-reverse-polish-notation',
  'basic-calculator', 'linked-list-cycle', 'add-two-numbers', 'merge-two-sorted-lists', 'copy-list-with-random-pointer',
  'reverse-linked-list-ii', 'reverse-nodes-in-k-group', 'remove-nth-node-from-end-of-list', 'remove-duplicates-from-sorted-list-ii', 'rotate-list',
  'partition-list', 'lru-cache', 'maximum-depth-of-binary-tree', 'same-tree', 'invert-binary-tree',
  'symmetric-tree', 'construct-binary-tree-from-preorder-and-inorder-traversal', 'construct-binary-tree-from-inorder-and-postorder-traversal', 'populating-next-right-pointers-in-each-node-ii', 'flatten-binary-tree-to-linked-list',
  'path-sum', 'sum-root-to-leaf-numbers', 'binary-tree-maximum-path-sum', 'binary-search-tree-iterator', 'count-complete-tree-nodes',
  'lowest-common-ancestor-of-a-binary-tree', 'binary-tree-right-side-view', 'average-of-levels-in-binary-tree', 'binary-tree-level-order-traversal', 'binary-tree-zigzag-level-order-traversal',
  'minimum-absolute-difference-in-bst', 'kth-smallest-element-in-a-bst', 'validate-binary-search-tree', 'number-of-islands', 'surrounded-regions',
  'clone-graph', 'evaluate-division', 'course-schedule', 'course-schedule-ii', 'snakes-and-ladders',
  'minimum-genetic-mutation', 'word-ladder', 'implement-trie-prefix-tree', 'design-add-and-search-words-data-structure', 'word-search-ii',
  'letter-combinations-of-a-phone-number', 'combinations', 'permutations', 'combination-sum', 'n-queens-ii',
  'generate-parentheses', 'word-search', 'convert-sorted-array-to-binary-search-tree', 'sort-list', 'construct-quad-tree',
  'merge-k-sorted-lists', 'maximum-subarray', 'maximum-sum-circular-subarray', 'search-insert-position', 'search-a-2d-matrix',
  'find-peak-element', 'search-in-rotated-sorted-array', 'find-first-and-last-position-of-element-in-sorted-array', 'find-minimum-in-rotated-sorted-array', 'median-of-two-sorted-arrays',
  'kth-largest-element-in-an-array', 'ipo', 'find-k-pairs-with-smallest-sums', 'find-median-from-data-stream', 'add-binary',
  'reverse-bits', 'number-of-1-bits', 'single-number', 'single-number-ii', 'bitwise-and-of-numbers-range',
  'palindrome-number', 'plus-one', 'factorial-trailing-zeroes', 'sqrtx', 'powx-n',
  'max-points-on-a-line', 'climbing-stairs', 'house-robber', 'word-break', 'coin-change',
  'longest-increasing-subsequence', 'triangle', 'minimum-path-sum', 'unique-paths-ii', 'longest-palindromic-substring',
  'interleaving-string', 'edit-distance', 'best-time-to-buy-and-sell-stock-iii', 'best-time-to-buy-and-sell-stock-iv', 'maximal-square',
] as const;

const CODETOP_100_SLUGS = [
  'reverse-linked-list', 'lru-cache', 'longest-substring-without-repeating-characters', 'kth-largest-element-in-an-array', 'reverse-nodes-in-k-group',
  '3sum', 'maximum-subarray', 'sort-an-array', 'merge-two-sorted-lists', 'two-sum',
  'binary-tree-level-order-traversal', 'longest-palindromic-substring', 'search-in-rotated-sorted-array', 'number-of-islands', 'best-time-to-buy-and-sell-stock',
  'merge-sorted-array', 'valid-parentheses', 'trapping-rain-water', 'linked-list-cycle', 'binary-tree-zigzag-level-order-traversal',
  'lowest-common-ancestor-of-a-binary-tree', 'binary-tree-maximum-path-sum', 'reverse-linked-list-ii', 'spiral-matrix', 'intersection-of-two-linked-lists',
  'permutations', 'merge-k-sorted-lists', 'longest-increasing-subsequence', 'merge-intervals', 'edit-distance',
  'remove-nth-node-from-end-of-list', 'reorder-list', 'add-strings', 'binary-tree-right-side-view', 'linked-list-cycle-ii',
  'binary-tree-inorder-traversal', 'climbing-stairs', 'implement-queue-using-stacks', 'next-permutation', 'first-missing-positive',
  'sqrtx', 'remove-duplicates-from-sorted-list-ii', 'add-two-numbers', 'sort-list', 'generate-parentheses',
  'compare-version-numbers', 'restore-ip-addresses', 'minimum-window-substring', 'median-of-two-sorted-arrays', 'sum-root-to-leaf-numbers',
  'construct-binary-tree-from-preorder-and-inorder-traversal', 'longest-common-subsequence', 'reverse-words-in-a-string', 'sliding-window-maximum', 'min-stack',
  'binary-search', 'coin-change', 'house-robber', 'invert-binary-tree', 'rotate-image',
  'search-a-2d-matrix-ii', 'combination-sum', 'minimum-path-sum', 'find-first-and-last-position-of-element-in-sorted-array', 'subsets',
  'decode-string', 'symmetric-tree', 'maximum-depth-of-binary-tree', 'path-sum', 'path-sum-ii',
  'find-peak-element', 'maximal-square', 'multiply-strings', 'best-time-to-buy-and-sell-stock-ii', 'majority-element',
  'minimum-size-subarray-sum', 'palindrome-linked-list', 'longest-valid-parentheses', 'diameter-of-binary-tree', 'maximum-width-of-binary-tree',
  'validate-binary-search-tree', 'longest-consecutive-sequence', 'word-break', 'largest-number', 'course-schedule',
  'basic-calculator-ii', 'swap-nodes-in-pairs', 'implement-rand10-using-rand7', 'subarray-sum-equals-k', 'maximum-length-of-repeated-subarray',
  'daily-temperatures', 'string-to-integer-atoi', 'check-completeness-of-a-binary-tree', 'balanced-binary-tree', 'copy-list-with-random-pointer',
  'maximum-product-subarray', 'find-minimum-in-rotated-sorted-array', 'implement-trie-prefix-tree', 'move-zeroes', 'lfu-cache',
] as const;

export const BUILTIN_PROBLEM_LISTS: readonly BuiltinProblemList[] = [
  {
    id: 'hot-100',
    name: '力扣 Hot 100',
    shortName: 'Hot 100',
    description: '力扣官方热题 100（100 题内置题单）',
    slugs: HOT_100_SLUGS,
  },
  {
    id: 'top-interview-150',
    name: '面试经典 150',
    shortName: '面试 150',
    description: '力扣官方「面试经典 150 题」内置题单',
    slugs: TOP_INTERVIEW_150_SLUGS,
  },
  {
    id: 'codetop-100',
    name: 'CodeTop 高频 100',
    shortName: 'CodeTop 100',
    description: '国内大厂后端高频 Top 100（内置经典快照）',
    slugs: CODETOP_100_SLUGS,
  },
];

const SLUG_SETS: Readonly<Record<BuiltinProblemListId, ReadonlySet<string>>> = {
  'hot-100': new Set(HOT_100_SLUGS),
  'top-interview-150': new Set(TOP_INTERVIEW_150_SLUGS),
  'codetop-100': new Set(CODETOP_100_SLUGS),
};

export function getBuiltinProblemList(id: BuiltinProblemListId): BuiltinProblemList {
  const list = BUILTIN_PROBLEM_LISTS.find((item) => item.id === id);
  if (!list) throw new Error(`未知题单：${id}`);
  return list;
}

export function isSlugInBuiltinList(slug: string, listId: BuiltinProblemListId): boolean {
  return SLUG_SETS[listId].has(slug);
}

export function matchBuiltinListsForSlug(slug: string): readonly BuiltinProblemListId[] {
  return BUILTIN_PROBLEM_LISTS
    .filter((list) => SLUG_SETS[list.id].has(slug))
    .map((list) => list.id);
}
