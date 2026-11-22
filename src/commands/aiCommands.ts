/** AI prompt and follow-up commands. Notes are never read by AI tools. */

import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FoliumApp } from '../app';
import { activeNote, pickNote } from './util';
import { codeContext, createNoteFlow } from './noteCommands';
import { renderTemplate, type TemplateContext } from '../core/templates';
import {
  composeAnswersReply,
  composeFollowUpBody,
  followUpTitle,
  hasFollowUpContent,
  parseFollowUp,
  parseFollowUpRequest,
} from '../core/followup';
import { parseNote, setFrontMatterFields } from '../core/frontmatter';
import { slugify } from '../core/filenames';
import { nowLocalIso } from '../core/time';

export const AI_TARGETS: Record<string, { label: string; kind: 'api' | 'clipboard'; command?: string }> = {
  copilot: { label: 'GitHub Copilot Chat', kind: 'api' },
  cline: { label: 'Cline', kind: 'api', command: 'cline.sendMessage' },
  roo: { label: 'Roo Code', kind: 'api', command: 'roo-cline.sendMessage' },
  kilo: { label: 'Kilo Code', kind: 'api', command: 'kilocode.sendMessage' },
  continue: { label: 'Continue', kind: 'clipboard', command: 'continue.openChatPanel' },
  claude: { label: 'Claude Code', kind: 'clipboard' },
  codex: { label: 'Codex', kind: 'clipboard' },
  jetbrains: { label: 'JetBrains AI', kind: 'clipboard' },
  custom: { label: 'Custom command', kind: 'api' },
};

async function sendToTarget(app: FoliumApp, text: string, targetKey: string): Promise<boolean> {
  const settings = app.settings.prompts;
  const target = AI_TARGETS[targetKey] ?? AI_TARGETS.custom;
  if (targetKey === 'copilot') {
    try {
      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: text,
        isPartialQuery: !settings.submit,
      });
      return true;
    } catch {
      /* fall through to clipboard */
    }
  }
  if (targetKey === 'custom') {
    if (!settings.customCommand || !vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        'Folium Notes: set FoliumNotes.prompts.customCommand at user level and trust the workspace to use a custom target.',
      );
      return false;
    }
    try {
      await vscode.commands.executeCommand(settings.customCommand, text);
      return true;
    } catch (error) {
      void vscode.window.showWarningMessage(
        `Folium: custom prompt command failed (${error instanceof Error ? error.message : String(error)}). The prompt was copied to the clipboard.`,
      );
    }
  }
  if (target.command) {
    try {
      await vscode.commands.executeCommand(target.command, text);
      return true;
    } catch {
      /* fall back to clipboard */
    }
  }
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage(
    `Folium: prompt copied. Paste it into ${target.label}.`,
  );
  return true;
}

async function requireSharedNote(app: FoliumApp, note: ReturnType<typeof activeNote>): Promise<boolean> {
  if (!note) return false;
  if (note.sensitive || note.encrypted) {
    void vscode.window.showWarningMessage('Folium: sensitive notes are never sent to AI tools.');
    return false;
  }
  if (note.scope === 'private') {
    const action = await vscode.window.showWarningMessage(
      'Private notes are never sent to AI tools. Move this note to shared notes first?',
      'Move to Shared',
    );
    if (action === 'Move to Shared' && app.store) {
      await app.store.moveNote(note, 'shared');
      app.refresh();
      void vscode.window.showInformationMessage('Folium: note moved to shared notes. Run the command again to send it.');
    }
    return false;
  }
  return true;
}

