/** Related view: links, backlinks, code links and issues for the active editor. */

import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import type { FoliumApp } from '../app';
import { parseWikiLinks, resolveLink, type WikiLink } from '../core/links';
import { codeLinkAnchor, resolveCodeLink, STATUS_LABELS, type CodeLinkResolution, type CodeFileProvider } from '../core/codeLinks';
import type { NoteFile } from '../store/store';
import path from 'node:path';

export type RelatedNode =
  | { kind: 'section'; id: string; label: string; count?: number }
  | { kind: 'note'; key: string; label: string; detail?: string }
  | { kind: 'code'; noteKey: string; linkIndex: number; label: string; detail: string; resolution: CodeLinkResolution }
  | { kind: 'issue'; label: string; detail?: string }
  | { kind: 'message'; label: string };

const SECTION_LINKS = 'links-out';
const SECTION_BACKLINKS = 'links-in';
const SECTION_CODE = 'code';
const SECTION_NOTES = 'notes-file';
const SECTION_ISSUE = 'issue';

export class RelatedTreeProvider implements vscode.TreeDataProvider<RelatedNode> {
  private readonly changes = new vscode.EventEmitter<RelatedNode | undefined>();
  readonly onDidChangeTreeData = this.changes.event;

  constructor(private readonly app: FoliumApp) {}

  refresh(): void {
    this.changes.fire(undefined);
  }

  private active(): { note?: NoteFile; filePath?: string } {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return {};
    const fsPath = editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    if (!fsPath) return {};
    const note = this.app.store?.byPath(fsPath);
    return note ? { note, filePath: fsPath } : { filePath: fsPath };
  }

