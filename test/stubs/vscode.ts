/** Minimal VS Code API stub for unit tests that load extension modules. */

export class EventEmitter<T> {
  private listeners: Array<(value: T) => void> = [];
  event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  };
  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export const Disposable = { from: (...items: Array<{ dispose(): void }>) => ({ dispose: () => items.forEach((item) => item.dispose()) }) };

export class Uri {
  constructor(readonly scheme: string, readonly path: string, readonly query = '') {}
  static file(p: string): Uri {
    return new Uri('file', p);
  }
  static from(parts: { scheme: string; path: string }): Uri {
    return new Uri(parts.scheme, parts.path);
  }
  static parse(value: string): Uri {
    const match = /^([a-z0-9+.-]+):(.*)$/i.exec(value);
    return new Uri(match?.[1] ?? 'file', match?.[2] ?? value);
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return new Uri(base.scheme, `${base.path}/${parts.join('/')}`);
  }
  get fsPath(): string {
    return this.path;
  }
  toString(): string {
    return `${this.scheme}:${this.path}`;
  }
}

export class Position {
  constructor(readonly line: number, readonly character: number) {}
}

export class Range {
  constructor(readonly start: Position, readonly end: Position) {}
}

export class Selection extends Range {}

export class ThemeIcon {
  constructor(readonly id: string, readonly color?: unknown) {}
  static File = new ThemeIcon('file');
  static Folder = new ThemeIcon('folder');
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class MarkdownString {
  value = '';
  isTrusted = false;
  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }
  appendCodeblock(text: string): this {
    this.value += `\n\`\`\`\n${text}\n\`\`\`\n`;
    return this;
  }
}

export class TreeItem {
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  id?: string;
  resourceUri?: unknown;
  checkboxState?: number;
  accessibilityInformation?: unknown;
  constructor(public label: string, public collapsibleState?: number) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export enum TreeItemCheckboxState {
  Unchecked = 0,
  Checked = 1,
}

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
}

export enum FileChangeType {
  Changed = 1,
  Created = 2,
  Deleted = 3,
}

export const FileSystemError = {
  NoPermissions: (message: string) => new Error(message),
  Unavailable: (message: string) => new Error(message),
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
}

export enum ProgressLocation {
  Notification = 15,
  Window = 10,
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum CompletionItemKind {
  Text = 0,
  Variable = 4,
  File = 16,
  Reference = 17,
  Snippet = 14,
}

export enum OverviewRulerLane {
  Left = 1,
  Center = 2,
  Right = 4,
  Full = 7,
}

export enum TextEditorRevealType {
  Default = 0,
  InCenter = 1,
}

export class Diagnostic {
  source?: string;
  code?: string;
  tags?: unknown[];
  constructor(public range: Range, public message: string, public severity: number) {}
}

export class CompletionItem {
  detail?: string;
  documentation?: unknown;
  insertText?: unknown;
  range?: Range;
  filterText?: string;
  constructor(public label: string, public kind?: number) {}
}

export class SnippetString {
  constructor(public value: string) {}
}

export class Hover {
  constructor(public contents: unknown, public range?: Range) {}
}

export class Location {
  constructor(public uri: Uri, public range: Range) {}
}

export class CodeLens {
  constructor(public range: Range, public command?: unknown) {}
}

export class DocumentLink {
  tooltip?: string;
  constructor(public range: Range, public target?: Uri) {}
}

export class DataTransferItem {
  constructor(public value: unknown) {}
}

export class DataTransfer {
  private items = new Map<string, DataTransferItem>();
  set(mime: string, item: DataTransferItem): void {
    this.items.set(mime, item);
  }
  get(mime: string): DataTransferItem | undefined {
    return this.items.get(mime);
  }
}

export class RelativePattern {
  constructor(public base: Uri, public pattern: string) {}
}

export class CancellationTokenSource {}

export const workspace = {
  workspaceFolders: [] as unknown[],
  textDocuments: [] as unknown[],
  isTrusted: true,
  getConfiguration: () => ({
    get: (_key: string, fallback: unknown) => fallback,
    update: async () => undefined,
  }),
  onDidChangeConfiguration: () => ({ dispose: () => undefined }),
  onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
  onDidOpenTextDocument: () => ({ dispose: () => undefined }),
  onDidChangeTextDocument: () => ({ dispose: () => undefined }),
  onDidCloseTextDocument: () => ({ dispose: () => undefined }),
  onDidSaveTextDocument: () => ({ dispose: () => undefined }),
  createFileSystemWatcher: () => ({ onDidChange: () => undefined, onDidCreate: () => undefined, onDidDelete: () => undefined, dispose: () => undefined }),
  registerFileSystemProvider: () => ({ dispose: () => undefined }),
  openTextDocument: async () => ({ getText: () => '', uri: Uri.file('') }),
};

export const window = {
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [] as unknown[],
  createOutputChannel: () => ({ appendLine: () => undefined, show: () => undefined, dispose: () => undefined }),
  createStatusBarItem: () => ({ show: () => undefined, hide: () => undefined, dispose: () => undefined }),
  createTreeView: () => ({ dispose: () => undefined }),
  createTextEditorDecorationType: () => ({ dispose: () => undefined }),
  createQuickPick: () => ({ dispose: () => undefined }),
  registerTreeDataProvider: () => ({ dispose: () => undefined }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showSaveDialog: async () => undefined,
  showOpenDialog: async () => undefined,
  showTextDocument: async () => undefined,
  withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
  onDidChangeActiveTextEditor: () => ({ dispose: () => undefined }),
  onDidChangeVisibleTextEditors: () => ({ dispose: () => undefined }),
  setStatusBarMessage: () => ({ dispose: () => undefined }),
};

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
  executeCommand: async () => undefined,
};

export const languages = {
  createDiagnosticCollection: () => ({ set: () => undefined, delete: () => undefined, clear: () => undefined, dispose: () => undefined }),
  registerCodeLensProvider: () => ({ dispose: () => undefined }),
  registerHoverProvider: () => ({ dispose: () => undefined }),
  registerCompletionItemProvider: () => ({ dispose: () => undefined }),
  registerDefinitionProvider: () => ({ dispose: () => undefined }),
  registerDocumentLinkProvider: () => ({ dispose: () => undefined }),
};

export const env = {
  remoteName: undefined as string | undefined,
  appName: 'Visual Studio Code',
  clipboard: { readText: async () => '', writeText: async () => undefined },
  openExternal: async () => true,
};

export const extensions = { getExtension: () => undefined };

export const authentication = { getSession: async () => undefined };

export const OverviewRulerLaneEnum = OverviewRulerLane;
