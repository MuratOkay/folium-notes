/** Editor features: overlays, code lenses, gutter dots, hovers, diagnostics, links. */

import * as vscode from 'vscode';
import path from 'node:path';
import fs from 'node:fs';
import type { FoliumApp } from '../app';
import type { NoteFile } from '../store/store';
import {
  codeLinkAnchor,
  codeLinkCandidates,
  resolveCodeLink,
  STATUS_LABELS,
  type CodeLinkResolution,
  type CodeFileProvider,
} from '../core/codeLinks';
import { COLOR_HEX, type Color } from '../core/colors';
import { parseNote } from '../core/frontmatter';
import { parseWikiLinks, resolveLink, validateLinks } from '../core/links';
import { parseTasks } from '../core/tasks';
import { firstHeadingLine, splitFrontMatter, splitLines } from '../core/markdown';
import { parsePlaceholders, placeholderDoc, validateTemplate, ALL_PLACEHOLDERS } from '../core/templates';
import { secureUri } from './secureFs';

export function registerEditorFeatures(app: FoliumApp): void {
  const subscriptions: vscode.Disposable[] = [];
  const overlay = new OverlaySync(app);
  const lenses = new CodeLinkLensProvider(app);
  const decorator = new CodeLinkDecorator(app);
  const diagnostics = new NoteDiagnostics(app);
  const templateFeatures = new TemplateFeatures(app);
  const taskMarks = new TaskMarkDecorator(app);

  subscriptions.push(
    overlay,
    lenses,
    decorator,
    diagnostics,
    templateFeatures,
    taskMarks,
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, lenses),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, decorator),
    vscode.languages.registerCompletionItemProvider(
      [{ language: 'markdown', scheme: 'file' }],
      new WikiLinkCompletion(app),
      '[',
      '#',
    ),
    vscode.languages.registerDefinitionProvider(
      [{ language: 'markdown', scheme: 'file' }],
      new WikiLinkDefinition(app),
    ),
    vscode.languages.registerDocumentLinkProvider(
      [{ language: 'markdown', scheme: 'file' }],
      new WikiLinkDocumentLinks(app),
    ),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'markdown', scheme: 'file' }],
      new MissingLinkActions(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );
  app.context.subscriptions.push(...subscriptions);
  app.onDidRefresh.event(() => {
    lenses.refresh();
    decorator.refresh();
    diagnostics.refresh();
    taskMarks.refresh();
  });
}

function noteForDocument(app: FoliumApp, document: vscode.TextDocument): NoteFile | undefined {
  if (document.uri.scheme !== 'file') return undefined;
  return app.store?.byPath(document.uri.fsPath);
}

/** Mirror unsaved editor buffers into the store (tree/search see unsaved edits). */
class OverlaySync implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly app: FoliumApp) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const document = event.document;
        if (!noteForDocument(this.app, document)) return;
        this.app.store?.setOverlay(document.uri.fsPath, document.getText());
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!noteForDocument(this.app, document)) return;
        this.app.store?.clearOverlay(document.uri.fsPath);
        void this.app.store?.refresh();
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.app.store?.clearOverlay(document.uri.fsPath);
      }),
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}

export interface FileCodeLink {
  note: NoteFile;
  linkIndex: number;
  resolution: CodeLinkResolution;
}

function codeProvider(app: FoliumApp, note?: NoteFile): CodeFileProvider {
  return {
    candidates: (linkPath) => {
      if (/^file:\/\//i.test(linkPath)) {
        try {
          return [vscode.Uri.parse(linkPath).fsPath];
        } catch {
          return [];
        }
      }
      const out: string[] = [];
      if (note) out.push(...codeLinkCandidates(linkPath, note.absPath, app.projectRoot()));
      else if (app.projectRoot()) out.push(path.resolve(app.projectRoot()!, linkPath));
      return out;
    },
    exists: (candidate) => {
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    },
    readLines: (candidate) => {
      try {
        return fs.readFileSync(candidate, 'utf8').split('\n');
      } catch {
        return undefined;
      }
    },
  };
}

