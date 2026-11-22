/** Note commands: create, open, color, pin, archive, trash, code links, tasks. */

import * as vscode from 'vscode';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { FoliumApp } from '../app';
import { askTitle, activeNote, confirmDanger, pickNote, pickScope } from './util';
import type { NoteFile } from '../store/store';
import type { Scope } from '../core/state';
import { COLORS, normalizeColor, type Color } from '../core/colors';
import { parseNote } from '../core/frontmatter';
import { firstHeadingLine, splitLines } from '../core/markdown';
import {
  buildCodeLink,
  captureSnippet,
  codeLinkPathFor,
  formatBodyLink,
  resolveCodeLink,
  STATUS_LABELS,
  type CodeFileProvider,
} from '../core/codeLinks';
import { renderTemplate, templatesForScope, type TemplateDefinition, type TemplateContext } from '../core/templates';
import { normalizeTag } from '../core/tags';
import { emptyFilters } from '../core/views';
import { showSearch } from '../ui/search';

function lastCodeEditor(app: FoliumApp): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && !app.store?.byPath(active.document.uri.fsPath)) return active;
  return vscode.window.visibleTextEditors.find((editor) => !app.store?.byPath(editor.document.uri.fsPath));
}

export function codeContext(app: FoliumApp): TemplateContext & { editor?: vscode.TextEditor } {
  const editor = lastCodeEditor(app);
  if (!editor) return {};
  const selection = editor.selection.isEmpty
    ? editor.document.lineAt(editor.selection.active.line).text
    : editor.document.getText(editor.selection);
  const root = app.projectRoot();
  return {
    editor,
    selection,
    file: root ? path.relative(root, editor.document.uri.fsPath).split(path.sep).join('/') : editor.document.uri.fsPath,
    language: editor.document.languageId,
  };
}

export interface CreateFlowOptions {
  scope?: Scope;
  title?: string;
  templateName?: string;
  folder?: string;
  branch?: string;
  bodyOverride?: string;
  tags?: string[];
  kind?: string;
  target?: string;
  sensitive?: boolean;
  codeLinks?: Array<{ path: string; lines?: string; text?: string; endText?: string }>;
  askTitle?: boolean;
}

async function askTemplateQuestions(
  app: FoliumApp,
  rendered: ReturnType<typeof renderTemplate>,
): Promise<Record<string, string> | undefined> {
  const answers: Record<string, string> = {};
  for (const question of rendered.questions) {
    if (question.options && question.options.length > 0) {
      const picked = await vscode.window.showQuickPick(question.options, {
        placeHolder: question.question,
        title: 'Template question',
      });
      if (picked === undefined) return undefined;
      answers[question.question] = picked;
    } else {
      const value = await vscode.window.showInputBox({
        prompt: question.question,
        title: 'Template question',
      });
      if (value === undefined) return undefined;
      answers[question.question] = value;
    }
  }
  return answers;
}

