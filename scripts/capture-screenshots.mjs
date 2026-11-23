#!/usr/bin/env node
/**
 * Capture real VS Code screenshots for the docs and the Marketplace.
 *
 * Requires: a graphical session (DISPLAY), an installed VS Code (`code` on PATH or
 * VSCODE_EXECUTABLE), a built VSIX (`npm run package`). It launches a throw-away VS Code
 * profile with the extension installed, drives the UI from a temporary automation
 * extension and captures the workbench through the Chrome DevTools Protocol.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const images = path.join(root, 'images');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'folium-shots-'));
const demo = path.join(os.tmpdir(), 'folio-demo');
const home = path.join(tmp, 'home');
const userData = path.join(tmp, 'user-data');
const extensions = path.join(tmp, 'extensions');
const automation = path.join(tmp, 'automation-extension');
const port = Number(process.env.FOLIUM_CDP_PORT || 9333);
const code = process.env.VSCODE_EXECUTABLE || 'code';
const privateRoot = path.join(home, 'FoliumNotes');
const projectKey = 'github.com/acme/webapp';
const privateFolder = path.join(privateRoot, 'github.com_acme_webapp');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad = (value) => String(value).padStart(2, '0');
const iso = (date) => {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
};
const day = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const daysAgo = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  date.setHours(9 + (offset % 6), 10 + (offset % 40), 5);
  return date;
};
const id = (suffix) => `01JQ8Z3K4M5N6P7Q8R9S0T1V${String(suffix).padStart(2, '0').slice(-2)}`;

function note({ id: noteId, title, created, tags, color, archived, kind, code, body }) {
  const lines = ['---', `id: ${noteId}`, `title: ${JSON.stringify(title)}`, `created: ${iso(created)}`];
  if (archived) lines.push(`archived: ${iso(archived)}`);
  if (tags?.length) lines.push(`tags: [ ${tags.join(', ')} ]`);
  if (color) lines.push(`color: ${color}`);
  if (kind) lines.push(`kind: ${kind}`);
  if (code) {
    lines.push('code:');
    lines.push(`  - path: ${code.path}`);
    lines.push(`    lines: ${code.lines}`);
    if (code.text) {
      lines.push('    text: |-');
      for (const line of code.text.split('\n')) lines.push(`      ${line}`);
    }
    if (code.endText) lines.push(`    endText: ${JSON.stringify(code.endText)}`);
  }
  lines.push('---', '', body.trim(), '');
  return lines.join('\n');
}

async function writeDemo() {
  await fs.rm(demo, { recursive: true, force: true });
  await fs.mkdir(path.join(demo, 'src', 'auth'), { recursive: true });
  await fs.mkdir(path.join(demo, '.notes'), { recursive: true });
  await fs.mkdir(path.join(privateFolder, '.Folium', 'trash'), { recursive: true });
  await fs.mkdir(path.join(demo, '.vscode'), { recursive: true });

  const loginSource = [
    'import { redirect } from "./redirect";',
    'import { readToken, clearToken } from "./session";',
    '',
    'export function login(user: string) {',
    '  const token = readToken(user);',
    '  if (!token) {',
    '    return redirect("/login");',
    '  }',
    '  return token;',
    '}',
    '',
    'export function logout() {',
    '  clearToken();',
    '  return redirect("/");',
    '}',
    '',
  ].join('\n');
  await fs.writeFile(path.join(demo, 'src', 'auth', 'login.ts'), loginSource);
  await fs.writeFile(
    path.join(demo, 'src', 'auth', 'session.ts'),
    [
      'const sessions = new Map<string, string>();',
      '',
      'export function readToken(user: string): string | undefined {',
      '  return sessions.get(user);',
      '}',
      '',
      'export function clearToken(user?: string): void {',
      '  if (user) sessions.delete(user);',
      '  else sessions.clear();',
      '}',
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(demo, 'src', 'auth', 'redirect.ts'),
    'export function redirect(path: string): string {\n  return path;\n}\n',
  );
  await fs.writeFile(
    path.join(demo, 'package.json'),
    JSON.stringify({ name: 'webapp', version: '1.0.0', scripts: { test: 'vitest run', build: 'tsc' } }, null, 2) + '\n',
  );
  await fs.writeFile(path.join(demo, 'README.md'), '# Acme Webapp\n\nDemo project for the Folium Notes screenshots.\n');

  await fs.writeFile(
    path.join(demo, '.vscode', 'settings.json'),
    JSON.stringify(
      {
        'foliumNotes.privateRoot': privateRoot,
        'foliumNotes.sharedFolder': '.notes',
        'workbench.colorTheme': 'Default Dark Modern',
        'workbench.startupEditor': 'none',
        'workbench.tips.enabled': false,
        'workbench.editor.showTabs': 'single',
        'editor.minimap.enabled': false,
        'editor.codeLens': true,
        'editor.stickyScroll.enabled': false,
        'breadcrumbs.enabled': false,
        'telemetry.telemetryLevel': 'off',
        'extensions.ignoreRecommendations': true,
        'update.showReleaseNotes': false,
        'explorer.compactFolders': false,
        'terminal.integrated.fontSize': 12,
        'foliumNotes.autoReveal': false,
        'foliumNotes.treeDescription': false,
        'terminal.integrated.gpuAcceleration': 'off',
        'terminal.integrated.shellIntegration.enabled': false,
        'terminal.integrated.cursorBlinking': false,
        'chat.disableAIFeatures': true,
        'chat.commandCenter.enabled': false,
        'workbench.secondarySideBar.defaultVisibility': 'hidden',
        'github.copilot.enable': { '*': false },
      },
      null,
      2,
    ) + '\n',
  );

  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: demo });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/webapp.git'], { cwd: demo });

  const loginLines = loginSource.split('\n');
  const snippet = {
    path: '../src/auth/login.ts',
    lines: '4-10',
    text: [loginLines[3], loginLines[4], loginLines[5]].map((line) => line.trim()).join('\n'),
    endText: loginLines[9].trim(),
  };

  const shared = {
    fix: path.join(demo, '.notes', `${day(-3)}-fix-login-redirect.md`),
    auth: path.join(demo, '.notes', `${day(-5)}-auth-flow.md`),
    release: path.join(demo, '.notes', `${day(-1)}-release-checklist.md`),
    decision: path.join(demo, '.notes', `${day(-2)}-decision-redis-sessions.md`),
    terminal: path.join(demo, '.notes', `${day(0)}-terminal-commands.md`),
    archived: path.join(demo, '.notes', `${day(-40)}-old-spike-sessions.md`),
    followup: path.join(demo, '.notes', `${day(0)}-followup-sessions-cache.md`),
  };

  await fs.writeFile(
    shared.fix,
    note({
      id: id(1),
      title: 'Login redirect',
      created: daysAgo(3),
      tags: ['bug', 'auth/login'],
      code: snippet,
      body: `# Fix login redirect

The redirect loops after logout. The token is read before the session is cleared, so the order in
[[Auth flow]] matters.

## Reproduction

1. Sign in as a test user
2. Click **Log out**
3. The login page redirects back to /account

## Notes

- \`logout()\` clears the token and redirects; the current handler redirects first
- Regression coverage is tracked in [[Release checklist]]

- [ ] Reproduce bug due:${day(0)}
- [ ] Add regression test due:${day(3)}
- [x] Check the session store
`,
    }),
  );
  await fs.writeFile(
    shared.auth,
    note({
      id: id(2),
      title: 'Auth flow',
      created: daysAgo(5),
      tags: ['auth'],
      body: `# Auth flow

## Steps

1. \`login()\` reads the token from the session store
2. A missing token redirects to /login
3. \`logout()\` clears the token and redirects home

See [[Login redirect]] for the current bug and [[Redis sessions]] for the storage choice.
`,
    }),
  );
  await fs.writeFile(
    shared.release,
    note({
      id: id(3),
      title: 'Release checklist',
      created: daysAgo(1),
      tags: ['release'],
      body: `# Release checklist

- [ ] Run tests due:${day(0)}
- [ ] Update changelog due:${day(1)}
- [x] Tag the release
- [ ] Announce release due:${day(10)}
`,
    }),
  );
  await fs.writeFile(
    shared.decision,
    note({
      id: id(4),
      title: 'Redis sessions',
      created: daysAgo(2),
      tags: ['decision'],
      body: `# Decision: Redis sessions

Status: accepted · ${day(-2)}

## Context

Sessions are stored in memory today, so every deploy logs everybody out. We need a store that is
shared by all instances and survives a restart.

## Decision

Use Redis for sessions with a 30 minute TTL.

## Consequences

- One more service to operate
- Sessions survive deploys
- The auth flow stays the same (see [[Auth flow]])
`,
    }),
  );
  await fs.writeFile(
    shared.terminal,
    note({
      id: id(5),
      title: 'Terminal commands',
      created: daysAgo(0),
      tags: ['terminal'],
      body: `# Terminal commands

Put the cursor on a command and run **Send Line to Terminal** (Alt+N then Enter). Markdown bullets and
\`$\` prompts are removed before sending.

## Build and test

\`\`\`bash
npm ci
npm run build
npm test
\`\`\`

## Demo

\`\`\`bash
echo "Folium terminal ready"
\`\`\`
`,
    }),
  );
  await fs.writeFile(
    shared.archived,
    note({
      id: id(6),
      title: 'Old spike: sessions',
      created: daysAgo(40),
      archived: daysAgo(10),
      tags: ['spike'],
      body: `# Old spike: sessions\n\nKept for reference. Superseded by [[Redis sessions]].\n`,
    }),
  );
  await fs.writeFile(
    shared.followup,
    note({
      id: id(7),
      title: 'Follow-up: sessions cache',
      created: daysAgo(0),
      tags: ['followup'],
      kind: 'followup',
      body: `# Follow-up: Should sessions be cached?

## Questions

- Should sessions be cached?
  - Answer: Redis
  - [x] Redis
  - [ ] Postgres

- Do we need a TTL?
  - Answer: 30 minutes
  - [ ] 30 minutes
  - [ ] 24 hours

## Decisions

- Use Redis for sessions

## Open items

- [ ] Update the deployment docs
`,
    }),
  );

  const privateNote = (idValue, title, tags, color, body) =>
    note({ id: idValue, title, created: daysAgo(0), tags, color, body });
  await fs.writeFile(
    path.join(privateFolder, `${day(-1)}-questions-for-the-architect.md`),
    privateNote(
      id(8),
      'Questions for the architect',
      ['questions'],
      null,
      `# Questions for the architect\n\n- Do we keep the legacy session table?\n- Who rotates the Redis password?\n`,
    ),
  );
  await fs.writeFile(
    path.join(privateFolder, `${day(-2)}-staging-credentials.md`),
    privateNote(
      id(9),
      'Staging credentials',
      ['credentials'],
      'green',
      `# Staging credentials\n\n| No | Name | Username | Password |\n| -- | ---- | -------- | -------- |\n| 1 | staging | deploy | (in the vault) |\n`,
    ),
  );

  await fs.writeFile(
    path.join(privateFolder, '.Folium', 'state.json'),
    JSON.stringify(
      {
        version: 1,
        notes: {
          [id(1)]: { color: 'red', pinned: true },
          [id(2)]: { color: 'green' },
          [id(3)]: { color: 'blue' },
          [id(4)]: { color: 'purple' },
          [id(5)]: { color: 'orange' },
          [id(7)]: { color: 'pink' },
        },
      },
      null,
      2,
    ) + '\n',
  );
  await fs.writeFile(path.join(privateFolder, '.Folium', 'project.json'), JSON.stringify({ version: 1, key: projectKey, folder: 'github.com_acme_webapp' }, null, 2) + '\n');

  const trashName = 'obsolete-notes.md';
  await fs.writeFile(
    path.join(privateFolder, '.Folium', 'trash', trashName),
    note({ id: id(10), title: 'Obsolete notes', created: daysAgo(12), tags: ['old'], body: '# Obsolete notes\n' }),
  );
  await fs.writeFile(
    path.join(privateFolder, '.Folium', 'trash.json'),
    JSON.stringify(
      {
        version: 1,
        entries: [
          {
            id: id(10),
            scope: 'shared',
            relPath: `${day(-12)}-obsolete-notes.md`,
            storedName: trashName,
            deletedAt: iso(daysAgo(2)),
            originalPath: path.join(demo, '.notes', `${day(-12)}-obsolete-notes.md`),
            personal: { color: 'gray' },
          },
        ],
      },
      null,
      2,
    ) + '\n',
  );

  execFileSync('git', ['add', '-A'], { cwd: demo });
  execFileSync(
    'git',
    ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', 'commit', '-q', '-m', 'Demo project'],
    { cwd: demo },
  );

  return { shared, privateFolder };
}

async function writeAutomationExtension(markerDir) {
  await fs.mkdir(automation, { recursive: true });
  await fs.writeFile(
    path.join(automation, 'package.json'),
    JSON.stringify(
      {
        name: 'folium-screenshot-automation',
        displayName: 'Folium screenshot automation',
        publisher: 'folium-dev',
        version: '0.0.1',
        engines: { vscode: '^1.90.0' },
        main: './extension.js',
        activationEvents: ['onStartupFinished'],
      },
      null,
      2,
    ),
  );
  const code = String.raw`
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const markerDir = process.env.FOLIUM_SHOT_DIR || '/tmp';
const marker = (scene, suffix) => path.join(markerDir, 'shot-' + scene + '.' + suffix);

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return;
    await sleep(100);
  }
  throw new Error('Timed out waiting for ' + file);
}

async function scene(number, action) {
  await sleep(500);
  await action();
  fs.writeFileSync(marker(number, 'ready'), '');
  await waitForFile(marker(number, 'done'), 60000);
}

async function activate() {
  const extension = vscode.extensions.getExtension('folium.folium-notes');
  if (!extension) throw new Error('Folium Notes is not installed');
  const api = await extension.activate();
  const app = api.app;
  for (let attempt = 0; attempt < 150 && !app.store; attempt++) await sleep(100);
  if (!app.store) throw new Error('Folium store did not start');
  const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const findSummary = (title) => {
    const summary = app.store.allNotes.find((note) => note.title === title || note.title.startsWith(title));
    if (!summary) throw new Error('Note not found: ' + title);
    return summary;
  };
  const openNote = async (title) => {
    const summary = findSummary(title);
    await app.openNote(app.store.byKey(summary.key));
    return summary;
  };
  const revealInEditor = (needle) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const lines = editor.document.getText().split(/\r?\n/);
    const index = lines.findIndex((line) => line.includes(needle));
    if (index < 0) return;
    const position = new vscode.Position(index, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.AtTop);
  };
  const focusNotes = async (title) => {
    await vscode.commands.executeCommand('workbench.view.extension.folium');
    await vscode.commands.executeCommand('folium.notes.focus');
    await sleep(600);
    await app.notesTree.revealNote(app.store.byKey(findSummary(title).key));
  };

  await scene(1, async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    for (const command of ['workbench.action.closeAuxiliaryBar', 'workbench.action.closePanel', 'notifications.clearAll']) {
      try { await vscode.commands.executeCommand(command); } catch {}
    }
    await openNote('Login redirect');
    revealInEditor('# Fix login redirect');
    await focusNotes('Login redirect');
  });

  await scene(2, async () => {
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await openNote('Follow-up: sessions cache');
    revealInEditor('# Follow-up: Should sessions be cached?');
  });
  try { await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility'); } catch {}
  await sleep(800);

  await scene(3, async () => {
    const uri = vscode.Uri.file(path.join(workspace, 'src', 'auth', 'login.ts'));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.One });
    const position = new vscode.Position(3, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    const end = document.lineAt(0).range.end;
    await editor.edit((builder) => builder.insert(end, ' '));
    await editor.edit((builder) => builder.delete(new vscode.Range(end, new vscode.Position(end.line, end.character + 1))));
    if (document.isDirty) await document.save();
    await vscode.commands.executeCommand('folium.related.focus');
    await sleep(900);
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await sleep(500);
    await editor.edit((builder) => builder.insert(end, ' '));
    await editor.edit((builder) => builder.delete(new vscode.Range(end, new vscode.Position(end.line, end.character + 1))));
    if (document.isDirty) await document.save();
    await sleep(1200);
  });

  await scene(4, async () => {
    const summary = await openNote('Release checklist');
    await app.notesTree.revealNote(app.store.byKey(summary.key));
    revealInEditor('# Release checklist');
    await app.viewStateStore.update({ showDoneTasks: true, tasksGroupBy: 'due' });
    app.refresh();
    await vscode.commands.executeCommand('folium.tasks.focus');
  });

  await scene(5, async () => {
    void vscode.commands.executeCommand('folium.searchWithQuery', 'login');
    await sleep(1500);
  });
  try { await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); } catch {}
  await sleep(400);

  await scene(6, async () => {
    void vscode.commands.executeCommand('folium.newFromTemplate');
    await sleep(1500);
  });
  try { await vscode.commands.executeCommand('workbench.action.closeQuickOpen'); } catch {}
  await sleep(400);

  await scene(7, async () => {
    const summary = await openNote('Terminal commands');
    await app.notesTree.revealNote(app.store.byKey(summary.key));
    const editor = vscode.window.activeTextEditor;
    const lines = editor.document.getText().split(/\r?\n/);
    const index = lines.findIndex((line) => line.includes('Folium terminal ready'));
    revealInEditor('## Demo');
    const position = new vscode.Position(index >= 0 ? index : 0, 0);
    editor.selection = new vscode.Selection(position, position);
    await vscode.commands.executeCommand('workbench.action.terminal.new');
    await sleep(7000);
    await vscode.commands.executeCommand('folium.sendLineToTerminal');
    await sleep(5000);
  });

  await vscode.commands.executeCommand('workbench.action.quit');
}

activate().catch(async (error) => {
  try {
    fs.writeFileSync(path.join(markerDir, 'shot-error.txt'), String(error && error.stack ? error.stack : error));
  } catch {}
  try { await vscode.commands.executeCommand('workbench.action.quit'); } catch {}
});
`;
  await fs.writeFile(path.join(automation, 'extension.js'), code);
  await fs.writeFile(
    path.join(automation, 'README.md'),
    'Temporary automation extension used by scripts/capture-screenshots.mjs.\n',
  );
}

async function installVsix() {
  const dist = path.join(root, 'dist');
  let entries = [];
  try {
    entries = await fs.readdir(dist);
  } catch {
    throw new Error('dist/ is missing — run `npm run package` first');
  }
  const vsix = entries
    .filter((name) => name.startsWith('folium-notes-') && name.endsWith('.vsix'))
    .map((name) => path.join(dist, name))
    .sort()
    .pop();
  if (!vsix) throw new Error('No Folium Notes VSIX in dist/ — run `npm run package` first');
  const unpacked = path.join(tmp, 'vsix');
  execFileSync('unzip', ['-q', vsix, '-d', unpacked]);
  const manifest = JSON.parse(await fs.readFile(path.join(unpacked, 'extension', 'package.json'), 'utf8'));
  const target = path.join(extensions, `${manifest.publisher}.${manifest.name}-${manifest.version}`);
  await fs.mkdir(extensions, { recursive: true });
  await fs.cp(path.join(unpacked, 'extension'), target, { recursive: true });
  return { vsix, target };
}

async function connect() {
  let targets;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((target) => target.type === 'page')) break;
    } catch {
      /* VS Code is still starting */
    }
    await sleep(500);
  }
  const page = targets?.find((target) => target.type === 'page');
  if (!page) throw new Error('VS Code DevTools endpoint did not expose a page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let counter = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++counter;
      pending.set(id, (message) =>
        message.error ? reject(new Error(`${method}: ${JSON.stringify(message.error)}`)) : resolve(message.result),
      );
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1.5,
    mobile: false,
  });
  return { ws, send };
}