export async function sendPrompt(app: FoliumApp, note?: ReturnType<typeof activeNote>): Promise<void> {
  const target = note ?? activeNote(app);
  if (!target || !app.store) {
    void vscode.window.showWarningMessage('Folium: open a prompt note first.');
    return;
  }
  if (!(await requireSharedNote(app, target))) return;
  const context = codeContext(app);
  const baseContext: TemplateContext = {
    ...context,
    title: target.title,
    user: app.git.userName,
    project: app.store.paths.projectKey,
    branch: app.git.branch,
  };
  let rendered = renderTemplate(target.body, baseContext);
  const answers: Record<string, string> = {};
  for (const question of rendered.questions) {
    const answer =
      question.options && question.options.length > 0
        ? await vscode.window.showQuickPick(question.options, { placeHolder: question.question })
        : await vscode.window.showInputBox({ prompt: question.question });
    if (answer === undefined) return;
    answers[question.question] = answer;
  }
  if (Object.keys(answers).length > 0) {
    rendered = renderTemplate(target.body, { ...baseContext, answers });
  }
  const prompt = rendered.text.trim();
  if (!prompt) {
    void vscode.window.showWarningMessage('Folium: this note is empty.');
    return;
  }
  const targetKey = (target.target || app.settings.prompts.defaultTarget || 'copilot').toLowerCase();
  const sent = await sendToTarget(app, prompt, targetKey);
  if (!sent) return;
  if (app.settings.prompts.showInNotes) {
    const body = `${target.body.trimEnd()}\n\n## Sent ${nowLocalIso()}\n\n> to ${AI_TARGETS[targetKey]?.label ?? targetKey}\n`;
    await app.store.replaceBody(target, body, false);
    app.refresh();
  }
}

export async function saveAsCopilotPrompt(app: FoliumApp): Promise<void> {
  const note = activeNote(app) ?? (await pickNote(app));
  if (!note || !app.store) return;
  const root = app.projectRoot();
  if (!root) return;
  const targetDir = path.join(root, '.github', 'prompts');
  await fs.mkdir(targetDir, { recursive: true });
  let fileName = `${slugify(note.title) || 'prompt'}.prompt.md`;
  let counter = 2;
  while (await fs.stat(path.join(targetDir, fileName)).catch(() => undefined)) {
    fileName = `${slugify(note.title) || 'prompt'}-${counter}.prompt.md`;
    counter++;
  }
  const converted = note.body
    .replace(/\{\{\s*selection\s*\}\}/gi, '${selection}')
    .replace(/\{\{\s*file\s*\}\}/gi, '${file}')
    .replace(/\{\{\s*language\s*\}\}/gi, '')
    .replace(/\{\{\s*clipboard\s*\}\}/gi, '')
    .replace(/\{\{\s*cursor\s*\}\}/gi, '')
    .replace(/\{\{\s*title\s*\}\}/gi, note.title)
    .replace(/\{\{\s*date\s*\}\}/gi, nowLocalIso().slice(0, 10))
    .replace(/\{\{\s*branch\s*\}\}/gi, app.git.branch ?? '');
  const content = `---\nmode: agent\ndescription: ${JSON.stringify(note.title)}\n---\n\n${converted.trim()}\n`;
  const file = path.join(targetDir, fileName);
  await fs.writeFile(file, content, 'utf8');
  await vscode.window.showTextDocument(vscode.Uri.file(file));
}

export async function createFollowUpNote(
  app: FoliumApp,
  content: string,
  title?: string,
): Promise<string | undefined> {
  const store = app.store;
  if (!store) return undefined;
  const { MAX_FOLLOWUP_BYTES } = await import('../core/followup');
  if (Buffer.byteLength(content, 'utf8') > MAX_FOLLOWUP_BYTES) {
    void vscode.window.showWarningMessage('Folium: the AI answer is too large to turn into a follow-up note.');
    return undefined;
  }
  const data = parseFollowUp(content);
  if (!hasFollowUpContent(data)) {
    void vscode.window.showWarningMessage('Folium: no questions, decisions or open items found in the AI answer.');
    return undefined;
  }
  const noteTitle = title?.trim() || followUpTitle(data);
  const body = composeFollowUpBody(data, noteTitle);
  const note = await store.createNote({
    scope: 'shared',
    title: noteTitle,
    body,
    tags: ['followup'],
    kind: 'followup',
  });
  app.refresh();
  await app.openNote(note);
  return note.key;
}

