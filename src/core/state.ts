/** Personal per-note data: shared-note colors, pins and Joplin ids (`.Folium/state.json`). */

import { normalizeColor, type Color } from './colors';

export type Scope = 'shared' | 'private';

export interface PersonalNoteState {
  /** Color for shared notes (`none` = explicitly cleared). */
  color?: string;
  pinned?: boolean;
  joplinId?: string;
}

export interface ProjectState {
  version: 1;
  notes: Record<string, PersonalNoteState>;
}

export function emptyState(): ProjectState {
  return { version: 1, notes: {} };
}

export function parseState(text: string | undefined): ProjectState {
  if (!text) return emptyState();
  try {
    const parsed = JSON.parse(text) as Partial<ProjectState> | null;
    if (!parsed || typeof parsed !== 'object') return emptyState();
    const notes: Record<string, PersonalNoteState> = {};
    for (const [key, value] of Object.entries(parsed.notes ?? {})) {
      if (!value || typeof value !== 'object') continue;
      const entry: PersonalNoteState = {};
      const record = value as Record<string, unknown>;
      if (typeof record.color === 'string') entry.color = record.color;
      if (typeof record.pinned === 'boolean') entry.pinned = record.pinned;
      if (typeof record.joplinId === 'string') entry.joplinId = record.joplinId;
      if (Object.keys(entry).length > 0) notes[key] = entry;
    }
    return { version: 1, notes };
  } catch {
    return emptyState();
  }
}

export function serializeState(state: ProjectState): string {
  const notes: Record<string, PersonalNoteState> = {};
  for (const key of Object.keys(state.notes).sort()) {
    const entry = state.notes[key];
    if (entry && Object.keys(entry).length > 0) notes[key] = entry;
  }
  return `${JSON.stringify({ version: 1, notes }, null, 2)}\n`;
}

export interface NoteKeyInput {
  id?: string;
  scope: Scope;
  relPath: string;
}

/** `<id>` when the note has one, else `<scope>:<relPath>`. */
export function stateKeyFor(note: NoteKeyInput): string {
  return note.id && note.id.trim() ? note.id.trim() : `${note.scope}:${note.relPath}`;
}

export function findStateEntry(
  state: ProjectState,
  note: NoteKeyInput,
): PersonalNoteState | undefined {
  const byId = note.id ? state.notes[note.id] : undefined;
  if (byId) return byId;
  return state.notes[`${note.scope}:${note.relPath}`];
}

export function stateEntryKey(state: ProjectState, note: NoteKeyInput): string {
  if (note.id && state.notes[note.id]) return note.id;
  return state.notes[`${note.scope}:${note.relPath}`]
    ? `${note.scope}:${note.relPath}`
    : stateKeyFor(note);
}

/** Color precedence: file color for private notes; personal state for shared ones. */
export function effectiveColor(
  note: NoteKeyInput & { fileColor?: string },
  state: ProjectState,
  shareColors: boolean,
): Color | undefined {
  const personal = findStateEntry(state, note);
  if (note.scope === 'private') {
    return normalizeColor(note.fileColor) ?? normalizeColor(personal?.color);
  }
  if (!shareColors) return normalizeColor(personal?.color);
  return normalizeColor(note.fileColor) ?? normalizeColor(personal?.color);
}

export function isPinned(note: NoteKeyInput, state: ProjectState): boolean {
  return findStateEntry(state, note)?.pinned === true;
}

export function setPersonalColor(
  state: ProjectState,
  key: string,
  color: Color | 'none' | undefined,
): ProjectState {
  const entry = { ...(state.notes[key] ?? {}) };
  if (color === undefined) delete entry.color;
  else entry.color = color;
  const notes = { ...state.notes };
  if (Object.keys(entry).length === 0) delete notes[key];
  else notes[key] = entry;
  return { version: 1, notes };
}

export function setPinned(state: ProjectState, key: string, pinned: boolean): ProjectState {
  const entry = { ...(state.notes[key] ?? {}) };
  if (pinned) entry.pinned = true;
  else delete entry.pinned;
  const notes = { ...state.notes };
  if (Object.keys(entry).length === 0) delete notes[key];
  else notes[key] = entry;
  return { version: 1, notes };
}

export function setJoplinId(state: ProjectState, key: string, joplinId: string): ProjectState {
  const entry = { ...(state.notes[key] ?? {}), joplinId };
  return { version: 1, notes: { ...state.notes, [key]: entry } };
}

export function joplinIdFor(state: ProjectState, note: NoteKeyInput): string | undefined {
  return findStateEntry(state, note)?.joplinId;
}

/** Move personal data after a rename so colors/pins follow the note. */
export function remapStateKey(state: ProjectState, from: KeyPair, to: KeyPair): ProjectState {
  const notes = { ...state.notes };
  const fromKey = stateKeyFor(from);
  const toKey = stateKeyFor(to);
  if (notes[fromKey]) {
    notes[toKey] = { ...notes[fromKey], ...(notes[toKey] ?? {}) };
    delete notes[fromKey];
  }
  return { version: 1, notes };
}

export interface KeyPair extends NoteKeyInput {}
