/** Branch note command. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import { branchNoteBody, branchNoteTitle, findBranchNote, isIgnoredBranch } from '../core/branch';
import { formatLocalIso } from '../core/time';

export async function openBranchNote(app: FoliumApp, options: { silent?: boolean } = {}): Promise<void> {
  const store = app.store;
  const branch = app.git.branch;
  if (!store) return;
  if (!branch) {
    if (!options.silent) void vscode.window.showWarningMessage('Folium: the current git branch is unknown.');
    return;
  }
  const existing = findBranchNote(store.allNotes, branch);
  if (existing) {
    await app.openNote(existing);
    return;
  }
  const title = branchNoteTitle(branch);
  const body = branchNoteBody(branch, app.git.branch === 'main' ? undefined : undefined).replace(
    '## Checklist',
    `Created: ${formatLocalIso(new Date())}\n\n## Checklist`,
  );
  const note = await store.createNote({
    scope: app.settings.branchNotes.scope,
    title,
    body,
    tags: ['branch'],
    branch,
  });
  app.refresh();
  await app.openNote(note);
  if (isIgnoredBranch(branch) && !options.silent) {
    void vscode.window.showInformationMessage(
      `Folium: ${branch} is ignored for automatic branch notes, but this note was created on request.`,
    );
  }
}
