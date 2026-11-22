/** Note front matter: parse, serialise (Folium write style) and edit fields in place. */

import { parse as parseYaml } from 'yaml';
import { normalizeColor, type Color } from './colors';
import { firstHeadingLine, splitFrontMatter } from './markdown';
import { parseTags } from './tags';
import { parseDateLoose } from './time';
import { titleFromFileName } from './filenames';

export interface CodeLink {
  path: string;
  /** e.g. `12-18` or `12`. */
  lines?: string;
  /** First up to three trimmed code lines, newline separated. */
  text?: string;
  /** Last line of the snippet (range growth anchor). */
  endText?: string;
}

export interface NoteMeta {
  id?: string;
  title?: string;
  created?: string;
  updated?: string;
  tags: string[];
  color?: string;
  archived?: string | boolean;
  sensitive?: boolean;
  encrypted?: string;
  code: CodeLink[];
  branch?: string;
  kind?: string;
  target?: string;
  status?: string;
  issue?: string;
  imported_from?: string;
  [key: string]: unknown;
}

export interface ParsedNote {
  meta: NoteMeta;
  body: string;
  raw: string;
  hasHeader: boolean;
  headerError?: string;
}

/** Keys in canonical order; unknown keys are appended after these. */
export const META_KEY_ORDER = [
  'id',
  'title',
  'created',
  'updated',
  'tags',
  'color',
  'archived',
  'sensitive',
  'encrypted',
  'code',
  'branch',
  'kind',
  'target',
  'status',
  'issue',
  'imported_from',
] as const;

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

export function normalizeCodeLinks(value: unknown): CodeLink[] {
  if (!Array.isArray(value)) return [];
  const out: CodeLink[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      out.push({ path: entry });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const pathValue = asString(record.path);
    if (!pathValue) continue;
    const link: CodeLink = { path: pathValue };
    if (record.lines !== undefined) {
      const lines = Array.isArray(record.lines)
        ? record.lines.map((n) => asString(n)).filter(Boolean).join('-')
        : asString(record.lines);
      if (lines) link.lines = lines;
    }
    const text = asString(record.text);
    if (text) link.text = text;
    const endText = asString(record.endText);
    if (endText) link.endText = endText;
    out.push(link);
  }
  return out;
}

export function normalizeMeta(input: unknown): NoteMeta {
  const record = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const meta: NoteMeta = { tags: [], code: [] };
  const copy: Record<string, unknown> = { ...record };
  delete copy.tags;
  delete copy.code;
  for (const [key, value] of Object.entries(copy)) {
    if (value === undefined) continue;
    if (key === 'id') meta.id = asString(value);
    else if (key === 'title') meta.title = asString(value);
    else if (key === 'created') meta.created = asString(value);
    else if (key === 'updated') meta.updated = asString(value);
    else if (key === 'color') meta.color = asString(value);
    else if (key === 'archived') {
      meta.archived = typeof value === 'boolean' ? value : asString(value);
    } else if (key === 'sensitive') meta.sensitive = value === true || value === 'true';
    else if (key === 'encrypted') meta.encrypted = asString(value);
    else if (key === 'branch') meta.branch = asString(value);
    else if (key === 'kind') meta.kind = asString(value);
    else if (key === 'target') meta.target = asString(value);
    else if (key === 'status') meta.status = asString(value);
    else if (key === 'issue') meta.issue = asString(value);
    else if (key === 'imported_from') meta.imported_from = asString(value);
    else meta[key] = value;
  }
  meta.tags = parseTags(record.tags);
  meta.code = normalizeCodeLinks(record.code);
  return meta;
}