/** Shared create note flow used by every "new note" command. */
export async function createNoteFlow(
  app: FoliumApp,
  options: CreateFlowOptions = {},
): Promise<NoteFile | undefined> {
  const store = app.store;
  if (!store) {
    void vscode.window.showWarningMessage('Folium Notes: open a folder first.');
    return undefined;
  }
  const settings = app.settings;
  const scope = options.scope ?? (await pickScope(app));
  if (!scope) return undefined;
  const templates = templatesForScope(store.templates, scope);
  let template: TemplateDefinition | undefined;
  if (options.templateName) {
    template = templates.find(
      (candidate) => candidate.name.toLowerCase() === options.templateName!.toLowerCase(),
    );
    if (!template) {
      void vscode.window.showWarningMessage(`Folium Notes: template "${options.templateName}" not found.`);
    }
  } else if (!options.bodyOverride) {
    const configured = settings.defaultTemplate.trim();
    if (configured.toLowerCase() === 'ask') {
      const picked = await vscode.window.showQuickPick(
        [
          { label: '$(blank) Blank note', template: undefined as TemplateDefinition | undefined },
          ...templates.map((candidate) => ({
            label: `$(file) ${candidate.name}`,
            description: candidate.description,
            template: candidate,
          })),
        ],
        { placeHolder: 'Start from a template?' },
      );
      if (picked === undefined) return undefined;
      template = picked.template;
    } else if (configured) {
      template = templates.find((candidate) => candidate.name.toLowerCase() === configured.toLowerCase());
    }
  }
  const title = options.title ?? (await askTitle(template ? template.name : '', 'Note title'));
  if (!title) return undefined;
  const context = codeContext(app);
  let body = options.bodyOverride ?? `# ${title}\n\n`;
  if (template && !options.bodyOverride) {
    const baseContext: TemplateContext = {
      ...context,
      title,
      user: app.git.userName,
      project: store.paths.projectKey,
      branch: app.git.branch,
    };
    let rendered = renderTemplate(template.body, baseContext);
    if (rendered.questions.length > 0) {
      const answers = await askTemplateQuestions(app, rendered);
      if (!answers) return undefined;
      rendered = renderTemplate(template.body, { ...baseContext, answers });
    }
    body = rendered.text;
  }
  const tags = options.tags ?? template?.tags;
  const sensitive = options.sensitive ?? template?.sensitive ?? false;
  const encrypt = sensitive && (template?.name === 'Credentials' || settings.encryptSensitiveNotes);
  const note = await store.createNote({
    scope,
    title,
    body,
    tags,
    color: template?.color,
    branch: options.branch,
    kind: options.kind ?? template?.kind,
    target: options.target ?? template?.target,
    sensitive,
    folder: options.folder,
    extra: template?.extra,
    transform: encrypt ? (raw) => raw : undefined,
  });
  let created = note;
  if (encrypt) {
    const encryptedRaw = await app.keys.encrypt(note.raw);
    created = await store.writeRaw(note, encryptedRaw);
  }
  if (options.codeLinks && options.codeLinks.length > 0) {
    const raw = parseNote(created.raw);
    const { setFrontMatterField } = await import('../core/frontmatter');
    const updated = setFrontMatterField(created.raw, 'code', [
      ...raw.meta.code,
      ...options.codeLinks,
    ]);
    created = await store.writeRaw(created, updated);
  }
  await app.openNote(created);
  if (template) {
    const renderedCursor = renderTemplate(template.body, {
      ...context,
      title,
      user: app.git.userName,
      project: store.paths.projectKey,
      branch: app.git.branch,
    });
    const offset = renderedCursor.cursorOffset;
    if (offset !== undefined) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const bodyStart = editor.document.getText().length - parseNote(editor.document.getText()).body.length;
        const position = editor.document.positionAt(bodyStart + offset);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
      }
    }
  }
  app.refresh();
  return created;
}

function selectionLines(editor: vscode.TextEditor): { start: number; end: number } {
  const selection = editor.selection;
  if (selection.isEmpty) return { start: selection.active.line + 1, end: selection.active.line + 1 };
  return { start: selection.start.line + 1, end: selection.end.line + 1 };
}

