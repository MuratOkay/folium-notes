/** Import, export, Joplin sync and issue creation. */

import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FoliumApp } from '../app';
import { activeNote, confirmDanger, pickNote, pickScope, requireTrusted } from './util';
import type { NoteFile } from '../store/store';
import { previewImport, type ImportFile, type ImportKind } from '../core/importers';
import { exportNotes, exportTargetWarning } from '../core/exporters';
import { JoplinApi } from '../core/joplin';
import {
  buildIssueRequest,
  canPublishIssue,
  codePermalink,
  isTrustedIssueHost,
  issueBodyFor,
  issueLabelsFor,
  issueTitleFor,
  repoFromProjectKey,
  type IssueSettings,
} from '../core/issues';
import { setFrontMatterField } from '../core/frontmatter';
import { codeLinkAnchor, resolveCodeLink, type CodeFileProvider } from '../core/codeLinks';

const exec = promisify(execFile);

async function collectFiles(root: string, dir: string, out: ImportFile[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(root, abs, out);
    else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      out.push({
        path: path.relative(root, abs).split(path.sep).join('/'),
        content: await fs.readFile(abs, 'utf8'),
      });
    }
  }
}

export async function importNotes(app: FoliumApp): Promise<void> {
  const store = app.store;
  const service = app.service;
  if (!store || !service) return;
  const kindPick = await vscode.window.showQuickPick(
    [
      { label: 'Markdown folder (Obsidian)', description: 'notes with front matter, folders become tags', value: 'markdown' as ImportKind },
      { label: 'Joplin export (.jex)', description: 'notebooks, tags, links and to-dos', value: 'jex' as ImportKind },
      { label: 'Evernote export (.enex)', description: 'ENML converted to Markdown, checkboxes become tasks', value: 'enex' as ImportKind },
    ],
    { placeHolder: 'Import from' },
  );
  if (!kindPick) return;
  const picked = await vscode.window.showOpenDialog({
    title: kindPick.value === 'markdown' ? 'Pick a Markdown folder' : 'Pick an export file',
    canSelectFiles: kindPick.value !== 'markdown',
    canSelectFolders: kindPick.value === 'markdown',
    canSelectMany: kindPick.value !== 'markdown',
    openLabel: 'Import',
    filters: kindPick.value === 'jex' ? { Joplin: ['jex'] } : kindPick.value === 'enex' ? { Evernote: ['enex'] } : undefined,
  });
  if (!picked || picked.length === 0) return;
  const files: ImportFile[] = [];
  for (const uri of picked) {
    const stat = await fs.stat(uri.fsPath);
    if (stat.isDirectory()) await collectFiles(uri.fsPath, uri.fsPath, files);
    else files.push({ path: path.basename(uri.fsPath), content: await fs.readFile(uri.fsPath) });
  }
  if (files.length === 0) {
    void vscode.window.showInformationMessage('Folium: nothing to import.');
    return;
  }
  const preview = previewImport(kindPick.value, files, service.importedValues());
  const ok = await vscode.window.showInformationMessage(
    `Import ${preview.total} note(s)? ${preview.duplicates} duplicate(s) will be skipped. ${preview.tags.length} tag(s).`,
    { modal: true },
    'Import',
  );
  if (ok !== 'Import') return;
  const scope = await pickScope(app, { placeHolder: 'Import into shared or private notes?' });
  if (!scope) return;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Folium: importing notes', cancellable: true },
    async (progress) => {
      let done = 0;
      for (const note of preview.notes) {
        await service.importNote(note, scope);
        done++;
        progress.report({ message: `${done}/${preview.notes.length}`, increment: 100 / preview.notes.length });
      }
    },
  );
  app.refresh();
  void vscode.window.showInformationMessage(
    `Folium: imported ${preview.total} note(s), skipped ${preview.duplicates} duplicate(s).`,
  );
}

