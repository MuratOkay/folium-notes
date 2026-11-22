import { describe, expect, it } from 'vitest';
import {
  encodeScalar,
  normalizeMeta,
  parseNote,
  rawFieldText,
  removeFrontMatterField,
  resolveTitle,
  serializeNote,
  setFrontMatterField,
  setFrontMatterFields,
} from '../../src/core/frontmatter';

describe('parseNote', () => {
  it('parses header and body', () => {
    const raw = [
      '---',
      'id: 01J0ABCDEFGHJKMNPQRSTVWXYZ',
      'title: Fix login',
      'created: 2026-11-22T14:14:05+03:00',
      'tags: [ bug, auth/login ]',
      'color: red',
      'archived: 2026-11-20T10:00:00+03:00',
      'code:',
      '  - path: src/a.ts',
      '    lines: 12-18',
      '---',
      '',
      'Body line',
      '',
    ].join('\n');
    const note = parseNote(raw);
    expect(note.meta.id).toBe('01J0ABCDEFGHJKMNPQRSTVWXYZ');
    expect(note.meta.title).toBe('Fix login');
    expect(note.meta.tags).toEqual(['bug', 'auth/login']);
    expect(note.meta.code).toEqual([{ path: 'src/a.ts', lines: '12-18' }]);
    expect(note.meta.archived).toBe('2026-11-20T10:00:00+03:00');
    expect(note.body.trim()).toBe('Body line');
    expect(note.hasHeader).toBe(true);
  });

  it('accepts comma separated tags and boolean archived', () => {
    const note = parseNote('---\ntags: "a, b c"\narchived: true\n---\n');
    expect(note.meta.tags).toEqual(['a', 'b-c']);
    expect(note.meta.archived).toBe(true);
  });

  it('keeps unknown fields', () => {
    const note = parseNote('---\nmyField: keep me\ncount: 2\n---\n');
    expect(note.meta.myField).toBe('keep me');
    expect(note.meta.count).toBe(2);
  });

  it('works without a header', () => {
    const note = parseNote('# Just a note\n\ntext');
    expect(note.hasHeader).toBe(false);
    expect(note.meta.tags).toEqual([]);
    expect(note.body).toBe('# Just a note\n\ntext');
  });

  it('handles a BOM', () => {
    const note = parseNote('\uFEFF---\ntitle: With BOM\n---\nbody');
    expect(note.meta.title).toBe('With BOM');
    expect(note.body).toBe('body');
  });

  it('normalises code links written as strings', () => {
    const meta = normalizeMeta({ code: ['src/a.ts', { path: 'b.ts', lines: [3, 5] }] });
    expect(meta.code).toEqual([{ path: 'src/a.ts' }, { path: 'b.ts', lines: '3-5' }]);
  });
});

describe('resolveTitle', () => {
  it('prefers the title field', () => {
    expect(resolveTitle(normalizeMeta({ title: 'From header' }), '# Heading\n', '2026-01-01-x.md')).toBe('From header');
  });

  it('falls back to the first non-empty line without # marks', () => {
    expect(resolveTitle(normalizeMeta({}), '\n\n## Heading text\n\nbody', 'x.md')).toBe('Heading text');
  });

  it('falls back to the file name', () => {
    expect(resolveTitle(normalizeMeta({}), '\n\n', '2026-11-22-fix-login.md')).toBe('Fix login');
  });
});