export async function newFromSelection(app: FoliumApp): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || app.store?.byPath(editor.document.uri.fsPath)) {
    void vscode.window.showWarningMessage('Folium Notes: select code in a file first.');
    return;
  }
  const scope = await pickScope(app);
  if (!scope) return;
  const { start, end } = selectionLines(editor);
  const selection = editor.selection.isEmpty
    ? editor.document.lineAt(editor.selection.active.line).text
    : editor.document.getText(editor.selection);
  const firstLine = selection.split(/\r?\n/).find((line) => line.trim());
  const suggested = (firstLine ?? '').trim().slice(0, 60) || `Note from ${path.basename(editor.document.fileName)}`;
  const title = await askTitle(suggested, 'Title for the new note');
  if (!title) return;
  const language = editor.document.languageId;
  const fence = language && language !== 'plaintext' ? language : '';
  const body = `# ${title}\n\n\`\`\`${fence}\n${selection.replace(/\s+$/, '')}\n\`\`\`\n\n`;
  const note = await createNoteFlow(app, { scope, title, bodyOverride: body });
  if (!note) return;
  const targetAbs = editor.document.uri.fsPath;
  const linkPath = codeLinkPathFor(note.absPath, note.scope, targetAbs);
  const lines = editor.document.getText().split(/\r?\n/);
  const snippet = buildCodeLink(lines, start, end, linkPath);
  const display = `${linkPath.replace(/^file:\/\//, '')}#L${start}${end !== start ? `-L${end}` : ''}`;
  const href = `${linkPath}#L${start}${end !== start ? `-L${end}` : ''}`;
  const bodyWithLink = `${parseNote(note.raw).body.trimEnd()}\n\n${formatBodyLink(display, href)}\n`;
  const { setFrontMatterField } = await import('../core/frontmatter');
  let raw = setFrontMatterField(note.raw, 'code', [...note.meta.code, snippet]);
  const parsed = parseNote(raw);
  raw = `${raw.slice(0, raw.length - parsed.body.length)}${bodyWithLink}`;
  await app.store?.writeRaw(note, raw);
  app.refresh();
}

export async function linkSelectionToNote(app: FoliumApp): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !app.store) return;
  if (app.store.byPath(editor.document.uri.fsPath)) {
    void vscode.window.showWarningMessage('Folium Notes: open a code file to link from.');
    return;
  }
  const note = (await pickNote(app, { placeHolder: 'Link the selection to which note?' })) ?? activeNote(app);
  if (!note) return;
  const { start, end } = selectionLines(editor);
  const linkPath = codeLinkPathFor(note.absPath, note.scope, editor.document.uri.fsPath);
  const display = `${linkPath.replace(/^file:\/\//, '')}#L${start}${end !== start ? `-L${end}` : ''}`;
  const href = `${linkPath}#L${start}${end !== start ? `-L${end}` : ''}`;
  const body = `${note.body.trimEnd()}\n\n${formatBodyLink(display, href)}\n`;
  await app.store.replaceBody(note, body);
  app.refresh();
}

function codeProvider(app: FoliumApp, note: NoteFile): CodeFileProvider {
  return {
    candidates: (linkPath) => {
      if (/^file:\/\//i.test(linkPath)) {
        try {
          return [vscode.Uri.parse(linkPath).fsPath];
        } catch {
          return [];
        }
      }
      return [
        path.resolve(path.dirname(note.absPath), linkPath),
        ...(app.projectRoot() ? [path.resolve(app.projectRoot()!, linkPath)] : []),
      ];
    },
    exists: (candidate) => {
      try {
        return require('node:fs').statSync(candidate).isFile();
      } catch {
        return false;
      }
    },
    readLines: (candidate) => {
      try {
        return require('node:fs').readFileSync(candidate, 'utf8').split('\n');
      } catch {
        return undefined;
      }
    },
  };
}

/** Re-capture every code link of a note (relocating code that moved). */
/** Search the project for files with a basename (code moved to another file or renamed). */
async function findFilesByBasename(root: string, fileName: string): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(['node_modules', '.git', '.notes', '.vscode', 'dist', 'out', 'build', 'coverage']);
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= 20 || depth > 12) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
        await visit(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && entry.name === fileName) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  await visit(root, 0);
  return out;
}

