/** Import Markdown folders / Obsidian, Joplin .jex and Evernote .enex. */

import { parseNote } from './frontmatter';
import { decodeEntities, enmlToMarkdown } from './enml';
import { readTar } from './tar';
import { normalizeTag, parseTags } from './tags';
import { dayKey, parseDateLoose } from './time';
import { firstHeadingLine } from './markdown';
import { titleFromFileName } from './filenames';
import { parse as parseYaml } from 'yaml';

export type ImportKind = 'markdown' | 'jex' | 'enex';

export interface ImportFile {
  /** Path inside the import source (folder relative or tar member). */
  path: string;
  content: string | Buffer;
}

export interface ImportedNote {
  title: string;
  body: string;
  tags: string[];
  created?: Date;
  updated?: Date;
  /** Value written to `imported_from`. */
  importedFrom: string;
  joplinId?: string;
  source: ImportKind;
  folder?: string;
}

export interface ExistingNotes {
  importedFrom: Set<string>;
  ids: Set<string>;
}

export interface ImportResult {
  notes: ImportedNote[];
  duplicates: number;
  skipped: number;
}

export interface ImportPreview {
  total: number;
  duplicates: number;
  skipped: number;
  tags: string[];
  folders: string[];
}

const textOf = (file: ImportFile): string =>
  Buffer.isBuffer(file.content) ? file.content.toString('utf8') : file.content;

function folderTags(folder: string | undefined): string[] {
  if (!folder) return [];
  const tags: string[] = [];
  for (const part of folder.split('/')) {
    const tag = normalizeTag(part);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Turn standard links to local Markdown files into `[[wiki links]]`. */
export function obsidianLinks(body: string): string {
  return body.replace(/\[([^\]\n]*)\]\(([^)\s]+\.md)(#[^)]*)?\)/g, (_m, text: string, target: string, hash?: string) => {
    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      /* keep raw */
    }
    const base = decoded.split('/').pop()!.replace(/\.md$/i, '');
    const label = text && text !== base ? `|${text}` : '';
    return `[[${base}${hash ?? ''}${label}]]`;
  });
}

/** Import a folder of Markdown files (Obsidian-compatible). */
export function importMarkdownFolder(files: ImportFile[]): ImportedNote[] {
  const notes: ImportedNote[] = [];
  for (const file of files) {
    if (!/\.md$/i.test(file.path)) continue;
    if (file.path.split('/').some((part) => part.startsWith('.'))) continue;
    const raw = textOf(file);
    const parsed = parseNote(raw);
    const folder = file.path.split('/').slice(0, -1).join('/');
    const fileName = file.path.split('/').pop() ?? file.path;
    const meta = parsed.meta as Record<string, unknown> & typeof parsed.meta;
    const keywordTags = parseTags(meta.keywords ?? meta.keyword);
    const tags = [...new Set([...parsed.meta.tags, ...keywordTags, ...folderTags(folder)])];
    const heading = firstHeadingLine(parsed.body);
    const title =
      parsed.meta.title || (heading ? heading.title : '') || titleFromFileName(fileName);
    const body = obsidianLinks(parsed.body).trim() + '\n';
    const created = parseDateLoose(meta.created ?? meta.date ?? meta.created_at ?? meta.createdAt);
    const updated = parseDateLoose(meta.updated ?? meta.modified ?? meta.updated_at);
    notes.push({
      title,
      body: heading && !parsed.meta.title ? body : body,
      tags,
      created,
      updated,
      importedFrom: `md:${file.path}`,
      source: 'markdown',
      folder: folder || undefined,
    });
  }
  return notes;
}

