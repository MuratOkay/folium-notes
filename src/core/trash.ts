/** Per-project trash index (`.Folium/trash.json`) shared by shared and private notes. */

import type { PersonalNoteState, Scope } from './state';
import { parseDateLoose } from './time';

export interface TrashEntry {
  id?: string;
  scope: Scope;
  /** Path relative to the scope root (shared folder / private project folder). */
  relPath: string;
  /** File name inside the trash folder. */
  storedName: string;
  /** Local ISO timestamp of deletion. */
  deletedAt: string;
  /** Absolute original path (restore target). */
  originalPath: string;
  /** Personal color/pin data captured at deletion time. */
  personal?: PersonalNoteState;
}

export interface TrashIndex {
  version: 1;
  entries: TrashEntry[];
}

export function emptyTrashIndex(): TrashIndex {
  return { version: 1, entries: [] };
}

export function parseTrash(text: string | undefined): TrashIndex {
  if (!text) return emptyTrashIndex();
  try {
    const parsed = JSON.parse(text) as Partial<TrashIndex> | null;
    if (!parsed || !Array.isArray(parsed.entries)) return emptyTrashIndex();
    const entries: TrashEntry[] = [];
    for (const entry of parsed.entries) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as unknown as Record<string, unknown>;
      if (record.scope !== 'shared' && record.scope !== 'private') continue;
      if (typeof record.relPath !== 'string' || typeof record.storedName !== 'string') continue;
      entries.push({
        id: typeof record.id === 'string' ? record.id : undefined,
        scope: record.scope,
        relPath: record.relPath,
        storedName: record.storedName,
        deletedAt: typeof record.deletedAt === 'string' ? record.deletedAt : new Date(0).toISOString(),
        originalPath: typeof record.originalPath === 'string' ? record.originalPath : '',
        personal:
          record.personal && typeof record.personal === 'object'
            ? (record.personal as PersonalNoteState)
            : undefined,
      });
    }
    return { version: 1, entries };
  } catch {
    return emptyTrashIndex();
  }
}

export function serializeTrash(index: TrashIndex): string {
  return `${JSON.stringify({ version: 1, entries: index.entries }, null, 2)}\n`;
}

export function addTrashEntry(index: TrashIndex, entry: TrashEntry): TrashIndex {
  return { version: 1, entries: [...index.entries, entry] };
}

export function removeTrashEntry(index: TrashIndex, storedName: string): TrashIndex {
  return { version: 1, entries: index.entries.filter((entry) => entry.storedName !== storedName) };
}

/** Drop entries older than the retention window (0 or negative keeps everything). */
export function pruneTrash(index: TrashIndex, retentionDays: number, now: Date = new Date()): TrashIndex {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return index;
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const entries = index.entries.filter((entry) => {
    const date = parseDateLoose(entry.deletedAt);
    return !date || date.getTime() >= cutoff;
  });
  return { version: 1, entries };
}