/** All code links from all notes that resolve into this document. */
export function linksForDocument(app: FoliumApp, document: vscode.TextDocument): FileCodeLink[] {
  if (document.uri.scheme !== 'file' || !app.store) return [];
  const target = path.resolve(document.uri.fsPath);
  const out: FileCodeLink[] = [];
  for (const note of app.store.allNotes) {
    if (note.meta.code.length === 0) continue;
    note.meta.code.forEach((link, linkIndex) => {
      const resolution = resolveCodeLink(link, codeProvider(app, note));
      if (resolution.path && path.resolve(resolution.path) === target) {
        out.push({ note, linkIndex, resolution });
      }
    });
  }
  return out;
}

class CodeLinkLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changes.event;
  private timer?: NodeJS.Timeout;

  constructor(private readonly app: FoliumApp) {}

  refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changes.fire(), 200);
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.app.settings.codeLens) return [];
    if (noteForDocument(this.app, document)) return [];
    const links = linksForDocument(this.app, document);
    return links.map((item) => {
      const line = Math.max(0, Math.min(item.resolution.startLine - 1, document.lineCount - 1));
      const range = new vscode.Range(line, 0, line, 0);
      const status = STATUS_LABELS[item.resolution.status];
      const lost = item.resolution.status === 'lost';
      const command: vscode.Command = {
        title: lost
          ? `$(warning) ${item.note.title} — code link lost`
          : `$(note) ${item.note.title}${item.resolution.status === 'exact' ? '' : ` — ${status}`}`,
        tooltip: `Open ${item.note.scope} note: ${item.note.title}`,
        command: 'folium.openNote',
        arguments: [item.note.key],
      };
      return new vscode.CodeLens(range, command);
    });
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.changes.dispose();
  }
}

class CodeLinkDecorator implements vscode.HoverProvider, vscode.Disposable {
  private readonly decorations = new Map<string, vscode.TextEditorDecorationType>();
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly app: FoliumApp) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument(() => this.refresh()),
    );
  }

  private decorationFor(color: Color | 'lost'): vscode.TextEditorDecorationType {
    const existing = this.decorations.get(color);
    if (existing) return existing;
    const created = vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      overviewRulerColor: color === 'lost' ? '#e5534b' : COLOR_HEX[color],
      overviewRulerLane: vscode.OverviewRulerLane.Center,
      gutterIconPath: vscode.Uri.joinPath(
        this.app.context.extensionUri,
        'images',
        `gutter-${color}.png`,
      ),
      gutterIconSize: 'contain',
    });
    this.decorations.set(color, created);
    return created;
  }

  refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.apply(), 120);
  }

  private apply(): void {
    const enabled = this.app.settings.gutterIcons;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme !== 'file') continue;
      docLinksCache.delete(editor.document.uri.toString());
      if (!enabled || noteForDocument(this.app, editor.document)) {
        for (const color of [...Object.keys(COLOR_HEX), 'lost' as const]) {
          editor.setDecorations(this.decorationFor(color as Color | 'lost'), []);
        }
        continue;
      }
      const links = linksForDocument(this.app, editor.document);
      docLinksCache.set(editor.document.uri.toString(), links);
      for (const color of [...Object.keys(COLOR_HEX), 'lost' as const]) {
        const ranges: vscode.Range[] = [];
        for (const item of links) {
          const key = item.resolution.status === 'lost' ? 'lost' : item.note.color ?? 'gray';
          if (key !== color) continue;
          const line = Math.max(0, Math.min(item.resolution.startLine - 1, editor.document.lineCount - 1));
          ranges.push(new vscode.Range(line, 0, line, 0));
        }
        editor.setDecorations(this.decorationFor(color as Color | 'lost'), ranges);
      }
    }
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (document.uri.scheme !== 'file' || noteForDocument(this.app, document)) return undefined;
    const links = docLinksCache.get(document.uri.toString()) ?? linksForDocument(this.app, document);
    docLinksCache.set(document.uri.toString(), links);
    const line = position.line + 1;
    const matching = links.filter(
      (item) =>
        item.resolution.status !== 'lost' &&
        line >= item.resolution.startLine &&
        line <= item.resolution.endLine,
    );
    if (matching.length === 0) return undefined;
    const markdown = new vscode.MarkdownString();
    for (const item of matching) {
      const link = item.note.meta.code[item.linkIndex];
      markdown.appendMarkdown(`**${item.note.title}** · ${item.note.scope} · ${STATUS_LABELS[item.resolution.status]}\n\n`);
      if (link.text) {
        markdown.appendCodeblock(link.text, 'text');
      }
      markdown.appendMarkdown(
        `[Open note](command:folium.openNote?${encodeURIComponent(JSON.stringify([item.note.key]))})\n\n`,
      );
    }
    markdown.isTrusted = { enabledCommands: ['folium.openNote'] };
    markdown.supportHtml = false;
    return new vscode.Hover(markdown);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const disposable of this.disposables) disposable.dispose();
    for (const decoration of this.decorations.values()) decoration.dispose();
  }
}

