/** Extension application: store lifecycle, views, watchers, status bar. */

import * as vscode from 'vscode';
import path from 'node:path';
import { FoliumProjectService, FoliumStore, type NoteFile } from './store/store';
import { DEFAULT_SETTINGS, mergeSettings, type FoliumSettings } from './core/settings';
import { KeyManager } from './ui/keys';
import { SecureFileSystem, SECURE_SCHEME, secureTargetPath, secureUri } from './ui/secureFs';
import { ViewStateStore } from './ui/viewState';
import { readGitInfo, watchGitHead, type GitInfo } from './git';
import { NotesTreeProvider } from './ui/notesTree';
import { TagsTreeProvider } from './ui/tagsTree';
import { TasksTreeProvider } from './ui/tasksTree';
import { RelatedTreeProvider } from './ui/relatedTree';
import { AiTreeProvider } from './ui/aiTree';
import { CommandsTreeProvider } from './ui/commandsTree';
import { StatusBarController } from './ui/statusBar';
import { registerEditorFeatures } from './ui/editor';
import { registerCommands } from './commands';
import { isIgnoredBranch } from './core/branch';

const STORE_AFFECTING = new Set([
  'sharedFolder',
  'privateRoot',
  'privateProjectKey',
]);

export class FoliumApp implements vscode.Disposable {
  readonly keys: KeyManager;
  readonly output: vscode.OutputChannel;
  readonly secureFs: SecureFileSystem;
  store?: FoliumStore;
  service?: FoliumProjectService;
  git: GitInfo = { remotes: [] };
  viewStateStore: ViewStateStore;
  notesTree: NotesTreeProvider;
  tagsTree: TagsTreeProvider;
  tasksTree: TasksTreeProvider;
  relatedTree: RelatedTreeProvider;
  aiTree: AiTreeProvider;
  commandsTree: CommandsTreeProvider;
  statusBar: StatusBarController;
  private treeViews: vscode.TreeView<unknown>[] = [];
  private disposables: vscode.Disposable[] = [];
  private watchers: vscode.FileSystemWatcher[] = [];
  private branchWatcher?: { dispose: () => void };
  private refreshTimer?: NodeJS.Timeout;
  readonly onDidRefresh = new vscode.EventEmitter<void>();
  private storeChangeSubscription?: { dispose: () => void };
  private activating?: Promise<void>;
  ready = false;
  lastBranch?: string;

  constructor(readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel('Folium Notes');
    this.keys = new KeyManager(context.secrets);
    this.secureFs = new SecureFileSystem(this.keys, (message) => {
      void vscode.window.showErrorMessage(message);
    });
    this.viewStateStore = new ViewStateStore(context.workspaceState, this.viewStateKey());
    this.notesTree = new NotesTreeProvider(this);
    this.tagsTree = new TagsTreeProvider(this);
    this.tasksTree = new TasksTreeProvider(this);
    this.relatedTree = new RelatedTreeProvider(this);
    this.aiTree = new AiTreeProvider(this);
    this.commandsTree = new CommandsTreeProvider(this);
    this.statusBar = new StatusBarController(this);
  }

  private viewStateKey(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return `folium.viewState.${folder?.uri.toString() ?? 'empty'}`;
  }

  get settings(): FoliumSettings {
    return readSettings();
  }

  workspaceFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  projectRoot(): string | undefined {
    return this.workspaceFolder()?.uri.fsPath;
  }

  async activate(): Promise<void> {
    if (this.activating) return this.activating;
    this.activating = this.doActivate();
    return this.activating;
  }

