/** Small text utilities: tokenisation, fuzzy distance, snippets. */

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Lower-case word tokens (letters/digits, `_`, `-`, `/`). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_/-]{2,}/gu) ?? [];
}

function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const normalized = text.toLowerCase();
  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  if (normalized.length === 1) map.set(normalized, 1);
  return map;
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. */
export function diceSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const left = bigrams(a);
  const right = bigrams(b);
  let intersection = 0;
  let total = 0;
  for (const [gram, count] of left) {
    total += count;
    const other = right.get(gram);
    if (other) intersection += Math.min(count, other);
  }
  for (const count of right.values()) total += count;
  if (total === 0) return 0;
  return (2 * intersection) / total;
}

/**
 * Levenshtein distance with an early exit: returns `undefined` when the
 * distance is greater than `max`.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number | undefined {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (Math.abs(aLen - bLen) > max) return undefined;
  let previous = new Array<number>(bLen + 1);
  let current = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j++) previous[j] = j;
  for (let i = 1; i <= aLen; i++) {
    current[0] = i;
    let rowMin = current[0];
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= bLen; j++) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return undefined;
    const swap = previous;
    previous = current;
    current = swap;
  }
  const distance = previous[bLen];
  return distance <= max ? distance : undefined;
}

/** Edits allowed for typo tolerance: ~20% of a term longer than 3 characters. */
export function allowedEdits(term: string): number {
  if (term.length <= 3) return 0;
  return Math.max(1, Math.round(term.length * 0.2));
}

export interface Snippet {
  text: string;
  /** Offset of the snippet inside the source text. */
  start: number;
  /** Match offsets relative to `text`. */
  highlightStart: number;
  highlightEnd: number;
}

/** Extract a short snippet around the first match of any term. */
export function makeSnippet(text: string, terms: string[], radius = 60): Snippet | undefined {
  const lower = text.toLowerCase();
  let index = -1;
  let matched = '';
  for (const term of terms) {
    if (!term) continue;
    const at = lower.indexOf(term.toLowerCase());
    if (at !== -1 && (index === -1 || at < index)) {
      index = at;
      matched = term;
    }
  }
  if (index === -1) {
    const flat = text.slice(0, radius * 2).replace(/[\r\n\t]/g, ' ');
    if (!flat.trim()) return undefined;
    return { text: flat, start: 0, highlightStart: 0, highlightEnd: 0 };
  }
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matched.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const slice = text.slice(start, end).replace(/[\r\n\t]/g, ' ');
  return {
    text: `${prefix}${slice}${suffix}`,
    start,
    highlightStart: prefix.length + index - start,
    highlightEnd: prefix.length + index - start + matched.length,
  };
}