export async function updateCodeLinks(app: FoliumApp, note?: NoteFile): Promise<void> {
  const target = note ?? activeNote(app) ?? (await pickNote(app, { placeHolder: 'Update code links of which note?' }));
  if (!target || !app.store) return;
  const { locateInLines } = await import('../core/codeLinks');
  const updatedLinks = [];
  const messages: string[] = [];
  for (const link of target.meta.code) {
    let resolution = resolveCodeLink(link, codeProvider(app, target));
    if ((resolution.status === 'lost' || !resolution.path) && app.projectRoot()) {
      const moved = await findFilesByBasename(app.projectRoot()!, path.basename(link.path.replace(/^file:\/\//, '')));
      for (const candidate of moved) {
        try {
          const lines = (await fs.readFile(candidate, 'utf8')).split(/\r?\n/);
          const located = locateInLines(lines, link);
          if (located) {
            resolution = {
              status: 'moved',
              path: candidate,
              startLine: located.start,
              endLine: located.end,
              link,
            };
            break;
          }
        } catch {
          /* unreadable file */
        }
      }
    }
    if (resolution.status === 'lost' || !resolution.path) {
      updatedLinks.push(link);
      messages.push(`lost: ${link.path}`);
      continue;
    }
    const lines = (await fs.readFile(resolution.path, 'utf8')).split(/\r?\n/);
    const newPath = codeLinkPathFor(target.absPath, target.scope, resolution.path);
    const snippet = buildCodeLink(lines, resolution.startLine, resolution.endLine, newPath);
    updatedLinks.push(snippet);
    messages.push(`${STATUS_LABELS[resolution.status]}: ${newPath}`);
  }
  const { setFrontMatterField } = await import('../core/frontmatter');
  const raw = setFrontMatterField(target.raw, 'code', updatedLinks.length > 0 ? updatedLinks : undefined);
  await app.store.writeRaw(target, raw);
  app.refresh();
  void vscode.window.showInformationMessage(
    messages.length > 0 ? `Folium: updated ${messages.length} code link(s).` : 'Folium: this note has no code links.',
  );
}

export async function showNotesForFile(app: FoliumApp): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !app.store) return;
  const notes = app.store.notesForCodeFile(editor.document.uri.fsPath);
  if (notes.length === 0) {
    void vscode.window.showInformationMessage('Folium: no notes mention this file.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    notes.map((note) => ({ label: note.title, description: note.scope, detail: note.relPath, note })),
    { placeHolder: 'Notes for this file' },
  );
  if (picked) await app.openNote(picked.note);
}

export async function openNoteByKey(app: FoliumApp, key: string | NoteFile): Promise<void> {
  const note = typeof key === 'string' ? app.store?.byKey(key) : key;
  if (note) await app.openNote(note);
}

export async function setNoteColor(app: FoliumApp, note?: NoteFile): Promise<void> {
  const target = note ?? activeNote(app) ?? (await pickNote(app));
  if (!target) return;
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(circle-slash) No color', value: 'none' as const },
      ...COLORS.map((color) => ({ label: `$(circle-filled) ${color}`, value: color })),
    ],
    { placeHolder: `Color for "${target.title}"` },
  );
  if (!picked) return;
  await app.store?.setColor(target, picked.value === 'none' ? undefined : (picked.value as Color));
  app.refresh();
}

export async function togglePin(app: FoliumApp, note?: NoteFile): Promise<void> {
  const target = note ?? activeNote(app) ?? (await pickNote(app));
  if (!target) return;
  const pinned = await app.store?.togglePin(target);
  app.refresh();
  void vscode.window.setStatusBarMessage(pinned ? 'Folium: note pinned' : 'Folium: note unpinned', 2000);
}

export async function setArchived(app: FoliumApp, archived: boolean, note?: NoteFile): Promise<void> {
  const target = note ?? activeNote(app) ?? (await pickNote(app));
  if (!target) return;
  await app.store?.setArchived(target, archived);
  app.refresh();
}

export async function trashNote(app: FoliumApp, note?: NoteFile): Promise<void> {
  const targets = note ? [note] : [activeNote(app)].filter((n): n is NoteFile => !!n);
  const list = targets.length > 0 ? targets : [await pickNote(app)];
  for (const target of list) {
    if (!target || !app.store) continue;
    if (app.settings.confirmDelete) {
      const ok = await confirmDanger(`Move "${target.title}" to the trash?`, 'Move to Trash');
      if (!ok) continue;
    }
    await app.store.trashNote(target);
  }
  app.refresh();
}

