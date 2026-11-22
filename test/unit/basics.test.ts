import { describe, expect, it } from 'vitest';
import { formatLocalIso, parseDateLoose, dayKey, startOfWeek } from '../../src/core/time';
import { createUlid, isUlid, ulidTime } from '../../src/core/ulid';
import {
  buildFileName,
  isWindowsDeviceName,
  slugify,
  titleFromFileName,
} from '../../src/core/filenames';
import {
  canonicalPath,
  folderNameFor,
  normalizeRemoteUrl,
  projectKey,
} from '../../src/core/keys';
import { normalizeColor } from '../../src/core/colors';

describe('time', () => {
  it('formats local ISO with offset and no milliseconds', () => {
    const formatted = formatLocalIso(new Date('2026-11-22T11:14:05.123Z'));
    expect(formatted).toMatch(/^2026-11-22T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    expect(formatted).not.toContain('.');
  });

  it('parses loose dates', () => {
    expect(dayKey(parseDateLoose('2026-11-22')!)).toBe('2026-11-22');
    expect(parseDateLoose('2026-11-22T14:14:05+03:00')!.toISOString()).toBe('2026-11-22T11:14:05.000Z');
    expect(parseDateLoose(1700000000000)!.getTime()).toBe(1700000000000);
    expect(parseDateLoose('nonsense')).toBeUndefined();
  });

  it('uses Monday as the start of the week', () => {
    expect(startOfWeek(new Date(2026, 10, 22)).getDay()).toBe(1);
  });
});

describe('ulid', () => {
  it('creates sortable 26 character ids', () => {
    const id = createUlid({ now: 1700000000000, random: () => new Uint8Array(10).fill(7) });
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(ulidTime(id)!.getTime()).toBe(1700000000000);
  });

  it('rejects invalid ids', () => {
    expect(isUlid('nope')).toBe(false);
    expect(isUlid('01J0ABCDEFGHJKMNPQRSTVWXY')).toBe(false);
  });
});

describe('slugify', () => {
  it('removes accents and handles Turkish dotless i', () => {
    expect(slugify('Iğdır Çay Öğün')).toBe('igdir-cay-ogun');
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
  });

  it('replaces unsafe characters and limits length', () => {
    expect(slugify('Hello, world! / test')).toBe('hello-world-test');
    expect(slugify('a'.repeat(100)).length).toBe(60);
    expect(slugify('...')).toBe('');
  });
});

describe('file names', () => {
  it('builds date-slug names and avoids collisions', () => {
    const created = new Date(2026, 10, 22, 14, 14, 5);
    const first = buildFileName({ title: 'Fix login', created, id: 'X' });
    expect(first.fileName).toBe('2026-11-22-fix-login.md');
    const second = buildFileName({ title: 'Fix login', created, id: 'X', taken: [first.fileName] });
    expect(second.fileName).toBe('2026-11-22-fix-login-2.md');
  });

  it('supports all pattern tokens', () => {
    const created = new Date(2026, 0, 2, 3, 4, 5);
    const result = buildFileName({
      pattern: '{date}_{time}_{slug}_{id}',
      title: 'Hi',
      created,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    });
    expect(result.fileName).toBe('2026-01-02_03-04-05_hi_01ARZ3NDEKTSV4RRFFQ69G5FAV.md');
  });

  it('suffixes Windows device names with an underscore', () => {
    expect(isWindowsDeviceName('CON')).toBe(true);
    const result = buildFileName({ pattern: '{slug}', title: 'CON', created: new Date(), id: 'X' });
    expect(result.fileName).toBe('con_.md');
  });

  it('removes invalid characters and trailing dots', () => {
    const result = buildFileName({ pattern: '{slug}', title: 'a<b>c:d', created: new Date(), id: 'X' });
    expect(result.fileName).toBe('a-b-c-d.md');
  });

  it('derives a title from a file name', () => {
    expect(titleFromFileName('2026-11-22-fix-login.md')).toBe('Fix login');
    expect(titleFromFileName('random_note.md')).toBe('Random note');
  });
});

describe('project keys', () => {
  it('normalises scp, ssh and https remotes', () => {
    expect(normalizeRemoteUrl('git@github.com:Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemoteUrl('ssh://git@github.com/Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemoteUrl('https://github.com/Org/Repo.git')).toBe('github.com/org/repo');
    expect(normalizeRemoteUrl('https://user@gitlab.com/Group/Sub/Repo.git/')).toBe('gitlab.com/group/sub/repo');
  });

  it('unifies Azure DevOps URL shapes', () => {
    expect(normalizeRemoteUrl('https://dev.azure.com/Contoso/Proj/_git/Repo')).toBe('dev.azure.com/contoso/proj/repo');
    expect(normalizeRemoteUrl('https://contoso.visualstudio.com/Proj/_git/Repo')).toBe('dev.azure.com/contoso/proj/repo');
    expect(normalizeRemoteUrl('git@ssh.dev.azure.com:v3/Contoso/Proj/Repo')).toBe('dev.azure.com/contoso/proj/repo');
  });

  it('prefers origin and appends monorepo sub folders', () => {
    const key = projectKey({
      remotes: [
        { name: 'upstream', url: 'https://github.com/other/repo.git' },
        { name: 'origin', url: 'git@github.com:Org/Repo.git' },
      ],
      repoRoot: '/work/repo',
      projectRoot: '/work/repo/packages/web',
    });
    expect(key).toBe('github.com/org/repo/packages/web');
  });

  it('uses the first remote when origin is missing', () => {
    const key = projectKey({
      remotes: [{ name: 'upstream', url: 'https://github.com/other/repo.git' }],
      projectRoot: '/work/repo',
    });
    expect(key).toBe('github.com/other/repo');
  });

  it('falls back to local keys and honours the override', () => {
    const withoutRemote = projectKey({ remotes: [], projectRoot: '/home/me/projects/app' });
    expect(withoutRemote).toMatch(/^local\/app-[0-9a-f]{8}$/);
    expect(projectKey({ remotes: [], projectRoot: '/home/me/projects/app' })).toBe(withoutRemote);
    expect(
      projectKey({ remotes: [{ name: 'origin', url: 'git@github.com:a/b.git' }], projectRoot: '/x', override: 'custom/key' }),
    ).toBe('custom/key');
  });

  it('lower-cases the drive letter on Windows', () => {
    expect(canonicalPath('C:\\Work\\App', true)).toBe('c:\\Work\\App');
  });

  it('builds a folder name from the key', () => {
    expect(folderNameFor('github.com/org/repo')).toBe('github.com_org_repo');
    const long = folderNameFor(`github.com/${'a'.repeat(200)}/repo`);
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long).toMatch(/-[0-9a-f]{8}$/);
  });
});

describe('colors', () => {
  it('accepts grey as gray and rejects unknown colors', () => {
    expect(normalizeColor('Grey')).toBe('gray');
    expect(normalizeColor('red')).toBe('red');
    expect(normalizeColor('teal')).toBeUndefined();
    expect(normalizeColor('none')).toBeUndefined();
  });
});