  private async doActivate(): Promise<void> {
    this.context.subscriptions.push(this.output);
    this.log(`Folium Notes ${this.context.extension.packageJSON.version as string} starting`);
    this.context.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(SECURE_SCHEME, this.secureFs, {
        isCaseSensitive: true,
      }),
    );
    this.registerTreeViews();
    registerEditorFeatures(this);
    registerCommands(this);
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('foliumNotes')) void this.onConfigurationChanged(event);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.restart()),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.relatedTree.refresh();
        this.statusBar.update();
        void this.updateContextKeys();
        if (this.settings.autoReveal) void this.revealActiveNote();
      }),
    );
    await this.restart();
    this.ready = true;
    this.statusBar.update();
    const version = this.context.extension.packageJSON.version as string;
    void vscode.window.setStatusBarMessage(`Folium Notes ${version} active`, 4000);
    await this.showRemoteNotice();
    if (!(await this.keys.has())) {
      void this.maybeWarnMissingKey();
    }
  }

  private registerTreeViews(): void {
    const notes = vscode.window.createTreeView('folium.notes', {
      treeDataProvider: this.notesTree,
      showCollapseAll: false,
      canSelectMany: true,
      dragAndDropController: this.notesTree,
    });
    const tags = vscode.window.createTreeView('folium.tags', {
      treeDataProvider: this.tagsTree,
      showCollapseAll: true,
    });
    const tasks = vscode.window.createTreeView('folium.tasks', {
      treeDataProvider: this.tasksTree,
      showCollapseAll: true,
    });
    const related = vscode.window.createTreeView('folium.related', {
      treeDataProvider: this.relatedTree,
      showCollapseAll: true,
    });
    const ai = vscode.window.createTreeView('folium.ai', {
      treeDataProvider: this.aiTree,
      showCollapseAll: true,
    });
    const commands = vscode.window.createTreeView('folium.commands', {
      treeDataProvider: this.commandsTree,
      showCollapseAll: true,
    });
    this.treeViews = [notes, tags, tasks, related, ai, commands] as unknown as vscode.TreeView<unknown>[];
    this.notesTree.attach(notes);
    this.tagsTree.attach(tags);
    this.tasksTree.attach(tasks);
    this.context.subscriptions.push(notes, tags, tasks, related, ai, commands);
  }

  async restart(): Promise<void> {
    const root = this.projectRoot();
    this.disposeStore();
    if (!root) {
      this.store = undefined;
      this.refresh();
      return;
    }
    this.viewStateStore = new ViewStateStore(this.context.workspaceState, this.viewStateKey());
    this.git = await readGitInfo(root);
    const settings = this.settings;
    const store = new FoliumStore({
      projectRoot: root,
      settings,
      remotes: this.git.remotes,
      repoRoot: this.git.repoRoot,
      isWindows: process.platform === 'win32',
    });
    try {
      await store.initialize();
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Folium Notes could not open the note folders: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.log(String(error));
      return;
    }
    this.store = store;
    this.service = new FoliumProjectService(store);
    this.storeChangeSubscription = store.onDidChange(() => this.scheduleRefresh());
    this.setupWatchers(store);
    this.lastBranch = this.git.branch;
    this.setupBranchWatcher();
    this.log(`Opened ${store.paths.projectKey} (${store.allNotes.length} notes)`);
    this.refresh();
  }

  private setupWatchers(store: FoliumStore): void {
    const roots = [store.paths.sharedRoot, store.paths.privateFolder];
    for (const root of roots) {
      const pattern = new vscode.RelativePattern(vscode.Uri.file(root), '**/*.md');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      const changed = vscode.Uri.file(root).toString();
      const handler = (uri: vscode.Uri): void => {
        if (uri.toString().includes('/.Folium/')) return;
        if (this.isOverlayActive(uri)) return;
        if (store.wasWrittenRecently(uri.fsPath)) return;
        this.scheduleRefresh();
      };
      watcher.onDidChange(handler);
      watcher.onDidCreate(handler);
      watcher.onDidDelete(handler);
      this.watchers.push(watcher);
      void changed;
    }
    const templateWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(store.paths.personalTemplatesDir), '**/*.md'),
    );
    templateWatcher.onDidChange(() => void store.reloadTemplates().then(() => this.refresh()));
    templateWatcher.onDidCreate(() => void store.reloadTemplates().then(() => this.refresh()));
    templateWatcher.onDidDelete(() => void store.reloadTemplates().then(() => this.refresh()));
    this.watchers.push(templateWatcher);
  }

  private isOverlayActive(uri: vscode.Uri): boolean {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    return doc?.isDirty === true;
  }

  private setupBranchWatcher(): void {
    this.branchWatcher?.dispose();
    const repoRoot = this.git.repoRoot;
    if (!repoRoot) return;
    this.branchWatcher = watchGitHead(repoRoot, (branch) => {
      if (!branch || branch === this.lastBranch) return;
      this.lastBranch = branch;
      this.git.branch = branch;
      void this.onBranchChanged(branch);
    });
    this.disposables.push({ dispose: () => this.branchWatcher?.dispose() });
  }

  private async onBranchChanged(branch: string): Promise<void> {
    const settings = this.settings;
    if (!this.store || isIgnoredBranch(branch)) return;
    const { findBranchNote } = await import('./core/branch');
    const existing = findBranchNote(this.store.allNotes, branch);
    switch (settings.branchNotes.onBranchSwitch) {
      case 'none':
        return;
      case 'notify':
        void vscode.window.showInformationMessage(
          existing ? `Folium: branch note for ${branch}` : `Folium: no note yet for branch ${branch}`,
          existing ? 'Open' : 'Create',
        ).then((choice) => {
          if (choice === 'Open' && existing) void this.openNote(existing);
          if (choice === 'Create') void vscode.commands.executeCommand('folium.branchNote');
        });
        return;
      case 'open':
        if (existing) void this.openNote(existing);
        return;
      case 'create':
        await vscode.commands.executeCommand('folium.branchNote', { silent: true });
        return;
      default:
        return;
    }
  }

  private async maybeWarnMissingKey(): Promise<void> {
    const encrypted = this.store?.allNotes.some((note) => note.encrypted);
    if (!encrypted) return;
    const action = await vscode.window.showWarningMessage(
      'Folium Notes: encrypted notes exist but no encryption key is stored on this machine.',
      'Restore Key',
    );
    if (action === 'Restore Key') await vscode.commands.executeCommand('folium.restoreKey');
  }

  private async showRemoteNotice(): Promise<void> {
    const remote = vscode.env.remoteName;
    if (!remote) return;
    const flag = `folium.remoteNotice.${remote}`;
    if (this.context.globalState.get(flag)) return;
    await this.context.globalState.update(flag, true);
    const folder = this.store?.paths.privateFolder ?? '';
    if (remote === 'dev-container' || remote === 'attached-container') {
      const action = await vscode.window.showWarningMessage(
        `Folium Notes: private notes are stored inside this container (${folder}). Container rebuilds delete them.`,
        'Back Up Now',
        'Set Private Root',
      );
      if (action === 'Back Up Now') await vscode.commands.executeCommand('folium.backupPrivate');
      if (action === 'Set Private Root') await vscode.commands.executeCommand('folium.configurePrivateRoot');
      return;
    }
    void vscode.window.showInformationMessage(
      `Folium Notes: private notes live on the remote machine at ${folder}. Use "Folium: Back Up Private Notes" to keep a copy.`,
    );
  }

  private async onConfigurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
    const affectsStore = [...STORE_AFFECTING].some((key) =>
      event.affectsConfiguration(`foliumNotes.${key}`),
    );
    if (affectsStore) {
      await this.restart();
      return;
    }
    if (this.store) {
      this.store.settings = this.settings;
      void this.store.refresh();
    }
    this.refresh();
    this.statusBar.update();
  }

  scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.refresh();
    }, 120);
  }

  refresh(): void {
    this.onDidRefresh.fire();
    void this.updateContextKeys();
    this.notesTree.refresh();
    this.tagsTree.refresh();
    this.tasksTree.refresh();
    this.relatedTree.refresh();
    this.aiTree.refresh();
    this.commandsTree.refresh();
    this.statusBar.update();
  }

  async refreshFromDisk(): Promise<void> {
    await this.store?.refresh();
    this.refresh();
  }

  /** Context keys used by menus, the editor title and keybindings. */
  async updateContextKeys(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    let note: NoteFile | undefined;
    let encrypted = false;
    if (editor?.document.uri.scheme === SECURE_SCHEME) {
      note = this.store?.byPath(secureTargetPath(editor.document.uri));
      encrypted = true;
    } else if (editor?.document.uri.scheme === 'file') {
      note = this.store?.byPath(editor.document.uri.fsPath);
      encrypted = note?.encrypted ?? false;
    }
    const set = (key: string, value: unknown) =>
      vscode.commands.executeCommand('setContext', key, value);
    await Promise.all([
      set('folium.isNote', !!note),
      set('folium.promptNote', note?.kind === 'prompt'),
      set('folium.followUpNote', note?.kind === 'followup'),
      set('folium.noteScope', note?.scope ?? ''),
      set('folium.noteEncrypted', encrypted),
      set('folium.noteSensitive', note?.sensitive === true),
    ]);
  }

  async openNote(note: NoteFile, options: { preserveFocus?: boolean; preview?: boolean } = {}): Promise<void> {
    const uri = note.encrypted ? secureUri(note.absPath) : vscode.Uri.file(note.absPath);
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: options.preview ?? false,
        preserveFocus: options.preserveFocus ?? false,
      });
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Folium Notes: could not open ${note.title}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async revealActiveNote(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.store) return;
    const note = this.store.byPath(editor.document.uri.fsPath);
    if (!note) return;
    await this.notesTree.revealNote(note);
  }

  log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private disposeStore(): void {
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
    this.branchWatcher?.dispose();
    this.branchWatcher = undefined;
    this.storeChangeSubscription?.dispose();
    this.storeChangeSubscription = undefined;
  }

  dispose(): void {
    this.disposeStore();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
    for (const view of this.treeViews) view.dispose();
    this.statusBar.dispose();
    this.output.dispose();
  }
}

