/** Send the current note line (or selection) to the integrated terminal. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import { terminalCommandFromLine, terminalCommandFromSelection } from '../core/terminal';

function activeNoteEditor(app: FoliumApp): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return undefined;
  if (editor.document.uri.scheme !== 'file') return undefined;
  return app.store?.byPath(editor.document.uri.fsPath) ? editor : undefined;
}

export async function sendLineToTerminal(app: FoliumApp): Promise<void> {
  const editor = activeNoteEditor(app);
  if (!editor) {
    void vscode.window.showWarningMessage('Folium: open a note and put the cursor on a command line first.');
    return;
  }
  let input: string | undefined;
  if (!editor.selection.isEmpty) {
    input = terminalCommandFromSelection(editor.document.getText(editor.selection));
    if (!input) {
      void vscode.window.showInformationMessage('Folium: the selection has no command lines to send.');
      return;
    }
  } else {
    const line = editor.document.lineAt(editor.selection.active.line).text;
    const parsed = terminalCommandFromLine(line);
    if (!parsed.text) {
      const message =
        parsed.reason === 'heading'
          ? 'Folium: move to a command line — headings are not sent to the terminal.'
          : parsed.reason === 'fence'
            ? 'Folium: move off the code fence line — fences are not sent to the terminal.'
            : 'Folium: this line is empty.';
      void vscode.window.showInformationMessage(message);
      return;
    }
    input = parsed.text;
  }
  const terminal =
    vscode.window.activeTerminal ??
    vscode.window.createTerminal({ name: 'Folium Notes' });
  terminal.show(true);
  terminal.sendText(input, true);
  const preview = input.split('\n')[0] ?? input;
  const suffix = input.includes('\n') ? ` (+${input.split('\n').length - 1} more lines)` : '';
  vscode.window.setStatusBarMessage(
    `Folium: sent to terminal — ${preview.length > 60 ? `${preview.slice(0, 57)}…` : preview}${suffix}`,
    3000,
  );
  app.log(`terminal: sent ${JSON.stringify(preview)}${suffix}`);
}
