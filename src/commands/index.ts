/** Command registration: one place, ids must match src/manifest/contributions.ts. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import * as notes from './noteCommands';
import * as templates from './templateCommands';
import * as tags from './tagCommands';
import * as ai from './aiCommands';
import * as security from './securityCommands';
import * as importExport from './importExportCommands';
import * as branch from './branchCommands';
import * as terminal from './terminalCommands';
import * as help from './helpCommands';
import { showSearch } from '../ui/search';
import type { NoteFile } from '../store/store';

function keyOf(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'key' in arg) return (arg as { key?: string }).key;
  return undefined;
}

export function registerCommands(app: FoliumApp): void {
  /** Tree items (keys), command arguments (keys) and strings all resolve to a note. */
  const noteOf = (arg: unknown): NoteFile | undefined => {
    const key = keyOf(arg);
    return key ? app.store?.byKey(key) : undefined;
  };
  const register = (id: string, handler: (...args: never[]) => unknown): void => {
    app.context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          return await (handler as (...inner: unknown[]) => unknown)(...args);
        } catch (error) {
          app.log(`${id} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
          void vscode.window.showErrorMessage(
            `Folium: ${error instanceof Error ? error.message : String(error)}`,
          );
          return undefined;
        }
      }),
    );
  };

  // Notes
  register('folium.newNote', async () => notes.createNoteFlow(app));
  register('folium.newSharedNote', async () => notes.createNoteFlow(app, { scope: 'shared' }));
  register('folium.newPrivateNote', async () => notes.createNoteFlow(app, { scope: 'private' }));
  register('folium.newNoteWithTitle', async (title: unknown) => notes.newNoteWithTitle(app, String(title ?? '')));
  register('folium.openNote', async (arg: unknown) => {
    const key = keyOf(arg);
    if (key) await notes.openNoteByKey(app, key);
  });
  register('folium.search', async () => showSearch(app));
  register('folium.searchWithQuery', async (query: unknown) => showSearch(app, String(query ?? '')));
  register('folium.statusMenu', async () => notes.statusMenu(app));
  register('folium.setColor', async (arg: unknown) => {
    const key = keyOf(arg);
    await notes.setNoteColor(app, key ? app.store?.byKey(key) : undefined);
  });
  register('folium.togglePin', async (arg: unknown) => {
    const key = keyOf(arg);
    await notes.togglePin(app, key ? app.store?.byKey(key) : undefined);
  });
  register('folium.archive', async (arg: unknown) => {
    const key = keyOf(arg);
    await notes.setArchived(app, true, key ? app.store?.byKey(key) : undefined);
  });
  register('folium.unarchive', async (arg: unknown) => {
    const key = keyOf(arg);
    await notes.setArchived(app, false, key ? app.store?.byKey(key) : undefined);
  });
  register('folium.trashNote', async (arg: unknown) => {
    const key = keyOf(arg);
    await notes.trashNote(app, key ? app.store?.byKey(key) : undefined);
  });
  register('folium.renameNote', async (arg: unknown) => notes.renameNote(app, noteOf(arg)));
  register('folium.duplicateNote', async (arg: unknown) => notes.duplicateNote(app, noteOf(arg)));
  register('folium.moveNote', async (arg: unknown) => notes.moveNoteScope(app, noteOf(arg)));
  register('folium.moveToPrivate', async (arg: unknown) => notes.moveNoteScope(app, noteOf(arg), 'private'));
  register('folium.moveToShared', async (arg: unknown) => notes.moveNoteScope(app, noteOf(arg), 'shared'));
  register('folium.editTags', async (arg: unknown) => notes.editNoteTags(app, noteOf(arg)));
  register('folium.copyNoteLink', async (arg: unknown) => notes.copyNoteLink(app, noteOf(arg)));
  register('folium.copyNotePath', async (arg: unknown) => notes.copyNotePath(app, noteOf(arg)));
  register('folium.revealNote', async (arg: unknown) => notes.revealNote(app, noteOf(arg)));
  register('folium.linkIssue', async (arg: unknown) => notes.linkIssue(app, noteOf(arg)));
  register('folium.restoreTrash', async (arg: unknown) => {
    const entry = arg && typeof arg === 'object' && 'entry' in arg ? (arg as { entry: { storedName: string } }).entry : undefined;
    await notes.restoreTrashEntry(app, entry);
  });
  register('folium.deleteTrashEntry', async (arg: unknown) => {
    const entry = arg && typeof arg === 'object' && 'entry' in arg ? (arg as { entry: { storedName: string } }).entry : undefined;
    await notes.deleteTrashEntry(app, entry);
  });
  register('folium.emptyTrash', async () => notes.emptyTrash(app));
  register('folium.openTask', async (arg: unknown) => {
    if (arg && typeof arg === 'object' && 'task' in arg) {
      await notes.openTask(app, (arg as { task: { noteKey: string; line: number } }).task);
    } else {
      await notes.openTask(app, arg as { noteKey: string; line: number });
    }
  });
  register('folium.toggleTask', async () => notes.toggleTaskAtCursor(app));
  register('folium.showTasks', async () => notes.showTasks());
  register('folium.sendLineToTerminal', async () => terminal.sendLineToTerminal(app));
  register('folium.toggleDoneTasks', async () => notes.toggleDoneTasks(app));
  register('folium.tasksGroupBy', async () => notes.tasksGroupBy(app));
  register('folium.newFromSelection', async () => notes.newFromSelection(app));
  register('folium.linkSelection', async () => notes.linkSelectionToNote(app));
  register('folium.updateCodeLinks', async (arg: unknown) => {
    const key = keyOf(arg);
    await notes.updateCodeLinks(app, key ? app.store?.byKey(key) : undefined);
  });
  register('folium.showNotesForFile', async () => notes.showNotesForFile(app));
  register('folium.createMissingNote', async (target: unknown, scope: unknown) =>
    notes.createMissingNote(app, String(target ?? ''), scope === 'private' ? 'private' : 'shared'),
  );

  // Filters, grouping and sorting
  register('folium.toggleTagFilter', async (arg: unknown) => {
    const tag = typeof arg === 'string' ? arg : (arg as { tag?: string } | undefined)?.tag;
    if (tag) await notes.toggleTagFilter(app, tag);
  });
  register('folium.filterByTag', async () => tags.filterByTagCommand(app));
  register('folium.filterMenu', async () => notes.filterMenu(app));
  register('folium.filterByTitle', async () => notes.filterByTitle(app));
  register('folium.filterByColor', async () => notes.filterByColor(app));
  register('folium.filterByDate', async () => notes.filterByDate(app));
  register('folium.filterByScope', async () => notes.filterByScope(app));
  register('folium.filterByText', async () => notes.filterByText(app));
  register('folium.setTagFilterMode', async () => notes.setTagFilterMode(app));
  register('folium.clearFilters', async () => notes.clearFilters(app));
  register('folium.groupBy', async () => notes.setGroupBy(app));
  register('folium.sortBy', async () => notes.setSortBy(app));
  register('folium.sortOrder', async () => notes.toggleSortOrder(app));
  register('folium.showFilters', async () => help.showFiltersInfo(app));

  // Tags
  register('folium.renameTag', async (arg: unknown) => tags.renameSelectedTag(app, arg as { tag?: string }));
  register('folium.removeTag', async (arg: unknown) => tags.removeSelectedTag(app, arg as { tag?: string }));

  // Templates
  register('folium.newFromTemplate', async () => templates.newFromTemplate(app));
  register('folium.browseTemplates', async () => templates.browseTemplatesForScope(app));
  register('folium.createTemplate', async () => templates.createTemplate(app));
  register('folium.saveAsTemplate', async (arg: unknown) => templates.saveNoteAsTemplate(app, noteOf(arg)));
  register('folium.manageTemplates', async () => templates.manageTemplates(app));
  register('folium.previewTemplate', async () => templates.previewTemplate(app));

  // AI
  register('folium.sendPrompt', async (arg: unknown) => {
    const key = keyOf(arg);
    await ai.sendPrompt(app, key ? app.store?.byKey(key) : undefined);
  });
  register('folium.saveAsCopilotPrompt', async () => ai.saveAsCopilotPrompt(app));
  register('folium.captureFollowUp', async () => ai.captureFollowUp(app));
  register('folium.sendAnswers', async () => ai.sendAnswers(app));
  register('folium.connectAITools', async () => ai.connectAITools(app));
  register('folium.newPromptNote', async () => ai.newPromptNote(app));

  // Security and backups
  register('folium.encryptNote', async () => security.encryptActiveNote(app));
  register('folium.decryptNote', async () => security.decryptActiveNote(app));
  register('folium.backupKey', async () => security.backupEncryptionKey(app));
  register('folium.restoreKey', async () => security.restoreEncryptionKey(app));
  register('folium.backupPrivate', async () => security.backupPrivateNotes(app));
  register('folium.restorePrivate', async () => security.restorePrivateNotes(app));
  register('folium.configurePrivateRoot', async () => security.configurePrivateRoot(app));
  register('folium.openPrivateFolder', async () => security.openPrivateFolder(app));
  register('folium.openTemplatesFolder', async () => security.openTemplatesFolder(app));
  register('folium.openSettings', async () => security.openSettings());
  register('folium.resetViewState', async () => security.resetViewState(app));

  // Import, export, Joplin and issues
  register('folium.importNotes', async () => importExport.importNotes(app));
  register('folium.exportNotes', async () => importExport.exportNotesCommand(app));
  register('folium.sendToJoplin', async (arg: unknown) => importExport.sendToJoplin(app, noteOf(arg)));
  register('folium.createIssue', async (arg: unknown) => importExport.createIssue(app, noteOf(arg)));
  register('folium.runCommand', async (command: unknown) =>
    terminal.runCommand(app, typeof command === 'string' ? command : undefined),
  );
  register('folium.copyTerminalCommand', async (command: unknown) =>
    terminal.copyTerminalCommand(typeof command === 'string' ? command : undefined),
  );

  // Branch and help
  register('folium.branchNote', async (arg: unknown) => {
    const silent = !!arg && typeof arg === 'object' && (arg as { silent?: boolean }).silent;
    await branch.openBranchNote(app, { silent });
  });
  register('folium.gettingStarted', async () => help.showGettingStarted(app));
  register('folium.refresh', async () => help.refreshNotes(app));
  register('folium.showLog', async () => help.showLog(app));

  // Background services
  app.context.subscriptions.push(ai.startFollowUpInbox(app));
  ai.registerFollowUpTool(app);
}

export type { NoteFile };
