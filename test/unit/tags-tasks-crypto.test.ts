import { describe, expect, it } from 'vitest';
import {
  collectTags,
  countTags,
  extractInlineTags,
  findInlineTags,
  normalizeTag,
  parseTags,
  removeInlineTags,
  renameInlineTags,
  tagWithParents,
} from '../../src/core/tags';
import { dueBucket, parseTasks, setTaskDone, toggleTask } from '../../src/core/tasks';
import {
  decryptNote,
  decryptText,
  encryptNote,
  encryptText,
  fingerprint,
  formatKeyBackup,
  generateKey,
  keyFromText,
  keyToText,
  parseKeyBackup,
  unwrapEncryptedBody,
} from '../../src/core/crypto';
import { parseNote } from '../../src/core/frontmatter';
import { readTar, writeTar } from '../../src/core/tar';
import { createBackup, planRestore, readBackup } from '../../src/core/backup';

describe('tags', () => {
  it('normalises tags', () => {
    expect(normalizeTag('  My Tag  ')).toBe('my-tag');
    expect(normalizeTag('#Nested/Child')).toBe('nested/child');
    expect(normalizeTag('a  b')).toBe('a-b');
    expect(normalizeTag('!!!')).toBe('');
  });

  it('parses header tags from lists and comma strings', () => {
    expect(parseTags(['a', 'B c', 'a'])).toEqual(['a', 'b-c']);
    expect(parseTags('a, b,c')).toEqual(['a', 'b', 'c']);
    expect(parseTags(undefined)).toEqual([]);
  });

  it('finds inline hashtags outside code only', () => {
    const body = [
      'Working on #auth and #auth/login today',
      '```',
      '#notatag',
      '```',
      'Inline `#code` span',
      'Email test@example.com is not a tag',
      'A # without a word',
      '#hash only counts a word with a letter',
      '#123 is not a tag',
    ].join('\n');
    expect(extractInlineTags(body)).toEqual(['auth', 'auth/login', 'hash']);
  });

  it('collects header and inline tags in order', () => {
    expect(collectTags(['header'], 'text #inline', true)).toEqual(['header', 'inline']);
    expect(collectTags(['header'], 'text #inline', false)).toEqual(['header']);
  });

  it('counts parent tags once per note', () => {
    const counts = countTags([['a/b/c', 'a/b'], ['a/b']]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('a/b')).toBe(2);
    expect(counts.get('a/b/c')).toBe(1);
    expect(tagWithParents('a/b')).toEqual(['a', 'a/b']);
  });

  it('renames tags including children and inline occurrences', () => {
    const body = 'See #project/x and #project and #projectile';
    const renamed = renameInlineTags(body, 'project', 'work');
    expect(renamed.text).toBe('See #work/x and #work and #projectile');
    expect(renamed.count).toBe(2);
  });

  it('removes inline tags, leaving the plain word', () => {
    const removed = removeInlineTags('Use #legacy here', 'legacy');
    expect(removed.text).toBe('Use legacy here');
    expect(removed.count).toBe(1);
  });

  it('reports positions of inline tags', () => {
    const [tag] = findInlineTags('a #tag b');
    expect(tag.start).toBe(2);
    expect(tag.end).toBe(6);
  });
});

describe('tasks', () => {
  const source = { noteKey: 'k', noteTitle: 'Note', scope: 'shared' as const, relPath: 'a.md' };

  it('parses tasks outside code blocks', () => {
    const raw = [
      '---',
      'id: X',
      '---',
      '- [ ] Open task due:2026-11-22',
      '* [x] Done task 📅 2026-11-20',
      '1. [ ] Numbered',
      '```',
      '- [ ] not a task',
      '```',
    ].join('\n');
    const tasks = parseTasks(raw, source);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].text).toBe('Open task');
    expect(tasks[0].due).toBe('2026-11-22');
    expect(tasks[1].done).toBe(true);
    expect(tasks[1].due).toBe('2026-11-20');
  });

  it('toggles tasks at the recorded offset', () => {
    const raw = '- [ ] task\n- [x] done\n';
    const tasks = parseTasks(raw, source);
    const toggled = toggleTask(raw, tasks[0].offset);
    expect(toggled.startsWith('- [x] task')).toBe(true);
    const back = setTaskDone(toggled, tasks[0].offset, false);
    expect(back.startsWith('- [ ] task')).toBe(true);
  });

  it('buckets due dates', () => {
    const now = new Date(2026, 10, 22, 12);
    const make = (due: string) => ({ ...parseTasks(`- [ ] x due:${due}`, source)[0] });
    expect(dueBucket(make('2026-11-21'), now)).toBe('overdue');
    expect(dueBucket(make('2026-11-22'), now)).toBe('today');
    expect(dueBucket(make('2026-11-25'), now)).toBe('next7');
    expect(dueBucket(make('2027-01-01'), now)).toBe('later');
    expect(dueBucket({ ...make('2026-11-22'), due: undefined }, now)).toBe('none');
  });
});

