/** Deterministic fixtures generated from the TS core (TZ=UTC). */

import { createCipheriv } from 'node:crypto';
import {
  encodeScalar,
  normalizeMeta,
  parseNote,
  removeFrontMatterField,
  resolveTitle,
  serializeNote,
  setFrontMatterField,
} from '../../src/core/frontmatter';
import { buildFileName, slugify, titleFromFileName } from '../../src/core/filenames';
import { folderNameFor, normalizeRemoteUrl, projectKey } from '../../src/core/keys';
import { collectTags, countTags, extractInlineTags, normalizeTag, removeInlineTags, renameInlineTags } from '../../src/core/tags';
import { parseTasks } from '../../src/core/tasks';
import { SearchIndex } from '../../src/core/search';
import { BUILTIN_TEMPLATES, renderTemplate, validateTemplate, sampleContext, templateFileContent } from '../../src/core/templates';
import { locateInLines, parseLines, captureSnippet } from '../../src/core/codeLinks';
import { buildLinkIndex, findBacklinks, parseWikiLinks, renameLinksInBody, resolveLink, validateLinks } from '../../src/core/links';
import { fingerprint, keyFromText, keyToText } from '../../src/core/crypto';
import { groupNotes } from '../../src/core/views';
import { buildSummary } from '../../src/core/note';
import { dueBucket } from '../../src/core/tasks';

const noteRaw = [
  '---',
  'id: 01J0ABCDEFGHJKMNPQRSTVWXYZ',
  'title: Fix login redirect',
  'created: 2026-11-22T14:14:05+03:00',
  'tags: [ bug, auth/login ]',
  'color: red',
  'code:',
  '  - path: ../src/auth/login.ts',
  '    lines: 12-18',
  '    text: |-',
  '      export function login() {',
  '      return redirect(url);',
  '    endText: }',
  '---',
  '',
  '# Fix login redirect',
  '',
  'The redirect loops after logout. See [[Auth flow]] and #needs-review.',
  '',
  '- [ ] Reproduce due:2026-11-25',
  '- [x] Write test',
  '',
].join('\n');

const sourceLines = [
  'import { redirect } from "./redirect";',
  '',
  'export function login() {',
  '  const token = readToken();',
  '  return redirect(url);',
  '}',
  '',
  'export function logout() {',
  '  clearToken();',
  '}',
];

const searchDocs = [
  { key: 'a', title: 'Login redirect bug', tags: ['bug', 'auth/login'], body: 'The redirect loops after logout.', updated: 300 },
  { key: 'b', title: 'Meeting notes', tags: ['meeting'], body: 'Discussed the login flow and the redirect strategy.', updated: 200 },
  { key: 'c', title: 'Shopping', tags: [], body: 'milk, bread', updated: 100 },
];

const linkNotes = [
  { key: '1', id: '01J0ABCDEFGHJKMNPQRSTVWXYZ', title: 'Login flow', fileName: '2026-11-22-login-flow.md', relPath: 'auth/2026-11-22-login-flow.md', scope: 'shared' as const },
  { key: '2', title: 'Secrets', fileName: 'secrets.md', relPath: 'secrets.md', scope: 'private' as const },
];