async function capture(send, file) {
  const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await fs.writeFile(file, Buffer.from(data, 'base64'));
  const size = (await fs.stat(file)).size;
  console.log(`[shots] ${path.basename(file)} (${Math.round(size / 1024)} kB)`);
}

async function waitForReady(markers, number) {
  const ready = path.join(markers, `shot-${number}.ready`);
  const error = path.join(markers, 'shot-error.txt');
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await fs.stat(ready).catch(() => undefined)) return;
    if (await fs.stat(error).catch(() => undefined)) {
      throw new Error(`Automation failed:\n${await fs.readFile(error, 'utf8')}`);
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for screenshot scene ${number}`);
}

async function main() {
  await fs.mkdir(images, { recursive: true });
  await writeDemo();
  const markers = path.join(tmp, 'markers');
  await fs.mkdir(markers, { recursive: true });
  await writeAutomationExtension(markers);
  const installed = await installVsix();
  console.log(`[shots] extension: ${installed.target}`);

  const logFile = path.join(tmp, 'vscode.log');
  const child = spawn(
    code,
    [
      demo,
      '--user-data-dir',
      userData,
      '--extensions-dir',
      extensions,
      '--extensionDevelopmentPath',
      automation,
      `--remote-debugging-port=${port}`,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--new-window',
      '--no-sandbox',
    ],
    { env: { ...process.env, FOLIUM_SHOT_DIR: markers }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const log = await fs.open(logFile, 'w');
  child.stdout?.on('data', (chunk) => void log.write(chunk));
  child.stderr?.on('data', (chunk) => void log.write(chunk));
  child.on('exit', (codeValue) => console.log(`[shots] code exited: ${codeValue}`));

  const { ws, send } = await connect();
  await sleep(2500);

  const scenes = [
    [1, 'screenshot-notes.png'],
    [2, 'screenshot-ai-followup.png'],
    [3, 'screenshot-code-links.png'],
    [4, 'screenshot-tasks.png'],
    [5, 'screenshot-search.png'],
    [6, 'screenshot-templates.png'],
    [7, 'screenshot-terminal.png'],
  ];
  try {
    for (const [number, name] of scenes) {
      await waitForReady(markers, number);
      if (number === 6) {
        try {
          await send('Input.insertText', { text: 'terminal' });
        } catch {
          /* the picker may already have focus elsewhere */
        }
        await sleep(700);
      }
      try {
        await send('Runtime.evaluate', {
          expression:
            "(() => { const root = document.querySelector('.part.sidebar'); if (!root) return false; for (const el of root.querySelectorAll('*')) { if (el.scrollTop) el.scrollTop = 0; if (el.scrollLeft) el.scrollLeft = 0; } return true; })()",
          returnByValue: true,
        });
      } catch {
        /* sidebar not ready */
      }
      await sleep(300);
      if (number !== 5 && number !== 6) {
        try {
          const key = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
          await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
        } catch {
          /* ignore */
        }
        await sleep(250);
      }
      await sleep(900);
      await capture(send, path.join(images, name));
      await fs.writeFile(path.join(markers, `shot-${number}.done`), '');
      await sleep(350);
    }
  } finally {
    try {
      await Promise.race([send('Browser.close').catch(() => undefined), sleep(1200)]);
    } catch {
      /* already closing */
    }
    await sleep(2000);
    child.kill('SIGTERM');
    await log.close();
    ws.close();
  }
  console.log(`[shots] done; temp workspace: ${tmp}`);
}

await main().catch((error) => {
  console.error('[shots] failed:', error.message);
  process.exitCode = 1;
});