const docLinksCache = new Map<string, FileCodeLink[]>();

class WikiLinkCompletion implements vscode.CompletionItemProvider {
  constructor(private readonly app: FoliumApp) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] | undefined {
    const store = this.app.store;
    if (!store) return undefined;
    const line = document.lineAt(position.line).text.slice(0, position.character);
    const wiki = /\[\[([^\[\]\n|#]*)$/.exec(line);
    if (wiki) {
      const typed = wiki[1];
      const range = new vscode.Range(
        position.line,
        position.character - typed.length,
        position.line,
        position.character,
      );
      const items = new Map<string, vscode.CompletionItem>();
      for (const note of store.allNotes) {
        if (items.has(note.title)) continue;
        const item = new vscode.CompletionItem(note.title, vscode.CompletionItemKind.File);
        item.insertText = note.title;
        item.range = range;
        item.detail = `${note.scope} · ${note.relPath}`;
        item.documentation = new vscode.MarkdownString(note.body.slice(0, 400));
        item.filterText = `${note.title} ${note.relPath}`;
        items.set(note.title, item);
      }
      return [...items.values()];
    }
    const hashtag = /(^|\s)#([\p{L}\p{N}_/-]*)$/u.exec(line);
    if (hashtag) {
      const typed = hashtag[2];
      const range = new vscode.Range(
        position.line,
        position.character - typed.length,
        position.line,
        position.character,
      );
      return [...store.allTags().keys()].map((tag) => {
        const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Reference);
        item.insertText = tag;
        item.range = range;
        item.detail = 'tag';
        return item;
      });
    }
    return undefined;
  }
}

class WikiLinkDefinition implements vscode.DefinitionProvider {
  constructor(private readonly app: FoliumApp) {}

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
    const store = this.app.store;
    if (!store) return undefined;
    const offset = document.offsetAt(position);
    const link = parseWikiLinks(document.getText()).find(
      (candidate) => offset >= candidate.start && offset <= candidate.end,
    );
    if (!link || !link.target) return undefined;
    const target = resolveLink(link.target, store.linkIndex)[0];
    if (!target) return undefined;
    const note = store.byKey(target.key);
    if (!note) return undefined;
    const uri = note.encrypted ? secureUri(note.absPath) : vscode.Uri.file(note.absPath);
    let line = 0;
    if (link.heading) {
      const heading = link.heading.toLowerCase();
      const found = splitLines(note.body).find((candidate) =>
        candidate.text.replace(/^#{1,6}\s*/, '').trim().toLowerCase() === heading,
      );
      if (found) line = found.number - 1;
    }
    return new vscode.Location(uri, new vscode.Range(line, 0, line, 0));
  }
}

class WikiLinkDocumentLinks implements vscode.DocumentLinkProvider {
  constructor(private readonly app: FoliumApp) {}

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const store = this.app.store;
    if (!store || noteForDocument(this.app, document) === undefined) return [];
    const out: vscode.DocumentLink[] = [];
    for (const link of parseWikiLinks(document.getText())) {
      if (!link.target) continue;
      const target = resolveLink(link.target, store.linkIndex)[0];
      if (!target) continue;
      const note = store.byKey(target.key);
      if (!note) continue;
      const uri = note.encrypted ? secureUri(note.absPath) : vscode.Uri.file(note.absPath);
      const range = new vscode.Range(
        document.positionAt(link.contentStart),
        document.positionAt(link.end - 2),
      );
      const documentLink = new vscode.DocumentLink(range, uri);
      documentLink.tooltip = `${note.title} (${note.scope})`;
      out.push(documentLink);
    }
    return out;
  }
}

function isTemplateDocument(app: FoliumApp, document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file') return false;
  const full = document.uri.fsPath.split(path.sep).join('/');
  if (full.includes('/.templates/')) return true;
  if (document.languageId !== 'markdown') return false;
  const meta = parseNote(document.getText()).meta;
  return !!meta.template && typeof meta.template === 'object';
}

class NoteDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('folium');
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly app: FoliumApp) {
    this.disposables.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument(() => this.refresh()),
      vscode.workspace.onDidCloseTextDocument((document) => this.collection.delete(document.uri)),
    );
    this.refresh();
  }

  refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.collection.clear();
      for (const document of vscode.workspace.textDocuments) this.update(document);
    }, 250);
  }

  private update(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file' || document.languageId !== 'markdown') return;
    const diagnostics: vscode.Diagnostic[] = [];
    const parsed = parseNote(document.getText());
    if (parsed.headerError) {
      const split = splitFrontMatter(document.getText());
      const range = new vscode.Range(
        document.positionAt(split.headerStart),
        document.positionAt(Math.max(split.headerStart, split.headerEnd)),
      );
      const diagnostic = new vscode.Diagnostic(range, `Invalid front matter: ${parsed.headerError}`, vscode.DiagnosticSeverity.Error);
      diagnostic.source = 'Folium';
      diagnostics.push(diagnostic);
    }
    if (isTemplateDocument(this.app, document)) {
      const body = parsed.body;
      const bodyStart = document.getText().length - body.length;
      for (const problem of validateTemplate(body, { kind: parsed.meta.kind })) {
        const range = new vscode.Range(
          document.positionAt(bodyStart + problem.start),
          document.positionAt(bodyStart + problem.end),
        );
        const diagnostic = new vscode.Diagnostic(
          range,
          problem.suggestion ? `${problem.message}. ${problem.suggestion}` : problem.message,
          problem.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = 'Folium';
        diagnostics.push(diagnostic);
      }
      this.collection.set(document.uri, diagnostics);
      return;
    }
    const note = noteForDocument(this.app, document);
    if (!note || !this.app.settings.linkDiagnostics || !this.app.store) {
      this.collection.set(document.uri, diagnostics);
      return;
    }
    const bodyStart = document.getText().length - parsed.body.length;
    for (const item of validateLinks(parsed.body, this.app.store.linkIndex, {
      key: note.key,
      id: note.id,
      title: note.title,
      fileName: note.fileName,
      relPath: note.relPath,
      scope: note.scope,
    })) {
      const range = new vscode.Range(
        document.positionAt(bodyStart + item.link.start),
        document.positionAt(bodyStart + item.link.end),
      );
      const message =
        item.problem === 'missing'
          ? `Missing note: [[${item.link.target}]]`
          : `Shared notes cannot link to private notes ([[${item.link.target}]])`;
      const diagnostic = new vscode.Diagnostic(
        range,
        message,
        item.problem === 'missing' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
      );
      diagnostic.source = 'Folium';
      diagnostic.code = item.problem;
      (diagnostic as vscode.Diagnostic & { data?: unknown }).data = {
        foliumKind: item.problem,
        target: item.link.target,
        noteKey: note.key,
        noteScope: note.scope,
      };
      diagnostics.push(diagnostic);
    }
    this.collection.set(document.uri, diagnostics);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const disposable of this.disposables) disposable.dispose();
  }
}

