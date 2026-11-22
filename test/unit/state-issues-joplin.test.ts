import { describe, expect, it } from 'vitest';
import {
  effectiveColor,
  emptyState,
  isPinned,
  parseState,
  remapStateKey,
  serializeState,
  setJoplinId,
  setPersonalColor,
  setPinned,
  stateKeyFor,
} from '../../src/core/state';
import { DEFAULT_SETTINGS, mergeSettings } from '../../src/core/settings';
import {
  buildIssueRequest,
  canPublishIssue,
  codePermalink,
  isTrustedIssueHost,
  issueBodyFor,
  issueLabelsFor,
  repoFromProjectKey,
} from '../../src/core/issues';
import { JoplinApi } from '../../src/core/joplin';
import { normalizeMeta } from '../../src/core/frontmatter';

describe('personal state', () => {
  it('prefers file colors for private notes and personal colors for shared notes', () => {
    let state = emptyState();
    state = setPersonalColor(state, 'id1', 'red');
    expect(effectiveColor({ id: 'id1', scope: 'shared', relPath: 'a.md' }, state, false)).toBe('red');
    expect(
      effectiveColor({ id: 'id1', scope: 'shared', relPath: 'a.md', fileColor: 'blue' }, state, true),
    ).toBe('blue');
    expect(
      effectiveColor({ id: 'id1', scope: 'private', relPath: 'a.md', fileColor: 'green' }, state, false),
    ).toBe('green');
    expect(effectiveColor({ scope: 'shared', relPath: 'b.md' }, state, false)).toBeUndefined();
  });

  it('keys by id, else scope:relPath, and round-trips state.json', () => {
    expect(stateKeyFor({ id: 'X', scope: 'shared', relPath: 'a.md' })).toBe('X');
    expect(stateKeyFor({ scope: 'private', relPath: 'a.md' })).toBe('private:a.md');
    let state = setPinned(setPersonalColor(emptyState(), 'X', 'none'), 'X', true);
    state = setJoplinId(state, 'X', 'joplin-1');
    const parsed = parseState(serializeState(state));
    expect(parsed.notes.X).toEqual({ color: 'none', pinned: true, joplinId: 'joplin-1' });
    expect(isPinned({ id: 'X', scope: 'shared', relPath: 'a.md' }, parsed)).toBe(true);
  });

  it('remaps state after a rename', () => {
    const state = setPinned(emptyState(), 'shared:old.md', true);
    const next = remapStateKey(
      state,
      { scope: 'shared', relPath: 'old.md' },
      { scope: 'shared', relPath: 'new.md' },
    );
    expect(next.notes['shared:new.md']?.pinned).toBe(true);
    expect(next.notes['shared:old.md']).toBeUndefined();
  });

  it('tolerates malformed state files', () => {
    expect(parseState('not json')).toEqual({ version: 1, notes: {} });
    expect(parseState('{"notes":{"a":{"color":"red"}}}').notes.a.color).toBe('red');
  });
});

describe('settings', () => {
  it('merges nested settings with defaults', () => {
    const settings = mergeSettings({ sharedFolder: 'notes', tasks: { showCheckMarks: false } });
    expect(settings.sharedFolder).toBe('notes');
    expect(settings.tasks.showCheckMarks).toBe(false);
    expect(settings.tasks.statusBar).toBe(DEFAULT_SETTINGS.tasks.statusBar);
    expect(settings.prompts.defaultTarget).toBe('copilot');
  });
});

