/** Filesystem-backed note store: scan, write, personal state, trash, indexes. */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildFileName,
  DEFAULT_FILE_NAME_PATTERN,
  sanitizeFileNameBase,
  slugify,
  titleFromFileName,
} from '../core/filenames';
import {
  parseNote,
  resolveTitle,
  serializeNote,
  setFrontMatterFields,
  type NoteInit,
  type NoteMeta,
} from '../core/frontmatter';
import { isArchived } from '../core/frontmatter';
import { buildLinkIndex, type LinkIndex } from '../core/links';
import { buildSummary, noteKeyOf, type NoteSummary } from '../core/note';
import { SearchIndex, type SearchHit } from '../core/search';
import { collectTags, countTags } from '../core/tags';
import { parseTasks, type TaskItem } from '../core/tasks';
import type { Color } from '../core/colors';
import { createUlid } from '../core/ulid';
import { nowLocalIso } from '../core/time';
import {
  effectiveColor,
  emptyState,
  findStateEntry,
  isPinned,
  parseState,
  remapStateKey,
  serializeState,
  setJoplinId,
  setPersonalColor,
  setPinned,
  stateKeyFor,
  type ProjectState,
  type Scope,
} from '../core/state';
import {
  addTrashEntry,
  emptyTrashIndex,
  parseTrash,
  pruneTrash,
  removeTrashEntry,
  serializeTrash,
  type TrashEntry,
  type TrashIndex,
} from '../core/trash';
import { projectJson, type GitRemote } from '../core/keys';
import { collectTemplates, parseTemplateFile, type TemplateDefinition } from '../core/templates';
import { isInside, resolveStorePaths, toRelPath, type StorePaths } from './paths';
import type { FoliumSettings } from '../core/settings';
import { codeLinkCandidates, parseLines } from '../core/codeLinks';

export interface NoteFile extends NoteSummary {
  /** Full file content including front matter. */
  raw: string;
}

export interface StoreOptions {
  projectRoot: string;
  settings: FoliumSettings;
  remotes?: GitRemote[];
  repoRoot?: string;
  homedir?: string;
  isWindows?: boolean;
  now?: () => Date;
  idFactory?: () => string;
}

export interface CreateNoteInput {
  scope: Scope;
  title?: string;
  body?: string;
  tags?: string[];
  color?: string;
  branch?: string;
  kind?: string;
  target?: string;
  issue?: string;
  sensitive?: boolean;
  archived?: string | boolean;
  imported_from?: string;
  extra?: Record<string, unknown>;
  /** Sub folder inside the scope root (`/` separated). */
  folder?: string;
  /** Called with the serialized note to encrypt it before writing. */
  transform?: (raw: string) => string;
  /** Pre-built header (used by imports to keep created dates). */
  init?: Partial<NoteInit>;
}

export interface StoreEvents {
  onChange: () => void;
}