describe('serializeNote', () => {
  it('writes the documented style', () => {
    const raw = serializeNote(
      {
        id: '01J0ABCDEFGHJKMNPQRSTVWXYZ',
        created: '2026-11-22T14:14:05+03:00',
        tags: ['bug', 'needs review'],
        title: 'Fix: login error',
        code: [{ path: 'src/a.ts', lines: '12-18', text: 'const a = 1;\nconst b = 2;', endText: 'const b = 2;' }],
      },
      '# Fix: login error\n',
    );
    expect(raw).toContain('tags: [ bug, needs review ]');
    expect(raw).toContain('title: "Fix: login error"');
    expect(raw).toContain(
      'code:\n  - path: src/a.ts\n    lines: 12-18\n    text: |-\n      const a = 1;\n      const b = 2;\n    endText: const b = 2;',
    );
  });

  it('writes empty lists as [] and plain scalars when safe', () => {
    const raw = serializeNote({ tags: [], created: '2026-11-22T14:14:05+03:00' }, 'body');
    expect(raw).toContain('tags: []');
    expect(raw).toContain('created: 2026-11-22T14:14:05+03:00');
  });

  it('round-trips through parseNote', () => {
    const raw = serializeNote(
      { id: '01J0ABCDEFGHJKMNPQRSTVWXYZ', title: 'A: b', tags: ['x/y'], color: 'blue', extra: { custom: 'v' } },
      'Body\n',
    );
    const note = parseNote(raw);
    expect(note.meta.title).toBe('A: b');
    expect(note.meta.tags).toEqual(['x/y']);
    expect(note.meta.color).toBe('blue');
    expect(note.meta.custom).toBe('v');
  });

  it('encodes scalars safely', () => {
    expect(encodeScalar('plain text')).toBe('plain text');
    expect(encodeScalar('12')).toBe('"12"');
    expect(encodeScalar('true')).toBe('"true"');
    expect(encodeScalar('a: b')).toBe('"a: b"');
    expect(encodeScalar('#tag')).toBe('"#tag"');
    expect(encodeScalar('')).toBe('""');
  });
});

describe('in-place field editing', () => {
  const raw = [
    '---',
    '# keep this comment',
    'id: 01J0ABCDEFGHJKMNPQRSTVWXYZ',
    'created: 2026-11-22T14:14:05+03:00',
    'tags: [ a, b ]',
    'custom:  spaced value  ',
    'code:',
    '  - path: src/a.ts',
    '    lines: 12-18',
    '---',
    '',
    'Body',
    '',
  ].join('\n');

  it('changes only the edited line', () => {
    const updated = setFrontMatterField(raw, 'color', 'red');
    expect(updated).toBe(raw.replace('custom:  spaced value  \n', 'custom:  spaced value  \ncolor: red\n'));
  });

  it('replaces an existing list without touching neighbours', () => {
    const updated = setFrontMatterField(raw, 'tags', ['x', 'y']);
    expect(updated).toContain('tags: [ x, y ]');
    expect(updated).toContain('# keep this comment');
    expect(updated).toContain('custom:  spaced value  ');
    expect(updated).toContain('  - path: src/a.ts\n    lines: 12-18');
  });

  it('replaces a block list of maps', () => {
    const updated = setFrontMatterField(raw, 'code', [{ path: 'b.ts', lines: '1-2' }]);
    expect(updated).toContain('code:\n  - path: b.ts\n    lines: 1-2\n---');
    expect(updated).not.toContain('src/a.ts');
  });

  it('adds a header when the note has none', () => {
    const updated = setFrontMatterField('# Title\n\ntext\n', 'color', 'green');
    expect(updated).toBe('---\ncolor: green\n---\n# Title\n\ntext\n');
  });

  it('removes a field', () => {
    const updated = removeFrontMatterField(raw, 'tags');
    expect(updated).not.toContain('tags:');
    expect(updated).toContain('created: 2026-11-22T14:14:05+03:00');
    expect(updated).toContain('  - path: src/a.ts');
  });

  it('sets several fields', () => {
    const updated = setFrontMatterFields(raw, [
      ['archived', '2026-11-22T15:00:00+03:00'],
      ['sensitive', true],
    ]);
    expect(updated).toContain('archived: 2026-11-22T15:00:00+03:00');
    expect(updated).toContain('sensitive: true');
    expect(rawFieldText(updated, 'sensitive')).toBe('sensitive: true\n');
  });

  it('preserves CRLF line endings', () => {
    const crlf = '---\r\ntitle: A\r\n---\r\nBody\r\n';
    const updated = setFrontMatterField(crlf, 'color', 'blue');
    expect(updated).toBe('---\r\ntitle: A\r\ncolor: blue\r\n---\r\nBody\r\n');
  });
});
