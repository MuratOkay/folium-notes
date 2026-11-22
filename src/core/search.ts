/** Live search: title boost 3, tags 2, body 1, prefix + typo tolerance, #tag filter. */

import { allowedEdits, boundedLevenshtein, makeSnippet, tokenize, type Snippet } from './text';
import { normalizeTag, tagMatches } from './tags';

export interface SearchDoc {
  key: string;
  title: string;
  tags: string[];
  body: string;
  scope?: 'shared' | 'private';
  /** Cache signature (e.g. file mtime + size). */
  version?: string;
  updated?: number;
}

export interface SearchHit {
  key: string;
  score: number;
  snippet?: Snippet;
  /** Tags matched by `#tag` filters. */
  matchedTags: string[];
}

interface Entry {
  doc: SearchDoc;
  version: string;
  titleLower: string;
  bodyLower: string;
  tagsLower: string[];
  titleWords: string[];
  bodyWords: string[];
}

const WEIGHT = { title: 3, tag: 2, body: 1 } as const;

function signatureOf(doc: SearchDoc): string {
  return doc.version ?? `${doc.title}\u0000${doc.tags.join(',')}\u0000${doc.body.length}`;
}

function makeEntry(doc: SearchDoc): Entry {
  return {
    doc,
    version: signatureOf(doc),
    titleLower: doc.title.toLowerCase(),
    bodyLower: doc.body.toLowerCase(),
    tagsLower: doc.tags.map((tag) => tag.toLowerCase()),
    titleWords: tokenize(doc.title),
    bodyWords: tokenize(doc.body),
  };
}

function wordBoundaryHit(haystack: string, needle: string): boolean {
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? ' ' : haystack[at - 1];
    const after = haystack[at + needle.length] ?? ' ';
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true;
    from = at + 1;
  }
  return false;
}

function fuzzyWordScore(words: string[], term: string): number {
  const edits = allowedEdits(term);
  if (edits === 0) return 0;
  for (const word of words) {
    if (Math.abs(word.length - term.length) > edits) continue;
    if (boundedLevenshtein(term, word, edits) !== undefined) return 1;
    // Prefix typo tolerance for longer words.
    if (word.length > term.length) {
      const prefix = word.slice(0, term.length);
      if (boundedLevenshtein(term, prefix, edits) !== undefined) return 0.8;
    }
  }
  return 0;
}

function fieldScore(haystack: string, words: string[], needle: string, weight: number): number {
  if (haystack.includes(needle)) {
    return weight * (wordBoundaryHit(haystack, needle) ? 1 : 0.9);
  }
  return fuzzyWordScore(words, needle) * weight * 0.5;
}

/** Incremental search index (kept in memory by the store). */
export class SearchIndex {
  private entries = new Map<string, Entry>();

  /** Add or replace documents; unchanged entries are reused. Returns true when changed. */
  update(docs: SearchDoc[]): boolean {
    let changed = false;
    const seen = new Set<string>();
    for (const doc of docs) {
      seen.add(doc.key);
      const existing = this.entries.get(doc.key);
      if (existing && existing.version === signatureOf(doc)) {
        existing.doc = doc;
        continue;
      }
      this.entries.set(doc.key, makeEntry(doc));
      changed = true;
    }
    for (const key of [...this.entries.keys()]) {
      if (!seen.has(key)) {
        this.entries.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): SearchDoc | undefined {
    return this.entries.get(key)?.doc;
  }

  /** Search with AND semantics over words; `#tag` tokens filter. */
  search(query: string, limit = 100): SearchHit[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const rawTerms = trimmed.split(/\s+/).filter(Boolean);
    const tagFilters: string[] = [];
    const terms: string[] = [];
    for (const raw of rawTerms) {
      if (raw.startsWith('#') && raw.length > 1) tagFilters.push(normalizeTag(raw.slice(1)));
      else terms.push(raw.toLowerCase());
    }
    const hits: SearchHit[] = [];
    for (const entry of this.entries.values()) {
      let score = 0;
      let failed = false;
      const matchedTags: string[] = [];
      for (const tag of tagFilters) {
        const match = entry.tagsLower.find((candidate) => tagMatches(candidate, tag));
        if (!match) {
          failed = true;
          break;
        }
        matchedTags.push(match);
        score += WEIGHT.tag;
      }
      if (failed) continue;
      for (const term of terms) {
        const title = fieldScore(entry.titleLower, entry.titleWords, term, WEIGHT.title);
        const body = fieldScore(entry.bodyLower, entry.bodyWords, term, WEIGHT.body);
        let tag = 0;
        if (entry.tagsLower.some((candidate) => candidate === term)) tag = WEIGHT.tag;
        else if (entry.tagsLower.some((candidate) => candidate.startsWith(term))) {
          tag = WEIGHT.tag * 0.8;
        } else if (entry.tagsLower.some((candidate) => candidate.includes(term))) {
          tag = WEIGHT.tag * 0.6;
        }
        const termScore = title + body + tag;
        if (termScore <= 0) {
          failed = true;
          break;
        }
        score += termScore;
      }
      if (failed) continue;
      hits.push({
        key: entry.doc.key,
        score,
        matchedTags,
        snippet: makeSnippet(entry.doc.body || entry.doc.title, terms),
      });
    }
    hits.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 1e-9) return b.score - a.score;
      const aUpdated = this.entries.get(a.key)?.doc.updated ?? 0;
      const bUpdated = this.entries.get(b.key)?.doc.updated ?? 0;
      if (aUpdated !== bUpdated) return bUpdated - aUpdated;
      return (this.entries.get(a.key)?.doc.title ?? '').localeCompare(
        this.entries.get(b.key)?.doc.title ?? '',
      );
    });
    return hits.slice(0, limit);
  }
}

/** Recently updated notes, used when the search box is empty. */
export function recentNotes(docs: SearchDoc[], limit = 10): SearchDoc[] {
  return [...docs].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0)).slice(0, limit);
}
