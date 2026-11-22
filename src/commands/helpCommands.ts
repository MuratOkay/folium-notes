/** Help, refresh and diagnostics commands. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';

export async function showGettingStarted(app: FoliumApp): Promise<void> {
  const walkthrough = `${app.context.extension.id}#folium.gettingStarted`;
  try {
    await vscode.commands.executeCommand('workbench.action.openWalkthrough', walkthrough, false);
    return;
  } catch {
    /* fall back to the README */
  }
  const readme = vscode.Uri.joinPath(app.context.extensionUri, 'README.md');
  try {
    const document = await vscode.workspace.openTextDocument(readme);
    await vscode.window.showTextDocument(document, { preview: true });
  } catch {
    void vscode.window.showInformationMessage('Folium Notes: see the extension README for a quick start.');
  }
}

export async function refreshNotes(app: FoliumApp): Promise<void> {
  await app.store?.refresh();
  await app.store?.reloadTemplates();
  app.refresh();
  const count = app.store?.allNotes.length ?? 0;
  void vscode.window.setStatusBarMessage(`Folium: ${count} note(s)`, 2500);
}

export async function showLog(app: FoliumApp): Promise<void> {
  app.output.show(true);
  if (app.store) {
    app.log(`project key: ${app.store.paths.projectKey}`);
    app.log(`shared folder: ${app.store.paths.sharedRoot}`);
    app.log(`private folder: ${app.store.paths.privateFolder}`);
    app.log(`notes: ${app.store.allNotes.length}, trash: ${app.store.trashEntries.length}`);
    for (const error of app.store.errors) app.log(`error: ${error}`);
  } else {
    app.log('no workspace folder is open');
  }
}

export async function showFiltersInfo(app: FoliumApp): Promise<void> {
  const state = app.viewStateStore.get();
  const summary = (await import('../core/views')).filterSummary(state.filters);
  void vscode.window.showInformationMessage(
    summary ? `Folium filters — ${summary}` : 'Folium: no filters are active.',
    'Clear Filters',
  ).then(async (choice) => {
    if (choice === 'Clear Filters') await vscode.commands.executeCommand('folium.clearFilters');
  });
}
