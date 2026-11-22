import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FoliumStore } from '../../src/store/store';
import { mergeSettings } from '../../src/core/settings';

const COUNT = 5000;

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (index < items.length) {
      const current = index++;
      await fn(items[current]);
    }
  });
  await Promise.all(workers);
}

function noteSource(index: number): string {
  return [
    '---',
    `id: 01J0${String(index).padStart(22, '0')}`,
    `title: Generated note ${index}`,
    'created: 2026-11-22T10:00:00+00:00',
    `updated: 2026-11-22T10:00:00+00:00`,
    `tags: [ generated, area/${index % 25} ]`,
    '---',
    '',
    `# Generated note ${index}`,
    '',
    `Body of note ${index} with some words to search: deploy, database, cache, release.`,
    '',
    `- [ ] follow up ${index} due:2026-11-${String((index % 28) + 1).padStart(2, '0')}`,
    '',
  ].join('\n');
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

describe('store performance (5,000 notes)', () => {
  it('loads cold, refreshes incrementally, searches and creates quickly', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'folium-store-perf-'));
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'folium-store-perf-home-'));
    try {
      const notesDir = path.join(root, '.notes');
      await fs.mkdir(notesDir, { recursive: true });
      const indexes = Array.from({ length: COUNT }, (_, index) => index);
      const seedStart = performance.now();
      await mapLimit(indexes, 32, async (index) => {
        await fs.writeFile(path.join(notesDir, `note-${index}.md`), noteSource(index));
      });
      const seedMs = performance.now() - seedStart;

      const store = new FoliumStore({
        projectRoot: root,
        homedir: home,
        remotes: [{ name: 'origin', url: 'git@github.com:Org/Repo.git' }],
        settings: mergeSettings({ privateRoot: path.join(home, 'FoliumNotes') }),
      });

      let start = performance.now();
      await store.initialize();
      const coldMs = performance.now() - start;
      expect(store.allNotes).toHaveLength(COUNT);

      start = performance.now();
      const hits = store.search('note 4999');
      const searchMs = performance.now() - start;
      expect(hits.length).toBeGreaterThan(0);

      start = performance.now();
      const tagCount = store.tagCounts().get('generated') ?? 0;
      const taskCount = store.tasks.length;
      const cachedMs = performance.now() - start;
      expect(tagCount).toBe(COUNT);
      expect(taskCount).toBe(COUNT);

      start = performance.now();
      await store.refresh();
      const noopRefreshMs = performance.now() - start;

      const changedFile = path.join(notesDir, 'note-2500.md');
      await fs.appendFile(changedFile, '\n- [ ] added externally\n');
      start = performance.now();
      await store.refresh();
      const oneChangeRefreshMs = performance.now() - start;
      expect(store.tasks.some((task) => task.text === 'added externally')).toBe(true);

      start = performance.now();
      const created = await store.createNote({
        scope: 'private',
        title: 'Live note',
        body: '# Live note\n\n- [ ] one task\n',
      });
      const createMs = performance.now() - start;
      expect(created.relPath).toMatch(/live-note/);

      start = performance.now();
      await store.refresh();
      const afterCreateRefreshMs = performance.now() - start;

      console.log(
        [
          `[store-perf] seed ${COUNT} files: ${ms(seedMs)}`,
          `[store-perf] cold load+index: ${ms(coldMs)}`,
          `[store-perf] search: ${ms(searchMs)} (${hits.length} hits)`,
          `[store-perf] cached tags/tasks: ${ms(cachedMs)} (${tagCount} tags, ${taskCount} tasks)`,
          `[store-perf] refresh, no changes: ${ms(noopRefreshMs)}`,
          `[store-perf] refresh, 1 changed file: ${ms(oneChangeRefreshMs)}`,
          `[store-perf] create note: ${ms(createMs)}`,
          `[store-perf] refresh after own write: ${ms(afterCreateRefreshMs)}`,
        ].join('\n'),
      );

      expect(coldMs).toBeLessThan(6000);
      expect(searchMs).toBeLessThan(400);
      expect(noopRefreshMs).toBeLessThan(800);
      expect(oneChangeRefreshMs).toBeLessThan(1000);
      expect(createMs).toBeLessThan(1500);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(home, { recursive: true, force: true });
    }
  }, 60_000);
});
