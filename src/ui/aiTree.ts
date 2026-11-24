/** AI view: prompt and follow-up notes plus the AI actions. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import type { NoteFile } from '../store/store';

export type AiNode =
  | { kind: 'section'; id: 'prompts' | 'followups' | 'actions'; label: string; count?: number }
  | { kind: 'note'; key: string; label: string; detail?: string }
  | { kind: 'action'; id: string; label: string; description?: string; command: string }
  | { kind: 'message'; label: string };

const ACTIONS: Array<Extract<AiNode, { kind: 'action' }>> = [
  {
    kind: 'action',
    id: 'new-prompt',
    label: 'New Prompt Note',
    description: 'template with selection, file and language context',
    command: 'folium.newPromptNote',
  },
  {
    kind: 'action',
    id: 'connect',
    label: 'Connect AI Tools',
    description: 'Copilot, Cline, Roo, Kilo, MCP server',
    command: 'folium.connectAITools',
  },
  {
    kind: 'action',
    id: 'follow-up',
    label: 'Capture Follow-up from Clipboard',
    description: 'save questions asked by the AI',
    command: 'folium.captureFollowUp',
  },
];

export class AiTreeProvider implements vscode.TreeDataProvider<AiNode> {
  private readonly changes = new vscode.EventEmitter<AiNode | undefined>();
  readonly onDidChangeTreeData = this.changes.event;

  constructor(private readonly app: FoliumApp) {}

  refresh(): void {
    this.changes.fire(undefined);
  }

  private notes(kind: string): NoteFile[] {
    const notes = this.app.store?.allNotes ?? [];
    return notes
      .filter((note) => !note.archived && note.kind === kind)
      .sort((a, b) => b.updated.getTime() - a.updated.getTime());
  }

  getChildren(node?: AiNode): AiNode[] {
    if (!this.app.store) return [{ kind: 'message', label: 'Open a folder to use AI features' }];
    if (!node) {
      const prompts = this.notes('prompt');
      const followUps = this.notes('followup');
      const out: AiNode[] = [];
      if (prompts.length > 0) {
        out.push({ kind: 'section', id: 'prompts', label: 'Prompt notes', count: prompts.length });
      }
      if (followUps.length > 0) {
        out.push({ kind: 'section', id: 'followups', label: 'Follow-ups', count: followUps.length });
      }
      out.push({ kind: 'section', id: 'actions', label: 'Actions' });
      return out;
    }
    if (node.kind === 'section') {
      if (node.id === 'actions') return ACTIONS;
      const kind = node.id === 'prompts' ? 'prompt' : 'followup';
      return this.notes(kind).map((note) => ({
        kind: 'note' as const,
        key: note.key,
        label: note.title,
        detail: `${note.scope} · ${note.updated.toISOString().slice(0, 10)}`,
      }));
    }
    return [];
  }

  getTreeItem(node: AiNode): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon('info');
      item.contextValue = 'folium.message';
      return item;
    }
    if (node.kind === 'section') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = node.count === undefined ? undefined : String(node.count);
      item.iconPath = new vscode.ThemeIcon(
        node.id === 'actions' ? 'sparkle' : node.id === 'prompts' ? 'comment-discussion' : 'reply',
      );
      item.contextValue = 'folium.aiSection';
      item.id = `ai:${node.id}`;
      return item;
    }
    if (node.kind === 'action') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.description = node.description;
      item.iconPath = new vscode.ThemeIcon(node.id === 'connect' ? 'plug' : node.id === 'follow-up' ? 'comment-add' : 'add');
      item.contextValue = 'folium.aiAction';
      item.command = { command: node.command, title: node.label };
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.detail;
    item.iconPath = new vscode.ThemeIcon('comment-discussion');
    item.contextValue = 'folium.aiNote';
    item.id = `ai:note:${node.key}`;
    item.command = { command: 'folium.openNote', title: 'Open Note', arguments: [node.key] };
    return item;
  }
}