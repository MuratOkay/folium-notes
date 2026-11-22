/** Note file naming: slugs, patterns, Windows device names, collisions. */

import { createHash } from 'node:crypto';
import { dayKey, timeKey } from './time';

export const DEFAULT_FILE_NAME_PATTERN = '{date}-{slug}';
export const MAX_SLUG_LENGTH = 60;

const WINDOWS_DEVICES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'clock$',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** Lower case, accents removed, `ı` -> `i`, non letters/digits -> `-`, max 60 chars. */
export function slugify(text: string, maxLength = MAX_SLUG_LENGTH): string {
  const prepared = text
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'I')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  let out = '';
  for (const char of prepared) {
    if (/[a-z0-9]/.test(char)) out += char;
    else out += '-';
  }
  out = out.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  if (out.length > maxLength) {
    out = out.slice(0, maxLength).replace(/-+$/g, '');
  }
  return out;
}

export function isWindowsDeviceName(base: string): boolean {
  const lower = base.toLowerCase();
  const dot = lower.indexOf('.');
  const stem = dot === -1 ? lower : lower.slice(0, dot);
  return WINDOWS_DEVICES.has(stem);
}

/** Strip characters that are invalid on Windows and trim trailing dots/spaces. */
export function sanitizeFileNameBase(base: string): string {
  let out = '';
  for (const char of base) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32) continue;
    if (/[<>:"/\\|?*]/.test(char)) continue;
    out += char;
  }
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(/[. ]+$/g, '');
  return out;
}

export interface FileNameOptions {
  pattern?: string;
  title?: string;
  created: Date;
  id: string;
  /** Lower-cased names already taken in the target folder (with extension). */
  taken?: Iterable<string>;
}

export interface FileNameResult {
  fileName: string;
  base: string;
  slug: string;
}

/** Build `{date}-{slug}.md` (or the configured pattern), avoiding collisions. */
export function buildFileName(options: FileNameOptions): FileNameResult {
  const pattern = (options.pattern ?? DEFAULT_FILE_NAME_PATTERN).trim() || DEFAULT_FILE_NAME_PATTERN;
  const slug = slugify(options.title ?? '') || 'note';
  const replacements: Record<string, string> = {
    '{date}': dayKey(options.created),
    '{time}': timeKey(options.created),
    '{slug}': slug,
    '{id}': options.id,
  };
  let base = pattern.replace(/\{(date|time|slug|id)\}/g, (_, key: string) => replacements[`{${key}}`] ?? '');
  base = sanitizeFileNameBase(base);
  if (!base) base = 'note';
  if (isWindowsDeviceName(base)) base = `${base}_`;
  const taken = new Set([...((options.taken as Iterable<string>) ?? [])].map((n) => n.toLowerCase()));
  let fileName = `${base}.md`;
  let counter = 2;
  while (taken.has(fileName.toLowerCase())) {
    fileName = `${base}-${counter}.md`;
    counter++;
  }
  return { fileName, base: fileName.slice(0, -3), slug };
}

/** Human readable title from a file name (`2026-11-22-fix-login` -> `Fix login`). */
export function titleFromFileName(fileName: string): string {
  let name = fileName.replace(/\.md$/i, '');
  name = name.replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '');
  name = name.replace(/[-_]+/g, ' ').trim();
  if (!name) name = fileName.replace(/\.md$/i, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Stable 8 hex characters of a SHA-1 — used for project folders and truncation. */
export function shortHash(input: string): string {
  return createHash('sha1').update(input, 'utf8').digest('hex').slice(0, 8);
}