export async function restoreTrashEntry(app: FoliumApp): Promise<void> {
  const store = app.store;
  if (!store) return;
  const entries = store.trashEntries;
  if (entries.length === 0) {
    void vscode.window.showInformationMessage('Folium: the trash is empty.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    entries.map((entry) => ({
      label: entry.relPath.split('/').pop() ?? entry.relPath,
      description: `${entry.scope} · deleted ${entry.deletedAt.slice(0, 10)}`,
      entry,
    })),
    { placeHolder: 'Restore which note?' },
  );
  if (!picked) return;
  const restored = await store.restoreTrashEntry(picked.entry);
  app.refresh();
  if (restored) await app.openNote(restored);
}

export async function deleteTrashEntry(app: FoliumApp, entry?: { storedName: string }): Promise<void> {
  const store = app.store;
  if (!store) return;
  const target = entry ?? store.trashEntries[0];
  if (!target) return;
  const full = store.trashEntries.find((candidate) => candidate.storedName === target.storedName);
  if (!full) return;
  const ok = await confirmDanger('Delete this note permanently?', 'Delete Permanently');
  if (!ok) return;
  await store.deleteTrashEntry(full);
  app.refresh();
}

export async function emptyTrash(app: FoliumApp): Promise<void> {
  const store = app.store;
  if (!store || store.trashEntries.length === 0) return;
  const ok = await confirmDanger(`Delete ${store.trashEntries.length} note(s) permanently?`, 'Empty Trash');
  if (!ok) return;
  await store.emptyTrash();
  app.refresh();
}

export async function renameNote(app: FoliumApp): Promise<void> {
  const note = activeNote(app) ?? (await pickNote(app));
  if (!note || !app.store) return;
  const title = await askTitle(note.title, 'New title');
  if (!title || title === note.title) return;
  await app.store.updateFrontMatter(note, [['title', title]]);
  app.refresh();
}

export async function duplicateNote(app: FoliumApp): Promise<void> {
  const note = activeNote(app) ?? (await pickNote(app));
  if (!note || !app.store) return;
  const created = await app.store.createNote({
    scope: note.scope,
    title: `${note.title} (copy)`,
    body: note.body,
    tags: note.tags,
    kind: note.kind,
    target: note.target,
    sensitive: note.sensitive,
    extra: { ...note.meta },
  });
  await app.openNote(created);
  app.refresh();
}

export async function moveNoteScope(app: FoliumApp): Promise<void> {
  const note = activeNote(app) ?? (await pickNote(app));
  if (!note || !app.store) return;
  const target: Scope = note.scope === 'shared' ? 'private' : 'shared';
  if (target === 'shared' && note.sensitive) {
    void vscode.window.showWarningMessage('Sensitive notes can never be shared.');
    return;
  }
  const ok = await confirmDanger(`Move "${note.title}" to ${target} notes?`, 'Move');
  if (!ok) return;
  const moved = await app.store.moveNote(note, target);
  await app.openNote(moved);
  app.refresh();
}

export async function editNoteTags(app: FoliumApp): Promise<void> {
  const note = activeNote(app) ?? (await pickNote(app));
  if (!note || !app.store) return;
  const value = await vscode.window.showInputBox({
    prompt: 'Tags (comma separated, nested with /)',
    value: app.store.tagsOf(note).join(', '),
  });
  if (value === undefined) return;
  const tags = value
    .split(',')
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);
  await app.store.updateFrontMatter(note, [['tags', tags.length > 0 ? tags : undefined]]);
  app.refresh();
}