function cryptoFixtures() {
  const key = keyFromText('AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=');
  const iv = Buffer.from('000102030405060708090a0b', 'hex');
  const plaintext = '# Credentials\n\nuser: admin\npass: hunter2\n';
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = `v1.${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
  return {
    keyText: keyToText(key),
    fingerprint: fingerprint(key),
    plaintext,
    iv: iv.toString('hex'),
    payload,
    header: `aes-256-gcm:${fingerprint(key)}`,
  };
}

function frontMatterFixtures() {
  const parsed = parseNote(noteRaw);
  const raw = [
    '---',
    '# comment stays',
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
  return {
    noteRaw,
    parsed: { meta: parsed.meta, body: parsed.body, hasHeader: parsed.hasHeader },
    titleCases: [
      { meta: { title: 'From header' }, body: '# Heading\n', fileName: 'x.md', title: 'From header' },
      { meta: {}, body: '\n\n## Heading text\n\nbody', fileName: 'x.md', title: 'Heading text' },
      { meta: {}, body: '\n\n', fileName: '2026-11-22-fix-login.md', title: 'Fix login' },
    ].map((item) => ({ ...item, resolved: resolveTitle(normalizeMeta(item.meta), item.body, item.fileName) })),
    scalars: ['plain text', '12', 'true', 'a: b', '#tag', '', 'needs review', '2026-11-22T14:14:05+03:00'].map((value) => ({
      value,
      encoded: encodeScalar(value),
    })),
    serialize: {
      init: {
        id: '01J0ABCDEFGHJKMNPQRSTVWXYZ',
        title: 'Fix: login error',
        created: '2026-11-22T14:14:05+03:00',
        tags: ['bug', 'needs review'],
        code: [{ path: 'src/a.ts', lines: '12-18', text: 'const a = 1;\nconst b = 2;', endText: 'const b = 2;' }],
        extra: { custom: 'v' },
      },
      body: '# Fix: login error\n',
      expected: serializeNote(
        {
          id: '01J0ABCDEFGHJKMNPQRSTVWXYZ',
          title: 'Fix: login error',
          created: '2026-11-22T14:14:05+03:00',
          tags: ['bug', 'needs review'],
          code: [{ path: 'src/a.ts', lines: '12-18', text: 'const a = 1;\nconst b = 2;', endText: 'const b = 2;' }],
          extra: { custom: 'v' },
        },
        '# Fix: login error\n',
      ),
    },
    edits: [
      { key: 'color', value: 'red', expected: setFrontMatterField(raw, 'color', 'red') },
      { key: 'tags', value: ['x', 'y'], expected: setFrontMatterField(raw, 'tags', ['x', 'y']) },
      { key: 'code', value: [{ path: 'b.ts', lines: '1-2' }], expected: setFrontMatterField(raw, 'code', [{ path: 'b.ts', lines: '1-2' }]) },
      { key: 'tags', value: undefined, expected: removeFrontMatterField(raw, 'tags') },
    ],
  };
}

export function buildFixtures(): Record<string, unknown> {
  const remoteUrls = [
    'git@github.com:Org/Repo.git',
    'ssh://git@github.com/Org/Repo.git',
    'https://github.com/Org/Repo.git',
    'https://user@gitlab.com/Group/Sub/Repo.git/',
    'https://dev.azure.com/Contoso/Proj/_git/Repo',
    'https://contoso.visualstudio.com/Proj/_git/Repo',
    'git@ssh.dev.azure.com:v3/Contoso/Proj/Repo',
    'https://bitbucket.org/team/repo.git',
  ];
  const keyCases = [
    {
      name: 'monorepo sub folder',
      input: {
        remotes: [
          { name: 'upstream', url: 'https://github.com/other/repo.git' },
          { name: 'origin', url: 'git@github.com:Org/Repo.git' },
        ],
        repoRoot: '/work/repo',
        projectRoot: '/work/repo/packages/web',
      },
    },
    {
      name: 'first remote',
      input: { remotes: [{ name: 'upstream', url: 'https://github.com/other/repo.git' }], projectRoot: '/work/repo' },
    },
    { name: 'no remote', input: { remotes: [], projectRoot: '/home/ada/projects/app' } },
    { name: 'windows local', input: { remotes: [], projectRoot: 'C:\\Users\\Ada\\App', isWindows: true } },
    { name: 'override', input: { remotes: [{ name: 'origin', url: 'git@github.com:a/b.git' }], projectRoot: '/x', override: 'custom/key' } },
  ];

  const created = new Date('2026-11-22T14:14:05Z');
  const fileCases = [
    { pattern: '{date}-{slug}', title: 'Fix login', created, id: '01J0ABCDEFGHJKMNPQRSTVWXYZ' },
    { pattern: '{date}_{time}_{slug}_{id}', title: 'Hello, World!', created, id: '01J0ABCDEFGHJKMNPQRSTVWXYZ' },
    { pattern: '{slug}', title: 'CON', created, id: 'X' },
    { pattern: '{slug}', title: 'a<b>c:d', created, id: 'X' },
  ];

  const tagBody = [
    'Working on #auth and #auth/login today',
    '```',
    '#notatag',
    '```',
    'Inline `#code` span',
    'Email test@example.com is not a tag',
    '#hash only counts a word with a letter',
    '#123 is not a tag',
  ].join('\n');

  const taskSource = {
    noteKey: '01J0ABCDEFGHJKMNPQRSTVWXYZ',
    noteTitle: 'Fix login redirect',
    scope: 'shared' as const,
    relPath: '2026-11-22-fix-login-redirect.md',
  };
  const tasks = parseTasks(noteRaw, taskSource);

  const search = new SearchIndex();
  search.update(searchDocs);
  const queries = ['login', 'login redirect', 'redir', 'redreict', '#auth', '#login', 'redirect #meeting', 'milk'];

  const templates = {
    builtins: BUILTIN_TEMPLATES.map((template) => ({
      name: template.name,
      description: template.description,
      tags: template.tags ?? [],
      privateOnly: template.privateOnly ?? false,
      sharedOnly: template.sharedOnly ?? false,
      sensitive: template.sensitive ?? false,
      kind: template.kind ?? '',
      body: template.body,
    })),
    render: {
      body: '{{title}}|{{date}}|{{time}}|{{user}}|{{project}}|{{branch}}|{{cursor}}',
      context: sampleContext(),
      expected: renderTemplate('{{title}}|{{date}}|{{time}}|{{user}}|{{project}}|{{branch}}|{{cursor}}', sampleContext()),
    },
    questions: renderTemplate('{{ask:Which tool?|Copilot|Cline}}', { ...sampleContext(), answers: {} }).questions,
    problems: [
      { body: '{{titel}}', kind: 'note' },
      { body: '{{selection}}', kind: 'note' },
      { body: '{{ask:}}', kind: 'note' },
      { body: '{{cursor}} {{cursor}}', kind: 'note' },
      { body: '{{ask:Pick|A|a}}', kind: 'note' },
    ].map((item) => ({ ...item, problems: validateTemplate(item.body, { kind: item.kind }) })),
  };

  const codeLinks = [
    { name: 'exact', link: { path: 'a.ts', lines: '3-6', text: 'export function login() {', endText: '}' }, lines: sourceLines },
    { name: 'moved', link: { path: 'a.ts', lines: '3-4', text: 'export function login() {\n  const token = readToken();' }, lines: ['// header', '', ...sourceLines] },
    { name: 'moved-first', link: { path: 'a.ts', lines: '3-4', text: 'export function login() {\n  const token = readToken(user);' }, lines: sourceLines },
    { name: 'lost', link: { path: 'missing.ts', lines: '1-2', text: 'nope' }, lines: [] },
  ].map((item) => ({
    name: item.name,
    link: item.link,
    lines: item.lines,
    result: locateInLines(item.lines, item.link) ?? null,
  }));

  const index = buildLinkIndex(linkNotes);
  const links = {
    parse: parseWikiLinks('See [[Login flow#Steps|the steps]] and `[[code]]`'),
    resolve: {
      byTitle: resolveLink('login flow', index).map((note) => note.key),
      byFileName: resolveLink('login-flow', index).map((note) => note.key),
      byRelPath: resolveLink('auth/2026-11-22-login-flow.md', index).map((note) => note.key),
      byId: resolveLink('01j0abcdefghjkmnpqrstvwxyz', index).map((note) => note.key),
      missing: resolveLink('nope', index).map((note) => note.key),
    },
    backlinks: findBacklinks(
      [{ key: '2', title: 'Secrets', body: 'See [[Login flow]] and [[Login flow#Steps|x]]' }],
      linkNotes[0],
    )
      .flatMap((entry) => entry.links)
      .map((link) => link.raw),
    rename: renameLinksInBody('a [[Old]] b [[Old#H|alias]] c', ['Old'], 'New'),
    diagnostics: validateLinks('[[Nope]] [[Secrets]]', index, linkNotes[0]).map((item) => ({
      problem: item.problem,
      target: item.link.target,
    })),
  };

  const now = new Date('2026-11-22T12:00:00Z');
  const notes = [
    { title: 'Today note', updated: '2026-11-22T09:00:00Z' },
    { title: 'Yesterday note', updated: '2026-11-21T09:00:00Z' },
    { title: 'Older note', updated: '2026-10-02T09:00:00Z' },
  ].map((item, index) =>
    buildSummary({
      absPath: `/p/.notes/n${index}.md`,
      relPath: `n${index}.md`,
      scope: 'shared',
      raw: [
        '---',
        `id: 01J0ABCDEFGHJKMNPQRSTVWX${String(index).padStart(2, '0')}`,
        `title: ${item.title}`,
        `updated: ${item.updated}`,
        'tags: [ bug, auth/login ]',
        '---',
        '',
        `# ${item.title}`,
        '',
      ].join('\n'),
      mtime: new Date(item.updated).getTime(),
      size: 100,
    }),
  );
  const views = {
    date: groupNotes(notes, 'date', now).map((group) => ({ id: group.id, label: group.label, count: group.notes.length })),
    tag: groupNotes(notes, 'tag', now).map((group) => ({ id: group.id, label: group.label, depth: group.depth })),
    scope: groupNotes(notes, 'scope', now).map((group) => ({ id: group.id, count: group.notes.length })),
  };

  return {
    'frontmatter.json': frontMatterFixtures(),
    'project-keys.json': {
      remoteUrls: remoteUrls.map((url) => ({ url, key: normalizeRemoteUrl(url) ?? null })),
      keyCases: keyCases.map((item) => ({ ...item, key: projectKey(item.input as never) })),
      folderNames: [
        'github.com/org/repo',
        'dev.azure.com/contoso/proj/repo',
        `github.com/${'a'.repeat(200)}/repo`,
      ].map((key) => ({ key, folder: folderNameFor(key) })),
    },
    'filenames.json': {
      slugs: ['Iğdır Çay Öğün', 'Crème brûlée', 'Hello, world! / test', 'a'.repeat(100), '...'].map((input) => ({
        input,
        slug: slugify(input),
      })),
      files: fileCases.map((item) => ({
        ...item,
        created: item.created.toISOString(),
        result: buildFileName({ ...item, created: new Date(item.created) }),
      })),
      collision: buildFileName({ pattern: '{date}-{slug}', title: 'Fix login', created, id: 'X', taken: ['2026-11-22-fix-login.md'] }),
      titles: ['2026-11-22-fix-login.md', 'random_note.md'].map((fileName) => ({ fileName, title: titleFromFileName(fileName) })),
    },
    'tags.json': {
      normalize: ['My Tag', '#Nested/Child', 'a  b', '!!!'].map((input) => ({ input, tag: normalizeTag(input) })),
      inline: extractInlineTags(tagBody),
      collected: collectTags(['header'], 'text #inline', true),
      counts: [...countTags([['a/b/c', 'a/b'], ['a/b']]).entries()],
      rename: renameInlineTags('See #project/x and #project and #projectile', 'project', 'work'),
      remove: removeInlineTags('Use #legacy here', 'legacy'),
      body: tagBody,
    },
    'tasks.json': {
      note: noteRaw,
      tasks,
      buckets: tasks.map((task) => ({ text: task.text, bucket: dueBucket(task, new Date('2026-11-22T12:00:00Z')) })),
      lineRanges: ['12-18', '7', 'bad'].map((input) => ({ input, range: parseLines(input) ?? null })),
      snippet: captureSnippet(sourceLines, 1, 5),
    },
    'search.json': {
      docs: searchDocs,
      results: queries.map((query) => ({ query, keys: search.search(query).map((hit) => hit.key) })),
      recent: searchDocs.map((doc) => doc.key),
    },
    'templates.json': templates,
    'code-links.json': { sourceLines, cases: codeLinks, statusLabels: { exact: 'Exact', moved: 'Moved', 'moved-first': 'Moved (first line)', fuzzy: 'Fuzzy match', lost: 'Lost' } },
    'links.json': { notes: linkNotes, ...links },
    'views.json': views,
    'crypto.json': cryptoFixtures(),
  };
}

/** Built-in templates as Markdown files for the shared spec. */
export function buildTemplateResources(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const template of BUILTIN_TEMPLATES) {
    const fileName = `${slugify(template.name) || 'template'}.md`;
    out[fileName] = templateFileContent({
      name: template.name,
      description: template.description,
      privateOnly: template.privateOnly,
      sharedOnly: template.sharedOnly,
      sensitive: template.sensitive,
      kind: template.kind,
      target: template.target,
      tags: template.tags,
      color: template.color,
      body: template.body,
    });
  }
  return out;
}