describe('issues', () => {
  it('derives the repository from the project key', () => {
    expect(repoFromProjectKey('github.com/org/repo/packages/web')).toEqual({
      host: 'github.com',
      owner: 'org',
      repo: 'repo',
    });
    expect(repoFromProjectKey('local/app-12345678')).toBeUndefined();
    expect(repoFromProjectKey('dev.azure.com/org/proj/repo')).toBeUndefined();
  });

  it('strips header and title and flattens wiki links', () => {
    const body = issueBodyFor({
      title: 'Fix login',
      body: '# Fix login\n\nSee [[Auth flow#Steps|the steps]] and plain text.\n',
    });
    expect(body.startsWith('See the steps › Steps')).toBe(true);
    expect(body).not.toContain('[[');
  });

  it('appends code permalinks', () => {
    const body = issueBodyFor(
      { title: 'T', body: '# T\n\nBody\n' },
      { permalinks: [{ display: 'src/a.ts#L3-L6', url: 'https://github.com/o/r/blob/abc/src/a.ts#L3-L6' }] },
    );
    expect(body).toContain('## Code');
    expect(body).toContain('[src/a.ts#L3-L6](https://github.com/o/r/blob/abc/src/a.ts#L3-L6)');
  });

  it('builds GitHub, GitLab and Jira requests', () => {
    const repo = { host: 'github.com', owner: 'o', repo: 'r' };
    const draft = { title: 'Fix', body: 'Body', labels: ['bug'] };
    const github = buildIssueRequest(
      { provider: 'github', githubToken: 't', tagsAsLabels: true, permalinks: true },
      draft,
      repo,
    );
    expect(github.url).toBe('https://api.github.com/repos/o/r/issues');
    expect(github.headers.Authorization).toBe('Bearer t');
    expect(JSON.parse(github.body).labels).toEqual(['bug']);
    const gitlab = buildIssueRequest(
      { provider: 'gitlab', gitlabToken: 'g', tagsAsLabels: true, permalinks: false },
      draft,
      repo,
    );
    expect(gitlab.url).toContain('/api/v4/projects/o%2Fr/issues');
    const jira = buildIssueRequest(
      {
        provider: 'jira',
        jira: { url: 'https://acme.atlassian.net', email: 'a@b.c', token: 'j', projectKey: 'ABC' },
        tagsAsLabels: false,
        permalinks: false,
      },
      draft,
      undefined,
    );
    expect(jira.url).toBe('https://acme.atlassian.net/rest/api/2/issue');
    expect(JSON.parse(jira.body).fields.project.key).toBe('ABC');
    expect(() => buildIssueRequest({ provider: 'github', tagsAsLabels: true, permalinks: true }, draft, undefined)).toThrow();
  });

  it('only trusts known or confirmed hosts', () => {
    expect(isTrustedIssueHost('github.com')).toBe(true);
    expect(isTrustedIssueHost('api.github.com')).toBe(true);
    expect(isTrustedIssueHost('gitlab.example.com')).toBe(false);
    expect(isTrustedIssueHost('gitlab.example.com', ['gitlab.example.com'])).toBe(true);
  });

  it('refuses sensitive and encrypted notes', () => {
    expect(canPublishIssue({ sensitive: true })).toBe(false);
    expect(canPublishIssue({ sensitive: false, encrypted: true })).toBe(false);
    expect(canPublishIssue({ sensitive: false, encrypted: false })).toBe(true);
  });

  it('builds permalinks and labels', () => {
    const repo = { host: 'github.com', owner: 'o', repo: 'r' };
    expect(codePermalink(repo, 'abc', 'src/a.ts', '3-6')).toBe(
      'https://github.com/o/r/blob/abc/src/a.ts#L3-L6',
    );
    expect(codePermalink(repo, 'abc', 'src/a.ts', '3-6', 'gitlab')).toContain('/-/blob/abc');
    expect(issueLabelsFor({ tags: ['bug', 'auth/login'] }, { provider: 'github', tagsAsLabels: true, permalinks: false })).toEqual([
      'bug',
      'auth/login',
    ]);
    expect(issueLabelsFor({ tags: ['bug'] }, { provider: 'github', tagsAsLabels: false, permalinks: false })).toEqual([]);
  });
});

describe('joplin client', () => {
  function fakeFetch(handlers: Array<{ method: string; match: RegExp; respond: unknown }>) {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const text = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: text, method, body: init?.body as string | undefined });
      for (const handler of handlers) {
        if (handler.method === method && handler.match.test(text)) {
          return new Response(JSON.stringify(handler.respond), { status: 200 });
        }
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it('pings and reuses an existing notebook', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { method: 'GET', match: /\/ping/, respond: { status: 'ok' } },
      { method: 'GET', match: /\/folders/, respond: { items: [{ id: 'nb', title: 'Project' }] } },
    ]);
    const api = new JoplinApi({ url: 'http://localhost:41184', fetchImpl, token: 't' });
    expect(await api.ping()).toBe(true);
    expect(await api.ensureNotebook('Project')).toBe('nb');
    expect(calls.every((call) => call.url.includes('token=t'))).toBe(true);
  });

  it('creates a notebook and a note, and updates by id', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { method: 'GET', match: /\/folders/, respond: { items: [] } },
      { method: 'POST', match: /\/folders$/, respond: { id: 'new-nb' } },
      { method: 'POST', match: /\/notes$/, respond: { id: 'note-1' } },
      { method: 'PUT', match: /\/notes\/note-1/, respond: {} },
    ]);
    const api = new JoplinApi({ url: 'localhost:41184', fetchImpl });
    const notebook = await api.ensureNotebook('Project');
    expect(notebook).toBe('new-nb');
    const noteId = await api.createNote({ parentId: notebook, title: 'T', body: 'B' });
    expect(noteId).toBe('note-1');
    await api.updateNote('note-1', { title: 'T2', body: 'B2' });
    const put = calls.find((call) => call.method === 'PUT');
    expect(JSON.parse(put!.body!)).toEqual({ title: 'T2', body: 'B2' });
  });

  it('reports a friendly error when Joplin is unreachable', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const api = new JoplinApi({ url: 'http://localhost:41184', fetchImpl });
    expect(await api.ping()).toBe(false);
    await expect(api.listNotebooks()).rejects.toThrow(/Cannot reach Joplin/);
  });
});

describe('note meta helpers used by issues', () => {
  it('keeps archived state in metadata', () => {
    expect(normalizeMeta({ archived: true }).archived).toBe(true);
  });
});