  private codeProvider(): CodeFileProvider {
    return {
      candidates: (linkPath) => {
        const note = this.active().note;
        const root = this.app.projectRoot();
        const out: string[] = [];
        if (/^file:\/\//i.test(linkPath)) {
          try {
            out.push(vscode.Uri.parse(linkPath).fsPath);
          } catch {
            /* ignore */
          }
          return out;
        }
        if (path.isAbsolute(linkPath)) {
          out.push(linkPath);
          return out;
        }
        if (note) out.push(path.resolve(path.dirname(note.absPath), linkPath));
        if (root) out.push(path.resolve(root, linkPath));
        return out;
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

  getChildren(node?: RelatedNode): RelatedNode[] {
    const store = this.app.store;
    if (!store) return [{ kind: 'message', label: 'Open a folder to see related notes' }];
    const { note, filePath } = this.active();
    if (!node) {
      if (note) {
        const out: RelatedNode[] = [];
        const outgoing = parseWikiLinks(note.body).filter((link) => link.target);
        if (outgoing.length > 0) out.push({ kind: 'section', id: SECTION_LINKS, label: 'Links to', count: outgoing.length });
        const backlinks = store.allNotes.filter((other) => other.key !== note.key && parseWikiLinks(other.body).some((link) => this.linkTargets(link, note)));
        if (backlinks.length > 0) out.push({ kind: 'section', id: SECTION_BACKLINKS, label: 'Linked from', count: backlinks.length });
        if (note.meta.code.length > 0) out.push({ kind: 'section', id: SECTION_CODE, label: 'Code links', count: note.meta.code.length });
        if (note.issue) out.push({ kind: 'section', id: SECTION_ISSUE, label: 'Issue' });
        if (out.length === 0) out.push({ kind: 'message', label: 'No related notes yet' });
        return out;
      }
      if (filePath) {
        const notes = store.notesForCodeFile(filePath);
        const branch = store.allNotes.find((candidate) => candidate.meta.branch && candidate.meta.branch === this.app.git.branch);
        const out: RelatedNode[] = [];
        if (notes.length > 0) out.push({ kind: 'section', id: SECTION_NOTES, label: 'Notes for this file', count: notes.length });
        if (branch) out.push({ kind: 'section', id: 'branch', label: 'Branch note', count: 1 });
        if (out.length === 0) out.push({ kind: 'message', label: 'No notes mention this file' });
        return out;
      }
      return [{ kind: 'message', label: 'Open a note or a code file' }];
    }
    if (node.kind === 'section') {
      if (node.id === SECTION_LINKS && note) {
        return parseWikiLinks(note.body)
          .filter((link) => link.target)
          .map((link) => {
            const target = resolveLink(link.target, store.linkIndex, note.scope)[0];
            return {
              kind: 'note' as const,
              key: target?.key ?? '',
              label: link.alias ?? link.target,
              detail: target ? target.scope : 'missing',
            };
          });
      }
      if (node.id === SECTION_BACKLINKS && note) {
        return store.allNotes
          .filter((other) => other.key !== note.key && parseWikiLinks(other.body).some((link) => this.linkTargets(link, note)))
          .map((other) => ({ kind: 'note' as const, key: other.key, label: other.title, detail: other.scope }));
      }
      if (node.id === SECTION_CODE && note) {
        return note.meta.code.map((link, index) => {
          const resolution = resolveCodeLink(link, this.codeProvider());
          return {
            kind: 'code' as const,
            noteKey: note.key,
            linkIndex: index,
            label: codeLinkAnchor(link.path, link.lines),
            detail: STATUS_LABELS[resolution.status],
            resolution,
          };
        });
      }
      if (node.id === SECTION_ISSUE && note) {
        return [{ kind: 'issue', label: note.issue ?? '', detail: 'issue' }];
      }
      if (node.id === SECTION_NOTES && filePath) {
        return store.notesForCodeFile(filePath).map((other) => ({
          kind: 'note' as const,
          key: other.key,
          label: other.title,
          detail: other.scope,
        }));
      }
      if (node.id === 'branch') {
        const branch = store.allNotes.find((candidate) => candidate.meta.branch && candidate.meta.branch === this.app.git.branch);
        return branch ? [{ kind: 'note', key: branch.key, label: branch.title, detail: 'branch' }] : [];
      }
    }
    return [];
  }

  private linkTargets(link: WikiLink, note: NoteFile): boolean {
    const lower = (value: string) => value.trim().toLowerCase();
    return (
      lower(link.target) === lower(note.title) ||
      lower(link.target) === lower(note.fileName.replace(/\.md$/i, '')) ||
      lower(link.target) === lower(note.relPath.replace(/\.md$/i, '')) ||
      (!!note.id && lower(link.target) === lower(note.id))
    );
  }

  getTreeItem(node: RelatedNode): vscode.TreeItem {
    switch (node.kind) {
      case 'section': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
        item.description = node.count === undefined ? undefined : String(node.count);
        item.iconPath = new vscode.ThemeIcon(
          node.id === SECTION_CODE ? 'symbol-file' : node.id.includes('links') ? 'link' : 'references',
        );
        item.contextValue = 'folium.relatedSection';
        return item;
      }
      case 'note': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.description = node.detail;
        item.iconPath = new vscode.ThemeIcon(node.detail === 'missing' ? 'warning' : 'note');
        item.contextValue = 'folium.relatedNote';
        if (node.key) {
          item.command = { command: 'folium.openNote', title: 'Open Note', arguments: [node.key] };
        } else {
          item.iconPath = new vscode.ThemeIcon('warning');
          item.tooltip = 'Missing note — use Quick Fix or create it';
        }
        return item;
      }
      case 'code': {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.description = node.detail;
        item.iconPath = new vscode.ThemeIcon(
          node.resolution.status === 'lost' ? 'warning' : node.resolution.status === 'exact' ? 'pass' : 'arrow-right',
        );
        item.contextValue = 'folium.relatedCode';
        item.tooltip = `${node.label}\n${node.detail}`;
        if (node.resolution.path) {
          item.command = {
            command: 'vscode.open',
            title: 'Open Code',
            arguments: [
              vscode.Uri.file(node.resolution.path),
              { selection: new vscode.Range(node.resolution.startLine - 1, 0, node.resolution.endLine - 1, 0) },
            ],
          };
        }
        return item;
      }
      case 'issue': {
        const item = new vscode.TreeItem(node.label || 'No issue linked');
        item.iconPath = new vscode.ThemeIcon('issues');
        item.contextValue = 'folium.relatedIssue';
        return item;
      }
      default:
        return new vscode.TreeItem(node.label);
    }
  }
}
