import { describe, expect, it } from 'vitest';
import {
  captureSnippet,
  codeLinkPathFor,
  formatBodyLink,
  locateInLines,
  parseLines,
  resolveCodeLink,
  type CodeFileProvider,
} from '../../src/core/codeLinks';
import {
  buildLinkIndex,
  findBacklinks,
  formatWikiLink,
  parseWikiLinks,
  renameLinksInBody,
  resolveLink,
  validateLinks,
  type LinkableNote,
} from '../../src/core/links';

function provider(files: Record<string, string>): CodeFileProvider {
  return {
    candidates: (path) => [path],
    exists: (path) => path in files,
    readLines: (path) => files[path]?.split('\n'),
  };
}

const source = [
  'import x from "x";',
  '',
  'function login() {',
  '  const token = readToken();',
  '  return token;',
  '}',
  '',
  'function logout() {',
  '  clearToken();',
  '}',
].join('\n');

describe('code links', () => {
  it('parses line ranges', () => {
    expect(parseLines('12-18')).toEqual([12, 18]);
    expect(parseLines('7')).toEqual([7, 7]);
    expect(parseLines('L3-L6')).toEqual([3, 6]);
    expect(parseLines('bad')).toBeUndefined();
  });

  it('captures the first three trimmed lines and the last line', () => {
    const lines = ['a', '  b  ', 'c', 'd', 'e'];
    const snippet = captureSnippet(lines, 1, 5);
    expect(snippet.lines).toBe('1-5');
    expect(snippet.text).toBe('a\nb\nc');
    expect(snippet.endText).toBe('e');
  });

  it('resolves an exact match', () => {
    const result = resolveCodeLink(
      { path: 'a.ts', lines: '3-6', text: 'function login() {', endText: '}' },
      provider({ 'a.ts': source }),
    );
    expect(result.status).toBe('exact');
    expect(result.startLine).toBe(3);
    expect(result.endLine).toBe(6);
  });

  it('finds a moved snippet', () => {
    const moved = `// header\n\n${source}`;
    const result = resolveCodeLink(
      { path: 'a.ts', lines: '3-6', text: 'function login() {\n  const token = readToken();' },
      provider({ 'a.ts': moved }),
    );
    expect(result.status).toBe('moved');
    expect(result.startLine).toBe(5);
  });

  it('falls back to the first line', () => {
    const changed = source.replace('const token = readToken();', 'const token = readToken(user);');
    const result = resolveCodeLink(
      { path: 'a.ts', lines: '3-6', text: 'function login() {\n  const token = readToken();' },
      provider({ 'a.ts': changed }),
    );
    expect(result.status).toBe('moved-first');
    expect(result.startLine).toBe(3);
  });

  it('uses fuzzy matching for small edits', () => {
    const changed = source.replace('function login() {', 'function login(user) {').replace('readToken()', 'readToken(user)');
    const result = resolveCodeLink(
      { path: 'a.ts', lines: '3-5', text: 'function login() {\n  const token = readToken();\n  return token;' },
      provider({ 'a.ts': changed }),
    );
    expect(['fuzzy', 'moved-first']).toContain(result.status);
  });

  it('grows the range with endText when the snippet got longer', () => {
    const longer = source.replace('  return token;', '  log(token);\n  return token;');
    const result = resolveCodeLink(
      { path: 'a.ts', lines: '3-5', text: 'function login() {', endText: '}' },
      provider({ 'a.ts': longer }),
    );
    expect(result.status).toBe('exact');
    expect(result.endLine).toBeGreaterThan(5);
  });

  it('reports lost links', () => {
    const result = resolveCodeLink({ path: 'missing.ts', lines: '1-2' }, provider({}));
    expect(result.status).toBe('lost');
    expect(result.path).toBeUndefined();
  });

  it('locates directly in lines', () => {
    expect(locateInLines(['a', 'b'], { path: 'x', lines: '1-2' })?.status).toBe('exact');
  });

  it('stores relative paths for shared and file URIs for private notes', () => {
    expect(codeLinkPathFor('/p/.notes/n.md', 'shared', '/p/src/a.ts')).toBe('../src/a.ts');
    expect(codeLinkPathFor('/p/.notes/n.md', 'private', '/p/src/a.ts')).toMatch(/^file:\/\//);
    expect(formatBodyLink('src/a.ts#L3-L6', '../src/a.ts#L3-L6')).toBe(
      '[src/a.ts#L3-L6](../src/a.ts#L3-L6)',
    );
  });
});

const linkNotes: LinkableNote[] = [
  { key: '1', id: '01J0ABCDEFGHJKMNPQRSTVWXYZ', title: 'Login flow', fileName: '2026-11-22-login-flow.md', relPath: 'auth/2026-11-22-login-flow.md', scope: 'shared' },
  { key: '2', title: 'Secrets', fileName: 'secrets.md', relPath: 'secrets.md', scope: 'private' },
];

describe('wiki links', () => {
  it('parses heading and alias', () => {
    const [link] = parseWikiLinks('See [[Login flow#Steps|the steps]] now');
    expect(link.target).toBe('Login flow');
    expect(link.heading).toBe('Steps');
    expect(link.alias).toBe('the steps');
    expect(link.raw).toBe('[[Login flow#Steps|the steps]]');
    expect(formatWikiLink('A', 'H', 'B')).toBe('[[A#H|B]]');
  });

  it('ignores links in code', () => {
    expect(parseWikiLinks('`[[nope]]`\n```\n[[nope2]]\n```\n[[yes]]')).toHaveLength(1);
  });

  it('resolves by title, file name, rel path and id', () => {
    const index = buildLinkIndex(linkNotes);
    expect(resolveLink('login flow', index)[0]?.key).toBe('1');
    expect(resolveLink('login-flow', index)[0]?.key).toBe('1');
    expect(resolveLink('auth/2026-11-22-login-flow.md', index)[0]?.key).toBe('1');
    expect(resolveLink('01j0abcdefghjkmnpqrstvwxyz', index)[0]?.key).toBe('1');
    expect(resolveLink('secrets', index, 'shared')[0]?.key).toBe('2');
  });

  it('finds backlinks', () => {
    const backlinks = findBacklinks(
      [{ key: '2', title: 'Secrets', body: 'See [[Login flow]] and [[Login flow#Steps|x]]' }],
      linkNotes[0],
    );
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].links).toHaveLength(2);
  });

  it('renames links while keeping heading and alias', () => {
    const renamed = renameLinksInBody('a [[Old]] b [[Old#H|alias]] c', ['Old'], 'New');
    expect(renamed.text).toBe('a [[New]] b [[New#H|alias]] c');
    expect(renamed.count).toBe(2);
  });

  it('diagnoses missing and private-from-shared links', () => {
    const index = buildLinkIndex(linkNotes);
    const diagnostics = validateLinks('[[Nope]] [[Secrets]]', index, linkNotes[0]);
    expect(diagnostics.map((item) => item.problem)).toEqual(['missing', 'private-from-shared']);
    const privateDiagnostics = validateLinks('[[Secrets]]', index, linkNotes[1]);
    expect(privateDiagnostics).toEqual([]);
  });
});