export async function toggleTaskAtCursor(app: FoliumApp): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const note = app.store?.byPath(editor.document.uri.fsPath);
  if (!note || !app.store) return;
  const { parseTasks, toggleTask } = await import('../core/tasks');
  const tasks = parseTasks(editor.document.getText(), {
    noteKey: note.key,
    noteTitle: note.title,
    scope: note.scope,
    relPath: note.relPath,
  });
  const line = editor.selection.active.line + 1;
  const task = tasks.find((candidate) => candidate.line === line);
  if (!task) return;
  const raw = toggleTask(editor.document.getText(), task.offset);
  const updated = await app.store.writeRaw(note, raw);
  await app.openNote(updated, { preserveFocus: true });
  app.refresh();
}

export async function openTask(app: FoliumApp, task: { noteKey: string; line: number }): Promise<void> {
  const note = app.store?.byKey(task.noteKey);
  if (!note) return;
  await app.openNote(note);
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const line = Math.max(0, Math.min(task.line - 1, editor.document.lineCount - 1));
  const position = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

export async function showTasks(): Promise<void> {
  await vscode.commands.executeCommand('folium.tasks.focus');
}

export async function newNoteWithTitle(app: FoliumApp, title: string): Promise<void> {
  const scope = await pickScope(app);
  if (!scope) return;
  await createNoteFlow(app, { scope, title });
}

export async function statusMenu(app: FoliumApp): Promise<void> {
  const note = activeNote(app);
  if (!note) {
    await showSearch(app);
    return;
  }
  const actions: Array<{ label: string; command: string; args?: unknown[] }> = [
    { label: '$(symbol-color) Set color', command: 'folium.setColor' },
    { label: '$(pin) Toggle pin', command: 'folium.togglePin' },
    { label: '$(archive) Archive', command: 'folium.archive' },
    { label: '$(trash) Move to trash', command: 'folium.trashNote' },
    { label: '$(edit) Rename', command: 'folium.renameNote' },
    { label: '$(lock) Encrypt note', command: 'folium.encryptNote' },
    { label: '$(globe) Move to other scope', command: 'folium.moveNote' },
    { label: '$(comment-discussion) Send as prompt', command: 'folium.sendPrompt' },
    { label: '$(issue-opened) Create issue', command: 'folium.createIssue' },
  ];
  const picked = await vscode.window.showQuickPick(actions, { placeHolder: note.title });
  if (picked) await vscode.commands.executeCommand(picked.command, ...(picked.args ?? []));
}

/* ------------------------------- filters ------------------------------- */

export async function toggleTagFilter(app: FoliumApp, tag: string): Promise<void> {
  const state = app.viewStateStore.get();
  const tags = state.filters.tags.includes(tag)
    ? state.filters.tags.filter((candidate) => candidate !== tag)
    : [...state.filters.tags, tag];
  await app.viewStateStore.updateFilters({ ...state.filters, tags });
  app.refresh();
}

export async function filterByColor(app: FoliumApp): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(circle-slash) No color', value: 'none' as const },
      ...COLORS.map((color) => ({ label: `$(circle-filled) ${color}`, value: color })),
    ],
    { placeHolder: 'Filter by color (Esc to cancel)', canPickMany: true },
  );
  if (!picked) return;
  const state = app.viewStateStore.get();
  await app.viewStateStore.updateFilters({ ...state.filters, colors: picked.map((item) => item.value) });
  app.refresh();
}

export async function filterByDate(app: FoliumApp): Promise<void> {
  const presets = [
    { label: 'Any date', value: 'any' as const },
    { label: 'Today', value: 'today' as const },
    { label: 'Last 7 days', value: 'last7' as const },
    { label: 'Last 30 days', value: 'last30' as const },
    { label: 'This year', value: 'thisYear' as const },
    { label: 'Custom range…', value: 'custom' as const },
  ];
  const picked = await vscode.window.showQuickPick(presets, { placeHolder: 'Filter by date' });
  if (!picked) return;
  const state = app.viewStateStore.get();
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  if (picked.value === 'custom') {
    dateFrom = await vscode.window.showInputBox({ prompt: 'From (YYYY-MM-DD)' });
    dateTo = await vscode.window.showInputBox({ prompt: 'To (YYYY-MM-DD)' });
  }
  await app.viewStateStore.updateFilters({
    ...state.filters,
    datePreset: picked.value,
    dateFrom,
    dateTo,
  });
  app.refresh();
}

