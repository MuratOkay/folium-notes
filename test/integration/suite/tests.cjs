/** Extension-host integration tests: real VS Code, real files. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

async function timeAsync(label, fn) {
  const start = Date.now();
  const result = await fn();
  const elapsed = Date.now() - start;
  console.log(`[it] ${label}: ${elapsed}ms`);
  return { result, elapsed };
}

exports.run = async function run() {
  const phase = process.env.FOLIUM_IT_PHASE || 'first';
  const workspace = process.env.FOLIUM_IT_WORKSPACE;
  assert.ok(workspace, 'FOLIUM_IT_WORKSPACE is set');
  const extension = vscode.extensions.getExtension('folium.folium-notes');
  assert.ok(extension, 'extension is installed for development');
  const api = await extension.activate();
  assert.ok(api && api.app, 'extension API exposes the app');
  const app = api.app;
  assert.ok(app.store, 'store initialized');
  assert.strictEqual(app.store.paths.projectRoot, workspace, 'project root');

  if (phase === 'first') {
    const note = await app.store.createNote({
      scope: 'shared',
      title: 'Integration note',
      body: '# Integration note\n\n- [ ] First task due:2026-11-22\n',
    });
    assert.ok(fs.existsSync(note.absPath), 'note file exists');
    assert.ok(note.absPath.startsWith(path.join(workspace, '.notes')), 'note is in .notes');
    assert.strictEqual(app.store.search('integration')[0].key, note.key, 'search finds the note');

    const privateNote = await app.store.createNote({
      scope: 'private',
      title: 'Private integration note',
      body: '# Private integration note\n',
    });
    assert.ok(!privateNote.absPath.startsWith(workspace), 'private note is outside the repo');
    await app.store.setColor(privateNote, 'green');
    const pinned = await app.store.togglePin(privateNote);
    assert.strictEqual(pinned, true, 'pin toggled');

    const tasks = app.store.tasks;
    assert.ok(tasks.some((task) => task.text.includes('First task')), 'task extracted');

    await vscode.commands.executeCommand('folium.openNote', note.key);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor && editor.document.uri.fsPath === note.absPath, 'note opened in the editor');

    const key = await app.keys.ensure();
    assert.ok(key.length === 32, 'encryption key created');
    const fingerprint = await app.keys.fingerprint();
    assert.ok(/^[0-9a-f]{8}$/.test(fingerprint), 'key fingerprint');

    const encrypted = await app.store.createNote({
      scope: 'private',
      title: 'Encrypted note',
      body: '# Encrypted note\n\nsecret: hunter2\n',
      transform: (raw) => raw,
    });
    fs.writeFileSync(path.join(workspace, '.it-marker'), note.key);
    assert.ok(encrypted.key, 'encrypted note created');
    console.log('[it] phase first finished');
    return;
  }

  if (phase === 'restart') {
    const marker = fs.readFileSync(path.join(workspace, '.it-marker'), 'utf8').trim();
    const note = app.store.byKey(marker);
    assert.ok(note, 'note created before the restart is still indexed');
    assert.strictEqual(note.title, 'Integration note', 'content survived the restart');
    const privateNote = app.store.allNotes.find((candidate) => candidate.title === 'Private integration note');
    assert.ok(privateNote, 'private note survived the restart');
    assert.strictEqual(privateNote.color, 'green', 'private color kept in the file');
    assert.strictEqual(privateNote.pinned, true, 'pin kept in state.json');
    const key = await app.keys.get();
    assert.ok(key && key.length === 32, 'secret storage kept the key across restarts');
    console.log('[it] phase restart finished');
    return;
  }

  if (phase === 'perf') {
    const { elapsed } = await timeAsync('refresh 5000 notes', () => app.refreshFromDisk());
    assert.ok(app.store.allNotes.length >= 5000, `loaded ${app.store.allNotes.length} notes`);
    assert.ok(elapsed < 15000, `full refresh took ${elapsed}ms`);
    const search = await timeAsync('search', () => app.store.search('note 4999'));
    assert.ok(search.result.length > 0, 'search found the generated note');
    assert.ok(search.elapsed < 500, `search took ${search.elapsed}ms`);
    const create = await timeAsync('create note', () =>
      app.store.createNote({ scope: 'private', title: 'Perf note', body: '# Perf note\n' }),
    );
    assert.ok(create.elapsed < 2000, `create took ${create.elapsed}ms`);
    console.log('[it] phase perf finished');
    return;
  }

  throw new Error(`unknown phase ${phase}`);
};
