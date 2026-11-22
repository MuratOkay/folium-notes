/** Resolved folders for a project: shared notes, private folder, `.Folium`, templates. */

import os from 'node:os';
import path from 'node:path';
import { folderNameFor, projectKey, type GitRemote } from '../core/keys';

export interface StorePathInput {
  projectRoot: string;
  sharedFolder: string;
  privateRoot: string;
  privateProjectKey?: string;
  remotes: GitRemote[];
  repoRoot?: string;
  isWindows?: boolean;
  homedir?: string;
}

export interface StorePaths {
  projectRoot: string;
  sharedRoot: string;
  privateBase: string;
  privateFolder: string;
  projectKey: string;
  folderName: string;
  foliumDir: string;
  stateFile: string;
  trashDir: string;
  trashIndexFile: string;
  projectJsonFile: string;
  teamTemplatesDir: string;
  personalTemplatesDir: string;
  inboxDir: string;
  backupDir: string;
}

export function expandHome(input: string, home: string = os.homedir()): string {
  const trimmed = input.trim();
  if (!trimmed) return home;
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return path.join(home, trimmed.slice(2));
  return trimmed;
}

export function resolveStorePaths(input: StorePathInput): StorePaths {
  const home = input.homedir ?? os.homedir();
  const projectRoot = path.resolve(input.projectRoot);
  const sharedRoot = path.resolve(projectRoot, input.sharedFolder || '.notes');
  const privateBase = path.resolve(expandHome(input.privateRoot || '~/FoliumNotes', home));
  const key = projectKey({
    remotes: input.remotes ?? [],
    projectRoot,
    repoRoot: input.repoRoot,
    override: input.privateProjectKey,
    isWindows: input.isWindows,
  });
  const folderName = folderNameFor(key);
  const privateFolder = path.join(privateBase, folderName);
  const foliumDir = path.join(privateFolder, '.Folium');
  return {
    projectRoot,
    sharedRoot,
    privateBase,
    privateFolder,
    projectKey: key,
    folderName,
    foliumDir,
    stateFile: path.join(foliumDir, 'state.json'),
    trashDir: path.join(foliumDir, 'trash'),
    trashIndexFile: path.join(foliumDir, 'trash.json'),
    projectJsonFile: path.join(foliumDir, 'project.json'),
    teamTemplatesDir: path.join(sharedRoot, '.templates'),
    personalTemplatesDir: path.join(privateBase, '.templates'),
    inboxDir: path.join(privateBase, '.inbox'),
    backupDir: privateBase,
  };
}

export function toRelPath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

export function isInside(root: string, absolute: string): boolean {
  const rel = path.relative(root, absolute);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
