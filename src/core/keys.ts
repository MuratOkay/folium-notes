/** Git remote parsing and private-folder project keys. */

import path from 'node:path';
import { shortHash } from './filenames';

export interface GitRemote {
  name: string;
  url: string;
}

const SCHEME_RE = /^(ssh|git|https?|ftps?):\/\//i;

function cleanupProjectPath(input: string): string {
  let out = input.trim().replace(/\\/g, '/');
  out = out.replace(/\/{2,}/g, '/');
  out = out.replace(/^\/+|\/+$/g, '');
  out = out.replace(/\.git$/i, '');
  out = out.replace(/\/\.git$/i, '');
  return out.toLowerCase();
}

function azureDevOps(host: string, pathname: string): string | undefined {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (host === 'dev.azure.com') {
    // {org}/{project}/_git/{repo} or {org}/_git/{repo}
    const gitIndex = parts.indexOf('_git');
    if (gitIndex >= 1) {
      const org = parts[0];
      const repo = parts[gitIndex + 1];
      const project = gitIndex >= 2 ? parts[gitIndex - 1] : org;
      if (repo) return `dev.azure.com/${org}/${project}/${repo}`;
    }
    return undefined;
  }
  if (host === 'ssh.dev.azure.com') {
    // v3/{org}/{project}/{repo}
    const gitIndex = parts.indexOf('v3');
    if (gitIndex >= 0 && parts.length >= gitIndex + 4) {
      return `dev.azure.com/${parts[gitIndex + 1]}/${parts[gitIndex + 2]}/${parts[gitIndex + 3]}`;
    }
    return undefined;
  }
  if (host.endsWith('.visualstudio.com')) {
    const org = host.slice(0, -'.visualstudio.com'.length);
    const filtered = parts[0] === 'DefaultCollection' ? parts.slice(1) : parts;
    const gitIndex = filtered.indexOf('_git');
    if (gitIndex >= 1) {
      const project = filtered[gitIndex - 1];
      const repo = filtered[gitIndex + 1];
      if (repo) return `dev.azure.com/${org}/${project}/${repo}`;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Normalise a git remote URL to `host/path` (lower case, no `.git`).
 * Handles SCP-like (`git@host:org/repo.git`), ssh://, https:// and the
 * Azure DevOps forms (dev.azure.com, *.visualstudio.com, ssh.dev.azure.com).
 */
export function normalizeRemoteUrl(url: string): string | undefined {
  if (typeof url !== 'string') return undefined;
  const text = url.trim();
  if (!text) return undefined;
  let host: string | undefined;
  let pathname = '';
  if (SCHEME_RE.test(text)) {
    try {
      const parsed = new URL(text);
      host = parsed.hostname.toLowerCase();
      pathname = parsed.pathname;
    } catch {
      return undefined;
    }
  } else {
    // SCP-like syntax: user@host:path or host:path
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(text);
    if (!scp) {
      // Bare `host/path` (already normalised key) is accepted.
      const bare = /^([^/\\\s]+)\/(.+)$/.exec(text);
      if (!bare) return undefined;
      host = bare[1].toLowerCase();
      pathname = bare[2];
    } else {
      host = scp[1].toLowerCase();
      pathname = scp[2];
    }
  }
  if (!host) return undefined;
  const azure = azureDevOps(host, pathname);
  if (azure) return cleanupProjectPath(azure);
  const cleaned = cleanupProjectPath(pathname);
  if (!cleaned) return host;
  return `${host}/${cleaned}`;
}

/** Pick `origin`, else the first remote (by configuration order). */
export function pickRemote(remotes: GitRemote[]): GitRemote | undefined {
  if (!remotes || remotes.length === 0) return undefined;
  return remotes.find((remote) => remote.name === 'origin') ?? remotes[0];
}

function looksWindows(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || (p.includes('\\') && !p.includes('/'));
}

/** Canonical path used for the local-folder hash (Windows drive lower-cased). */
export function canonicalPath(p: string, isWindows?: boolean): string {
  const windows = isWindows ?? looksWindows(p);
  if (!windows) return path.posix.normalize(p.replace(/\\/g, '/'));
  const win = path.win32.normalize(p);
  return win.replace(/^([A-Za-z]):/, (_m, drive: string) => `${drive.toLowerCase()}:`);
}

function relativeInside(base: string, target: string, isWindows?: boolean): string | undefined {
  const windows = isWindows ?? (looksWindows(base) || looksWindows(target));
  const impl = windows ? path.win32 : path.posix;
  const rel = impl.relative(impl.normalize(base), impl.normalize(target));
  if (!rel || rel === '.' || rel.startsWith('..') || impl.isAbsolute(rel)) return undefined;
  return rel.replace(/\\/g, '/');
}

export interface ProjectKeyInput {
  remotes: GitRemote[];
  /** Workspace / project folder (may be a sub folder of the repository). */
  projectRoot: string;
  /** Repository root (git top level), when known. */
  repoRoot?: string;
  /** `FoliumNotes.privateProjectKey` override. */
  override?: string;
  isWindows?: boolean;
}

export function normalizeProjectKey(key: string): string {
  return key
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '');
}

/** Project key: `<host>/<org>/<repo>[/<sub folder>]` or `local/<folder>-<hash>`. */
export function projectKey(input: ProjectKeyInput): string {
  const override = input.override?.trim();
  if (override) return normalizeProjectKey(override) || override;
  const remote = pickRemote(input.remotes);
  const normalized = remote ? normalizeRemoteUrl(remote.url) : undefined;
  if (normalized) {
    const sub = input.repoRoot
      ? relativeInside(input.repoRoot, input.projectRoot, input.isWindows)
      : undefined;
    return sub ? `${normalized}/${cleanupProjectPath(sub)}` : normalized;
  }
  const canonical = canonicalPath(input.projectRoot, input.isWindows);
  const folderBase = folderStem(canonical.replace(/[\\/]+$/, ''));
  return `local/${folderBase}-${shortHash(canonical)}`;
}

function folderStem(key: string): string {
  const last = key.split(/[\\/]/).filter(Boolean).pop() ?? 'project';
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-{2,}/g, '-');
  return safe || 'project';
}

/** Folder name for a project key: `/` -> `_`, unsafe -> `-`, max 120 chars + hash. */
export function folderNameFor(key: string): string {
  const normalized = normalizeProjectKey(key);
  let name = normalized
    .replace(/\//g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-');
  name = name.replace(/^[-_.]+|[-_.]+$/g, '');
  if (!name) name = 'project';
  if (name.length > 120) {
    name = `${name.slice(0, 111).replace(/[-_.]+$/g, '')}-${shortHash(normalized)}`;
  }
  return name;
}

/** Contents of `<private folder>/.Folium/project.json` (informational only). */
export function projectJson(key: string, folder: string, now: Date = new Date()): string {
  return `${JSON.stringify({ version: 1, key, folder, recordedAt: now.toISOString() }, null, 2)}\n`;
}
