import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FoliumProjectService, FoliumStore } from '../../src/store/store';
import { mergeSettings } from '../../src/core/settings';
import { parseNote } from '../../src/core/frontmatter';

let root: string;
let home: string;

async function makeStore(overrides: Record<string, unknown> = {}): Promise<FoliumStore> {
  const store = new FoliumStore({
    projectRoot: root,
    homedir: home,
    remotes: [{ name: 'origin', url: 'git@github.com:Acme/Webapp.git' }],
    settings: mergeSettings({
      privateRoot: path.join(home, 'FoliumNotes'),
      ...overrides,
    }),
    now: () => new Date(2026, 10, 22, 14, 14, 5),
    idFactory: (() => {
      let counter = 0;
      return () => `01J0ABCDEFGHJKMNPQRSTVWX${String(counter++).padStart(2, '0')}`;
    })(),
  });
  await store.initialize();
  return store;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'folium-test-'));
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'folium-home-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
});

describe('store initialization', () => {
  it('creates shared, private and .Folium folders plus project.json', async () => {
    const store = await makeStore();
    expect(store.paths.projectKey).toBe('github.com/acme/webapp');
    expect(store.paths.folderName).toBe('github.com_acme_webapp');
    const stat = await fs.stat(store.paths.sharedRoot);
    expect(stat.isDirectory()).toBe(true);
    const project = JSON.parse(await fs.readFile(store.paths.projectJsonFile, 'utf8'));
    expect(project.key).toBe('github.com/acme/webapp');
    expect(store.ready).toBe(true);
  });
});

describe('creating notes', () => {
  it('writes shared notes into <project>/.notes with header fields', async () => {
    const store = await makeStore();
    const note = await store.createNote({ scope: 'shared', title: 'Fix login', tags: ['bug'] });
    expect(note.relPath).toBe('2026-11-22-fix-login.md');
    expect(note.absPath.startsWith(store.paths.sharedRoot)).toBe(true);
    const raw = await fs.readFile(note.absPath, 'utf8');
    expect(raw).toContain('title: Fix login');
    expect(raw).toContain('tags: [ bug ]');
    expect(raw).toContain('created: 2026-11-22T14:14:05+');
    expect(raw).toContain('# Fix login');
    expect(store.allNotes).toHaveLength(1);
  });

  it('writes private notes outside the repository', async () => {
    const store = await makeStore();
    const note = await store.createNote({ scope: 'private', title: 'Secrets', sensitive: true });
    expect(note.absPath.startsWith(store.paths.privateFolder)).toBe(true);
    expect(note.absPath.includes(root)).toBe(false);
    expect(note.sensitive).toBe(true);
  });

  it('avoids file name collisions', async () => {
    const store = await makeStore();
    const first = await store.createNote({ scope: 'shared', title: 'Same' });
    const second = await store.createNote({ scope: 'shared', title: 'Same' });
    expect(first.relPath).toBe('2026-11-22-same.md');
    expect(second.relPath).toBe('2026-11-22-same-2.md');
  });

  it('applies a transform (encryption) before writing', async () => {
    const store = await makeStore();
    const note = await store.createNote({
      scope: 'private',
      title: 'Secret',
      body: '# Secret\n\nhunter2\n',
      transform: (raw) => raw.replace('hunter2', 'REDACTED'),
    });
    const raw = await fs.readFile(note.absPath, 'utf8');
    expect(raw).not.toContain('hunter2');
    expect(raw).toContain('REDACTED');
  });
});

