/** `[[wiki links]]` with `#heading` and `|alias`, resolution and backlinks. */

import { maskCode } from './markdown';

export interface WikiLink {
  /** Link target as written (no heading/alias). */
  target: string;
  heading?: string;
  alias?: string;
  raw: string;
  /** Offsets of the whole `[[...]]` token. */
  start: number;
  end: number;
  /** Offset just after `[[`. */
  contentStart: number;
}

const WIKI_RE = /\[\[([^[\]\n]+)\]\]/g;

export function parseWikiLinks(text: string): WikiLink[] {
  const masked = maskCode(text);
  const links: WikiLink[] = [];
  WIKI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_RE.exec(masked)) !== null) {
    const inner = match[1];
    let target = inner;
    let alias: string | undefined;
    const pipe = inner.indexOf('|');
    if (pipe !== -1) {
      target = inner.slice(0, pipe);
      alias = inner.slice(pipe + 1).trim() || undefined;
    }
    let heading: string | undefined;
    const hash = target.indexOf('#');
    if (hash !== -1) {
      heading = target.slice(hash + 1).trim() || undefined;
      target = target.slice(0, hash);
    }
    target = target.trim();
    if (!target && !heading) continue;
    links.push({
      target,
      heading,
      alias,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
      contentStart: match.index + 2,
    });
  }
  return links;
}

export function formatWikiLink(target: string, heading?: string, alias?: string): string {
  const base = heading ? `${target}#${heading}` : target;
  return alias ? `[[${base}|${alias}]]` : `[[${base}]]`;
}

export interface LinkableNote {
  key: string;
  id?: string;
  title: string;
  fileName: string;
  relPath: string;
  scope: 'shared' | 'private';
}

export interface LinkIndex {
  byTitle: Map<string, LinkableNote[]>;
  byFileName: Map<string, LinkableNote[]>;
  byRelPath: Map<string, LinkableNote[]>;
  byId: Map<string, LinkableNote[]>;
}

const lower = (value: string): string => value.trim().toLowerCase();

function push(map: Map<string, LinkableNote[]>, key: string, note: LinkableNote): void {
  if (!key) return;
  const list = map.get(key);
  if (list) {
    if (!list.includes(note)) list.push(note);
  } else map.set(key, [note]);
}

function fileNameKeys(fileName: string): string[] {
  const base = fileName.replace(/\.md$/i, '');
  const withoutExt = base.toLowerCase();
  const withoutDate = base.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '').toLowerCase();
  return [withoutExt, withoutDate].filter((value, index, all) => value && all.indexOf(value) === index);
}

export function buildLinkIndex(notes: LinkableNote[]): LinkIndex {
  const index: LinkIndex = {
    byTitle: new Map(),
    byFileName: new Map(),
    byRelPath: new Map(),
    byId: new Map(),
  };
  for (const note of notes) {
    push(index.byTitle, lower(note.title), note);
    for (const key of fileNameKeys(note.fileName)) push(index.byFileName, key, note);
    const rel = note.relPath.replace(/\\/g, '/');
    push(index.byRelPath, rel.toLowerCase(), note);
    push(index.byRelPath, rel.replace(/\.md$/i, '').toLowerCase(), note);
    if (note.id) push(index.byId, note.id.toLowerCase(), note);
  }
  return index;
}

export interface ResolvedLink {
  link: WikiLink;
  note?: LinkableNote;
  /** Notes that matched, in resolution order. */
  candidates: LinkableNote[];
}

/** Resolve by title, file name, rel path, id — case-insensitive, same project. */
export function resolveLink(
  target: string,
  index: LinkIndex,
  fromScope?: 'shared' | 'private',
): LinkableNote[] {
  const key = lower(target).replace(/\.md$/, '');
  const raw = lower(target);
  const found: LinkableNote[] = [];
  const add = (list: LinkableNote[] | undefined): void => {
    for (const note of list ?? []) if (!found.includes(note)) found.push(note);
  };
  add(index.byTitle.get(raw));
  add(index.byFileName.get(key));
  add(index.byRelPath.get(key));
  add(index.byRelPath.get(raw));
  add(index.byId.get(raw));
  if (fromScope) {
    found.sort((a, b) => {
      const aSame = a.scope === fromScope ? 0 : 1;
      const bSame = b.scope === fromScope ? 0 : 1;
      return aSame - bSame;
    });
  }
  return found;
}

export type LinkProblem = 'missing' | 'private-from-shared';

export interface LinkDiagnostic {
  link: WikiLink;
  problem: LinkProblem;
  target?: LinkableNote;
}

/** Validate all wiki links of a note. */
export function validateLinks(
  body: string,
  index: LinkIndex,
  from: LinkableNote,
): LinkDiagnostic[] {
  const diagnostics: LinkDiagnostic[] = [];
  for (const link of parseWikiLinks(body)) {
    if (!link.target) continue;
    const candidates = resolveLink(link.target, index, from.scope);
    const target = candidates[0];
    if (!target) diagnostics.push({ link, problem: 'missing' });
    else if (from.scope === 'shared' && target.scope === 'private') {
      diagnostics.push({ link, problem: 'private-from-shared', target });
    }
  }
  return diagnostics;
}

/** Notes that link to `target` (by any of its names). */
export function findBacklinks(
  notes: Array<{ key: string; body: string; title: string }>,
  target: LinkableNote,
): Array<{ key: string; title: string; links: WikiLink[] }> {
  const names = new Set<string>([
    lower(target.title),
    ...fileNameKeys(target.fileName),
    target.relPath.replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase(),
    ...(target.id ? [target.id.toLowerCase()] : []),
  ]);
  const out: Array<{ key: string; title: string; links: WikiLink[] }> = [];
  for (const note of notes) {
    if (note.key === target.key) continue;
    const links = parseWikiLinks(note.body).filter((link) => names.has(lower(link.target)));
    if (links.length > 0) out.push({ key: note.key, title: note.title, links });
  }
  return out;
}

/** Rewrite links that pointed at a renamed note (title / file name forms). */
export function renameLinksInBody(
  body: string,
  oldNames: string[],
  newTarget: string,
): { text: string; count: number } {
  const names = new Set(oldNames.map(lower));
  let count = 0;
  const text = body.replace(WIKI_RE, (raw, inner: string) => {
    let target = inner;
    let suffix = '';
    const pipe = target.indexOf('|');
    if (pipe !== -1) {
      suffix = target.slice(pipe);
      target = target.slice(0, pipe);
    }
    const hash = target.indexOf('#');
    if (hash !== -1) {
      suffix = `${target.slice(hash)}${suffix}`;
      target = target.slice(0, hash);
    }
    if (!names.has(lower(target))) return raw;
    count++;
    return `[[${newTarget}${suffix}]]`;
  });
  return { text, count };
}

/** Target text used when creating a link to a new note. */
export function linkTargetForNote(
  note: { title: string; relPath: string },
  preferRelPath = false,
): string {
  if (preferRelPath) return note.relPath.replace(/\\/g, '/').replace(/\.md$/i, '');
  return note.title;
}