export async function captureFollowUp(app: FoliumApp, content?: string): Promise<void> {
  const text = content ?? (await vscode.env.clipboard.readText());
  if (!text.trim()) {
    void vscode.window.showWarningMessage('Folium: the clipboard is empty.');
    return;
  }
  await createFollowUpNote(app, text);
}

export async function sendAnswers(app: FoliumApp): Promise<void> {
  const note = activeNote(app) ?? (await pickNote(app));
  if (!note || !app.store) return;
  if (note.kind !== 'followup') {
    void vscode.window.showWarningMessage('Folium: open a follow-up note first.');
    return;
  }
  if (!(await requireSharedNote(app, note))) return;
  const reply = composeAnswersReply(note.body);
  if (!reply.trim()) {
    void vscode.window.showWarningMessage('Folium: answer at least one question first.');
    return;
  }
  const targetKey = (note.target || app.settings.prompts.defaultTarget || 'copilot').toLowerCase();
  await sendToTarget(app, reply, targetKey);
  if (app.settings.followUps.archiveWhenSent) {
    await app.store.setArchived(note, true);
    app.refresh();
  }
}

export async function connectAITools(app: FoliumApp): Promise<void> {
  const server = path.join(app.context.extensionPath, 'dist', 'mcp-server.js');
  const privateRoot = app.store?.paths.privateBase ?? '~/FoliumNotes';
  const mcpJson = JSON.stringify(
    {
      servers: {
        folium: {
          command: 'node',
          args: [server],
          env: {
            FOLIUM_PRIVATE_ROOT: privateRoot,
            FOLIUM_PROJECT: app.store?.paths.projectKey ?? '',
          },
        },
      },
    },
    null,
    2,
  );
  const content = [
    '# Connect AI tools to Folium Notes',
    '',
    'AI tools cannot read your notes. A tool only receives text that you send from a note,',
    'and private or sensitive notes are never sent.',
    '',
    '## VS Code MCP (Copilot Chat, Cline, Roo Code, Kilo Code)',
    '',
    'Add this server to your MCP configuration (`mcp.json` / Cline MCP settings):',
    '',
    '```json',
    mcpJson,
    '```',
    '',
    'The server exposes `create_followup_note`, which writes a JSON request into',
    '`<privateRoot>/.inbox`; the open IDE claims it atomically and creates a follow-up note.',
    '',
    '## Copilot Chat language model tool',
    '',
    'In VS Code, Folium registers the `#followUp` tool. Ask Copilot to “create a follow-up note',
    'from this answer” and accept the tool call.',
    '',
    '## JetBrains IDEs',
    '',
    'Settings → Tools → AI Assistant → MCP Servers → Add: command `node`,',
    'argument the path above, and the same `FOLIUM_PRIVATE_ROOT` environment variable.',
    '',
    '## Follow-ups from the clipboard',
    '',
    'Copy an AI answer and run **Folium: Capture Follow-up from Clipboard**.',
    '',
    `Server: \`${server}\``,
    `Inbox: \`${path.join(app.store?.paths.privateBase ?? '~/FoliumNotes', '.inbox')}\``,
    '',
  ].join('\n');
  const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  const action = await vscode.window.showInformationMessage('Folium: MCP configuration copied to clipboard.', 'Copy MCP JSON');
  if (action) await vscode.env.clipboard.writeText(mcpJson);
  else await vscode.env.clipboard.writeText(mcpJson);
}

