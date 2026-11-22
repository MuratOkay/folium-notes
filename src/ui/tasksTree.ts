/** Tasks view: every checkbox in notes, grouped by note or due date. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import { dueBucket, DUE_BUCKET_LABELS, sortTasks, type DueBucket, type TaskItem } from '../core/tasks';

export type TasksNode =
  | { kind: 'group'; id: string; label: string; tasks: TaskItem[] }
  | { kind: 'task'; task: TaskItem }
  | { kind: 'message'; label: string };

export class TasksTreeProvider implements vscode.TreeDataProvider<TasksNode> {
  private readonly changes = new vscode.EventEmitter<TasksNode | undefined>();
  readonly onDidChangeTreeData = this.changes.event;
  private view?: vscode.TreeView<TasksNode>;

  constructor(private readonly app: FoliumApp) {}

  attach(view: vscode.TreeView<TasksNode>): void {
    this.view = view;
    view.onDidChangeCheckboxState(async (event) => {
      for (const [node, state] of event.items) {
        if (node.kind !== 'task') continue;
        await this.setDone(node.task, state === vscode.TreeItemCheckboxState.Checked);
      }
    });
  }

  refresh(): void {
    this.changes.fire(undefined);
  }

  private tasks(): TaskItem[] {
    const store = this.app.store;
    if (!store) return [];
    const state = this.app.viewStateStore.get();
    const tasks = sortTasks(store.tasks).filter((task) => state.showDoneTasks || !task.done);
    return tasks;
  }

  getChildren(node?: TasksNode): TasksNode[] {
    if (!this.app.store) return [{ kind: 'message', label: 'Open a folder to see tasks' }];
    const state = this.app.viewStateStore.get();
    const tasks = this.tasks();
    if (!node) {
      if (tasks.length === 0) return [{ kind: 'message', label: 'No open tasks' }];
      if (state.tasksGroupBy === 'note') {
        const byNote = new Map<string, TaskItem[]>();
        for (const task of tasks) {
          const list = byNote.get(task.noteKey) ?? [];
          list.push(task);
          byNote.set(task.noteKey, list);
        }
        return [...byNote.entries()].map(([key, list]) => ({
          kind: 'group' as const,
          id: key,
          label: list[0].noteTitle,
          tasks: list,
        }));
      }
      const buckets: DueBucket[] = ['overdue', 'today', 'next7', 'later', 'none'];
      return buckets
        .map((bucket) => ({
          kind: 'group' as const,
          id: bucket,
          label: DUE_BUCKET_LABELS[bucket],
          tasks: tasks.filter((task) => dueBucket(task) === bucket),
        }))
        .filter((group) => group.tasks.length > 0);
    }
    if (node.kind === 'group') return node.tasks.map((task) => ({ kind: 'task' as const, task }));
    return [];
  }

  getTreeItem(node: TasksNode): vscode.TreeItem {
    if (node.kind === 'message') return new vscode.TreeItem(node.label);
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(node.tasks.length);
      item.iconPath = new vscode.ThemeIcon(node.id === 'overdue' ? 'warning' : 'checklist');
      item.contextValue = 'folium.taskGroup';
      if (node.id === 'overdue') item.iconPath = new vscode.ThemeIcon('error');
      return item;
    }
    const task = node.task;
    const item = new vscode.TreeItem(task.text || '(empty task)', vscode.TreeItemCollapsibleState.None);
    item.id = `${task.noteKey}:${task.line}`;
    item.description = [task.due ? `due ${task.due}` : undefined, task.noteTitle]
      .filter(Boolean)
      .join(' · ');
    item.checkboxState = task.done
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    item.contextValue = 'folium.task';
    item.tooltip = `${task.noteTitle} (line ${task.line})${task.due ? `\nDue: ${task.due}` : ''}`;
    item.iconPath = new vscode.ThemeIcon(task.done ? 'pass-filled' : 'circle-large-outline');
    item.command = { command: 'folium.openTask', title: 'Open Task', arguments: [task] };
    item.accessibilityInformation = {
      label: `${task.done ? 'Done' : 'Open'} task: ${task.text}${task.due ? `, due ${task.due}` : ''}, in ${task.noteTitle}`,
    };
    return item;
  }

  async setDone(task: TaskItem, done: boolean): Promise<void> {
    const store = this.app.store;
    if (!store) return;
    const note = store.byKey(task.noteKey);
    if (!note) return;
    const { setTaskDone } = await import('../core/tasks');
    const raw = setTaskDone(note.raw, task.offset, done);
    await store.writeRaw(note, raw);
    this.app.refresh();
  }
}