describe('scanning and personal state', () => {
  it('picks up external files', async () => {
    const store = await makeStore();
    await fs.writeFile(path.join(store.paths.sharedRoot, 'manual.md'), '---\ntitle: Manual\n---\n\nBody\n');
    await store.refresh();
    expect(store.allNotes.map((note) => note.title)).toContain('Manual');
  });

  it('stores shared colors and pins in state.json', async () => {
    const store = await makeStore();
    const note = await store.createNote({ scope: 'shared', title: 'Colorful' });
    await store.setColor(note, 'purple');
    await store.togglePin(store.byKey(note.key)!);
    const state = JSON.parse(await fs.readFile(store.paths.stateFile, 'utf8'));
    expect(state.version).toBe(1);
    expect(state.notes[note.key]).toEqual({ color: 'purple', pinned: true });
    const refreshed = await makeStore();
    const reloaded = refreshed.byKey(note.key)!;
    expect(reloaded.color).toBe('purple');
    expect(reloaded.pinned).toBe(true);
  });

  it('keeps private colors in the file', async () => {
    const store = await makeStore();
    const note = await store.createNote({ scope: 'private', title: 'Mine' });
    await store.setColor(note, 'green');
    const raw = await fs.readFile(note.absPath, 'utf8');
    expect(raw).toContain('color: green');
    const state = await fs.readFile(store.paths.stateFile, 'utf8').catch(() => '');
    expect(state).not.toContain('green');
  });

  it('honours shareColors for shared notes', async () => {
    const store = await makeStore({ shareColors: true });
    const note = await store.createNote({ scope: 'shared', title: 'Shared color' });
    await store.setColor(note, 'blue');
    const raw = await fs.readFile(note.absPath, 'utf8');
    expect(raw).toContain('color: blue');
  });
});

describe('archive and trash', () => {
  it('archives with a timestamp and groups separately', async () => {
    const store = await makeStore();
    const note = await store.createNote({ scope: 'shared', title: 'Old' });
    await store.setArchived(note, true);
    expect(store.notes).toHaveLength(0);
    expect(store.archivedNotes).toHaveLength(1);
    const raw = await fs.readFile(note.absPath, 'utf8');
    expect(raw).toMatch(/archived: \d{4}-\d{2}-\d{2}T/);
  });

  it('trashes shared notes into the private folder and restores them with personal data', async () => {
    const store = await makeStore();
    const note = await store.createNote({ scope: 'shared', title: 'Trash me' });
    await store.setColor(note, 'orange');
    const pinned = await store.togglePin(store.byKey(note.key)!);
    expect(pinned).toBe(true);
    await store.trashNote(store.byKey(note.key)!);
    expect(store.allNotes).toHaveLength(0);
    expect(store.trashEntries).toHaveLength(1);
    const trashFile = path.join(store.paths.trashDir, store.trashEntries[0].storedName);
    expect((await fs.stat(trashFile)).isFile()).toBe(true);
    const restored = await store.restoreTrashEntry(store.trashEntries[0]);
    expect(restored?.relPath).toBe('2026-11-22-trash-me.md');
    expect(restored?.color).toBe('orange');
    expect(restored?.pinned).toBe(true);
    expect(store.trashEntries).toHaveLength(0);
  });

  it('deletes and empties the trash', async () => {
    const store = await makeStore();
    const first = await store.createNote({ scope: 'shared', title: 'A' });
    await store.trashNote(first);
    const second = await store.createNote({ scope: 'shared', title: 'B' });
    await store.trashNote(second);
    await store.deleteTrashEntry(store.trashEntries[0]);
    expect(store.trashEntries).toHaveLength(1);
    await store.emptyTrash();
    expect(store.trashEntries).toHaveLength(0);
    expect(await fs.readdir(store.paths.trashDir)).toHaveLength(0);
  });
});