export async function filterByScope(app: FoliumApp): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'All notes', value: 'all' as const },
      { label: 'Shared only', value: 'shared' as const },
      { label: 'Private only', value: 'private' as const },
    ],
    { placeHolder: 'Filter by scope' },
  );
  if (!picked) return;
  const state = app.viewStateStore.get();
  await app.viewStateStore.updateFilters({ ...state.filters, scope: picked.value });
  app.refresh();
}

export async function filterByText(app: FoliumApp): Promise<void> {
  const value = await vscode.window.showInputBox({ prompt: 'Filter notes by text' });
  if (value === undefined) return;
  const state = app.viewStateStore.get();
  await app.viewStateStore.updateFilters({ ...state.filters, text: value });
  app.refresh();
}

export async function setTagFilterMode(app: FoliumApp): Promise<void> {
  const state = app.viewStateStore.get();
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Any selected tag', value: 'any' as const },
      { label: 'All selected tags', value: 'all' as const },
    ],
    { placeHolder: 'Tag filter mode' },
  );
  if (!picked) return;
  await app.viewStateStore.updateFilters({ ...state.filters, tagMode: picked.value });
  app.refresh();
}

export async function clearFilters(app: FoliumApp): Promise<void> {
  await app.viewStateStore.update({ filters: emptyFilters() });
  app.refresh();
}

export async function setGroupBy(app: FoliumApp): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'None', value: 'none' as const },
      { label: 'Scope (shared/private)', value: 'scope' as const },
      { label: 'Tag (nested)', value: 'tag' as const },
      { label: 'Date', value: 'date' as const },
      { label: 'Color', value: 'color' as const },
    ],
    { placeHolder: 'Group notes by' },
  );
  if (!picked) return;
  await app.viewStateStore.update({ groupBy: picked.value });
  app.refresh();
}

export async function setSortBy(app: FoliumApp): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Updated', value: 'updated' as const },
      { label: 'Created', value: 'created' as const },
      { label: 'Title', value: 'title' as const },
    ],
    { placeHolder: 'Sort notes by' },
  );
  if (!picked) return;
  const state = app.viewStateStore.get();
  await app.viewStateStore.update({ sortBy: picked.value, sortOrder: state.sortOrder });
  app.refresh();
}

export async function toggleSortOrder(app: FoliumApp): Promise<void> {
  const state = app.viewStateStore.get();
  await app.viewStateStore.update({ sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' });
  app.refresh();
}

export async function toggleDoneTasks(app: FoliumApp): Promise<void> {
  const state = app.viewStateStore.get();
  await app.viewStateStore.update({ showDoneTasks: !state.showDoneTasks });
  app.refresh();
}

export async function tasksGroupBy(app: FoliumApp): Promise<void> {
  const state = app.viewStateStore.get();
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'By due date', value: 'due' as const },
      { label: 'By note', value: 'note' as const },
    ],
    { placeHolder: 'Group tasks by' },
  );
  if (!picked) return;
  await app.viewStateStore.update({ tasksGroupBy: picked.value });
  app.refresh();
}

/** Create a note that a [[wiki link]] points at (Quick Fix). */
export async function createMissingNote(
  app: FoliumApp,
  target: string,
  scope: Scope,
): Promise<void> {
  const store = app.store;
  const title = target.trim();
  if (!store || !title) return;
  const note = await store.createNote({ scope, title, body: `# ${title}\n\n` });
  app.refresh();
  await app.openNote(note);
}
