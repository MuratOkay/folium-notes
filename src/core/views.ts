/** Filters, grouping and sorting for the Notes view. */

import { COLORS, type Color } from './colors';
import type { NoteSummary } from './note';
import type { Scope } from './state';
import { tagMatches } from './tags';
import { dayKey, monthLabel, parseDayKey, startOfDay, startOfMonth, startOfWeek } from './time';

export type DatePreset = 'any' | 'today' | 'last7' | 'last30' | 'thisYear' | 'custom';

export interface FilterState {
  tags: string[];
  tagMode: 'any' | 'all';
  colors: Array<Color | 'none'>;
  datePreset: DatePreset;
  /** `YYYY-MM-DD` for the custom range. */
  dateFrom?: string;
  dateTo?: string;
  text: string;
  scope: 'all' | Scope;
}

export function emptyFilters(): FilterState {
  return { tags: [], tagMode: 'any', colors: [], datePreset: 'any', text: '', scope: 'all' };
}

export function hasActiveFilters(filters: FilterState): boolean {
  return (
    filters.tags.length > 0 ||
    filters.colors.length > 0 ||
    filters.datePreset !== 'any' ||
    filters.text.trim() !== '' ||
    filters.scope !== 'all'
  );
}

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  any: '',
  today: 'today',
  last7: 'last 7 days',
  last30: 'last 30 days',
  thisYear: 'this year',
  custom: 'custom range',
};

export function filterSummary(filters: FilterState): string {
  const parts: string[] = [];
  if (filters.tags.length > 0) parts.push(`tags (${filters.tagMode}): ${filters.tags.join(', ')}`);
  if (filters.colors.length > 0) parts.push(`colors: ${filters.colors.join(', ')}`);
  if (filters.datePreset !== 'any') {
    parts.push(
      filters.datePreset === 'custom'
        ? `date: ${filters.dateFrom ?? '…'} – ${filters.dateTo ?? '…'}`
        : DATE_PRESET_LABELS[filters.datePreset],
    );
  }
  if (filters.text.trim()) parts.push(`text: “${filters.text.trim()}”`);
  if (filters.scope !== 'all') parts.push(`scope: ${filters.scope}`);
  return parts.filter(Boolean).join(' · ');
}

function inDateRange(note: NoteSummary, filters: FilterState, now: Date): boolean {
  if (filters.datePreset === 'any') return true;
  const updated = note.updated.getTime();
  const today = startOfDay(now);
  switch (filters.datePreset) {
    case 'today':
      return updated >= today.getTime();
    case 'last7':
      return updated >= today.getTime() - 6 * 86_400_000;
    case 'last30':
      return updated >= today.getTime() - 29 * 86_400_000;
    case 'thisYear':
      return note.updated.getFullYear() === now.getFullYear();
    case 'custom': {
      const from = filters.dateFrom ? parseDayKey(filters.dateFrom) : undefined;
      const to = filters.dateTo ? parseDayKey(filters.dateTo) : undefined;
      if (from && updated < from.getTime()) return false;
      if (to && updated >= to.getTime() + 86_400_000) return false;
      return true;
    }
    default:
      return true;
  }
}

/** Apply all filters except free text (handled by the search index). */
export function matchesFilters(
  note: NoteSummary,
  filters: FilterState,
  now: Date = new Date(),
): boolean {
  if (filters.scope !== 'all' && note.scope !== filters.scope) return false;
  if (filters.tags.length > 0) {
    const matches = filters.tags.map((tag) =>
      note.tags.some((candidate) => tagMatches(candidate, tag)),
    );
    if (filters.tagMode === 'all' ? !matches.every(Boolean) : !matches.some(Boolean)) return false;
  }
  if (filters.colors.length > 0) {
    const color = note.color ?? 'none';
    if (!filters.colors.includes(color)) return false;
  }
  return inDateRange(note, filters, now);
}

export function applyFilters(
  notes: NoteSummary[],
  filters: FilterState,
  now: Date = new Date(),
): NoteSummary[] {
  if (!hasActiveFilters(filters)) return notes;
  return notes.filter((note) => matchesFilters(note, filters, now));
}

export type GroupBy = 'none' | 'scope' | 'tag' | 'date' | 'color';
export type SortBy = 'created' | 'updated' | 'title';
export type SortOrder = 'asc' | 'desc';

export interface NoteGroup {
  id: string;
  label: string;
  /** Nesting depth for tag groups. */
  depth: number;
  notes: NoteSummary[];
  section?: 'archive';
}

function sortWithin(
  notes: NoteSummary[],
  sortBy: SortBy,
  order: SortOrder,
  pinnedFirst: boolean,
): NoteSummary[] {
  const direction = order === 'asc' ? 1 : -1;
  return [...notes].sort((a, b) => {
    if (pinnedFirst && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sortBy === 'title') return direction * a.title.localeCompare(b.title);
    const aValue = sortBy === 'created' ? a.created.getTime() : a.updated.getTime();
    const bValue = sortBy === 'created' ? b.created.getTime() : b.updated.getTime();
    if (aValue !== bValue) return direction * (aValue - bValue);
    return a.title.localeCompare(b.title);
  });
}

