/** Git helpers: remotes, branch, user name and branch change notification. */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitRemote } from './core/keys';

const exec = promisify(execFile);

export interface GitInfo {
  remotes: GitRemote[];
  branch?: string;
  repoRoot?: string;
  userName?: string;
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['-C', cwd, ...args], { timeout: 4000, windowsHide: true });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

export async function readGitInfo(cwd: string): Promise<GitInfo> {
  const [remoteText, branch, repoRoot, userName] = await Promise.all([
    git(cwd, ['remote', '-v']),
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(cwd, ['rev-parse', '--show-toplevel']),
    git(cwd, ['config', 'user.name']),
  ]);
  const remotes: GitRemote[] = [];
  for (const line of (remoteText ?? '').split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line.trim());
    if (!match) continue;
    if (!remotes.some((remote) => remote.name === match[1])) {
      remotes.push({ name: match[1], url: match[2] });
    }
  }
  return {
    remotes,
    branch: branch && branch !== 'HEAD' ? branch : undefined,
    repoRoot: repoRoot || undefined,
    userName: userName || undefined,
  };
}

/** Poll `.git/HEAD` (the VS Code file watcher does not report it reliably). */
export function watchGitHead(
  repoRoot: string,
  onChange: (branch: string | undefined) => void,
): { dispose: () => void } {
  const headFile = path.join(repoRoot, '.git', 'HEAD');
  let last: string | undefined;
  try {
    last = fs.readFileSync(headFile, 'utf8').trim();
  } catch {
    last = undefined;
  }
  const timer = setInterval(() => {
    let current: string | undefined;
    try {
      current = fs.readFileSync(headFile, 'utf8').trim();
    } catch {
      current = undefined;
    }
    if (current === last) return;
    last = current;
    const branch = current?.startsWith('ref: refs/heads/') ? current.slice('ref: refs/heads/'.length) : undefined;
    onChange(branch);
  }, 2000);
  timer.unref?.();
  return { dispose: () => clearInterval(timer) };
}

export function currentBranchName(headContent: string | undefined): string | undefined {
  if (!headContent) return undefined;
  const match = /^ref:\s*refs\/heads\/(.+)$/.exec(headContent.trim());
  return match ? match[1] : undefined;
}
