import { describe, expect, it } from 'vitest';
import { buildSummary, type NoteSummary } from '../../src/core/note';
import { SearchIndex } from '../../src/core/search';
import { groupNotes } from '../../src/core/views';
import { parseTasks } from '../../src/core/tasks';

const COUNT = 5000;

function makeRaw(index: number): string {
  const words = ['login', 'deploy', 'meeting', 'decision', 'bug', 'release', 'database', 'cache'];
  const word = words[index % words.length];
  return [
    '---',
    `id: 01J0${String(index).padStart(22, '0')}`,
    `title: ${word} note ${index}`,
    'created: 2026-11-22T10:00:00+00:00',
    `tags: [ ${word}, area/${index % 30} ]`,
    '---',
    '',
    `# ${word} note ${index}`,
    '',
    `Body about ${word} and project ${index % 100}.`,
    '- [ ] follow up',
    '',
  ].join('\n');
}

describe('performance (5,000 notes)', () => {
  it('loads, indexes, searches and groups quickly', () => {
    const raws = Array.from({ length: COUNT }, (_, index) => makeRaw(index));

    let start = performance.now();
    const notes: NoteSummary[] = raws.map((raw, index) =>
      buildSummary({
        absPath: `/p/.notes/n${index}.md`,
        relPath: `n${index}.md`,
        scope: index % 2 === 0 ? 'shared' : 'private',
        raw,
        mtime: 1_700_000_000_000 + index,
        size: raw.length,
      }),
    );
    const loadMs = performance.now() - start;

    start = performance.now();
    const index = new SearchIndex();
    index.update(
      notes.map((note) => ({
        key: note.key,
        title: note.title,
        tags: note.tags,
        body: note.body,
        updated: note.updated.getTime(),
        version: String(note.mtime),
      })),
    );
    const indexMs = performance.now() - start;

    start = performance.now();
    const hits = index.search('database');
    const searchMs = performance.now() - start;

    start = performance.now();
    const groups = groupNotes(notes, 'tag');
    const groupMs = performance.now() - start;

    start = performance.now();
    const tasks = notes.reduce(
      (total, note) => total + parseTasks(note.body, { noteKey: note.key, noteTitle: note.title, scope: note.scope, relPath: note.relPath }).length,
      0,
    );
    const taskMs = performance.now() - start;

    console.log(
      `perf: load=${loadMs.toFixed(0)}ms index=${indexMs.toFixed(0)}ms search=${searchMs.toFixed(1)}ms group=${groupMs.toFixed(0)}ms tasks=${taskMs.toFixed(0)}ms hits=${hits.length} groups=${groups.length} tasks=${tasks}`,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(loadMs).toBeLessThan(5000);
    expect(searchMs).toBeLessThan(500);
    expect(groupMs).toBeLessThan(1500);
  });
});