describe('crypto', () => {
  it('encrypts and decrypts with AES-256-GCM', () => {
    const key = generateKey();
    const payload = encryptText('secret text', key);
    expect(payload.startsWith('v1.')).toBe(true);
    expect(decryptText(payload, key)).toBe('secret text');
    expect(() => decryptText(payload, generateKey())).toThrow();
  });

  it('round-trips the base64 key text and fingerprint', () => {
    const key = generateKey();
    expect(keyFromText(keyToText(key)).equals(key)).toBe(true);
    expect(fingerprint(key)).toMatch(/^[0-9a-f]{8}$/);
    expect(() => keyFromText('c2hvcnQ=')).toThrow();
  });

  it('keeps the header and title line when encrypting', () => {
    const key = generateKey();
    const raw = [
      '---',
      'id: 01J0ABCDEFGHJKMNPQRSTVWXYZ',
      'created: 2026-11-22T14:14:05+03:00',
      'tags: [ secret ]',
      '---',
      '',
      '# Credentials',
      '',
      'user: admin',
      'pass: hunter2',
      '',
    ].join('\n');
    const encrypted = encryptNote(raw, key);
    expect(encrypted).toContain('# Credentials');
    expect(encrypted).toContain('sensitive: true');
    expect(encrypted).toContain(`encrypted: aes-256-gcm:${fingerprint(key)}`);
    expect(encrypted).not.toContain('hunter2');
    expect(encrypted).toContain('```Folium-encrypted');
    const payload = unwrapEncryptedBody(parseNote(encrypted).body)!;
    expect(payload.length).toBeGreaterThan(20);
    const decrypted = decryptNote(encrypted, key);
    expect(decrypted).toContain('# Credentials');
    expect(decrypted).toContain('pass: hunter2');
    expect(parseNote(decrypted).meta.encrypted).toBeUndefined();
  });

  it('wraps payload lines at 76 characters', () => {
    const key = generateKey();
    const encrypted = encryptNote('---\nid: X\n---\n# T\n\n' + 'x'.repeat(500), key);
    const lines = encrypted.split('\n').filter((line) => /^[A-Za-z0-9+/=]+$/.test(line));
    expect(lines.every((line) => line.length <= 76)).toBe(true);
  });

  it('formats and parses key backups', () => {
    const key = generateKey();
    const backup = formatKeyBackup(key, 'github.com/a/b');
    expect(backup).toContain(`# fingerprint: ${fingerprint(key)}`);
    expect(parseKeyBackup(backup).equals(key)).toBe(true);
  });
});

describe('tar and backup', () => {
  it('round-trips files and long names', () => {
    const long = `${'deep/'.repeat(30)}note.md`;
    const buffer = writeTar([
      { name: 'a/b.md', type: 'file', data: Buffer.from('hello'), mode: 0o644, mtime: 1 },
      { name: long, type: 'file', data: Buffer.from('long'), mode: 0o644, mtime: 1 },
    ]);
    const entries = readTar(buffer);
    expect(entries.map((entry) => entry.name)).toEqual(['a/b.md', long]);
    expect(entries[1].data.toString()).toBe('long');
  });

  it('writes the manifest first and skips .inbox', () => {
    const buffer = createBackup(
      [
        { path: 'proj/note.md', content: '# Note\n' },
        { path: 'proj/.inbox/req.json', content: '{}' },
        { path: 'proj/.Folium/trash/x.md', content: 'old' },
      ],
      { now: new Date('2026-11-22T00:00:00Z'), source: 'test' },
    );
    const entries = readTar(buffer);
    expect(entries[0].name).toBe('Folium-backup.json');
    expect(entries.map((entry) => entry.name)).not.toContain('proj/.inbox/req.json');
    const contents = readBackup(buffer);
    expect(contents.manifest?.version).toBe(1);
    expect(contents.manifest?.counts.notes).toBe(2);
  });

  it('restores only missing files', () => {
    const plan = planRestore(
      [
        { path: 'a.md', content: 'new' },
        { path: 'b.md', content: 'new' },
        { path: '../evil.md', content: 'x' },
      ],
      ['a.md'],
    );
    expect(plan.write.map((file) => file.path)).toEqual(['b.md']);
    expect(plan.conflicts).toEqual(['a.md']);
    expect(plan.skipped).toEqual(['../evil.md']);
  });
});

describe('tar interoperability', () => {
  const hasTar = (() => {
    try {
      require('node:child_process').execFileSync('tar', ['--version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasTar)('writes archives GNU tar can read (long names included)', async () => {
    const { execFileSync } = require('node:child_process');
    const fsMod = require('node:fs');
    const osMod = require('node:os');
    const pathMod = require('node:path');
    const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'folium-tar-'));
    const longName = `${'deep/'.repeat(30)}note.md`;
    const file = pathMod.join(dir, 'backup.tar');
    fsMod.writeFileSync(
      file,
      writeTar([
        { name: 'Folium-backup.json', type: 'file', data: Buffer.from('{}'), mode: 0o644, mtime: 1 },
        { name: longName, type: 'file', data: Buffer.from('long'), mode: 0o644, mtime: 1 },
      ]),
    );
    const listing = execFileSync('tar', ['-tf', file], { encoding: 'utf8' });
    // Windows tar.exe emits CRLF; normalize before comparing.
    expect(listing.trim().split(/\r?\n/)).toEqual(['Folium-backup.json', longName]);
    fsMod.rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!hasTar)('reads archives created by GNU tar', async () => {
    const { execFileSync } = require('node:child_process');
    const fsMod = require('node:fs');
    const osMod = require('node:os');
    const pathMod = require('node:path');
    const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'folium-tar-src-'));
    fsMod.mkdirSync(pathMod.join(dir, 'a'), { recursive: true });
    fsMod.writeFileSync(pathMod.join(dir, 'a', 'b.md'), 'hi');
    const file = pathMod.join(dir, 'gnu.tar');
    execFileSync('tar', ['-cf', file, '-C', dir, 'a']);
    const entries = readTar(fsMod.readFileSync(file));
    expect(entries.map((entry) => entry.name)).toContain('a/b.md');
    expect(entries.find((entry) => entry.name === 'a/b.md')?.data.toString()).toBe('hi');
    fsMod.rmSync(dir, { recursive: true, force: true });
  });
});