class TemplateFeatures implements vscode.CompletionItemProvider, vscode.HoverProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly app: FoliumApp) {
    this.disposables.push(
      vscode.languages.registerCompletionItemProvider(
        [{ language: 'markdown', scheme: 'file' }],
        this,
        '{',
      ),
      vscode.languages.registerHoverProvider([{ language: 'markdown', scheme: 'file' }], this),
    );
  }

  private atPlaceholder(document: vscode.TextDocument, position: vscode.Position) {
    const line = document.lineAt(position.line).text;
    const before = line.slice(0, position.character);
    const open = before.lastIndexOf('{{');
    if (open === -1) return undefined;
    if (before.indexOf('}}', open) !== -1) return undefined;
    const after = line.slice(position.character);
    const close = after.indexOf('}}');
    if (close === -1) return undefined;
    const token = line.slice(open, position.character + close + 2);
    const tokenStart = open;
    return { token, tokenStart };
  }

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    if (!isTemplateDocument(this.app, document)) return undefined;
    const line = document.lineAt(position.line).text.slice(0, position.character);
    const match = /\{\{\s*([a-zA-Z]*)$/.exec(line);
    if (!match) return undefined;
    const typed = match[1];
    const range = new vscode.Range(
      position.line,
      position.character - typed.length,
      position.line,
      position.character,
    );
    const items = ALL_PLACEHOLDERS.map((name) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
      item.range = range;
      item.insertText = name === 'ask' ? 'ask:Question' : name;
      const doc = placeholderDoc(name);
      if (doc) item.documentation = new vscode.MarkdownString(doc);
      item.detail = 'template placeholder';
      return item;
    });
    const ask = new vscode.CompletionItem('ask with options', vscode.CompletionItemKind.Snippet);
    ask.insertText = new vscode.SnippetString('ask:${1:Question}|${2:Option A}|${3:Option B}');
    ask.range = range;
    ask.detail = 'question with options';
    items.push(ask);
    return items;
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (!isTemplateDocument(this.app, document)) return undefined;
    const found = this.atPlaceholder(document, position);
    if (!found) return undefined;
    const name = /\{\{\s*([a-zA-Z]+)/.exec(found.token)?.[1]?.toLowerCase();
    if (!name) return undefined;
    const doc = placeholderDoc(name);
    if (!doc) return undefined;
    const offset = document.offsetAt(position);
    const start = document.offsetAt(new vscode.Position(position.line, found.tokenStart));
    const range = new vscode.Range(document.positionAt(start), document.positionAt(offset));
    return new vscode.Hover(new vscode.MarkdownString(doc), range);
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}

class TaskMarkDecorator implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: ' ✓',
      color: new vscode.ThemeColor('charts.green'),
      fontStyle: 'normal',
    },
    textDecoration: 'none',
  });
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly app: FoliumApp) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh()),
      vscode.workspace.onDidChangeTextDocument(() => this.refresh()),
    );
    this.refresh();
  }

  refresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.apply(), 200);
  }

  private apply(): void {
    const enabled = this.app.settings.tasks.showCheckMarks;
    for (const editor of vscode.window.visibleTextEditors) {
      const note = noteForDocument(this.app, editor.document);
      if (!enabled || !note) {
        editor.setDecorations(this.decoration, []);
        continue;
      }
      const done = parseTasks(editor.document.getText(), {
        noteKey: note.key,
        noteTitle: note.title,
        scope: note.scope,
        relPath: note.relPath,
      }).filter((task) => task.done);
      const ranges = done.map((task) => {
        const line = Math.max(0, Math.min(task.line - 1, editor.document.lineCount - 1));
        const length = editor.document.lineAt(line).text.length;
        return new vscode.Range(line, 0, line, length);
      });
      editor.setDecorations(this.decoration, ranges);
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const disposable of this.disposables) disposable.dispose();
    this.decoration.dispose();
  }
}