export function sortNotes(
  notes: NoteSummary[],
  sortBy: SortBy = 'updated',
  order: SortOrder = 'desc',
  pinnedFirst = true,
): NoteSummary[] {
  return sortWithin(notes, sortBy, order, pinnedFirst);
}

function dateGroup(note: NoteSummary, now: Date): { id: string; label: string; rank: number } {
  const day = startOfDay(note.updated);
  const today = startOfDay(now);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return { id: 'today', label: 'Today', rank: 0 };
  if (diff === 1) return { id: 'yesterday', label: 'Yesterday', rank: 1 };
  if (day.getTime() >= startOfWeek(today).getTime()) {
    return { id: 'this-week', label: 'This Week', rank: 2 };
  }
  if (day.getTime() >= startOfMonth(today).getTime()) {
    return { id: 'this-month', label: 'This Month', rank: 3 };
  }
  return {
    id: `month-${day.getFullYear()}-${day.getMonth() + 1}`,
    label: monthLabel(day),
    rank: 4 + (today.getTime() - day.getTime()) / (365 * 86_400_000),
  };
}

/** Group notes for the tree view; archived notes go to a separate group. */
export function groupNotes(
  notes: NoteSummary[],
  groupBy: GroupBy,
  now: Date = new Date(),
): NoteGroup[] {
  const active = notes.filter((note) => !note.archived);
  const archived = notes.filter((note) => note.archived);
  const groups: NoteGroup[] = [];
  if (groupBy === 'none') {
    groups.push({ id: 'all', label: 'Notes', depth: 0, notes: active });
  } else if (groupBy === 'scope') {
    const shared = active.filter((note) => note.scope === 'shared');
    const priv = active.filter((note) => note.scope === 'private');
    if (shared.length > 0) groups.push({ id: 'shared', label: 'Shared', depth: 0, notes: shared });
    if (priv.length > 0) groups.push({ id: 'private', label: 'Private', depth: 0, notes: priv });
  } else if (groupBy === 'color') {
    for (const color of [...COLORS, 'none'] as Array<Color | 'none'>) {
      const matching = active.filter((note) => (note.color ?? 'none') === color);
      if (matching.length === 0) continue;
      groups.push({
        id: `color-${color}`,
        label: color === 'none' ? 'No color' : color[0].toUpperCase() + color.slice(1),
        depth: 0,
        notes: matching,
      });
    }
  } else if (groupBy === 'date') {
    const buckets = new Map<string, { label: string; rank: number; notes: NoteSummary[] }>();
    for (const note of active) {
      const bucket = dateGroup(note, now);
      const existing = buckets.get(bucket.id);
      if (existing) existing.notes.push(note);
      else buckets.set(bucket.id, { label: bucket.label, rank: bucket.rank, notes: [note] });
    }
    for (const [id, bucket] of [...buckets.entries()].sort((a, b) => a[1].rank - b[1].rank)) {
      groups.push({ id: `date-${id}`, label: bucket.label, depth: 0, notes: bucket.notes });
    }
  } else {
    // Nested tag groups: every tag path becomes a group.
    const tags = new Set<string>();
    for (const note of active) {
      for (const tag of note.tags) {
        const parts = tag.split('/');
        for (let i = 1; i <= parts.length; i++) tags.add(parts.slice(0, i).join('/'));
      }
    }
    if (active.some((note) => note.tags.length === 0)) tags.add('');
    for (const tag of [...tags].sort((a, b) => a.localeCompare(b))) {
      const matching =
        tag === ''
          ? active.filter((note) => note.tags.length === 0)
          : active.filter((note) => note.tags.some((candidate) => tagMatches(candidate, tag)));
      if (matching.length === 0) continue;
      groups.push({
        id: `tag-${tag || 'none'}`,
        label: tag === '' ? 'No tags' : tag.split('/').pop()!,
        depth: tag === '' ? 0 : tag.split('/').length - 1,
        notes: matching,
      });
    }
  }
  if (archived.length > 0) {
    groups.push({
      id: 'archive',
      label: 'Archive',
      depth: 0,
      notes: archived,
      section: 'archive',
    });
  }
  return groups;
}

/** Filter chips shown in the view header. */
export function filterChips(filters: FilterState): Array<{ id: string; label: string }> {
  const chips: Array<{ id: string; label: string }> = [];
  for (const tag of filters.tags) chips.push({ id: `tag:${tag}`, label: `#${tag}` });
  for (const color of filters.colors) chips.push({ id: `color:${color}`, label: color });
  if (filters.datePreset !== 'any') {
    chips.push({
      id: 'date',
      label:
        filters.datePreset === 'custom'
          ? `${filters.dateFrom ?? '…'} – ${filters.dateTo ?? '…'}`
          : DATE_PRESET_LABELS[filters.datePreset],
    });
  }
  if (filters.text.trim()) chips.push({ id: 'text', label: filters.text.trim() });
  if (filters.scope !== 'all') chips.push({ id: 'scope', label: filters.scope });
  return chips;
}

export function todayKey(now: Date = new Date()): string {
  return dayKey(now);
}