export function parseNote(raw: string): ParsedNote {
  const split = splitFrontMatter(raw);
  if (!split.hasHeader) {
    return { meta: normalizeMeta({}), body: split.body, raw, hasHeader: false };
  }
  try {
    const parsed = parseYaml(split.header, { uniqueKeys: false, prettyErrors: false });
    return { meta: normalizeMeta(parsed), body: split.body, raw, hasHeader: true };
  } catch (error) {
    return {
      meta: normalizeMeta({}),
      body: split.body,
      raw,
      hasHeader: true,
      headerError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Title resolution: `title:` field, else first non-empty line without `#`, else file name. */
export function resolveTitle(meta: NoteMeta, body: string, fileName = ''): string {
  if (meta.title && meta.title.trim()) return meta.title.trim();
  const heading = firstHeadingLine(body);
  if (heading && heading.title) return heading.title;
  if (fileName) return titleFromFileName(fileName);
  return 'Untitled';
}

export function isArchived(meta: NoteMeta): boolean {
  if (meta.archived === undefined) return false;
  if (typeof meta.archived === 'boolean') return meta.archived;
  if (typeof meta.archived === 'string') {
    const text = meta.archived.trim().toLowerCase();
    if (!text || text === 'false' || text === 'no' || text === '0') return false;
    return true;
  }
  return false;
}

export function noteColor(meta: NoteMeta): Color | undefined {
  return normalizeColor(meta.color);
}

export function noteCreated(meta: NoteMeta): Date {
  return parseDateLoose(meta.created) ?? new Date(0);
}

export function noteUpdated(meta: NoteMeta, fallback: Date): Date {
  return parseDateLoose(meta.updated) ?? fallback;
}

export function isEncrypted(meta: NoteMeta): boolean {
  return typeof meta.encrypted === 'string' && meta.encrypted.trim() !== '';
}

/* ------------------------------------------------------------------------- */
/* Write style                                                                */
/* ------------------------------------------------------------------------- */

const PLAIN_SCALAR = /^[A-Za-z0-9_][A-Za-z0-9 _.;/@()+,&:=-]*$/;
const RESERVED = new Set(['true', 'false', 'null', '~', 'yes', 'no', 'on', 'off']);
const NUMBER_LIKE = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/** Plain scalar when safe, otherwise a double-quoted YAML string. */
export function encodeScalar(value: string): string {
  const text = value;
  if (text === '') return '""';
  if (text.includes('\n') || text.includes('\r')) return JSON.stringify(text);
  const looksNumeric = NUMBER_LIKE.test(text);
  const reserved = RESERVED.has(text.toLowerCase());
  const safe =
    PLAIN_SCALAR.test(text) &&
    !looksNumeric &&
    !reserved &&
    !text.includes(': ') &&
    !text.includes(' #') &&
    !text.endsWith(':') &&
    !text.endsWith(' ') &&
    !text.startsWith(' ') &&
    !text.includes('\t');
  if (safe) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t')}"`;
}

type EncodedValue =
  | { kind: 'inline'; text: string }
  | { kind: 'block'; lines: string[] }
  | { kind: 'empty' };

function encodeMapEntry(entry: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const keys = Object.keys(entry).filter((key) => entry[key] !== undefined);
  if (keys.length === 0) return ['{}'];
  for (const key of keys) {
    const encoded = encodeValue(entry[key]);
    if (encoded.kind === 'inline') lines.push(`${key}: ${encoded.text}`);
    else if (encoded.kind === 'block') {
      if (encoded.lines[0]?.startsWith('|')) {
        lines.push(`${key}: ${encoded.lines[0]}`);
        lines.push(...encoded.lines.slice(1));
      } else {
        lines.push(`${key}:`);
        lines.push(...encoded.lines.map((line) => `  ${line}`));
      }
    }
  }
  return lines;
}

function encodeValue(value: unknown): EncodedValue {
  if (value === undefined) return { kind: 'empty' };
  if (value === null) return { kind: 'inline', text: 'null' };
  if (typeof value === 'boolean') return { kind: 'inline', text: value ? 'true' : 'false' };
  if (typeof value === 'number') return { kind: 'inline', text: String(value) };
  if (typeof value === 'string') {
    if (value.includes('\n')) {
      const lines = value.replace(/\r\n/g, '\n').split('\n');
      if (lines[lines.length - 1] === '') lines.pop();
      return { kind: 'block', lines: ['|-', ...lines.map((line) => `  ${line}`)] };
    }
    return { kind: 'inline', text: encodeScalar(value) };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'inline', text: '[]' };
    const allScalar = value.every(
      (item) => item === null || ['string', 'number', 'boolean'].includes(typeof item),
    );
    if (allScalar) {
      const parts = value.map((item) => (item === null ? 'null' : encodeScalar(String(item))));
      return { kind: 'inline', text: `[ ${parts.join(', ')} ]` };
    }
    const lines: string[] = [];
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const entries = encodeMapEntry(item as Record<string, unknown>);
        lines.push(`  - ${entries[0]}`, ...entries.slice(1).map((line) => `    ${line}`));
      } else {
        lines.push(`  - ${encodeScalar(String(item))}`);
      }
    }
    return { kind: 'block', lines };
  }
  if (typeof value === 'object') {
    const entries = encodeMapEntry(value as Record<string, unknown>);
    return { kind: 'block', lines: entries.map((line) => `  ${line}`) };
  }
  return { kind: 'inline', text: encodeScalar(String(value)) };
}

