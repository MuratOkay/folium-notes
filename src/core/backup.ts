/** Backup and restore of the private notes folder (tar + manifest, never overwrites). */

import { readTar, writeTar, type TarEntry } from './tar';

export const BACKUP_FORMAT = 'folium-backup';
export const BACKUP_MANIFEST = 'Folium-backup.json';

export interface BackupFile {
  /** Path relative to the private root, `/` separated. */
  path: string;
  content: Buffer | string;
  mtime?: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: 1;
  created: string;
  source: string;
  counts: { notes: number; files: number; trash: number; templates: number };
}

function isExcluded(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (/(^|\/)\.inbox(\/|$)/.test(normalized)) return true;
  if (/(^|\/)Folium-backup\.json$/.test(normalized)) return true;
  if (/\.folium-key(\.txt)?$/i.test(normalized)) return true;
  return false;
}

/** Build a tar backup: manifest first, then the private folder (minus `.inbox`). */
export function createBackup(
  files: BackupFile[],
  options: { source?: string; now?: Date } = {},
): Buffer {
  const included = files.filter((file) => !isExcluded(file.path));
  const notes = included.filter((file) => file.path.toLowerCase().endsWith('.md')).length;
  const trash = included.filter((file) => /(^|\/)\.Folium\/trash\//.test(file.path.replace(/\\/g, '/'))).length;
  const templates = included.filter((file) => /(^|\/)\.templates\//.test(file.path.replace(/\\/g, '/'))).length;
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: 1,
    created: (options.now ?? new Date()).toISOString(),
    source: options.source ?? 'Folium Notes',
    counts: { notes, files: included.length, trash, templates },
  };
  const mtime = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const entries: TarEntry[] = [
    {
      name: BACKUP_MANIFEST,
      type: 'file',
      data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      mode: 0o644,
      mtime,
    },
  ];
  for (const file of included) {
    entries.push({
      name: file.path.replace(/\\/g, '/').replace(/^\/+/, ''),
      type: 'file',
      data: Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8'),
      mode: 0o644,
      mtime: file.mtime ?? mtime,
    });
  }
  return writeTar(entries);
}

export interface BackupContents {
  manifest?: BackupManifest;
  files: BackupFile[];
}

/** Read a backup archive (manifest optional for robustness). */
export function readBackup(buffer: Buffer): BackupContents {
  const entries = readTar(buffer);
  const files: BackupFile[] = [];
  let manifest: BackupManifest | undefined;
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    if (entry.name === BACKUP_MANIFEST) {
      try {
        const parsed = JSON.parse(entry.data.toString('utf8')) as BackupManifest;
        if (parsed && parsed.format === BACKUP_FORMAT) manifest = parsed;
      } catch {
        /* ignore malformed manifest */
      }
      continue;
    }
    files.push({ path: entry.name.replace(/^\.\//, ''), content: entry.data, mtime: entry.mtime });
  }
  return { manifest, files };
}

export interface RestorePlan {
  write: BackupFile[];
  /** Files that already exist and will not be overwritten. */
  conflicts: string[];
  /** Entries skipped for safety (absolute paths, traversal). */
  skipped: string[];
}

/** Plan a restore: only missing files are written, conflicts are reported. */
export function planRestore(
  files: BackupFile[],
  existingPaths: Iterable<string>,
): RestorePlan {
  const existing = new Set([...existingPaths].map((path) => path.replace(/\\/g, '/')));
  const write: BackupFile[] = [];
  const conflicts: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/');
    if (!path || path.startsWith('/') || path.includes('..') || /^[A-Za-z]:/.test(path)) {
      skipped.push(file.path);
      continue;
    }
    if (existing.has(path)) {
      conflicts.push(path);
      continue;
    }
    existing.add(path);
    write.push({ ...file, path });
  }
  return { write, conflicts, skipped };
}