interface JoplinItem {
  id: string;
  type: number;
  parentId: string;
  title: string;
  body: string;
  created?: Date;
  updated?: Date;
  isTodo: boolean;
  due?: Date;
  completed?: Date;
  tags: string[];
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

/** Import a Joplin `.jex` archive (tar of raw items). */
export function importJex(files: ImportFile[]): ImportedNote[] {
  const entries: Array<{ path: string; data: Buffer }> = [];
  for (const file of files) {
    if (/\.jex$/i.test(file.path)) {
      const buffer = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'binary');
      for (const entry of readTar(buffer)) {
        if (entry.type === 'file') entries.push({ path: entry.name, data: entry.data });
      }
    } else {
      entries.push({
        path: file.path,
        data: Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8'),
      });
    }
  }
  const items: JoplinItem[] = [];
  const noteTags = new Map<string, string[]>();
  const tagsById = new Map<string, string>();
  const notebooks = new Map<string, { title: string; parentId: string }>();
  const raw: Array<{ meta: Record<string, unknown>; body: string }> = [];
  for (const entry of entries) {
    if (!/\.md$/i.test(entry.path) && !entry.path.includes('/')) continue;
    const text = entry.data.toString('utf8');
    if (!text.startsWith('---')) continue;
    let meta: Record<string, unknown> = {};
    try {
      const parsed = parseNote(text);
      meta = parsed.meta as unknown as Record<string, unknown>;
      raw.push({ meta, body: parsed.body });
    } catch {
      const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      if (!header) continue;
      try {
        meta = (parseYaml(header[1], { uniqueKeys: false, prettyErrors: false }) ?? {}) as Record<string, unknown>;
        raw.push({ meta, body: text.slice(header[0].length) });
      } catch {
        continue;
      }
    }
  }
  for (const { meta, body } of raw) {
    const id = typeof meta.id === 'string' ? meta.id : '';
    if (!id) continue;
    const type = numberOrUndefined(meta.type_);
    if (type === 2) {
      notebooks.set(id, {
        title: typeof meta.title === 'string' ? meta.title : 'Notebook',
        parentId: typeof meta.parent_id === 'string' ? meta.parent_id : '',
      });
    } else if (type === 5) {
      if (typeof meta.title === 'string') tagsById.set(id, meta.title);
    } else if (type === 6) {
      const noteId = typeof meta.note_id === 'string' ? meta.note_id : '';
      const tagId = typeof meta.tag_id === 'string' ? meta.tag_id : '';
      if (!noteId || !tagId) continue;
      const list = noteTags.get(noteId) ?? [];
      list.push(tagId);
      noteTags.set(noteId, list);
    } else if (type === 1 || type === undefined) {
      const createdMs = numberOrUndefined(meta.created_time);
      const updatedMs = numberOrUndefined(meta.updated_time);
      const dueMs = numberOrUndefined(meta.todo_due);
      const completedMs = numberOrUndefined(meta.todo_completed);
      items.push({
        id,
        type: 1,
        parentId: typeof meta.parent_id === 'string' ? meta.parent_id : '',
        title: typeof meta.title === 'string' ? meta.title : 'Untitled',
        body,
        created: createdMs ? new Date(createdMs) : undefined,
        updated: updatedMs ? new Date(updatedMs) : undefined,
        isTodo: numberOrUndefined(meta.is_todo) === 1,
        due: dueMs ? new Date(dueMs) : undefined,
        completed: completedMs ? new Date(completedMs) : undefined,
        tags: [],
      });
    }
  }
  const notebookPath = (id: string): string[] => {
    const out: string[] = [];
    let current = id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const notebook = notebooks.get(current);
      if (!notebook) break;
      out.unshift(notebook.title);
      current = notebook.parentId;
    }
    return out;
  };
  const titles = new Map(items.map((item) => [item.id, item.title]));
  const linkify = (body: string): string =>
    body.replace(/\[([^\]\n]*)\]\(:\/([a-zA-Z0-9]+)(#[^)]*)?\)/g, (_m, text: string, targetId: string, hash?: string) => {
      const title = titles.get(targetId) ?? text;
      return `[[${title}${hash ?? ''}${text !== title ? `|${text}` : ''}]]`;
    });
  const notes: ImportedNote[] = [];
  for (const item of items) {
    const tags = [
      ...item.tags,
      ...(noteTags.get(item.id) ?? []).map((tagId) => tagsById.get(tagId) ?? '').filter(Boolean),
      ...notebookPath(item.parentId),
    ]
      .map((tag) => normalizeTag(tag))
      .filter(Boolean);
    let body = linkify(item.body).trim();
    if (item.isTodo) {
      const due = item.due ? ` due:${dayKey(item.due)}` : '';
      const checkbox = item.completed ? '[x]' : '[ ]';
      body = `- ${checkbox} ${item.title}${due}\n\n${body}`;
    }
    notes.push({
      title: item.title,
      body: body.endsWith('\n') ? body : `${body}\n`,
      tags: [...new Set(tags)],
      created: item.created,
      updated: item.updated,
      importedFrom: `joplin:${item.id}`,
      joplinId: item.id,
      source: 'jex',
      folder: notebookPath(item.parentId).join('/') || undefined,
    });
  }
  return notes;
}