function fieldLine(key: string, value: unknown, eol: string): string {
  const encoded = encodeValue(value);
  if (encoded.kind === 'empty') return '';
  if (encoded.kind === 'inline') return `${key}: ${encoded.text}`;
  return `${key}:${eol}${encoded.lines.join(eol)}`;
}

export interface NoteInit {
  id?: string;
  title?: string;
  created?: Date | string;
  updated?: Date | string;
  tags?: string[];
  color?: string;
  archived?: string | boolean;
  sensitive?: boolean;
  encrypted?: string;
  code?: CodeLink[];
  branch?: string;
  kind?: string;
  target?: string;
  status?: string;
  issue?: string;
  imported_from?: string;
  /** Unknown/custom front matter fields, written after the known ones. */
  extra?: Record<string, unknown>;
}

function isoTimestamp(value: Date | string): string {
  if (value instanceof Date) {
    const offset = -value.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return (
      `${p(value.getFullYear(), 4)}-${p(value.getMonth() + 1)}-${p(value.getDate())}` +
      `T${p(value.getHours())}:${p(value.getMinutes())}:${p(value.getSeconds())}` +
      `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
    );
  }
  return value;
}

/** Serialise a new note (or a note without header) in Folium's write style. */
export function serializeNote(init: NoteInit, body: string): string {
  const values: Record<string, unknown> = {
    id: init.id,
    title: init.title,
    created: init.created === undefined ? undefined : isoTimestamp(init.created),
    updated: init.updated === undefined ? undefined : isoTimestamp(init.updated),
    tags: init.tags,
    color: init.color,
    archived: init.archived,
    sensitive: init.sensitive === true ? true : undefined,
    encrypted: init.encrypted,
    code: init.code && init.code.length > 0 ? init.code : undefined,
    branch: init.branch,
    kind: init.kind,
    target: init.target,
    status: init.status,
    issue: init.issue,
    imported_from: init.imported_from,
  };
  const extra = init.extra ?? {};
  const extraKeys = Object.keys(extra).filter((key) => !(key in values));
  for (const key of extraKeys) values[key] = extra[key];
  const lines: string[] = [];
  for (const key of [...META_KEY_ORDER, ...extraKeys]) {
    const line = fieldLine(key, values[key], '\n');
    if (line) lines.push(line);
  }
  const header = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  const normalizedBody = body.replace(/\r\n/g, '\n');
  return `---\n${header}---\n${normalizedBody}${normalizedBody.endsWith('\n') ? '' : '\n'}`;
}

/* ------------------------------------------------------------------------- */
/* In-place field editing (never rewrites unrelated lines)                    */
/* ------------------------------------------------------------------------- */

function escapeKeyForRegExp(key: string): string {
  return key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface FieldSpan {
  /** Offset of the key line start. */
  start: number;
  /** Offset just after the last content line of the field. */
  end: number;
}

/** Locate a top-level key and the end of its block (blank lines stay untouched). */
function findFieldSpan(header: string, key: string): FieldSpan | undefined {
  const re = new RegExp(`^${escapeKeyForRegExp(key)}[ \\t]*:`, 'm');
  const match = re.exec(header);
  if (!match) return undefined;
  const start = match.index;
  let cursor = header.indexOf('\n', start);
  if (cursor === -1) return { start, end: header.length };
  cursor += 1;
  let end = cursor;
  while (cursor < header.length) {
    const newline = header.indexOf('\n', cursor);
    const lineEnd = newline === -1 ? header.length : newline;
    const line = header.slice(cursor, lineEnd);
    if (line.trim() === '') {
      cursor = lineEnd + 1;
      continue;
    }
    // A new top-level key or a comment ends the block.
    if (/^[^\s#]/.test(line)) break;
    cursor = lineEnd + 1;
    end = Math.min(cursor, header.length);
  }
  return { start, end };
}

/** Insert new fields after the last single-line field, before block lists. */
function insertionPoint(header: string): number {
  let offset = 0;
  let best = -1;
  for (const line of header.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    if (/^[A-Za-z0-9_-]+:[ \t]+\S/.test(line)) {
      best = Math.min(offset, header.length);
    } else if (/^#/.test(line) || line.trim() === '') {
      if (best === -1) best = Math.min(lineStart, header.length);
    }
  }
  if (best === -1) return header.length;
  return best;
}

/** Set one front-matter field, leaving every other byte untouched. */
export function setFrontMatterField(raw: string, key: string, value: unknown): string {
  const rendered = fieldLine(key, value, '\n');
  if (!rendered) return removeFrontMatterField(raw, key);
  const split = splitFrontMatter(raw);
  const eol = split.eol;
  const renderedWithEol = rendered.replace(/\n/g, eol) + eol;
  if (!split.hasHeader) {
    const bodyOffset = split.bodyStart;
    const prefix = split.bom ? raw.slice(0, 1) : '';
    return `${prefix}---${eol}${renderedWithEol}---${eol}${raw.slice(bodyOffset)}`;
  }
  const header = split.header;
  const span = findFieldSpan(header, key);
  if (!span) {
    const insertAt = insertionPoint(header);
    const nextHeader = `${header.slice(0, insertAt)}${renderedWithEol}${header.slice(insertAt)}`;
    return `${raw.slice(0, split.headerStart)}${nextHeader}${raw.slice(split.headerEnd)}`;
  }
  const nextHeader = `${header.slice(0, span.start)}${renderedWithEol}${header.slice(span.end)}`;
  return `${raw.slice(0, split.headerStart)}${nextHeader}${raw.slice(split.headerEnd)}`;
}

/** Set several fields in order (each edit re-parses the header). */
export function setFrontMatterFields(raw: string, entries: Array<[string, unknown]>): string {
  let out = raw;
  for (const [key, value] of entries) out = setFrontMatterField(out, key, value);
  return out;
}

/** Remove a front-matter field (no-op when absent). */
export function removeFrontMatterField(raw: string, key: string): string {
  const split = splitFrontMatter(raw);
  if (!split.hasHeader) return raw;
  const span = findFieldSpan(split.header, key);
  if (!span) return raw;
  const nextHeader = `${split.header.slice(0, span.start)}${split.header.slice(span.end)}`;
  return `${raw.slice(0, split.headerStart)}${nextHeader}${raw.slice(split.headerEnd)}`;
}

/** Raw text of one front-matter field, including its trailing newline(s). */
export function rawFieldText(raw: string, key: string): string | undefined {
  const split = splitFrontMatter(raw);
  if (!split.hasHeader) return undefined;
  const span = findFieldSpan(split.header, key);
  return span ? split.header.slice(span.start, span.end) : undefined;
}
