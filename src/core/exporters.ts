/** Export notes as Markdown (Obsidian) or Joplin Markdown. Sensitive notes never leave. */

import { buildFileName, DEFAULT_FILE_NAME_PATTERN } from './filenames';
import { parseWikiLinks } from './links';
import type { NoteMeta } from './frontmatter';
import type { Scope } from './state';

export type ExportFormat = 'markdown' | 'joplin';
export type ExportScope = 'shared' | 'private' | 'both';

export interface ExportSourceNote {
  relPath: string;
  scope: Scope;
  title: string;
  body: string;
  meta: NoteMeta;
  created: Date;
  updated: Date;
  tags: string[];
  sensitive: boolean;
  encrypted: boolean;
}

export interface ExportFile {
  path: string;
  content: string;
}

export interface ExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  fileNamePattern?: string;
}

export interface ExportResult {
  files: ExportFile[];
  skipped: Array<{ relPath: string; reason: string }>;
}

function scalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 ._/@()+-]*$/.test(value) ? value : JSON.stringify(value);
}

function localIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

type LinkTable = Map<string, string>;

/** Obsidian export keeps `[[wiki links]]`; Joplin export needs relative file links. */
function rewriteLinks(body: string, format: ExportFormat, table: LinkTable): string {
  if (format === 'markdown') return body;
  return body.replace(/\[\[([^[\]\n]+)\]\]/g, (raw, inner: string) => {
    let target = inner;
    let alias: string | undefined;
    const pipe = target.indexOf('|');
    if (pipe !== -1) {
      alias = target.slice(pipe + 1);
      target = target.slice(0, pipe);
    }
    let heading = '';
    const hash = target.indexOf('#');
    if (hash !== -1) {
      heading = target.slice(hash);
      target = target.slice(0, hash);
    }
    const file = table.get(target.trim().toLowerCase());
    if (!file) return alias ?? target;
    return `[${alias ?? target}](${encodeURI(file)}${heading})`;
  });
}

function frontMatter(note: ExportSourceNote, format: ExportFormat): string {
  const lines = ['---'];
  lines.push(`title: ${scalar(note.title)}`);
  lines.push(`created: ${localIso(note.created)}`);
  if (format === 'joplin') lines.push(`updated: ${localIso(note.updated)}`);
  if (note.tags.length > 0) lines.push(`tags: [ ${note.tags.map(scalar).join(', ')} ]`);
  lines.push('---', '');
  return lines.join('\n');
}

/** Build export files in memory (the caller writes them to disk). */
export function exportNotes(notes: ExportSourceNote[], options: ExportOptions): ExportResult {
  const files: ExportFile[] = [];
  const skipped: Array<{ relPath: string; reason: string }> = [];
  const selected = notes.filter((note) => {
    if (options.scope === 'both') return true;
    return note.scope === options.scope;
  });
  const included: ExportSourceNote[] = [];
  for (const note of selected) {
    if (note.sensitive) {
      skipped.push({ relPath: note.relPath, reason: 'sensitive' });
      continue;
    }
    if (note.encrypted) {
      skipped.push({ relPath: note.relPath, reason: 'encrypted' });
      continue;
    }
    included.push(note);
  }
  const taken: string[] = [];
  const linkTable: LinkTable = new Map();
  const names = new Map<ExportSourceNote, string>();
  for (const note of included) {
    const { fileName } = buildFileName({
      pattern: options.fileNamePattern ?? DEFAULT_FILE_NAME_PATTERN,
      title: note.title,
      created: note.created,
      id: note.meta.id ?? '',
      taken,
    });
    taken.push(fileName);
    names.set(note, fileName);
    linkTable.set(note.title.toLowerCase(), fileName);
    if (note.meta.id) linkTable.set(note.meta.id.toLowerCase(), fileName);
    const rel = note.relPath.replace(/\\/g, '/').replace(/\.md$/i, '');
    linkTable.set(rel.toLowerCase(), fileName);
    const base = fileName.replace(/\.md$/i, '').toLowerCase();
    linkTable.set(base, fileName);
  }
  for (const note of included) {
    const fileName = names.get(note)!;
    const body = rewriteLinks(note.body, options.format, linkTable).trimEnd();
    files.push({
      path: fileName,
      content: `${frontMatter(note, options.format)}${body}\n`,
    });
  }
  return { files, skipped };
}

/** Warn when the export target is inside the project (notes could be committed). */
export function exportTargetWarning(targetDir: string, projectRoot: string): string | undefined {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const target = normalize(targetDir);
  const root = normalize(projectRoot);
  if (target === root || target.startsWith(`${root}/`)) {
    return 'The export folder is inside the project. Exported notes may get committed with the code.';
  }
  return undefined;
}

/** Count link targets that would break because the linked note is not exported. */
export function brokenExportLinks(notes: ExportSourceNote[], titles: Set<string>): number {
  let broken = 0;
  for (const note of notes) {
    for (const link of parseWikiLinks(note.body)) {
      if (link.target && !titles.has(link.target.toLowerCase())) broken++;
    }
  }
  return broken;
}
