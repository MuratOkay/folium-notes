/** Code links: capture snippets and relocate them as code moves. */

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { diceSimilarity } from './text';
import type { CodeLink } from './frontmatter';

export type CodeLinkStatus = 'exact' | 'moved' | 'moved-first' | 'fuzzy' | 'lost';

export const STATUS_LABELS: Record<CodeLinkStatus, string> = {
  exact: 'Exact',
  moved: 'Moved',
  'moved-first': 'Moved (first line)',
  fuzzy: 'Fuzzy match',
  lost: 'Lost',
};

export interface CodeLinkResolution {
  status: CodeLinkStatus;
  /** Absolute path of the resolved file (undefined when lost). */
  path?: string;
  /** 1-based inclusive range. */
  startLine: number;
  endLine: number;
  similarity?: number;
  link: CodeLink;
}

export interface CodeFileProvider {
  /** Candidate absolute paths for a link path, in priority order. */
  candidates(linkPath: string): string[];
  exists(absPath: string): boolean;
  readLines(absPath: string): string[] | undefined;
}

/** Parse `12-18` / `12` / `12:18` into a 1-based inclusive range. */
export function parseLines(value: string | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const match = /^\s*L?(\d+)(?:\s*[-:–]\s*L?(\d+))?\s*$/i.exec(String(value));
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (!Number.isFinite(start) || start < 1) return undefined;
  if (!Number.isFinite(end) || end < start) return [start, start];
  return [start, end];
}

export function formatLines(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}

export interface SnippetCapture {
  lines: string;
  text: string;
  endText?: string;
}

/** Capture a snippet: `text` holds the first (up to 3) trimmed lines. */
export function captureSnippet(lines: string[], start: number, end: number, maxText = 3): SnippetCapture {
  const from = Math.max(1, Math.min(start, end));
  const to = Math.min(lines.length, Math.max(start, end));
  const slice = lines.slice(from - 1, to).map((line) => line.trim());
  const nonEmpty = slice.filter(Boolean);
  const textLines = (nonEmpty.length > 0 ? nonEmpty : slice).slice(0, maxText);
  return {
    lines: formatLines(from, to),
    text: textLines.join('\n'),
    endText: to >= from ? slice[slice.length - 1] || undefined : undefined,
  };
}

function sameLine(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  return actual.trim() === expected.trim();
}

function matchesAt(lines: string[], start: number, expected: string[]): boolean {
  if (expected.length === 0) return start >= 1 && start <= lines.length;
  if (start < 1 || start + expected.length - 1 > lines.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (!sameLine(lines[start - 1 + i], expected[i])) return false;
  }
  return true;
}

function findNearest(
  lines: string[],
  expected: string[],
  around: number,
  exactBlock: boolean,
): number | undefined {
  if (expected.length === 0) return undefined;
  let best: { line: number; distance: number } | undefined;
  for (let i = 1; i <= lines.length; i++) {
    const matches = exactBlock
      ? matchesAt(lines, i, expected)
      : sameLine(lines[i - 1], expected[0]);
    if (!matches) continue;
    const distance = Math.abs(i - around);
    if (!best || distance < best.distance || (distance === best.distance && i < best.line)) {
      best = { line: i, distance };
    }
  }
  return best?.line;
}

function findEndLine(lines: string[], startLine: number, endText: string, from: number): number | undefined {
  const limit = Math.min(lines.length, from + 2000);
  for (let i = Math.max(from, startLine); i <= limit; i++) {
    if (sameLine(lines[i - 1], endText)) return i;
  }
  return undefined;
}

function fuzzyFind(
  lines: string[],
  expected: string[],
  around: number,
): { line: number; similarity: number } | undefined {
  const windowSize = Math.max(1, expected.length);
  const needle = expected.join('\n');
  let best: { line: number; similarity: number } | undefined;
  for (let i = 1; i + windowSize - 1 <= lines.length; i++) {
    const candidate = lines.slice(i - 1, i - 1 + windowSize).join('\n');
    const similarity = diceSimilarity(candidate, needle);
    if (similarity < 0.75) continue;
    if (
      !best ||
      similarity > best.similarity + 1e-9 ||
      (Math.abs(similarity - best.similarity) <= 1e-9 &&
        Math.abs(i - around) < Math.abs(best.line - around))
    ) {
      best = { line: i, similarity };
    }
  }
  return best;
}

interface Located {
  status: CodeLinkStatus;
  start: number;
  end: number;
  similarity?: number;
}

