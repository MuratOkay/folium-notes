/** Status bar: active note scope/actions, note count, due task bell. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import { isOverdue, isDueToday } from '../core/tasks';

export class StatusBarController {
  private readonly noteItem: vscode.StatusBarItem;
  private readonly taskItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly app: FoliumApp) {
    this.noteItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
    this.noteItem.command = 'folium.statusMenu';
    this.taskItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 89);
    this.taskItem.command = 'folium.showTasks';
    this.disposables.push(this.noteItem, this.taskItem);
  }

  update(): void {
    const settings = this.app.settings;
    const store = this.app.store;
    if (!settings.statusBar || !store) {
      this.noteItem.hide();
      this.taskItem.hide();
      return;
    }
    const editor = vscode.window.activeTextEditor;
    const activePath = editor?.document.uri.fsPath;
    const active = activePath ? store.byPath(activePath) : undefined;
    if (active) {
      this.noteItem.text = `$(note) ${active.scope === 'shared' ? 'Shared' : 'Private'}`;
      this.noteItem.tooltip = `${active.title}\n${active.relPath}\nClick for note actions`;
    } else {
      const count = store.allNotes.length;
      this.noteItem.text = `$(book) Folium ${count}`;
      this.noteItem.tooltip = `${count} note(s) · click to search`;
    }
    this.noteItem.command = active ? 'folium.statusMenu' : 'folium.search';
    this.noteItem.show();
    const tasks = settings.tasks.statusBar ? store.tasks.filter((task) => !task.done) : [];
    const due = tasks.filter((task) => isOverdue(task) || isDueToday(task)).length;
    if (due > 0) {
      const overdue = tasks.filter((task) => isOverdue(task)).length;
      this.taskItem.text = `$(bell) ${due} due`;
      this.taskItem.tooltip = `${overdue} overdue, ${due - overdue} due today`;
      this.taskItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      this.taskItem.show();
    } else {
      this.taskItem.hide();
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }
}
