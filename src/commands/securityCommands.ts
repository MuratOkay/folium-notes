/** Encryption and backup commands. */

import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FoliumApp } from '../app';
import { activeNote, confirmDanger, pickNote } from './util';
import { decryptNote, fingerprint } from '../core/crypto';
import { SECURE_SCHEME, secureTargetPath } from '../ui/secureFs';
import { defaultViewState } from '../ui/viewState';

export async function encryptActiveNote(app: FoliumApp): Promise<void> {
  const store = app.store;
  if (!store) return;
  const note = activeNote(app) ?? (await pickNote(app, { placeHolder: 'Encrypt which note?' }));
  if (!note) return;
  if (note.encrypted) {
    void vscode.window.showInformationMessage('Folium: this note is already encrypted.');
    return;
  }
  const ok = await confirmDanger(
    'Encrypt this note with AES-256-GCM? Encrypted notes are marked sensitive and are never shared, exported or sent to AI.',
    'Encrypt',
  );
  if (!ok) return;
  const key = await app.keys.ensure();
  const { encryptNote } = await import('../core/crypto');
  const encrypted = encryptNote(note.raw, key);
  const updated = await store.writeRaw(note, encrypted);
  app.refresh();
  await app.openNote(updated);
  void vscode.window.showInformationMessage(
    `Folium: note encrypted (key ${fingerprint(key)}). Back up the key with "Folium: Back Up Encryption Key".`,
  );
}

export async function decryptActiveNote(app: FoliumApp): Promise<void> {
  const store = app.store;
  if (!store) return;
  const editor = vscode.window.activeTextEditor;
  let note = activeNote(app);
  if (!note && editor?.document.uri.scheme === SECURE_SCHEME) {
    note = store.byPath(secureTargetPath(editor.document.uri));
  }
  note = note ?? (await pickNote(app));
  if (!note) return;
  if (!note.encrypted) {
    void vscode.window.showInformationMessage('Folium: this note is not encrypted.');
    return;
  }
  const key = await app.keys.get();
  if (!key) {
    void vscode.window.showErrorMessage(
      'Folium: the encryption key is missing. Restore it with "Folium: Restore Encryption Key".',
    );
    return;
  }
  let plain: string;
  try {
    plain = decryptNote(note.raw, key);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Folium: decryption failed (${error instanceof Error ? error.message : String(error)}).`,
    );
    return;
  }
  const ok = await confirmDanger('Decrypt this note and store it as plain Markdown on disk?', 'Decrypt');
  if (!ok) return;
  const updated = await store.writeRaw(note, plain);
  app.refresh();
  await app.openNote(updated);
}

export async function backupEncryptionKey(app: FoliumApp): Promise<void> {
  const key = await app.keys.ensure();
  const text = await app.keys.backupText();
  const target = await vscode.window.showSaveDialog({
    title: 'Back up Folium encryption key',
    defaultUri: vscode.Uri.file(path.join(app.context.globalStorageUri.fsPath, `folium-key-${fingerprint(key)}.txt`)),
    filters: { 'Text file': ['txt'], 'All files': ['*'] },
  });
  if (!target) return;
  await fs.mkdir(path.dirname(target.fsPath), { recursive: true });
  await fs.writeFile(target.fsPath, text, 'utf8');
  void vscode.window.showInformationMessage(
    `Folium: key backup written (fingerprint ${fingerprint(key)}). Keep it somewhere safe — it is not part of note backups.`,
  );
}

export async function restoreEncryptionKey(app: FoliumApp): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Restore Folium encryption key',
    canSelectMany: false,
    filters: { 'Text file': ['txt'], 'All files': ['*'] },
  });
  if (!picked || picked.length === 0) return;
  let text: string;
  try {
    text = await fs.readFile(picked[0].fsPath, 'utf8');
  } catch (error) {
    void vscode.window.showErrorMessage(`Folium: could not read the key file (${String(error)}).`);
    return;
  }
  try {
    const newFingerprint = await app.keys.restoreFromText(text);
    void vscode.window.showInformationMessage(`Folium: encryption key restored (fingerprint ${newFingerprint}).`);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Folium: that file does not contain a valid key (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

export async function backupPrivateNotes(app: FoliumApp): Promise<void> {
  if (!app.service || !app.store) return;
  const date = new Date().toISOString().slice(0, 10);
  const target = await vscode.window.showSaveDialog({
    title: 'Back up private notes',
    defaultUri: vscode.Uri.file(path.join(app.store.paths.privateBase, `folium-backup-${date}.tar`)),
    filters: { 'Tar archive': ['tar'], 'All files': ['*'] },
  });
  if (!target) return;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Folium: backing up private notes' },
    async () => {
      const buffer = await app.service!.createBackup();
      await fs.writeFile(target.fsPath, buffer);
      void vscode.window.showInformationMessage(
        `Folium: private notes backed up to ${target.fsPath} (${Math.round(buffer.length / 1024)} KB). The encryption key is not included.`,
      );
    },
  );
}

export async function restorePrivateNotes(app: FoliumApp): Promise<void> {
  if (!app.service) return;
  const picked = await vscode.window.showOpenDialog({
    title: 'Restore private notes',
    canSelectMany: false,
    filters: { 'Tar archive': ['tar'], 'All files': ['*'] },
  });
  if (!picked || picked.length === 0) return;
  const buffer = await fs.readFile(picked[0].fsPath);
  const summary = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Folium: restoring private notes' },
    async () => app.service!.restoreBackup(buffer),
  );
  app.refresh();
  for (const conflict of summary.conflicts) app.log(`restore conflict (kept existing): ${conflict}`);
  void vscode.window.showInformationMessage(
    `Folium: restored ${summary.written} file(s); ${summary.conflicts.length} already existed and were kept.`,
  );
}

export async function configurePrivateRoot(app: FoliumApp): Promise<void> {
  const current = app.store?.paths.privateBase ?? app.settings.privateRoot;
  const value = await vscode.window.showInputBox({
    title: 'Private notes folder',
    prompt: 'Absolute path (or ~/…) where private notes are stored',
    value: current,
  });
  if (!value) return;
  await vscode.workspace
    .getConfiguration('foliumNotes')
    .update('privateRoot', value.trim(), vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage('Folium: private notes folder updated.');
}

export async function openPrivateFolder(app: FoliumApp): Promise<void> {
  const folder = app.store?.paths.privateFolder;
  if (!folder) return;
  await fs.mkdir(folder, { recursive: true }).catch(() => undefined);
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder));
}

export async function resetViewState(app: FoliumApp): Promise<void> {
  await app.viewStateStore.update(defaultViewState({}));
  app.refresh();
}
