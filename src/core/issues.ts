/** Issue creation for GitHub, GitLab and Jira. Tokens only go to trusted hosts. */

import { isArchived, type NoteMeta } from './frontmatter';
import { parseWikiLinks } from './links';
import { normalizeProjectKey } from './keys';
import type { Scope } from './state';

export type IssueProvider = 'github' | 'gitlab' | 'jira';

export interface JiraSettings {
  url?: string;
  email?: string;
  token?: string;
  projectKey?: string;
  issueType?: string;
}

export interface IssueSettings {
  provider: IssueProvider | '';
  githubToken?: string;
  githubApiUrl?: string;
  gitlabToken?: string;
  gitlabUrl?: string;
  jira?: JiraSettings;
  tagsAsLabels: boolean;
  permalinks: boolean;
}

export interface RepoRef {
  host: string;
  owner: string;
  repo: string;
}

export interface IssueDraft {
  title: string;
  body: string;
  labels: string[];
}

export interface IssueRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  /** Host that receives the token (for the trust check). */
  host: string;
}

const TRUSTED_HOSTS = ['github.com', 'api.github.com', 'gitlab.com'];

/** `github.com/org/repo/sub` -> owner/repo (Azure and local keys yield nothing). */
export function repoFromProjectKey(key: string): RepoRef | undefined {
  const normalized = normalizeProjectKey(key);
  const parts = normalized.split('/');
  if (parts.length < 3) return undefined;
  const host = parts[0];
  if (host === 'dev.azure.com' || host === 'local') return undefined;
  return { host, owner: parts[1], repo: parts[2] };
}

export function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Tokens may only be sent to github.com / gitlab.com or hosts the user confirmed. */
export function isTrustedIssueHost(host: string | undefined, confirmed: string[] = []): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  return TRUSTED_HOSTS.includes(lower) || confirmed.map((h) => h.toLowerCase()).includes(lower);
}

/** Body without the header and title; wiki links become plain text. */
export function issueBodyFor(
  note: { title: string; body: string; meta?: NoteMeta; scope?: Scope; relPath?: string },
  options: { permalinks?: Array<{ display: string; url: string }> } = {},
): string {
  let body = note.body;
  const heading = /^\s*#{1,6}\s+.*(?:\r?\n|$)/.exec(body);
  if (heading) body = body.slice(heading[0].length);
  body = body.replace(/\[\[([^[\]\n]+)\]\]/g, (_raw, inner: string) => {
    let target = inner;
    let alias: string | undefined;
    const pipe = target.indexOf('|');
    if (pipe !== -1) {
      alias = target.slice(pipe + 1);
      target = target.slice(0, pipe);
    }
    const hash = target.indexOf('#');
    const headingPart = hash === -1 ? '' : ` › ${target.slice(hash + 1)}`;
    if (hash !== -1) target = target.slice(0, hash);
    return `${alias ?? target}${headingPart}`;
  });
  const links = options.permalinks ?? [];
  if (links.length > 0) {
    body += `\n\n## Code\n\n${links.map((link) => `- [${link.display}](${link.url})`).join('\n')}\n`;
  }
  return body.trim() + '\n';
}

export function issueTitleFor(note: { title: string; meta?: NoteMeta }): string {
  return note.title.trim() || 'Note';
}

export function issueLabelsFor(note: { tags: string[] }, settings: IssueSettings): string[] {
  return settings.tagsAsLabels ? note.tags : [];
}

function encodeProjectPath(owner: string, repo: string): string {
  return encodeURIComponent(`${owner}/${repo}`);
}

/** Build the HTTP request for the configured provider. */
export function buildIssueRequest(
  settings: IssueSettings,
  draft: IssueDraft,
  repo: RepoRef | undefined,
  note?: { id?: string; relPath?: string; scope?: Scope; archived?: boolean },
): IssueRequest {
  if (settings.provider === 'github') {
    if (!repo || repo.host !== 'github.com') throw new Error('GitHub issues need a github.com remote');
    const api = (settings.githubApiUrl || 'https://api.github.com').replace(/\/+$/, '');
    return {
      url: `${api}/repos/${repo.owner}/${repo.repo}/issues`,
      method: 'POST',
      host: hostOf(api) ?? 'api.github.com',
      headers: {
        Authorization: `Bearer ${settings.githubToken ?? ''}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'FoliumNotes',
      },
      body: JSON.stringify({ title: draft.title, body: draft.body, labels: draft.labels }),
    };
  }
  if (settings.provider === 'gitlab') {
    if (!repo) throw new Error('GitLab issues need a git remote');
    const base = (settings.gitlabUrl || (repo.host === 'gitlab.com' ? 'https://gitlab.com' : `https://${repo.host}`)).replace(/\/+$/, '');
    return {
      url: `${base}/api/v4/projects/${encodeProjectPath(repo.owner, repo.repo)}/issues`,
      method: 'POST',
      host: hostOf(base) ?? repo.host,
      headers: {
        'PRIVATE-TOKEN': settings.gitlabToken ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: draft.title, description: draft.body, labels: draft.labels.join(',') }),
    };
  }
  if (settings.provider === 'jira') {
    const jira = settings.jira ?? {};
    if (!jira.url || !jira.projectKey) throw new Error('Jira needs a URL and a project key');
    const base = jira.url.replace(/\/+$/, '');
    const auth = Buffer.from(`${jira.email ?? ''}:${jira.token ?? ''}`, 'utf8').toString('base64');
    return {
      url: `${base}/rest/api/2/issue`,
      method: 'POST',
      host: hostOf(base) ?? '',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: jira.projectKey },
          summary: draft.title,
          description: draft.body,
          issuetype: { name: jira.issueType || 'Task' },
          labels: draft.labels,
        },
      }),
    };
  }
  throw new Error('No issue provider configured');
}

/** Permalink for a code link at a pushed commit (GitHub/GitLab style). */
export function codePermalink(
  repo: RepoRef | undefined,
  commit: string,
  path: string,
  lines?: string,
  provider: IssueProvider = 'github',
): string | undefined {
  if (!repo) return undefined;
  const clean = path.replace(/^file:\/\//, '').replace(/\\/g, '/');
  const anchor = lines ? `#L${lines.replace('-', '-L')}` : '';
  if (provider === 'github') {
    return `https://github.com/${repo.owner}/${repo.repo}/blob/${commit}/${clean.replace(/^\/+/, '')}${anchor}`;
  }
  if (provider === 'gitlab') {
    return `https://${repo.host}/${repo.owner}/${repo.repo}/-/blob/${commit}/${clean.replace(/^\/+/, '')}${anchor}`;
  }
  return undefined;
}

/** Notes that should never be sent to an issue tracker. */
export function canPublishIssue(note: { sensitive: boolean; encrypted?: boolean; meta?: NoteMeta }): boolean {
  return !note.sensitive && !note.encrypted && !(note.meta ? isArchived(note.meta) : false);
}

export function issueLinkText(note: { title: string }): string {
  return parseWikiLinks(note.title).length > 0 ? note.title : note.title;
}
