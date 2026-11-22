/** Windows behaviour simulated with path.win32 (no Windows host required). */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFileName, isWindowsDeviceName, slugify } from '../../src/core/filenames';
import { canonicalPath, folderNameFor, projectKey } from '../../src/core/keys';

const BS = String.fromCharCode(92);
const win = (...parts: string[]): string => parts.join(BS);

describe('windows paths', () => {
  it('lower-cases the drive letter for the local hash', () => {
    const canonical = canonicalPath(win('C:', 'Users', 'Ada', 'Repo'), true);
    expect(canonical.startsWith(`c:${BS}`)).toBe(true);
    expect(canonicalPath(win('c:', 'Users', 'Ada', 'Repo'), true)).toBe(canonical);
  });

  it('normalises backslashes to forward slashes', () => {
    expect(canonicalPath(win('C:', 'Users', 'Ada', 'Repo'), true).split(BS).join('/')).toBe('c:/Users/Ada/Repo');
  });

  it('appends monorepo sub folders using win32 paths', () => {
    const key = projectKey({
      remotes: [{ name: 'origin', url: 'git@github.com:Org/Repo.git' }],
      repoRoot: win('C:', 'Work', 'Repo'),
      projectRoot: win('C:', 'Work', 'Repo', 'packages', 'web'),
      isWindows: true,
    });
    expect(key).toBe('github.com/org/repo/packages/web');
  });

  it('produces deterministic local keys despite drive letter case', () => {
    const first = projectKey({ remotes: [], projectRoot: win('D:', 'Code', 'App'), isWindows: true });
    const second = projectKey({ remotes: [], projectRoot: win('d:', 'Code', 'App'), isWindows: true });
    expect(first).toBe(second);
    expect(first).toMatch(/^local\/[A-Za-z0-9._-]+-[0-9a-f]{8}$/);
  });

  it('computes relative paths with path.win32', () => {
    const relative = path.win32.relative(win('C:', 'Work', 'Repo'), win('C:', 'Work', 'Repo', 'packages', 'web'));
    expect(relative.split(BS).join('/')).toBe('packages/web');
  });
});

describe('windows file names', () => {
  it('recognises reserved device names with and without extensions', () => {
    for (const name of ['CON', 'prn', 'AUX', 'nul', 'COM1', 'lpt9']) {
      expect(isWindowsDeviceName(name)).toBe(true);
      expect(isWindowsDeviceName(`${name}.md`)).toBe(true);
    }
    expect(isWindowsDeviceName('console')).toBe(false);
  });

  it('escapes device names when building files', () => {
    for (const name of ['CON', 'aux', 'LPT1']) {
      const { fileName } = buildFileName({ pattern: '{slug}', title: name, created: new Date(), id: 'X' });
      expect(fileName).toBe(`${name.toLowerCase()}_.md`);
    }
  });

  it('avoids collisions case-insensitively (Windows file systems)', () => {
    const created = new Date(2026, 10, 22);
    const { fileName } = buildFileName({
      title: 'Fix Login',
      created,
      id: 'X',
      taken: ['2026-11-22-fix-login.md'.toUpperCase()],
    });
    expect(fileName).toBe('2026-11-22-fix-login-2.md');
  });

  it('strips characters Windows rejects', () => {
    const { fileName } = buildFileName({ pattern: '{slug}', title: slugify('a*?b|c'), created: new Date(), id: 'X' });
    expect(fileName).toBe('a-b-c.md');
  });

  it('keeps long folder names within 120 characters', () => {
    const name = folderNameFor(`github.com/${'x'.repeat(300)}/repo`);
    expect(name.length).toBeLessThanOrEqual(120);
  });
});
