/** QuickPick live search with title boost, snippets and "create a note". */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import { recentNotes } from '../core/search';

interface SearchItem extends vscode.QuickPickItem {
  action: 'open' | 'create' | 'recent';
  key?: string;
  title?: string;
}

export async function showSearch(app: FoliumApp, initialQuery = ''): Promise<void> {
  const store = app.store;
  if (!store) {
    void vscode.window.showWarningMessage('Folium Notes: open a folder first.');
    return;
  }
  const quickPick = vscode.window.createQuickPick<SearchItem>();
  quickPick.title = 'Search Notes';
  quickPick.placeholder = 'Search titles, tags and text (#tag filters). Enter creates a note.';
  quickPick.matchOnDescription = false;
  quickPick.value = initialQuery;
  let timer: NodeJS.Timeout | undefined;

  const update = (query: string): void => {
    const trimmed = query.trim();
    const items: SearchItem[] = [];
    if (!trimmed) {
      const recent = recentNotes(
        store.allNotes.map((note) => ({
          key: note.key,
          title: note.title,
          tags: note.tags,
          body: note.body,
          updated: note.updated.getTime(),
        })),
        8,
      );
      for (const doc of recent) {
        items.push({
          label: `$(history) ${doc.title}`,
          description: 'recent',
          action: 'recent',
          key: doc.key,
        });
      }
      quickPick.items = items;
      return;
    }
    const hits = store.search(trimmed, 50);
    for (const hit of hits) {
      const note = store.byKey(hit.key);
      if (!note) continue;
      items.push({
        label: note.title,
        description: `${note.scope}${note.tags.length ? ` · ${note.tags.join(' ')}` : ''}`,
        detail: hit.snippet?.text,
        action: 'open',
        key: note.key,
      });
    }
    const exact = store.allNotes.some((note) => note.title.toLowerCase() === trimmed.toLowerCase());
    if (!exact) {
      items.push({
        label: `$(add) Create note: ${trimmed}`,
        description: 'new note with this title',
        action: 'create',
        title: trimmed,
      });
    }
    quickPick.items = items;
  };

  quickPick.onDidChangeValue((value) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => update(value), 80);
  });
  quickPick.onDidAccept(async () => {
    const picked = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
    quickPick.hide();
    if (!picked) return;
    if (picked.action === 'create' && picked.title) {
      await vscode.commands.executeCommand('folium.newNoteWithTitle', picked.title);
      return;
    }
    if (picked.key) {
      const note = store.byKey(picked.key);
      if (note) await app.openNote(note);
    }
  });
  quickPick.onDidHide(() => {
    if (timer) clearTimeout(timer);
    quickPick.dispose();
  });
  update(initialQuery);
  quickPick.show();
}