const MD = /\.md$/i;
const IGNORED_DIRS = new Set(['.Folium', '.templates', '.inbox', '.git', 'node_modules']);

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readDirSafe(target: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(target, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let index = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (index < items.length) {
      const current = index++;
      out[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return out;
}

export class FoliumStore {
  readonly options: StoreOptions;
  readonly paths: StorePaths;
  settings: FoliumSettings;
  private notesByPath = new Map<string, NoteFile>();
  private stateValue: ProjectState = emptyState();
  private trashValue: TrashIndex = emptyTrashIndex();
  private overlay = new Map<string, string>();
  private searchIndex = new SearchIndex();
  private listeners = new Set<() => void>();
  private scanErrors: string[] = [];
  private templatesValue: TemplateDefinition[] = [];
  private linkIndexValue: LinkIndex = buildLinkIndex([]);
  private writeQueues = new Map<string, Promise<unknown>>();
  private writeTimes = new Map<string, number>();
  private tasksCache: TaskItem[] = [];
  private tagsCache: Map<string, number> = new Map();
  private readonly now: () => Date;
  private readonly newId: () => string;
  ready = false;

  constructor(options: StoreOptions) {
    this.options = options;
    this.settings = options.settings;
    this.now = options.now ?? (() => new Date());
    this.newId = options.idFactory ?? (() => createUlid());
    this.paths = resolveStorePaths({
      projectRoot: options.projectRoot,
      sharedFolder: options.settings.sharedFolder,
      privateRoot: options.settings.privateRoot,
      privateProjectKey: options.settings.privateProjectKey,
      remotes: options.remotes ?? [],
      repoRoot: options.repoRoot,
      isWindows: options.isWindows,
      homedir: options.homedir,
    });
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.paths.sharedRoot, { recursive: true }).catch(() => undefined);
    await fs.mkdir(this.paths.privateFolder, { recursive: true }).catch(() => undefined);
    await fs.mkdir(this.paths.foliumDir, { recursive: true }).catch(() => undefined);
    await fs.mkdir(this.paths.trashDir, { recursive: true }).catch(() => undefined);
    await fs.mkdir(this.paths.inboxDir, { recursive: true }).catch(() => undefined);
    await fs.mkdir(this.paths.personalTemplatesDir, { recursive: true }).catch(() => undefined);
    await this.writeProjectJson();
    this.stateValue = parseState(await this.readText(this.paths.stateFile));
    this.trashValue = pruneTrash(
      parseTrash(await this.readText(this.paths.trashIndexFile)),
      this.settings.trashRetentionDays,
      this.now(),
    );
    await this.removeExpiredTrashFiles();
    await this.refresh();
    await this.reloadTemplates();
    this.ready = true;
  }

  onDidChange(listener: () => void): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* ignore listener errors */
      }
    }
  }

  private async readText(file: string): Promise<string | undefined> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch {
      return undefined;
    }
  }

  private async writeProjectJson(): Promise<void> {
    const expected = projectJson(this.paths.projectKey, this.paths.folderName, this.now());
    const existing = await this.readText(this.paths.projectJsonFile);
    if (existing === expected) return;
    try {
      const parsed = existing ? (JSON.parse(existing) as { key?: string }) : undefined;
      if (parsed?.key === this.paths.projectKey) return;
    } catch {
      /* rewrite malformed project.json */
    }
    await fs.writeFile(this.paths.projectJsonFile, expected, 'utf8').catch(() => undefined);
  }

  /** Re-read every note from disk (watchers call this after external changes). */
  async refresh(): Promise<void> {
    const files: Array<{ abs: string; root: string; scope: Scope }> = [];
    for (const [root, scope] of [
      [this.paths.sharedRoot, 'shared'],
      [this.paths.privateFolder, 'private'],
    ] as Array<[string, Scope]>) {
      const found = await this.walk(root);
      for (const abs of found) files.push({ abs, root, scope });
    }
    const errors: string[] = [];
    const loaded = await mapLimit(files, 32, async (file) => {
      try {
        return await this.loadNote(file.abs, file.root, file.scope);
      } catch (error) {
        errors.push(`${file.abs}: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    });
    this.notesByPath = new Map();
    for (const note of loaded) if (note) this.notesByPath.set(note.absPath, note);
    this.scanErrors = errors;
    this.reindex();
  }

  private async walk(root: string): Promise<string[]> {
    const out: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      const entries = await readDirSafe(dir);
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          await visit(abs);
        } else if (entry.isFile() && MD.test(entry.name)) {
          out.push(abs);
        }
      }
    };
    await visit(root);
    return out;
  }

  private async loadNote(absPath: string, root: string, scope: Scope): Promise<NoteFile | undefined> {
    let raw: string;
    let mtime = 0;
    let size = 0;
    const overlay = this.overlay.get(absPath);
    if (overlay !== undefined) {
      raw = overlay;
      const stat = await fs.stat(absPath).catch(() => undefined);
      mtime = stat?.mtimeMs ?? this.now().getTime();
      size = Buffer.byteLength(raw, 'utf8');
    } else {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) return undefined;
      raw = await fs.readFile(absPath, 'utf8');
      mtime = stat.mtimeMs;
      size = stat.size;
    }
    const relPath = toRelPath(root, absPath);
    const parsed = parseNote(raw);
    const key = noteKeyOf(scope, parsed.meta.id, relPath);
    const personal = findStateEntry(this.stateValue, { id: parsed.meta.id, scope, relPath });
    const tasks = parseTasks(raw, {
      noteKey: key,
      noteTitle: resolveTitle(parsed.meta, parsed.body, relPath.split('/').pop() ?? relPath),
      scope,
      relPath,
    });
    const color = effectiveColor(
      { id: parsed.meta.id, scope, relPath, fileColor: parsed.meta.color },
      this.stateValue,
      this.settings.shareColors,
    );
    const summary = buildSummary({
      absPath,
      relPath,
      scope,
      raw,
      mtime,
      size,
      color,
      pinned: personal?.pinned === true,
      tasks,
    });
    return { ...summary, raw };
  }

  private reindex(): void {
    const notes = this.allNotes;
    this.searchIndex.update(
      notes.map((note) => ({
        key: note.key,
        title: note.title,
        tags: note.tags,
        body: note.body,
        scope: note.scope,
        updated: note.updated.getTime(),
        version: `${note.mtime}:${note.size}:${note.title}`,
      })),
    );
    this.linkIndexValue = buildLinkIndex(
      notes.map((note) => ({
        key: note.key,
        id: note.id,
        title: note.title,
        fileName: note.fileName,
        relPath: note.relPath,
        scope: note.scope,
      })),
    );
    const tasks: TaskItem[] = [];
    for (const note of notes) {
      if (note.encrypted) continue;
      tasks.push(
        ...parseTasks(note.raw, {
          noteKey: note.key,
          noteTitle: note.title,
          scope: note.scope,
          relPath: note.relPath,
        }),
      );
    }
    this.tasksCache = tasks;
    const active = notes.filter((note) => !isArchived(note.meta));
    this.tagsCache = countTags(
      active.map((note) => collectTags(note.meta.tags, note.body, this.settings.inlineTags)),
    );
  }

  get allNotes(): NoteFile[] {
    return [...this.notesByPath.values()];
  }

  /** Notes shown in the main view (archived notes are grouped separately). */
  get notes(): NoteFile[] {
    return this.allNotes.filter((note) => !isArchived(note.meta));
  }

  get archivedNotes(): NoteFile[] {
    return this.allNotes.filter((note) => isArchived(note.meta));
  }

  get errors(): string[] {
    return [...this.scanErrors];
  }

  get projectState(): ProjectState {
    return this.stateValue;
  }

  get trashEntries(): TrashEntry[] {
    return [...this.trashValue.entries].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  }

  get templates(): TemplateDefinition[] {
    return this.templatesValue;
  }

  get linkIndex(): LinkIndex {
    return this.linkIndexValue;
  }

  byKey(key: string): NoteFile | undefined {
    return this.allNotes.find((note) => note.key === key);
  }

  byPath(absPath: string): NoteFile | undefined {
    return this.notesByPath.get(path.resolve(absPath));
  }

  byRelPath(scope: Scope, relPath: string): NoteFile | undefined {
    const needle = relPath.replace(/\\/g, '/');
    return this.allNotes.find((note) => note.scope === scope && note.relPath === needle);
  }

  noteForUri(uriPath: string): NoteFile | undefined {
    return this.byPath(uriPath) ?? this.byKey(uriPath);
  }

  /** Notes whose `code:` links point at this file (and the branch note). */
  notesForCodeFile(absPath: string): NoteFile[] {
    const target = path.resolve(absPath);
    const out: NoteFile[] = [];
    for (const note of this.allNotes) {
      if (note.meta.code.length === 0) continue;
      const hit = note.meta.code.some((link) =>
        codeLinkCandidates(link.path, note.absPath, this.paths.sharedRoot).some(
          (candidate) => path.resolve(candidate) === target,
        ),
      );
      if (hit) out.push(note);
    }
    return out;
  }

  get tasks(): TaskItem[] {
    return this.tasksCache;
  }

  tagCounts(): Map<string, number> {
    return this.tagsCache;
  }

  tagsOf(note: NoteFile): string[] {
    return collectTags(note.meta.tags, note.body, this.settings.inlineTags);
  }

  search(query: string, limit = 100): SearchHit[] {
    return this.searchIndex.search(query, limit);
  }

  /** All tags including inline ones, for the Tags view. */
  allTags(): Map<string, number> {
    return this.tagsCache;
  }

  private async takenNames(dir: string): Promise<string[]> {
    const entries = await readDirSafe(dir);
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  private scopeRoot(scope: Scope): string {
    return scope === 'shared' ? this.paths.sharedRoot : this.paths.privateFolder;
  }

  /** Create a note and return the freshly scanned file. */
  async createNote(input: CreateNoteInput): Promise<NoteFile> {
    const scopeRoot = this.scopeRoot(input.scope);
    const folder = input.folder ? input.folder.replace(/\\/g, '/').replace(/^\.\//, '') : '';
    const dir = folder ? path.join(scopeRoot, ...folder.split('/')) : scopeRoot;
    await fs.mkdir(dir, { recursive: true });
    const created = input.init?.created ? new Date(input.init.created) : this.now();
    const id = input.init?.id ?? this.newId();
    const title = input.title?.trim() || 'Untitled';
    const taken = await this.takenNames(dir);
    let fileName = buildFileName({
      pattern: this.settings.fileNamePattern || DEFAULT_FILE_NAME_PATTERN,
      title,
      created,
      id,
      taken,
    }).fileName;
    let absPath = path.join(dir, fileName);
    const body = input.body ?? `# ${title}\n\n`;
    const init: NoteInit = {
      ...input.init,
      id,
      title: input.init?.title ?? title,
      created: input.init?.created ?? created,
      updated: input.init?.updated ?? created,
      tags: input.tags ?? input.init?.tags,
      color: input.color ?? input.init?.color,
      branch: input.branch ?? input.init?.branch,
      kind: input.kind ?? input.init?.kind,
      target: input.target ?? input.init?.target,
      issue: input.issue ?? input.init?.issue,
      sensitive: input.sensitive ?? input.init?.sensitive,
      imported_from: input.imported_from ?? input.init?.imported_from,
      archived: input.archived ?? input.init?.archived,
      extra: input.extra ?? input.init?.extra,
    };
    let raw = serializeNote(init, body);
    if (input.transform) raw = input.transform(raw);
    try {
      await fs.writeFile(absPath, raw, { encoding: 'utf8', flag: 'wx' });
      this.markWritten(absPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      fileName = buildFileName({
        pattern: this.settings.fileNamePattern || DEFAULT_FILE_NAME_PATTERN,
        title,
        created,
        id,
        taken: [...taken, fileName],
      }).fileName;
      absPath = path.join(dir, fileName);
      await fs.writeFile(absPath, raw, 'utf8');
    }
    const note = await this.reloadFile(absPath, scopeRoot, input.scope);
    if (!note) throw new Error(`Could not read the new note at ${absPath}`);
    return note;
  }

  private async reloadFile(absPath: string, root: string, scope: Scope): Promise<NoteFile | undefined> {
    const note = await this.loadNote(path.resolve(absPath), root, scope);
    if (note) this.notesByPath.set(note.absPath, note);
    this.reindex();
    this.notify();
    return note;
  }

  /** True when this file was written by Folium itself (watchers should ignore it). */
  wasWrittenRecently(absPath: string, windowMs = 1500): boolean {
    const at = this.writeTimes.get(path.resolve(absPath));
    return at !== undefined && Date.now() - at < windowMs;
  }

  private markWritten(absPath: string): void {
    this.writeTimes.set(path.resolve(absPath), Date.now());
  }

  private enqueue<T>(file: string, task: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(file) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.writeQueues.set(
      file,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Overwrite a note's raw content (front matter included). */
  async writeRaw(note: NoteFile, raw: string): Promise<NoteFile> {
    const absPath = path.resolve(note.absPath);
    await this.enqueue(absPath, async () => {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, raw, 'utf8');
      this.markWritten(absPath);
    });
    const scopeRoot = this.scopeRoot(note.scope);
    const updated = await this.reloadFile(absPath, scopeRoot, note.scope);
    return updated ?? note;
  }

  /** Update front-matter fields without rewriting unrelated lines. */
  async updateFrontMatter(
    note: NoteFile,
    entries: Array<[string, unknown]>,
    options: { touchUpdated?: boolean } = {},
  ): Promise<NoteFile> {
    let raw = note.raw;
    const fields: Array<[string, unknown]> = [...entries];
    if (options.touchUpdated !== false) fields.push(['updated', nowLocalIso()]);
    raw = setFrontMatterFields(raw, fields);
    const renamed = entries.find(([key]) => key === 'title');
    if (
      renamed &&
      typeof renamed[1] === 'string' &&
      this.settings.renameFileOnTitleChange &&
      !note.encrypted
    ) {
      return this.applyRename(note, raw, String(renamed[1]));
    }
    return this.writeRaw(note, raw);
  }

  private async applyRename(note: NoteFile, raw: string, newTitle: string): Promise<NoteFile> {
    const dir = path.dirname(note.absPath);
    const taken = (await this.takenNames(dir)).filter((name) => name !== note.fileName);
    const { fileName } = buildFileName({
      pattern: this.settings.fileNamePattern || DEFAULT_FILE_NAME_PATTERN,
      title: newTitle,
      created: note.created,
      id: note.id ?? '',
      taken,
    });
    const newAbs = path.join(dir, fileName);
    if (newAbs === note.absPath) return this.writeRaw(note, raw);
    const oldRelPath = note.relPath;
    const newRelPath = toRelPath(this.scopeRoot(note.scope), newAbs);
    await this.enqueue(note.absPath, async () => {
      await fs.writeFile(newAbs, raw, 'utf8');
      await fs.unlink(note.absPath).catch(() => undefined);
      this.markWritten(newAbs);
    });
    this.stateValue = remapStateKey(
      this.stateValue,
      { id: note.id, scope: note.scope, relPath: oldRelPath },
      { id: note.id, scope: note.scope, relPath: newRelPath },
    );
    await this.saveState();
    const oldNames = [
      note.title,
      note.fileName.replace(MD, ''),
      oldRelPath.replace(MD, ''),
    ];
    if (this.settings.updateLinksOnRename) {
      await this.rewriteLinks(oldNames, newTitle);
    }
    const updated = await this.reloadFile(newAbs, this.scopeRoot(note.scope), note.scope);
    return updated ?? note;
  }

  /** Update wiki links in every other note after a rename. */
  private async rewriteLinks(oldNames: string[], newTitle: string): Promise<void> {
    const { renameLinksInBody } = await import('../core/links');
    for (const other of this.allNotes) {
      const result = renameLinksInBody(other.body, oldNames, newTitle);
      if (result.count === 0) continue;
      const parsed = parseNote(other.raw);
      const headerEnd = other.raw.length - parsed.body.length;
      const raw = `${other.raw.slice(0, headerEnd)}${result.text}`;
      await this.enqueue(other.absPath, () => fs.writeFile(other.absPath, raw, 'utf8'));
      await this.reloadFile(other.absPath, this.scopeRoot(other.scope), other.scope);
    }
  }

  private async saveState(): Promise<void> {
    await fs.mkdir(this.paths.foliumDir, { recursive: true }).catch(() => undefined);
    await fs.writeFile(this.paths.stateFile, serializeState(this.stateValue), 'utf8');
  }

  private async saveTrash(): Promise<void> {
    await fs.mkdir(this.paths.foliumDir, { recursive: true }).catch(() => undefined);
    await fs.writeFile(this.paths.trashIndexFile, serializeTrash(this.trashValue), 'utf8');
  }

  /** Color: file for private notes (and shared notes when shareColors), else personal state. */
  async setColor(note: NoteFile, color: Color | 'none' | undefined): Promise<void> {
    const useFile = note.scope === 'private' || this.settings.shareColors;
    if (useFile) {
      await this.updateFrontMatter(note, [['color', color === 'none' ? undefined : color]], {
        touchUpdated: false,
      });
      return;
    }
    const key = stateKeyFor({ id: note.id, scope: note.scope, relPath: note.relPath });
    this.stateValue = setPersonalColor(this.stateValue, key, color);
    await this.saveState();
    const updated = this.notesByPath.get(note.absPath);
    if (updated) {
      const next: NoteFile = {
        ...updated,
        color: color === 'none' ? undefined : color,
      };
      this.notesByPath.set(note.absPath, next);
    }
    this.notify();
  }

  async togglePin(note: NoteFile): Promise<boolean> {
    const key = stateKeyFor({ id: note.id, scope: note.scope, relPath: note.relPath });
    const pinned = !isPinned({ id: note.id, scope: note.scope, relPath: note.relPath }, this.stateValue);
    this.stateValue = setPinned(this.stateValue, key, pinned);
    await this.saveState();
    const updated = this.notesByPath.get(note.absPath);
    if (updated) this.notesByPath.set(note.absPath, { ...updated, pinned });
    this.notify();
    return pinned;
  }

  async setArchived(note: NoteFile, archived: boolean): Promise<NoteFile> {
    return this.updateFrontMatter(note, [
      ['archived', archived ? nowLocalIso() : undefined],
    ]);
  }

  async setJoplinId(note: NoteFile, joplinId: string): Promise<void> {
    const key = stateKeyFor({ id: note.id, scope: note.scope, relPath: note.relPath });
    this.stateValue = setJoplinId(this.stateValue, key, joplinId);
    await this.saveState();
    this.notify();
  }

  async setSensitive(note: NoteFile, sensitive: boolean): Promise<NoteFile> {
    return this.updateFrontMatter(note, [['sensitive', sensitive ? true : undefined]], {
      touchUpdated: false,
    });
  }

  /** Move a note to the project trash (shared notes included). */
  async trashNote(note: NoteFile): Promise<void> {
    const stamp = this.now().getTime();
    const base = sanitizeFileNameBase(note.fileName.replace(MD, '')) || 'note';
    let storedName = `${stamp}-${base}.md`;
    let counter = 2;
    while (await pathExists(path.join(this.paths.trashDir, storedName))) {
      storedName = `${stamp}-${base}-${counter}.md`;
      counter++;
    }
    await fs.mkdir(this.paths.trashDir, { recursive: true });
    await fs.copyFile(note.absPath, path.join(this.paths.trashDir, storedName));
    this.markWritten(path.join(this.paths.trashDir, storedName));
    const personal = findStateEntry(this.stateValue, {
      id: note.id,
      scope: note.scope,
      relPath: note.relPath,
    });
    this.trashValue = addTrashEntry(this.trashValue, {
      id: note.id,
      scope: note.scope,
      relPath: note.relPath,
      storedName,
      deletedAt: nowLocalIso(),
      originalPath: note.absPath,
      personal: personal ? { ...personal } : undefined,
    });
    await this.saveTrash();
    await fs.unlink(note.absPath);
    this.notesByPath.delete(note.absPath);
    this.reindex();
    this.notify();
  }

  async restoreTrashEntry(entry: TrashEntry): Promise<NoteFile | undefined> {
    const source = path.join(this.paths.trashDir, entry.storedName);
    if (!(await pathExists(source))) {
      this.trashValue = removeTrashEntry(this.trashValue, entry.storedName);
      await this.saveTrash();
      this.notify();
      return undefined;
    }
    const scopeRoot = this.scopeRoot(entry.scope);
    let target = entry.originalPath;
    if (!target || !isInside(scopeRoot, target) || (await pathExists(target))) {
      const desired = target && isInside(scopeRoot, target) ? path.basename(target) : path.basename(source);
      const base = sanitizeFileNameBase(desired.replace(MD, '')) || 'note';
      const dir = target && isInside(scopeRoot, path.dirname(target)) ? path.dirname(target) : scopeRoot;
      await fs.mkdir(dir, { recursive: true });
      let name = `${base}.md`;
      let counter = 2;
      while (await pathExists(path.join(dir, name))) {
        name = `${base}-${counter}.md`;
        counter++;
      }
      target = path.join(dir, name);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(source, target);
    this.trashValue = removeTrashEntry(this.trashValue, entry.storedName);
    await this.saveTrash();
    if (entry.personal) {
      const relPath = toRelPath(scopeRoot, target);
      const key = stateKeyFor({ id: entry.id, scope: entry.scope, relPath });
      this.stateValue = {
        version: 1,
        notes: { ...this.stateValue.notes, [key]: { ...this.stateValue.notes[key], ...entry.personal } },
      };
      await this.saveState();
    }
    return this.reloadFile(target, scopeRoot, entry.scope);
  }

  async deleteTrashEntry(entry: TrashEntry): Promise<void> {
    await fs.unlink(path.join(this.paths.trashDir, entry.storedName)).catch(() => undefined);
    this.trashValue = removeTrashEntry(this.trashValue, entry.storedName);
    await this.saveTrash();
    this.notify();
  }

  async emptyTrash(): Promise<void> {
    for (const entry of this.trashValue.entries) {
      await fs.unlink(path.join(this.paths.trashDir, entry.storedName)).catch(() => undefined);
    }
    this.trashValue = emptyTrashIndex();
    await this.saveTrash();
    this.notify();
  }

  private async removeExpiredTrashFiles(): Promise<void> {
    const kept = new Set(this.trashValue.entries.map((entry) => entry.storedName));
    const files = await readDirSafe(this.paths.trashDir);
    for (const file of files) {
      if (file.isFile() && !kept.has(file.name)) {
        await fs.unlink(path.join(this.paths.trashDir, file.name)).catch(() => undefined);
      }
    }
    await this.saveTrash();
  }

  /** Replace only the body of a note, keeping the header bytes. */
  async replaceBody(note: NoteFile, body: string, touchUpdated = true): Promise<NoteFile> {
    const parsed = parseNote(note.raw);
    const header = note.raw.slice(0, note.raw.length - parsed.body.length);
    let raw = `${header}${body}`;
    if (touchUpdated) raw = setFrontMatterFields(raw, [['updated', nowLocalIso()]]);
    return this.writeRaw(note, raw);
  }

  /** Rename a tag (and its children) in headers and inline tags everywhere. */
  async renameTag(from: string, to: string): Promise<number> {
    const { tagMatches, renameInlineTags, normalizeTag } = await import('../core/tags');
    const source = normalizeTag(from);
    const target = normalizeTag(to);
    if (!source || !target) return 0;
    let changed = 0;
    for (const note of this.allNotes) {
      const tags = note.meta.tags.map((tag) => (tagMatches(tag, source) ? `${target}${tag.slice(source.length)}` : tag));
      const headerChanged = tags.some((tag, index) => tag !== note.meta.tags[index]);
      const bodyResult = this.settings.inlineTags
        ? renameInlineTags(note.body, source, target)
        : { text: note.body, count: 0 };
      if (!headerChanged && bodyResult.count === 0) continue;
      let raw = note.raw;
      const parsed = parseNote(raw);
      if (headerChanged) {
        raw = setFrontMatterFields(raw, [
          ['tags', tags.length > 0 ? tags : undefined],
          ['updated', nowLocalIso()],
        ]);
      }
      if (bodyResult.count > 0) {
        const refreshed = parseNote(raw);
        const headerText = raw.slice(0, raw.length - refreshed.body.length);
        raw = `${headerText}${bodyResult.text}`;
      }
      await this.writeRaw(note, raw);
      changed++;
      if (parsed.body === '' && bodyResult.count === 0) continue;
    }
    return changed;
  }

  /** Remove a tag everywhere; inline `#tag` becomes the plain word. */
  async removeTag(tag: string): Promise<number> {
    const { tagMatches, removeInlineTags, normalizeTag } = await import('../core/tags');
    const source = normalizeTag(tag);
    if (!source) return 0;
    let changed = 0;
    for (const note of this.allNotes) {
      const tags = note.meta.tags.filter((candidate) => !tagMatches(candidate, source));
      const headerChanged = tags.length !== note.meta.tags.length;
      const bodyResult = this.settings.inlineTags
        ? removeInlineTags(note.body, source)
        : { text: note.body, count: 0 };
      if (!headerChanged && bodyResult.count === 0) continue;
      let raw = note.raw;
      if (headerChanged) {
        raw = setFrontMatterFields(raw, [
          ['tags', tags.length > 0 ? tags : undefined],
          ['updated', nowLocalIso()],
        ]);
      }
      if (bodyResult.count > 0) {
        const parsed = parseNote(raw);
        raw = `${raw.slice(0, raw.length - parsed.body.length)}${bodyResult.text}`;
      }
      await this.writeRaw(note, raw);
      changed++;
    }
    return changed;
  }

  /** Move a note to the other scope root, preserving content and personal data. */
  async moveNote(note: NoteFile, targetScope: Scope, folder = ''): Promise<NoteFile> {
    if (note.scope === targetScope) return note;
    const root = this.scopeRoot(targetScope);
    const dir = folder ? path.join(root, ...folder.split('/')) : root;
    await fs.mkdir(dir, { recursive: true });
    const taken = await this.takenNames(dir);
    const { fileName } = buildFileName({
      pattern: this.settings.fileNamePattern || DEFAULT_FILE_NAME_PATTERN,
      title: note.title,
      created: note.created,
      id: note.id ?? '',
      taken,
    });
    const target = path.join(dir, fileName);
    await fs.writeFile(target, note.raw, 'utf8');
    this.markWritten(target);
    await fs.unlink(note.absPath).catch(() => undefined);
    this.notesByPath.delete(note.absPath);
    this.stateValue = remapStateKey(
      this.stateValue,
      { id: note.id, scope: note.scope, relPath: note.relPath },
      { id: note.id, scope: targetScope, relPath: toRelPath(root, target) },
    );
    await this.saveState();
    const updated = await this.reloadFile(target, root, targetScope);
    if (!updated) throw new Error('Could not move the note');
    return updated;
  }

  setOverlay(absPath: string, raw: string): void {
    const key = path.resolve(absPath);
    const existing = this.overlay.get(key);
    if (existing === raw) return;
    this.overlay.set(key, raw);
    const note = this.notesByPath.get(key);
    if (note) {
      void this.loadNote(key, this.scopeRoot(note.scope), note.scope).then((updated) => {
        if (updated) {
          this.notesByPath.set(key, updated);
          this.reindex();
          this.notify();
        }
      });
    }
  }

  clearOverlay(absPath: string): void {
    const key = path.resolve(absPath);
    if (!this.overlay.delete(key)) return;
    const note = this.notesByPath.get(key);
    if (note) {
      void this.loadNote(key, this.scopeRoot(note.scope), note.scope).then((updated) => {
        if (updated) this.notesByPath.set(key, updated);
        this.reindex();
        this.notify();
      });
    }
  }

  /* ----------------------------- templates ----------------------------- */

  async reloadTemplates(): Promise<TemplateDefinition[]> {
    const team = await this.readTemplates(this.paths.teamTemplatesDir);
    const personal = await this.readTemplates(this.paths.personalTemplatesDir);
    this.templatesValue = collectTemplates(team, personal);
    return this.templatesValue;
  }

  private async readTemplates(dir: string): Promise<TemplateDefinition[]> {
    const entries = await readDirSafe(dir);
    const out: TemplateDefinition[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !MD.test(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const raw = await this.readText(abs);
      if (!raw) continue;
      const parsed = parseTemplateFile(raw, abs);
      if (parsed) out.push(parsed);
    }
    return out;
  }

  templateDirFor(target: 'team' | 'personal'): string {
    return target === 'team' ? this.paths.teamTemplatesDir : this.paths.personalTemplatesDir;
  }

  async writeTemplate(
    target: 'team' | 'personal',
    input: { name: string; description?: string; scope?: Scope; privateOnly?: boolean; sharedOnly?: boolean; sensitive?: boolean; kind?: string; promptTarget?: string; tags?: string[]; color?: string; body: string; fileName?: string },
  ): Promise<string> {
    const { templateFileContent } = await import('../core/templates');
    const dir = this.templateDirFor(target);
    await fs.mkdir(dir, { recursive: true });
    const base = sanitizeFileNameBase(slugify(input.name) || 'template');
    const fileName = input.fileName ?? `${base}.md`;
    const abs = path.join(dir, fileName);
    const content = templateFileContent({
      name: input.name,
      description: input.description,
      scope: input.scope,
      privateOnly: input.privateOnly,
      sharedOnly: input.sharedOnly,
      sensitive: input.sensitive,
      kind: input.kind,
      target: input.promptTarget,
      tags: input.tags,
      color: input.color,
      body: input.body,
    });
    await fs.writeFile(abs, content, 'utf8');
    await this.reloadTemplates();
    this.notify();
    return abs;
  }
}

/* ------------------------------------------------------------------------- */
/* Backup, restore and import helpers                                         */
/* ------------------------------------------------------------------------- */

export interface BackupSummary {
  written: number;
  conflicts: string[];
  skipped: string[];
  created?: string;
}

export class FoliumProjectService {
  constructor(readonly store: FoliumStore) {}

  private get paths(): StorePaths {
    return this.store.paths;
  }

  /** All files below the private root except the AI inbox (for backups). */
  async collectPrivateFiles(): Promise<Array<{ path: string; content: Buffer; mtime: number }>> {
    const out: Array<{ path: string; content: Buffer; mtime: number }> = [];
    const visit = async (dir: string): Promise<void> => {
      const entries = await readDirSafe(dir);
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '.inbox') continue;
          await visit(abs);
        } else if (entry.isFile()) {
          const stat = await fs.stat(abs).catch(() => undefined);
          if (!stat) continue;
          out.push({
            path: toRelPath(this.paths.privateBase, abs),
            content: await fs.readFile(abs),
            mtime: Math.floor(stat.mtimeMs / 1000),
          });
        }
      }
    };
    await visit(this.paths.privateBase);
    return out;
  }

  async createBackup(): Promise<Buffer> {
    const { createBackup } = await import('../core/backup');
    const files = await this.collectPrivateFiles();
    return createBackup(files, { source: `Folium Notes (${this.paths.projectKey})`, now: new Date() });
  }

  /** Restore a backup: missing files only, conflicts are reported. */
  async restoreBackup(buffer: Buffer): Promise<BackupSummary> {
    const { planRestore, readBackup } = await import('../core/backup');
    const contents = readBackup(buffer);
    const existing = (await this.collectPrivateFiles()).map((file) => file.path);
    const plan = planRestore(contents.files, existing);
    for (const file of plan.write) {
      const abs = path.join(this.paths.privateBase, ...file.path.split('/'));
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, file.content);
    }
    await this.store.refresh();
    await this.store.reloadTemplates();
    return {
      written: plan.write.length,
      conflicts: plan.conflicts,
      skipped: plan.skipped,
      created: contents.manifest?.created,
    };
  }

  /** Existing `imported_from` values and ids for duplicate detection. */
  importedValues(): { importedFrom: Set<string>; ids: Set<string> } {
    const importedFrom = new Set<string>();
    const ids = new Set<string>();
    for (const note of this.store.allNotes) {
      if (note.meta.imported_from) importedFrom.add(note.meta.imported_from);
      if (note.id) ids.add(note.id);
    }
    for (const entry of Object.values(this.store.projectState.notes)) {
      if (entry?.joplinId) ids.add(entry.joplinId);
    }
    return { importedFrom, ids };
  }

  /** Write one imported note into the target scope. */
  async importNote(
    note: { title: string; body: string; tags: string[]; created?: Date; updated?: Date; importedFrom: string; joplinId?: string; folder?: string },
    scope: Scope,
  ): Promise<NoteFile> {
    const init: Partial<NoteInit> = {
      created: note.created,
      updated: note.updated,
      imported_from: note.importedFrom,
    };
    const created = await this.store.createNote({
      scope,
      title: note.title,
      body: note.body,
      tags: note.tags.length > 0 ? note.tags : undefined,
      folder: note.folder,
      imported_from: note.importedFrom,
      init,
    });
    if (note.joplinId) await this.store.setJoplinId(created, note.joplinId);
    return created;
  }
}
