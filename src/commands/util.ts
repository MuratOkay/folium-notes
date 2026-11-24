/** Shared helpers for command implementations. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import type { NoteFile } from '../store/store';
import type { Scope } from '../core/state';
import { normalizeTag } from '../core/tags';

export function activeNote(app: FoliumApp): NoteFile | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  if (editor.document.uri.scheme !== 'file') return undefined;
  return app.store?.byPath(editor.document.uri.fsPath);
}

export function requireStore(app: FoliumApp): NoteFile[] | undefined {
  if (!app.store) {
    void vscode.window.showWarningMessage('Folium Notes: open a folder first.');
    return undefined;
  }
  return app.store.allNotes;
}

export async function pickNote(
  app: FoliumApp,
  options: { placeHolder?: string; scope?: Scope; exclude?: string } = {},
): Promise<NoteFile | undefined> {
  const store = app.store;
  if (!store) return undefined;
  const items = store.allNotes
    .filter((note) => !options.scope || note.scope === options.scope)
    .filter((note) => !options.exclude || note.key !== options.exclude)
    .sort((a, b) => b.updated.getTime() - a.updated.getTime())
    .map((note) => ({
      label: note.title,
      description: `${note.scope}${note.tags.length ? ` · ${note.tags.join(' ')}` : ''}`,
      detail: note.relPath,
      note,
    }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage('Folium Notes: there are no notes yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: options.placeHolder ?? 'Pick a note',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  return picked?.note;
}

export async function askTitle(defaultValue = '', prompt = 'Note title'): Promise<string | undefined> {
  const title = await vscode.window.showInputBox({
    prompt,
    value: defaultValue,
    valueSelection: defaultValue ? [0, defaultValue.length] : undefined,
    validateInput: (value) => (value.trim() ? undefined : 'A title is required'),
  });
  return title?.trim() || undefined;
}

export async function pickScope(
  app: FoliumApp,
  options: { placeHolder?: string; allowBoth?: boolean; default?: Scope } = {},
): Promise<Scope | undefined> {
  const configured = app.settings.defaultScope;
  const preferred =
    options.default ?? (configured === 'shared' || configured === 'private' ? configured : undefined);
  const choices = [
    {
      label: '$(folder) Shared note',
      description: 'in the project (.notes), committed with the code',
      value: 'shared' as Scope,
    },
    {
      label: '$(lock) Private note',
      description: 'outside the repository, never committed',
      value: 'private' as Scope,
    },
  ];
  const ordered =
    preferred === 'private' ? [choices[1], choices[0]] : choices;
  const items = ordered.map((choice) => ({
    ...choice,
    description:
      choice.value === preferred ? `${choice.description} · default` : choice.description,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: options.placeHolder ?? 'Where should the note live?',
    title: 'Shared or private?',
  });
  return picked?.value;
}

export function normalizeTagInput(value: string): string {
  return normalizeTag(value);
}

export async function confirmDanger(message: string, action: string): Promise<boolean> {
  const answer = await vscode.window.showWarningMessage(message, { modal: true }, action);
  return answer === action;
}

export function isTrustedWorkspace(): boolean {
  return vscode.workspace.isTrusted;
}

export function requireTrusted(action: string): boolean {
  if (vscode.workspace.isTrusted) return true;
  void vscode.window.showWarningMessage(
    `Folium Notes: ${action} is disabled in untrusted workspaces. Trust the workspace to enable it.`,
  );
  return false;
}

export function languageOf(document: vscode.TextDocument): string {
  return document.languageId === 'plaintext' ? '' : document.languageId;
}