describe('renaming and tags', () => {
  it('renames the file when the title changes and updates links', async () => {
    const store = await makeStore();
    const target = await store.createNote({ scope: 'shared', title: 'Old name' });
    const linker = await store.createNote({
      scope: 'shared',
      title: 'Linker',
      body: '# Linker\n\nSee [[Old name]].\n',
    });
    const updated = await store.updateFrontMatter(store.byKey(target.key)!, [['title', 'New name']]);
    expect(updated.relPath).toBe('2026-11-22-new-name.md');
    expect(await fs.stat(target.absPath).catch(() => null)).toBeNull();
    const linkerRaw = await fs.readFile(linker.absPath, 'utf8');
    expect(linkerRaw).toContain('[[New name]]');
  });

  it('renames and removes tags everywhere', async () => {
    const store = await makeStore();
    const note = await store.createNote({
      scope: 'shared',
      title: 'Tagged',
      tags: ['old', 'keep'],
      body: '# Tagged\n\nText #old and #old/child.\n',
    });
    const renamed = await store.renameTag('old', 'new');
    expect(renamed).toBe(1);
    const raw = await fs.readFile(note.absPath, 'utf8');
    expect(raw).toContain('tags: [ new, keep ]');
    expect(raw).toContain('#new');
    expect(raw).toContain('#new/child');
    await store.removeTag('new');
    const removed = await fs.readFile(note.absPath, 'utf8');
    expect(removed).toContain('tags: [ keep ]');
    expect(removed).toContain('Text new and new/child.');
  });
});

describe('overlay, search and tasks', () => {
  it('reflects unsaved editor content', async () => {
    const store = await makeStore();
    const note = await store.createNote({ scope: 'shared', title: 'Live' });
    store.setOverlay(note.absPath, note.raw.replace('title: Live', 'title: Live edited'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.byKey(note.key)?.title).toBe('Live edited');
    store.clearOverlay(note.absPath);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.byKey(note.key)?.title).toBe('Live');
  });

  it('searches titles, tags and bodies', async () => {
    const store = await makeStore();
    await store.createNote({
      scope: 'shared',
      title: 'Deploy checklist',
      tags: ['release'],
      body: '# Deploy checklist\n\nRollback plan.\n',
    });
    expect(store.search('deploy')[0]?.key).toBeTruthy();
    expect(store.search('#release')).toHaveLength(1);
    expect(store.search('rollback')).toHaveLength(1);
    expect(store.search('missing')).toHaveLength(0);
  });

  it('exposes tasks across notes', async () => {
    const store = await makeStore();
    await store.createNote({
      scope: 'shared',
      title: 'Tasks',
      body: '# Tasks\n\n- [ ] One due:2026-11-22\n- [x] Two\n',
    });
    const tasks = store.tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks.filter((task) => !task.done)).toHaveLength(1);
  });
});

describe('templates', () => {
  it('saves a note as a template and lists it', async () => {
    const store = await makeStore();
    const note = await store.createNote({
      scope: 'shared',
      title: 'Bug flow',
      body: '# {{title}}\n\nRepro steps\n',
      tags: ['bug'],
    });
    const file = await store.writeTemplate('team', {
      name: 'Team bug',
      description: 'Our flow',
      body: note.body,
      tags: note.tags,
    });
    expect(file.startsWith(store.paths.teamTemplatesDir)).toBe(true);
    expect(store.templates.some((template) => template.name === 'Team bug')).toBe(true);
    const reloaded = await store.reloadTemplates();
    const team = reloaded.find((template) => template.name === 'Team bug')!;
    expect(team.builtin).toBeUndefined();
  });
});

describe('backup and restore', () => {
  it('round-trips the private folder without overwriting', async () => {
    const store = await makeStore();
    await store.createNote({ scope: 'private', title: 'Private one' });
    const service = new FoliumProjectService(store);
    const buffer = await service.createBackup();
    expect(buffer.length).toBeGreaterThan(512);
    await fs.rm(store.paths.privateFolder, { recursive: true, force: true });
    await store.refresh();
    const summary = await service.restoreBackup(buffer);
    expect(summary.written).toBeGreaterThan(0);
    expect(summary.conflicts).toEqual([]);
    await store.refresh();
    expect(store.allNotes.map((note) => note.title)).toContain('Private one');
    const second = await service.restoreBackup(buffer);
    expect(second.written).toBe(0);
    expect(second.conflicts.length).toBeGreaterThan(0);
  });
});
