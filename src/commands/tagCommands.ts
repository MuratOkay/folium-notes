/** Tag commands: filter, rename everywhere and remove everywhere. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import { confirmDanger } from './util';
import { normalizeTag, tagMatches } from '../core/tags';
import { toggleTagFilter } from './noteCommands';

export async function pickTag(app: FoliumApp, placeHolder: string): Promise<string | undefined> {
  const counts = app.store?.allTags() ?? new Map<string, number>();
  if (counts.size === 0) return undefined;
  const picked = await vscode.window.showQuickPick(
    [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ label: tag, description: String(count), tag })),
    { placeHolder },
  );
  return picked?.tag;
}

export async function renameTagCommand(app: FoliumApp, tagArg?: string): Promise<void> {
  const store = app.store;
  if (!store) return;
  const tag = tagArg ?? (await pickTag(app, 'Rename which tag?'));
  if (!tag) return;
  const newValue = await vscode.window.showInputBox({
    title: `Rename tag #${tag}`,
    prompt: 'New tag name (nested tags use /)',
    value: tag,
    validateInput: (value) => (normalizeTag(value) ? undefined : 'Tag cannot be empty'),
  });
  const target = newValue ? normalizeTag(newValue) : undefined;
  if (!target || target === tag) return;
  const affected = store.allNotes.filter((note) => note.tags.some((candidate) => tagMatches(candidate, tag)));
  const shared = affected.filter((note) => note.scope === 'shared');
  if (affected.length === 0) {
    void vscode.window.showInformationMessage(`Folium: no notes use #${tag}.`);
    return;
  }
  if (shared.length > 0) {
    const ok = await confirmDanger(
      `#${tag} is used in ${shared.length} shared note(s) that are committed with the code. Rename it everywhere?`,
      'Rename',
    );
    if (!ok) return;
  }
  const changed = await store.renameTag(tag, target);
  app.refresh();
  void vscode.window.showInformationMessage(
    `Folium: renamed #${tag} to #${target} in ${changed} note(s) (including children and inline tags).`,
  );
}

export async function removeTagCommand(app: FoliumApp, tagArg?: string): Promise<void> {
  const store = app.store;
  if (!store) return;
  const tag = tagArg ?? (await pickTag(app, 'Remove which tag?'));
  if (!tag) return;
  const affected = store.allNotes.filter((note) => note.tags.some((candidate) => tagMatches(candidate, tag)));
  const shared = affected.filter((note) => note.scope === 'shared');
  const ok = await confirmDanger(
    shared.length > 0
      ? `Remove #${tag} from ${affected.length} note(s), including ${shared.length} shared note(s)? Inline #${tag} becomes a plain word.`
      : `Remove #${tag} from ${affected.length} note(s)? Inline #${tag} becomes a plain word.`,
    'Remove Tag',
  );
  if (!ok) return;
  const changed = await store.removeTag(tag);
  app.refresh();
  void vscode.window.showInformationMessage(`Folium: removed #${tag} from ${changed} note(s).`);
}

export async function filterByTagCommand(app: FoliumApp): Promise<void> {
  const tag = await pickTag(app, 'Filter by tag (Esc clears selection)');
  if (!tag) return;
  await toggleTagFilter(app, tag);
}

export async function renameSelectedTag(app: FoliumApp, node?: { tag?: string }): Promise<void> {
  if (node?.tag) {
    await renameTagCommand(app, node.tag);
    return;
  }
  await renameTagCommand(app);
}

export async function removeSelectedTag(app: FoliumApp, node?: { tag?: string }): Promise<void> {
  if (node?.tag) {
    await removeTagCommand(app, node.tag);
    return;
  }
  await removeTagCommand(app);
}
