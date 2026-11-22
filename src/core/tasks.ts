/** Task extraction from Markdown notes (`- [ ]`, `* [x]`, `1. [ ]`) with due dates. */

import { findCodeRanges, inRanges, splitLines } from './markdown';
import type { Scope } from './state';
import { dayKey, parseDateLoose, startOfDay } from './time';

export interface TaskItem {
  noteKey: string;
  noteTitle: string;
  scope: Scope;
  relPath: string;
  /** 1-based line number in the note file. */
  line: number;
  lineText: string;
  text: string;
  done: boolean;
  /** `YYYY-MM-DD` due date, when present. */
  due?: string;
  /** Absolute offset of the status character inside `[ ]`. */
  offset: number;
  indent: number;
}

const TASK_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const DUE_RE = /(?:due:\s*|📅\s*|due\s+)(\d{4}-\d{2}-\d{2})/iu;

export interface TaskSource {
  noteKey: string;
  noteTitle: string;
  scope: Scope;
  relPath: string;
}

export interface ParseTaskOptions {
  /** Include lines inside fenced/inline code (default false). */
  includeCode?: boolean;
}

/** Extract tasks from the raw note file (front matter is harmless). */
export function parseTasks(raw: string, source: TaskSource, options: ParseTaskOptions = {}): TaskItem[] {
  const codeRanges = options.includeCode ? [] : findCodeRanges(raw);
  const tasks: TaskItem[] = [];
  for (const line of splitLines(raw)) {
    if (codeRanges.length > 0 && inRanges(line.start, codeRanges)) continue;
    const match = TASK_RE.exec(line.text);
    if (!match) continue;
    const [, indent, status, rest] = match;
    const statusIndex = line.text.indexOf(`[${status}]`);
    if (statusIndex === -1) continue;
    const dueMatch = DUE_RE.exec(rest);
    const due = dueMatch ? dayKey(parseDayKeySafe(dueMatch[1])) : undefined;
    tasks.push({
      noteKey: source.noteKey,
      noteTitle: source.noteTitle,
      scope: source.scope,
      relPath: source.relPath,
      line: line.number,
      lineText: line.text,
      text: rest.replace(DUE_RE, '').replace(/\s{2,}/g, ' ').trim(),
      done: status.toLowerCase() === 'x',
      due,
      offset: line.start + statusIndex + 1,
      indent: indent.replace(/\t/g, '  ').length,
    });
  }
  return tasks;
}

function parseDayKeySafe(value: string): Date {
  return parseDateLoose(value) ?? new Date(0);
}

/** Flip `[ ]` <-> `[x]` at the given status offset. */
export function toggleTask(raw: string, offset: number): string {
  const char = raw[offset];
  if (char === undefined) return raw;
  if (char === ' ') return `${raw.slice(0, offset)}x${raw.slice(offset + 1)}`;
  if (char === 'x' || char === 'X') return `${raw.slice(0, offset)} ${raw.slice(offset + 1)}`;
  return raw;
}

export function setTaskDone(raw: string, offset: number, done: boolean): string {
  const char = raw[offset];
  if (char === undefined) return raw;
  const replacement = done ? 'x' : ' ';
  if (char === replacement) return raw;
  return `${raw.slice(0, offset)}${replacement}${raw.slice(offset + 1)}`;
}

export type DueBucket = 'overdue' | 'today' | 'next7' | 'later' | 'none';

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  next7: 'Next 7 days',
  later: 'Later',
  none: 'No due date',
};

/** Bucket a task by its due date relative to `now` (local day boundaries). */
export function dueBucket(task: TaskItem, now: Date = new Date()): DueBucket {
  if (!task.due) return 'none';
  const due = parseDateLoose(task.due);
  if (!due) return 'none';
  const today = startOfDay(now).getTime();
  const dueDay = startOfDay(due).getTime();
  if (dueDay < today) return 'overdue';
  if (dueDay === today) return 'today';
  if (dueDay <= today + 7 * 86_400_000) return 'next7';
  return 'later';
}

export function isDueToday(task: TaskItem, now: Date = new Date()): boolean {
  return dueBucket(task, now) === 'today';
}

export function isOverdue(task: TaskItem, now: Date = new Date()): boolean {
  return dueBucket(task, now) === 'overdue';
}

/** Open/done counts for view descriptions and screen-reader labels. */
export function taskCounts(tasks: TaskItem[]): { open: number; done: number } {
  let open = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.done) done++;
    else open++;
  }
  return { open, done };
}

/** Notes with the most urgent open tasks first. */
export function sortTasks(tasks: TaskItem[], now: Date = new Date()): TaskItem[] {
  const order: Record<DueBucket, number> = { overdue: 0, today: 1, next7: 2, later: 3, none: 4 };
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const bucket = order[dueBucket(a, now)] - order[dueBucket(b, now)];
    if (bucket !== 0) return bucket;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    if (a.noteTitle !== b.noteTitle) return a.noteTitle.localeCompare(b.noteTitle);
    return a.line - b.line;
  });
}