export async function exportNotesCommand(app: FoliumApp): Promise<void> {
  const store = app.store;
  if (!store) return;
  const format = await vscode.window.showQuickPick(
    [
      { label: 'Markdown (Obsidian)', description: 'keeps [[wiki links]]', value: 'markdown' as const },
      { label: 'Markdown (Joplin)', description: 'front matter with title/created/updated/tags, relative links', value: 'joplin' as const },
    ],
    { placeHolder: 'Export format' },
  );
  if (!format) return;
  const scope = await vscode.window.showQuickPick(
    [
      { label: 'Both', value: 'both' as const },
      { label: 'Shared only', value: 'shared' as const },
      { label: 'Private only', value: 'private' as const },
    ],
    { placeHolder: 'Which notes?' },
  );
  if (!scope) return;
  const target = await vscode.window.showOpenDialog({
    title: 'Export notes into a folder',
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Export here',
  });
  if (!target || target.length === 0) return;
  const dir = target[0].fsPath;
  const root = app.projectRoot();
  if (root) {
    const warning = exportTargetWarning(dir, root);
    if (warning) {
      const ok = await confirmDanger(warning, 'Export Anyway');
      if (!ok) return;
    }
  }
  const result = exportNotes(store.allNotes, { format: format.value, scope: scope.value });
  await fs.mkdir(dir, { recursive: true });
  for (const file of result.files) {
    let target = path.join(dir, file.path);
    let counter = 2;
    while (await fs.stat(target).catch(() => undefined)) {
      const base = file.path.replace(/\.md$/i, '');
      target = path.join(dir, `${base}-${counter}.md`);
      counter++;
    }
    await fs.writeFile(target, file.content, 'utf8');
  }
  void vscode.window.showInformationMessage(
    `Folium: exported ${result.files.length} note(s) to ${dir}. ${result.skipped.length} sensitive/encrypted note(s) were skipped.`,
  );
}

export async function sendToJoplin(app: FoliumApp, given?: NoteFile): Promise<void> {
  const store = app.store;
  if (!store) return;
  const settings = app.settings.joplin;
  const api = new JoplinApi({ url: settings.url });
  if (!(await api.ping())) {
    const action = await vscode.window.showWarningMessage(
      `Folium: cannot reach Joplin at ${settings.url}. Enable the Web Clipper service in Joplin and check FoliumNotes.joplin.url.`,
      'Open Settings',
    );
    if (action) await vscode.commands.executeCommand('workbench.action.openSettings', 'foliumNotes.joplin');
    return;
  }
  const notebook = settings.notebook || store.paths.folderName;
  const notes = (given ? [given] : store.allNotes).filter((note) => !note.sensitive && !note.encrypted);
  if (notes.length === 0) {
    void vscode.window.showInformationMessage(
      given ? 'Folium: this note is sensitive or encrypted and is never sent.' : 'Folium: there are no non-sensitive notes to send.',
    );
    return;
  }
  const ok = await confirmDanger(
    given
      ? `Send "${given.title}" to Joplin notebook "${notebook}"?`
      : `Send ${notes.length} note(s) to Joplin notebook "${notebook}"? Sensitive notes are never sent.`,
    'Send to Joplin',
  );
  if (!ok) return;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Folium: sending notes to Joplin', cancellable: true },
    async (progress) => {
      const notebookId = await api.ensureNotebook(notebook);
      let done = 0;
      for (const note of notes) {
        const existing = app.store?.projectState.notes[note.key]?.joplinId;
        const payload = { title: note.title, body: note.body, sourceUrl: `folium://${note.key}` };
        try {
          if (existing) {
            await api.updateNote(existing, payload);
          } else {
            const id = await api.createNote({ ...payload, parentId: notebookId });
            await store.setJoplinId(note, id);
          }
        } catch (error) {
          app.log(`joplin: ${note.title}: ${error instanceof Error ? error.message : String(error)}`);
        }
        done++;
        progress.report({ message: `${done}/${notes.length}`, increment: 100 / notes.length });
      }
    },
  );
  app.refresh();
  void vscode.window.showInformationMessage(`Folium: ${notes.length} note(s) sent to Joplin.`);
}

async function getToken(app: FoliumApp, key: string, label: string): Promise<string | undefined> {
  const stored = await app.context.secrets.get(key);
  if (stored) return stored;
  const value = await vscode.window.showInputBox({
    title: `Folium: ${label} token`,
    prompt: `Paste a ${label} token. It is stored in the editor secret storage.`,
    password: true,
    ignoreFocusOut: true,
  });
  if (!value) return undefined;
  await app.context.secrets.store(key, value.trim());
  return value.trim();
}

async function githubSession(): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false, silent: true });
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