export function readSettings(): FoliumSettings {
  const config = vscode.workspace.getConfiguration('foliumNotes');
  const get = <T>(key: string, fallback: T): T => config.get<T>(key) ?? fallback;
  const settings = mergeSettings({
    sharedFolder: get('sharedFolder', '.notes'),
    privateRoot: get('privateRoot', '~/FoliumNotes'),
    privateProjectKey: get('privateProjectKey', ''),
    defaultScope: get('defaultScope', 'ask'),
    fileNamePattern: get('fileNamePattern', '{date}-{slug}'),
    renameFileOnTitleChange: get('renameFileOnTitleChange', true),
    inlineTags: get('inlineTags', true),
    shareColors: get('shareColors', false),
    defaultTemplate: get('defaultTemplate', ''),
    confirmDelete: get('confirmDelete', true),
    trashRetentionDays: get('trashRetentionDays', 30),
    defaultSort: get('defaultSort', 'updated'),
    defaultOrder: get('defaultOrder', 'desc'),
    defaultGroupBy: get('defaultGroupBy', 'scope'),
    treeDescription: get('treeDescription', true),
    autoReveal: get('autoReveal', false),
    statusBar: get('statusBar', true),
    codeLens: get('codeLens', true),
    gutterIcons: get('gutterIcons', true),
    linkDiagnostics: get('linkDiagnostics', true),
    updateLinksOnRename: get('updateLinksOnRename', true),
    branchNotes: {
      onBranchSwitch: get('branchNotes.onBranchSwitch', 'notify'),
      scope: get('branchNotes.scope', 'shared'),
      ignored: get('branchNotes.ignored', []),
    },
    tasks: {
      showCheckMarks: get('tasks.showCheckMarks', true),
      statusBar: get('tasks.statusBar', true),
    },
    encryptSensitiveNotes: get('encryptSensitiveNotes', false),
    prompts: {
      defaultTarget: get('prompts.defaultTarget', 'copilot'),
      submit: get('prompts.submit', false),
      customCommand: get('prompts.customCommand', ''),
      showInNotes: get('prompts.showInNotes', true),
    },
    followUps: { archiveWhenSent: get('followUps.archiveWhenSent', true) },
    issues: {
      provider: get('issues.provider', ''),
      githubApiUrl: get('issues.githubApiUrl', 'https://api.github.com'),
      gitlabUrl: get('issues.gitlabUrl', ''),
      jiraUrl: get('issues.jira.url', ''),
      jiraProjectKey: get('issues.jira.projectKey', ''),
      jiraIssueType: get('issues.jira.issueType', 'Task'),
      tagsAsLabels: get('issues.tagsAsLabels', true),
      permalinks: get('issues.permalinks', true),
    },
    joplin: { url: get('joplin.url', 'http://localhost:41184'), notebook: get('joplin.notebook', '') },
  });
  if (!vscode.workspace.isTrusted) {
    // Untrusted workspaces: ignore project settings that could redirect network calls.
    settings.issues = { ...DEFAULT_SETTINGS.issues, provider: mergedIssuesProvider(settings) };
    settings.joplin = { ...DEFAULT_SETTINGS.joplin };
    settings.prompts.customCommand = '';
  }
  return settings;
}

function mergedIssuesProvider(settings: FoliumSettings): FoliumSettings['issues']['provider'] {
  const provider = settings.issues.provider;
  return provider === 'github' || provider === 'gitlab' || provider === 'jira' ? provider : '';
}

export function projectRelative(app: FoliumApp, absPath: string): string {
  const root = app.projectRoot();
  return root ? path.relative(root, absPath).split(path.sep).join('/') : absPath;
}