/** Locate a code link inside one file's lines. */
export function locateInLines(lines: string[], link: CodeLink): Located | undefined {
  const range = parseLines(link.lines);
  const expected = (link.text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const around = range ? range[0] : 1;
  const span = range ? range[1] - range[0] + 1 : Math.max(expected.length, 1);

  const finish = (status: CodeLinkStatus, start: number, similarity?: number): Located => {
    let end = Math.min(lines.length, start + Math.max(span, expected.length) - 1);
    if (link.endText) {
      const found = findEndLine(lines, start, link.endText, start + Math.max(expected.length, 1) - 1);
      if (found !== undefined) end = found;
    }
    return { status, start, end: Math.max(start, end), similarity };
  };

  if (range && matchesAt(lines, range[0], expected)) {
    // Exact match; grow the range with endText when the snippet got longer.
    let end = range[1];
    if (link.endText) {
      const found = findEndLine(
        lines,
        range[0],
        link.endText,
        range[0] + Math.max(expected.length, 1) - 1,
      );
      if (found !== undefined) end = found;
    }
    return { status: 'exact', start: range[0], end: Math.min(lines.length, Math.max(range[0], end)) };
  }
  if (range && expected.length === 0 && range[1] <= lines.length) {
    return { status: 'exact', start: range[0], end: range[1] };
  }
  if (expected.length > 0) {
    const whole = findNearest(lines, expected, around, true);
    if (whole !== undefined) return finish('moved', whole);
    const first = findNearest(lines, expected, around, false);
    if (first !== undefined) return finish('moved-first', first);
    const fuzzy = fuzzyFind(lines, expected, around);
    if (fuzzy) return { ...finish('fuzzy', fuzzy.line, fuzzy.similarity), similarity: fuzzy.similarity };
  }
  return undefined;
}

const STATUS_RANK: Record<CodeLinkStatus, number> = {
  exact: 0,
  moved: 1,
  'moved-first': 2,
  fuzzy: 3,
  lost: 4,
};

/** Resolve a code link against the file system (exact > moved > first line > fuzzy > lost). */
export function resolveCodeLink(link: CodeLink, provider: CodeFileProvider): CodeLinkResolution {
  const fallback: CodeLinkResolution = {
    status: 'lost',
    startLine: parseLines(link.lines)?.[0] ?? 1,
    endLine: parseLines(link.lines)?.[1] ?? 1,
    link,
  };
  let best: (CodeLinkResolution & { rank: number; distance: number }) | undefined;
  const candidates = provider.candidates(link.path);
  for (const candidate of candidates) {
    if (!provider.exists(candidate)) continue;
    const lines = provider.readLines(candidate);
    if (!lines) continue;
    const located = locateInLines(lines, link);
    if (!located) continue;
    const around = parseLines(link.lines)?.[0] ?? 1;
    const rank = STATUS_RANK[located.status];
    const distance = Math.abs(located.start - around);
    if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
      best = {
        status: located.status,
        path: candidate,
        startLine: located.start,
        endLine: located.end,
        similarity: located.similarity,
        link,
        rank,
        distance,
      };
    }
  }
  if (!best) {
    // Keep the link path visible even when the file is gone.
    return fallback;
  }
  const { rank: _rank, distance: _distance, ...resolution } = best;
  return resolution;
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

/** Path stored in a note's `code:` entry: relative for shared, file URI for private. */
export function codeLinkPathFor(
  noteAbsPath: string,
  scope: 'shared' | 'private',
  targetAbsPath: string,
): string {
  if (scope === 'private') return pathToFileURL(targetAbsPath).href;
  const relative = path.relative(path.dirname(noteAbsPath), targetAbsPath);
  return toPosixPath(relative);
}

/** Absolute candidate paths for a stored code-link path (note dir, then project root). */
export function codeLinkCandidates(
  linkPath: string,
  noteAbsPath: string,
  projectRoot?: string,
): string[] {
  const out: string[] = [];
  if (/^file:\/\//i.test(linkPath)) {
    try {
      out.push(fileURLToPath(linkPath));
    } catch {
      /* ignore malformed file URIs */
    }
    return out;
  }
  if (path.isAbsolute(linkPath)) {
    out.push(path.normalize(linkPath));
    return out;
  }
  out.push(path.resolve(path.dirname(noteAbsPath), linkPath));
  if (projectRoot) {
    const fromRoot = path.resolve(projectRoot, linkPath);
    if (!out.includes(fromRoot)) out.push(fromRoot);
  }
  return out;
}

/** `src/a.ts#L3-L6` (anchor omitted when no lines are known). */
export function codeLinkAnchor(linkPath: string, lines?: string): string {
  const range = parseLines(lines);
  const display = toPosixPath(linkPath).replace(/^file:\/\//, '');
  if (!range) return display;
  return `${display}#L${range[0]}${range[1] !== range[0] ? `-L${range[1]}` : ''}`;
}

export function codeLinkHref(linkPath: string, lines?: string): string {
  const range = parseLines(lines);
  const base = toPosixPath(linkPath);
  if (!range) return base;
  return `${base}#L${range[0]}${range[1] !== range[0] ? `-L${range[1]}` : ''}`;
}

/** Markdown body link `[src/a.ts#L3-L6](../src/a.ts#L3-L6)`. */
export function formatBodyLink(displayPath: string, href: string): string {
  return `[${displayPath}](${href})`;
}

/** Build a code link from an editor range. */
export function buildCodeLink(
  lines: string[],
  startLine: number,
  endLine: number,
  linkPath: string,
): CodeLink {
  const snippet = captureSnippet(lines, startLine, endLine);
  const link: CodeLink = { path: linkPath, lines: snippet.lines };
  if (snippet.text) link.text = snippet.text;
  if (snippet.endText) link.endText = snippet.endText;
  return link;
}

