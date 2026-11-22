/** Folium Notes extension entry point. */

import * as vscode from 'vscode';
import { FoliumApp } from './app';

let app: FoliumApp | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<{ app: FoliumApp } | undefined> {
  app = new FoliumApp(context);
  context.subscriptions.push(app);
  try {
    await app.activate();
  } catch (error) {
    app.log(`activation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    void vscode.window.showErrorMessage(
      `Folium Notes failed to start: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { app };
}

export function deactivate(): void {
  app?.dispose();
  app = undefined;
}
