/** Commands view: terminal commands found in notes, ready to run. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import { extractTerminalCommands, type ExtractedCommand } from '../core/terminal';
import type { NoteFile } from '../store/store';

export type CommandsNode =
  | { kind: 'note'; key: string; label: string; commands: ExtractedCommand[] }
  | { kind: 'command'; noteKey: string; noteTitle: string; command: ExtractedCommand }
  | { kind: 'message'; label: string };

export class CommandsTreeProvider implements vscode.TreeDataProvider<CommandsNode> {
  private readonly changes = new vscode.EventEmitter<CommandsNode | undefined>();
  readonly onDidChangeTreeData = this.changes.event;

  constructor(private readonly app: FoliumApp) {}

  refresh(): void {
    this.changes.fire(undefined);
  }

  private notes(): Array<{ note: NoteFile; commands: ExtractedCommand[] }> {
    const notes = this.app.store?.allNotes ?? [];
    return notes
      .filter((note) => !note.archived)
      .map((note) => ({ note, commands: extractTerminalCommands(note.body) }))
      .filter((entry) => entry.commands.length > 0)
      .sort((a, b) => b.note.updated.getTime() - a.note.updated.getTime());
  }

  getChildren(node?: CommandsNode): CommandsNode[] {
    if (!this.app.store) return [{ kind: 'message', label: 'Open a folder to see terminal commands' }];
    if (!node) {
      const entries = this.notes();
      if (entries.length === 0) return [{ kind: 'message', label: 'No terminal commands in your notes' }];
      return entries.map(({ note, commands }) => ({
        kind: 'note' as const,
        key: note.key,
        label: note.title,
        commands,
      }));
    }
    if (node.kind === 'note') {
      return node.commands.map((command) => ({
        kind: 'command' as const,
        noteKey: node.key,
        noteTitle: node.label,
        command,
      }));
    }
    return [];
  }

  getTreeItem(node: CommandsNode): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label);
      item.iconPath = new vscode.ThemeIcon('terminal');
      item.contextValue = 'folium.message';
      return item;
    }
    if (node.kind === 'note') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(node.commands.length);
      item.iconPath = new vscode.ThemeIcon('terminal');
      item.contextValue = 'folium.commandGroup';
      item.id = `commands:note:${node.key}`;
      item.tooltip = `${node.commands.length} command(s)`;
      return item;
    }
    const item = new vscode.TreeItem(node.command.text, vscode.TreeItemCollapsibleState.None);
    item.description = node.noteTitle;
    item.iconPath = new vscode.ThemeIcon('play');
    item.contextValue = 'folium.terminalCommand';
    item.id = `commands:${node.noteKey}:${node.command.line}`;
    item.tooltip = `${node.noteTitle} · line ${node.command.line}\nClick to run in the integrated terminal`;
    item.command = { command: 'folium.runCommand', title: 'Run Command in Terminal', arguments: [node.command.text] };
    item.accessibilityInformation = { label: `Command: ${node.command.text}, from ${node.noteTitle}` };
    return item;
  }
}