import { describe, expect, it } from 'vitest';
import { SearchIndex, recentNotes, type SearchDoc } from '../../src/core/search';
import { buildSummary, accessibleLabel } from '../../src/core/note';
import {
  applyFilters,
  emptyFilters,
  filterSummary,
  groupNotes,
  matchesFilters,
  sortNotes,
} from '../../src/core/views';

const docs: SearchDoc[] = [
  {
    key: 'a',
    title: 'Login redirect bug',
    tags: ['bug', 'auth/login'],
    body: 'The redirect loops after logout.',
    updated: 300,
  },
  {
    key: 'b',
    title: 'Meeting notes',
    tags: ['meeting'],
    body: 'Discussed the login flow and the redirect strategy.',
    updated: 200,
  },
  { key: 'c', title: 'Shopping', tags: [], body: 'milk, bread', updated: 100 },
];

describe('search', () => {
  const index = new SearchIndex();
  index.update(docs);

  it('boosts title matches above body matches', () => {
    const hits = index.search('login');
    expect(hits.map((hit) => hit.key)).toEqual(['a', 'b']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('requires all words to match', () => {
    expect(index.search('login redirect').map((hit) => hit.key)).toEqual(['a', 'b']);
    expect(index.search('login milk')).toEqual([]);
  });

  it('supports prefixes', () => {
    expect(index.search('redir').map((hit) => hit.key)).toEqual(['a', 'b']);
  });

  it('tolerates typos in longer words', () => {
    expect(index.search('redreict').map((hit) => hit.key)).toContain('a');
    expect(index.search('logn').map((hit) => hit.key)).toContain('a');
  });

  it('filters with #tag tokens, including children', () => {
    expect(index.search('#auth/login').map((hit) => hit.key)).toEqual(['a']);
    expect(index.search('#login').map((hit) => hit.key)).toEqual([]);
    expect(index.search('#auth').map((hit) => hit.key)).toEqual(['a']);
    expect(index.search('redirect #meeting').map((hit) => hit.key)).toEqual(['b']);
  });

  it('produces snippets', () => {
    const hit = index.search('logout')[0];
    expect(hit.snippet?.text).toContain('logout');
  });

  it('returns recent notes when the query is empty', () => {
    expect(recentNotes(docs, 2).map((doc) => doc.key)).toEqual(['a', 'b']);
    expect(index.search('')).toEqual([]);
  });

  it('removes deleted documents', () => {
    const local = new SearchIndex();
    local.update(docs);
    local.update(docs.slice(0, 2));
    expect(local.size).toBe(2);
    expect(local.search('milk')).toEqual([]);
  });
});

function note(overrides: Record<string, unknown> = {}) {
  const raw = [
    '---',
    'id: 01J0ABCDEFGHJKMNPQRSTVWXYZ',
    'title: Fix login',
    'created: 2026-11-22T10:00:00+00:00',
    'updated: 2026-11-22T11:00:00+00:00',
    'tags: [ bug, auth/login ]',
    ...(overrides.extraLines as string[] | undefined ?? []),
    '---',
    '',
    '# Fix login',
    '',
    '- [ ] Reproduce',
    '- [x] Fix',
    '',
  ].join('\n');
  return buildSummary({
    absPath: '/p/.notes/2026-11-22-fix-login.md',
    relPath: '2026-11-22-fix-login.md',
    scope: (overrides.scope as 'shared' | 'private') ?? 'shared',
    raw,
    mtime: new Date('2026-11-22T11:00:00Z').getTime(),
    size: raw.length,
    pinned: overrides.pinned as boolean | undefined,
    color: overrides.color as never,
    tasks: [],
  });
}

describe('note summary', () => {
  it('derives title, tags, dates, tasks and archive state', () => {
    const summary = note();
    expect(summary.title).toBe('Fix login');
    expect(summary.tags).toEqual(['bug', 'auth/login']);
    expect(summary.created.toISOString()).toBe('2026-11-22T10:00:00.000Z');
    expect(summary.key).toBe('01J0ABCDEFGHJKMNPQRSTVWXYZ');
    expect(summary.archived).toBe(false);
    expect(summary.pinned).toBe(false);
  });

  it('builds a screen-reader label', () => {
    const summary = { ...note({ pinned: true, color: 'red' }), openTasks: 2 };
    expect(accessibleLabel(summary)).toBe(
      'Fix login, shared note, red color, pinned, 2 open tasks, tags bug, auth/login',
    );
  });
});

describe('views', () => {
  const now = new Date(2026, 10, 22, 12);
  const notes = [
    { ...note(), title: 'Today note', updated: new Date(2026, 10, 22, 9) },
    { ...note(), title: 'Yesterday note', updated: new Date(2026, 10, 21, 9) },
    { ...note(), title: 'Older note', updated: new Date(2026, 9, 2, 9) },
  ];

  it('groups by date buckets', () => {
    const groups = groupNotes(notes, 'date', now);
    expect(groups.map((group) => group.label)).toEqual(['Today', 'Yesterday', 'October 2026']);
  });

  it('groups by nested tags', () => {
    const groups = groupNotes(notes, 'tag', now);
    expect(groups.some((group) => group.id === 'tag-auth' && group.depth === 0)).toBe(true);
    expect(groups.some((group) => group.id === 'tag-auth/login' && group.depth === 1)).toBe(true);
  });

  it('sorts pinned notes first', () => {
    const sorted = sortNotes(
      [
        { ...notes[0], pinned: false, title: 'B' },
        { ...notes[1], pinned: true, title: 'A' },
      ],
      'title',
      'asc',
      true,
    );
    expect(sorted[0].title).toBe('A');
  });

  it('filters by tags, colors, dates and scope', () => {
    const filters = { ...emptyFilters(), tags: ['auth'], tagMode: 'any' as const };
    expect(applyFilters(notes, filters, now)).toHaveLength(3);
    expect(applyFilters(notes, { ...emptyFilters(), tags: ['auth', 'bug'], tagMode: 'all' }, now)).toHaveLength(3);
    expect(applyFilters(notes, { ...emptyFilters(), colors: ['none'] }, now)).toHaveLength(3);
    expect(applyFilters(notes, { ...emptyFilters(), colors: ['red'] }, now)).toHaveLength(0);
    expect(applyFilters(notes, { ...emptyFilters(), scope: 'private' }, now)).toHaveLength(0);
    expect(applyFilters(notes, { ...emptyFilters(), datePreset: 'today' }, now)).toHaveLength(1);
    expect(matchesFilters(notes[2], { ...emptyFilters(), datePreset: 'last7' }, now)).toBe(false);
  });

  it('filters by title text', () => {
    expect(applyFilters(notes, { ...emptyFilters(), title: 'yester' }, now).map((item) => item.title)).toEqual([
      'Yesterday note',
    ]);
    expect(applyFilters(notes, { ...emptyFilters(), title: 'NOTE' }, now)).toHaveLength(3);
    expect(applyFilters(notes, { ...emptyFilters(), title: 'missing' }, now)).toHaveLength(0);
  });

  it('summarises active filters', () => {
    expect(filterSummary({ ...emptyFilters(), tags: ['a', 'b'], colors: ['red'], datePreset: 'last7', text: 'x' })).toBe(
      'tags (any): a, b · colors: red · last 7 days · text: “x”',
    );
  });
});