/** Parse Evernote timestamps like `20180101T120000Z`. */
export function parseEvernoteDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value.trim());
  if (!match) return parseDateLoose(value);
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ),
  );
}

function cdataOf(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = re.exec(block);
  if (!match) return undefined;
  const inner = match[1];
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(inner);
  return cdata ? cdata[1] : inner;
}

/** Import an Evernote `.enex` export (ENML converted to Markdown). */
export function importEnex(files: ImportFile[]): ImportedNote[] {
  const notes: ImportedNote[] = [];
  for (const file of files) {
    if (!/\.enex$/i.test(file.path)) continue;
    const text = textOf(file);
    const base = (file.path.split('/').pop() ?? 'enex').replace(/\.enex$/i, '');
    const noteRe = /<note>([\s\S]*?)<\/note>/gi;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = noteRe.exec(text)) !== null) {
      index++;
      const block = match[1];
      const title = decodeEntities((cdataOf(block, 'title') ?? `Note ${index}`).trim());
      const content = cdataOf(block, 'content') ?? '';
      const body = enmlToMarkdown(content);
      const tags: string[] = [];
      const tagRe = /<tag[^>]*>([\s\S]*?)<\/tag>/gi;
      let tagMatch: RegExpExecArray | null;
      while ((tagMatch = tagRe.exec(block)) !== null) {
        const tag = normalizeTag(decodeXml(tagMatch[1]));
        if (tag && !tags.includes(tag)) tags.push(tag);
      }
      notes.push({
        title,
        body,
        tags,
        created: parseEvernoteDate(cdataOf(block, 'created')),
        updated: parseEvernoteDate(cdataOf(block, 'updated')),
        importedFrom: `enex:${base}:${index}:${title}`,
        source: 'enex',
      });
    }
  }
  return notes;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function isDuplicate(note: ImportedNote, existing: ExistingNotes): boolean {
  if (existing.importedFrom.has(note.importedFrom)) return true;
  if (note.joplinId && existing.ids.has(note.joplinId)) return true;
  return false;
}

export function scanImport(
  kind: ImportKind,
  files: ImportFile[],
  existing: ExistingNotes = { importedFrom: new Set(), ids: new Set() },
): ImportResult {
  const parsed =
    kind === 'markdown'
      ? importMarkdownFolder(files)
      : kind === 'jex'
        ? importJex(files)
        : importEnex(files);
  const notes: ImportedNote[] = [];
  let duplicates = 0;
  for (const note of parsed) {
    if (isDuplicate(note, existing)) {
      duplicates++;
      continue;
    }
    notes.push(note);
  }
  return { notes, duplicates, skipped: 0 };
}

/** Preview counts for the import UI (no files are written). */
export function previewImport(
  kind: ImportKind,
  files: ImportFile[],
  existing: ExistingNotes = { importedFrom: new Set(), ids: new Set() },
): ImportPreview & { notes: ImportedNote[] } {
  const result = scanImport(kind, files, existing);
  const tags = new Set<string>();
  const folders = new Set<string>();
  for (const note of result.notes) {
    for (const tag of note.tags) tags.add(tag);
    if (note.folder) folders.add(note.folder);
  }
  return {
    notes: result.notes,
    total: result.notes.length,
    duplicates: result.duplicates,
    skipped: result.skipped,
    tags: [...tags].sort(),
    folders: [...folders].sort(),
  };
}
