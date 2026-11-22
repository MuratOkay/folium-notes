/** The note view model shared by the tree views, search and tasks. */

import type { Color } from './colors';
import {
  isArchived,
  noteColor,
  parseNote,
  resolveTitle,
  type NoteMeta,
} from './frontmatter';
import type { Scope } from './state';
import type { TaskItem } from './tasks';

export interface NoteSummary {
  key: string;
  id?: string;
  scope: Scope;
  /** Path relative to the scope root, with `/` separators. */
  relPath: string;
  absPath: string;
  fileName: string;
  title: string;
  tags: string[];
  color?: Color;
  archived: boolean;
  sensitive: boolean;
  encrypted: boolean;
  created: Date;
  updated: Date;
  pinned: boolean;
  body: string;
  meta: NoteMeta;
  branch?: string;
  issue?: string;
  kind?: string;
  target?: string;
  status?: string;
  openTasks: number;
  doneTasks: number;
  /** File mtime, used for change detection and search caching. */
  mtime: number;
  size: number;
}

export interface BuildSummaryInput {
  absPath: string;
  relPath: string;
  scope: Scope;
  raw: string;
  mtime: number;
  size: number;
  color?: Color;
  pinned?: boolean;
  tasks?: TaskItem[];
}

export function noteKeyOf(scope: Scope, id: string | undefined, relPath: string): string {
  return id && id.trim() ? id.trim() : `${scope}:${relPath}`;
}

export function buildSummary(input: BuildSummaryInput): NoteSummary {
  const parsed = parseNote(input.raw);
  const fileName = input.relPath.split('/').pop() ?? input.relPath;
  const title = resolveTitle(parsed.meta, parsed.body, fileName);
  const tasks = input.tasks ?? [];
  let openTasks = 0;
  let doneTasks = 0;
  for (const task of tasks) {
    if (task.done) doneTasks++;
    else openTasks++;
  }
  return {
    key: noteKeyOf(input.scope, parsed.meta.id, input.relPath),
    id: parsed.meta.id,
    scope: input.scope,
    relPath: input.relPath,
    absPath: input.absPath,
    fileName,
    title,
    tags: parsed.meta.tags,
    color: input.color ?? noteColor(parsed.meta),
    archived: isArchived(parsed.meta),
    sensitive: parsed.meta.sensitive === true,
    encrypted: typeof parsed.meta.encrypted === 'string' && parsed.meta.encrypted !== '',
    created: parseDateOrEpoch(parsed.meta.created, input.mtime),
    updated: parseDateOrEpoch(parsed.meta.updated, input.mtime),
    pinned: input.pinned === true,
    body: parsed.body,
    meta: parsed.meta,
    branch: parsed.meta.branch,
    issue: parsed.meta.issue,
    kind: parsed.meta.kind,
    target: parsed.meta.target,
    status: parsed.meta.status,
    openTasks,
    doneTasks,
    mtime: input.mtime,
    size: input.size,
  };
}

function parseDateOrEpoch(value: string | undefined, fallbackMs: number): Date {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(fallbackMs);
}

/** Screen-reader label: "Title, shared note, red color, pinned, 2 open tasks, tags a, b". */
export function accessibleLabel(note: NoteSummary): string {
  const parts: string[] = [note.title];
  parts.push(note.scope === 'shared' ? 'shared note' : 'private note');
  if (note.color) parts.push(`${note.color} color`);
  if (note.pinned) parts.push('pinned');
  if (note.archived) parts.push('archived');
  if (note.sensitive) parts.push('sensitive');
  if (note.encrypted) parts.push('encrypted');
  const open = note.openTasks;
  if (open > 0) parts.push(`${open} open ${open === 1 ? 'task' : 'tasks'}`);
  if (note.tags.length > 0) parts.push(`tags ${note.tags.join(', ')}`);
  return parts.join(', ');
}

/** Plain-text body preview for tooltips. */
export function bodyPreview(body: string, maxLength = 400): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}