/** Quick fix: create the note a missing [[wiki link]] points at. */
class MissingLinkActions implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      const data = (diagnostic as vscode.Diagnostic & { data?: unknown }).data as
        | { foliumKind?: string; target?: string; noteScope?: 'shared' | 'private' }
        | undefined;
      if (diagnostic.code !== 'missing') continue;
      const fromMessage = /Missing note: \[\[(.+?)\]\]/.exec(diagnostic.message)?.[1];
      const target = data?.target ?? fromMessage;
      if (!target) continue;
      const scope = data?.noteScope === 'private' ? 'private' : 'shared';
      const action = new vscode.CodeAction(
        `Create ${scope} note "${target}"`,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diagnostic];
      action.command = {
        command: 'folium.createMissingNote',
        title: 'Create note',
        arguments: [target, scope],
      };
      actions.push(action);
      if (scope === 'shared') {
        const privateAction = new vscode.CodeAction(
          `Create private note "${target}"`,
          vscode.CodeActionKind.QuickFix,
        );
        privateAction.diagnostics = [diagnostic];
        privateAction.command = {
          command: 'folium.createMissingNote',
          title: 'Create private note',
          arguments: [target, 'private'],
        };
        actions.push(privateAction);
      }
    }
    void document;
    return actions;
  }
}