/** Watch `<privateRoot>/.inbox` for follow-up requests written by AI tools. */
export function startFollowUpInbox(app: FoliumApp): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  let processing = false;
  let watchedDir: string | undefined;

  const claim = async (file: string): Promise<string | undefined> => {
    const ide = (vscode.env.appName || 'ide').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const claimed = path.join(path.dirname(file), `.${ide}-${process.pid}.claimed`);
    try {
      await fs.rename(file, claimed);
      return claimed;
    } catch {
      return undefined;
    }
  };

  const processFile = async (file: string): Promise<void> => {
    if (!file.endsWith('.json')) return;
    const claimed = await claim(file);
    if (!claimed) return;
    try {
      const raw = await fs.readFile(claimed, 'utf8');
      const request = parseFollowUpRequest(raw);
      await createFollowUpNote(app, request.content, request.title);
    } catch (error) {
      void vscode.window.showWarningMessage(
        `Folium: could not read a follow-up request (${error instanceof Error ? error.message : String(error)}).`,
      );
    } finally {
      await fs.unlink(claimed).catch(() => undefined);
    }
  };

  const scan = async (): Promise<void> => {
    if (processing) return;
    processing = true;
    try {
      const inbox = app.store?.paths.inboxDir;
      if (!inbox) return;
      await fs.mkdir(inbox, { recursive: true });
      if (inbox !== watchedDir) {
        watchedDir = inbox;
        startWatcher(inbox);
      }
      const entries = await fs.readdir(inbox).catch(() => [] as string[]);
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        await processFile(path.join(inbox, entry));
      }
    } finally {
      processing = false;
    }
  };

  const startWatcher = (inbox: string): void => {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(inbox), '*.json'));
    watcher.onDidCreate((uri) => void processFile(uri.fsPath));
    disposables.push(watcher);
  };

  void scan();

  const timer = setInterval(() => {
    const currentInbox = app.store?.paths.inboxDir;
    if (currentInbox) void scan();
  }, 5000);
  timer.unref?.();
  disposables.push({ dispose: () => clearInterval(timer) });
  return {
    dispose: () => {
      for (const disposable of disposables) disposable.dispose();
    },
  };
}

/** Register the `#followUp` language model tool (VS Code 1.95+). */
export function registerFollowUpTool(app: FoliumApp): void {
  const lm = (vscode as unknown as { lm?: Record<string, unknown> }).lm as
    | { registerTool?: (name: string, tool: unknown) => vscode.Disposable }
    | undefined;
  if (!lm?.registerTool) return;
  const LanguageModelToolResult = (vscode as unknown as { LanguageModelToolResult?: new (parts: unknown[]) => unknown })
    .LanguageModelToolResult;
  const LanguageModelTextPart = (vscode as unknown as { LanguageModelTextPart?: new (text: string) => unknown })
    .LanguageModelTextPart;
  try {
    app.context.subscriptions.push(
      lm.registerTool('followUp', {
        description:
          'Create a Folium Notes follow-up note from an AI answer. Use when the user asks to turn questions, decisions or open items into a follow-up note.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The AI answer to extract questions and decisions from.' },
            title: { type: 'string', description: 'Optional note title.' },
          },
          required: ['content'],
        },
        invoke: async (options: { input: { content: string; title?: string } }) => {
          const key = await createFollowUpNote(app, options.input.content, options.input.title);
          const message = key ? `Created follow-up note ${key}.` : 'No follow-up content found.';
          if (LanguageModelToolResult && LanguageModelTextPart) {
            return new LanguageModelToolResult([new LanguageModelTextPart(message)]);
          }
          return { content: [{ type: 'text', text: message }] };
        },
      }),
    );
  } catch {
    /* older VS Code versions: the tool is simply not available */
  }
}

export async function sendPromptFromStatus(app: FoliumApp, note?: ReturnType<typeof activeNote>): Promise<void> {
  await sendPrompt(app, note);
}

export function promptBodyForAi(note: { body: string }): string {
  const parsed = parseNote(note.body);
  return parsed.body.trim();
}

export function withFrontMatterFields(raw: string, entries: Array<[string, unknown]>): string {
  return setFrontMatterFields(raw, entries);
}