async function repoCommit(app: FoliumApp): Promise<string | undefined> {
  const root = app.git.repoRoot ?? app.projectRoot();
  if (!root) return undefined;
  try {
    const { stdout } = await exec('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 4000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function repoRelative(app: FoliumApp, absPath: string): string | undefined {
  const root = app.git.repoRoot ?? app.projectRoot();
  if (!root) return undefined;
  const rel = path.relative(root, absPath).split(path.sep).join('/');
  return rel.startsWith('..') ? undefined : rel;
}

export async function createIssue(app: FoliumApp, given?: NoteFile): Promise<void> {
  const store = app.store;
  if (!store) return;
  if (!requireTrusted('creating issues from notes')) return;
  const note = given ?? activeNote(app) ?? (await pickNote(app, { placeHolder: 'Create an issue from which note?' }));
  if (!note) return;
  if (!canPublishIssue(note)) {
    void vscode.window.showWarningMessage('Folium: sensitive, encrypted and archived notes cannot be published as issues.');
    return;
  }
  const settings = app.settings.issues;
  if (!settings.provider) {
    const action = await vscode.window.showInformationMessage(
      'Folium: choose an issue provider in settings first.',
      'Open Settings',
    );
    if (action) await vscode.commands.executeCommand('workbench.action.openSettings', 'foliumNotes.issues');
    return;
  }
  const repo = repoFromProjectKey(store.paths.projectKey);
  const commit = settings.permalinks ? await repoCommit(app) : undefined;
  const provider = settings.provider;
  const permalinks: Array<{ display: string; url: string }> = [];
  if (settings.permalinks && commit && repo) {
    const codeProvider: CodeFileProvider = {
      candidates: (linkPath) => {
        if (/^file:\/\//i.test(linkPath)) {
          try {
            return [vscode.Uri.parse(linkPath).fsPath];
          } catch {
            return [];
          }
        }
        return [path.resolve(path.dirname(note.absPath), linkPath), ...(app.projectRoot() ? [path.resolve(app.projectRoot()!, linkPath)] : [])];
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
    for (const link of note.meta.code) {
      const resolution = resolveCodeLink(link, codeProvider);
      if (!resolution.path) continue;
      const relative = repoRelative(app, resolution.path);
      if (!relative) continue;
      const url = codePermalink(
        repo,
        commit,
        relative,
        `${resolution.startLine}-${resolution.endLine}`,
        provider === 'jira' ? 'github' : provider,
      );
      if (!url) continue;
      permalinks.push({ display: codeLinkAnchor(link.path, link.lines), url });
    }
  }
  let token = '';
  if (provider === 'github') {
    token = (await getToken(app, 'folium.githubToken', 'GitHub')) ?? '';
    const apiHost = new URL(settings.githubApiUrl || 'https://api.github.com').hostname;
    if (!token && apiHost === 'api.github.com') token = (await githubSession()) ?? '';
    if (!token) {
      void vscode.window.showWarningMessage('Folium: a GitHub token is required to create issues.');
      return;
    }
  } else if (provider === 'gitlab') {
    token = (await getToken(app, 'folium.gitlabToken', 'GitLab')) ?? '';
    if (!token) return;
  } else {
    token = (await getToken(app, 'folium.jiraToken', 'Jira')) ?? '';
    if (!token) return;
  }
  const issueSettings: IssueSettings = {
    provider,
    githubToken: provider === 'github' ? token : undefined,
    githubApiUrl: settings.githubApiUrl,
    gitlabToken: provider === 'gitlab' ? token : undefined,
    gitlabUrl: settings.gitlabUrl,
    jira: {
      url: settings.jiraUrl,
      email: vscode.workspace.getConfiguration('foliumNotes').get<string>('issues.jira.email', ''),
      token: provider === 'jira' ? token : undefined,
      projectKey: settings.jiraProjectKey,
      issueType: settings.jiraIssueType,
    },
    tagsAsLabels: settings.tagsAsLabels,
    permalinks: settings.permalinks,
  };
  const draft = {
    title: issueTitleFor(note),
    body: issueBodyFor(note, { permalinks }),
    labels: issueLabelsFor(note, issueSettings),
  };
  let request;
  try {
    request = buildIssueRequest(issueSettings, draft, repo);
  } catch (error) {
    void vscode.window.showErrorMessage(`Folium: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!isTrustedIssueHost(request.host)) {
    const ok = await confirmDanger(
      `Folium will send the token and note content to ${request.host}. You have not confirmed this host before. Continue?`,
      'Send',
    );
    if (!ok) return;
    await app.context.globalState.update(`folium.confirmedIssueHost.${request.host}`, true);
  }
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${text.slice(0, 300)}`);
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const issueUrl =
      (typeof parsed.html_url === 'string' && parsed.html_url) ||
      (typeof parsed.web_url === 'string' && parsed.web_url) ||
      (typeof parsed.key === 'string'
        ? `${(settings.jiraUrl || '').replace(/\/+$/, '')}/browse/${parsed.key}`
        : undefined) ||
      (typeof parsed.key === 'string' ? String(parsed.key) : undefined);
    if (issueUrl) {
      const raw = setFrontMatterField(note.raw, 'issue', issueUrl);
      await store.writeRaw(note, raw);
      app.refresh();
    }
    void vscode.window.showInformationMessage(`Folium: issue created${issueUrl ? ` (${issueUrl})` : ''}.`, 'Open').then(
      async (choice) => {
        if (choice === 'Open' && issueUrl) await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
      },
    );
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Folium: issue creation failed (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}
