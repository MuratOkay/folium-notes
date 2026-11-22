/** Tag normalisation, inline `#hashtag` extraction and tag editing helpers. */

import { maskCode } from './markdown';

const TAG_CHARS = /[\p{L}\p{N}_/-]/u;
const INLINE_TAG_RE = /(^|[\s(>])#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu;

/** Normalise a tag: lower case, spaces to `-`, nested tags use `/`. */
export function normalizeTag(value: unknown): string {
  if (typeof value !== 'string') return '';
  let text = value.trim().replace(/^#+/, '');
  text = text.toLowerCase().replace(/\s+/g, '-');
  let out = '';
  for (const char of text) {
    if (/[\p{L}\p{N}_/-]/u.test(char)) out += char;
  }
  out = out.replace(/-{2,}/g, '-').replace(/\/{2,}/g, '/').replace(/^-+|-+$/g, '');
  out = out.replace(/\/+$/g, '');
  return out;
}

/** Read tags from a header value: list, comma separated string or a mix. */
export function parseTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const raw: string[] = [];
  if (Array.isArray(value)) {
    for (const item of value) raw.push(...parseTags(item));
  } else if (typeof value === 'string') {
    for (const part of value.split(',')) raw.push(part);
  } else if (typeof value === 'number') {
    raw.push(String(value));
  }
  const out: string[] = [];
  for (const item of raw) {
    const tag = normalizeTag(item);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export interface InlineTag {
  tag: string;
  /** Offset of the leading `#`. */
  start: number;
  /** Offset just after the last tag character. */
  end: number;
  raw: string;
}

/** Find `#hashtags` outside code. Tags must start a line or follow whitespace. */
export function findInlineTags(body: string): InlineTag[] {
  const masked = maskCode(body);
  const found: InlineTag[] = [];
  INLINE_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TAG_RE.exec(masked)) !== null) {
    const hash = match.index + match[1].length;
    const raw = match[2];
    const tag = normalizeTag(raw);
    if (!tag) continue;
    found.push({ tag, start: hash, end: hash + 1 + raw.length, raw });
  }
  return found;
}

export function extractInlineTags(body: string): string[] {
  const out: string[] = [];
  for (const item of findInlineTags(body)) {
    if (!out.includes(item.tag)) out.push(item.tag);
  }
  return out;
}

/** All tags of a note: header tags plus inline hashtags (deduplicated, in order). */
export function collectTags(headerTags: string[] | undefined, body: string, inlineEnabled: boolean): string[] {
  const out = [...(headerTags ?? [])];
  if (inlineEnabled) {
    for (const tag of extractInlineTags(body)) {
      if (!out.includes(tag)) out.push(tag);
    }
  }
  return out;
}

/** A tag plus all its parents (`a/b/c` -> `a`, `a/b`, `a/b/c`). */
export function tagWithParents(tag: string): string[] {
  const parts = tag.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

export function tagMatches(tag: string, filter: string): boolean {
  return tag === filter || tag.startsWith(`${filter}/`);
}

/** Count notes per tag, including parent tags. Each note counts once per tag. */
export function countTags(tagLists: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tags of tagLists) {
    const seen = new Set<string>();
    for (const tag of tags) {
      for (const withParent of tagWithParents(tag)) seen.add(withParent);
    }
    for (const tag of seen) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/** Tags sorted for display: alphabetical, keeping nesting order. */
export function sortTags(tags: Iterable<string>): string[] {
  return [...new Set(tags)].sort((a, b) => a.localeCompare(b));
}

/** Replace inline tags (including children) with another tag / parent. */
export function renameInlineTags(body: string, from: string, to: string): { text: string; count: number } {
  const found = findInlineTags(body).filter((item) => tagMatches(item.tag, from));
  if (found.length === 0) return { text: body, count: 0 };
  let text = body;
  for (const item of [...found].sort((a, b) => b.start - a.start)) {
    const suffix = item.tag.slice(from.length);
    text = `${text.slice(0, item.start)}#${to}${suffix}${text.slice(item.end)}`;
  }
  return { text, count: found.length };
}

/** Remove inline tags: `#tag` becomes the plain word `tag`. */
export function removeInlineTags(body: string, tag: string): { text: string; count: number } {
  const found = findInlineTags(body).filter((item) => tagMatches(item.tag, tag));
  if (found.length === 0) return { text: body, count: 0 };
  let text = body;
  for (const item of [...found].sort((a, b) => b.start - a.start)) {
    text = `${text.slice(0, item.start)}${item.tag}${text.slice(item.end)}`;
  }
  return { text, count: found.length };
}

/** Replace a whole tag token in a body, keeping surrounding text. */
export function renameInlineTagExact(body: string, from: string, to: string): string {
  return renameInlineTags(body, from, to).text;
}

/** True when a character can be part of a tag. */
export function isTagChar(char: string): boolean {
  return TAG_CHARS.test(char);
}
