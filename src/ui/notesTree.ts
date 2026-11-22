/** Notes view: grouped, filterable notes with drag & drop and multi-select. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';
import { COLOR_THEME, COLORS, type Color } from '../core/colors';
import { accessibleLabel, bodyPreview, type NoteSummary } from '../core/note';
import type { NoteFile } from '../store/store';
import {
  applyFilters,
  filterChips,
  filterSummary,
  groupNotes,
  hasActiveFilters,
  sortNotes,
  type NoteGroup,
} from '../core/views';
import type { TrashEntry } from '../core/trash';
import { formatDisplay } from '../core/time';

export type NotesNode =
  | { kind: 'note'; key: string; groupId?: string }
  | { kind: 'group'; group: NoteGroup }
  | { kind: 'tagGroup'; tag: string; label: string; depth: number }
  | { kind: 'trash' }
  | { kind: 'trashEntry'; entry: TrashEntry }
  | { kind: 'filters' }
  | { kind: 'empty' }
  | { kind: 'message'; label: string; description?: string };

export const NOTES_MIME = 'application/vnd.code.tree.folium.notes';

export class NotesTreeProvider implements vscode.TreeDataProvider<NotesNode>, vscode.TreeDragAndDropController<NotesNode> {
  readonly dropMimeTypes = [NOTES_MIME];
  readonly dragMimeTypes = [NOTES_MIME];
  private readonly changes = new vscode.EventEmitter<NotesNode | undefined>();
  readonly onDidChangeTreeData = this.changes.event;
  private view?: vscode.TreeView<NotesNode>;
  private memo = new Map<string, unknown>();

  constructor(private readonly app: FoliumApp) {}

  attach(view: vscode.TreeView<NotesNode>): void {
    this.view = view;
  }

  refresh(): void {
    this.memo.clear();
    this.changes.fire(undefined);
  }

  private get store() {
    return this.app.store;
  }

  /** Notes after filters, text search and sorting. */
  visibleNotes(): NoteFile[] {
    const cached = this.memo.get('visible');
    if (cached) return cached as NoteFile[];
    const store = this.store;
    if (!store) return [];
    const state = this.app.viewStateStore.get();
    let notes = applyFilters(store.allNotes, state.filters);
    const text = state.filters.text.trim();
    if (text) {
      const keys = new Set(store.search(text, 500).map((hit) => hit.key));
      notes = notes.filter((note) => keys.has(note.key));
    }
    const sorted = sortNotes(notes, state.sortBy, state.sortOrder, true);
    this.memo.set('visible', sorted);
    return sorted;
  }

  groups(): NoteGroup[] {
    const cached = this.memo.get('groups');
    if (cached) return cached as NoteGroup[];
    const state = this.app.viewStateStore.get();
    const notes = this.visibleNotes();
    const groups = groupNotes(notes, state.groupBy);
    const sorted = groups.map((group) => ({
      ...group,
      notes: sortNotes(group.notes, state.sortBy, state.sortOrder, true),
    }));
    this.memo.set('groups', sorted);
    return sorted;
  }

  noteNode(key: string, groupId?: string): NotesNode {
    return { kind: 'note', key, groupId };
  }

  nodeForNote(note: NoteSummary): NotesNode {
    const group = this.groups().find((candidate) =>
      candidate.notes.some((item) => item.key === note.key),
    );
    return this.noteNode(note.key, group?.id);
  }

  async revealNote(note: NoteFile): Promise<void> {
    if (!this.view) return;
    try {
      await this.view.reveal(this.nodeForNote(note), { select: true, focus: false, expand: true });
    } catch {
      /* the note may be filtered out */
    }
  }

  getChildren(node?: NotesNode): NotesNode[] {
    const store = this.store;
    if (!store) {
      return [{ kind: 'message', label: 'Open a folder to start taking notes' }];
    }
    if (!node) {
      const state = this.app.viewStateStore.get();
      const out: NotesNode[] = [];
      if (hasActiveFilters(state.filters)) out.push({ kind: 'filters' });
      const groups = this.groups();
      const hasAny = store.allNotes.length > 0;
      if (!hasAny) return [{ kind: 'empty' }];
      if (groups.length === 0) {
        out.push({ kind: 'message', label: 'No notes match the current filters' });
      }
      if (state.groupBy === 'tag') {
        out.push(...this.tagRoots());
        const archive = groups.find((group) => group.section === 'archive');
        if (archive) out.push({ kind: 'group', group: archive });
      } else {
        for (const group of groups) out.push({ kind: 'group', group });
      }
      if (store.trashEntries.length > 0) out.push({ kind: 'trash' });
      return out;
    }
    if (node.kind === 'group') {
      return node.group.notes.map((note) => this.noteNode(note.key, node.group.id));
    }
    if (node.kind === 'tagGroup') {
      const childTags = this.tagChildren(node.tag);
      const notes = this.notesWithTag(node.tag);
      return [
        ...childTags.map((tag) => ({
          kind: 'tagGroup' as const,
          tag,
          label: tag.split('/').pop() ?? tag,
          depth: tag.split('/').length - 1,
        })),
        ...notes.map((note) => this.noteNode(note.key, `tag-${node.tag}`)),
      ];
    }
    if (node.kind === 'trash') {
      return store.trashEntries.map((entry) => ({ kind: 'trashEntry' as const, entry }));
    }
    return [];
  }

  getParent(node: NotesNode): NotesNode | undefined {
    if (node.kind === 'note') {
      const group = node.groupId
        ? this.groups().find((candidate) => candidate.id === node.groupId)
        : this.groups().find((candidate) => candidate.notes.some((note) => note.key === node.key));
      return group ? { kind: 'group', group } : undefined;
    }
    if (node.kind === 'tagGroup') {
      const parts = node.tag.split('/');
      if (parts.length <= 1) return undefined;
      const parentTag = parts.slice(0, -1).join('/');
      return { kind: 'tagGroup', tag: parentTag, label: parts[parts.length - 2], depth: parts.length - 2 };
    }
    if (node.kind === 'trashEntry') return { kind: 'trash' };
    return undefined;
  }

  /** Top-level tag nodes (tags without a parent). */
  private tagRoots(): NotesNode[] {
    const cached = this.memo.get('tagRoots');
    if (cached) return cached as NotesNode[];
    const tags = new Set<string>();
    for (const note of this.visibleNotes()) {
      if (note.archived) continue;
      for (const tag of note.tags) tags.add(tag.split('/')[0]);
    }
    const roots = [...tags]
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({ kind: 'tagGroup' as const, tag, label: tag, depth: 0 }));
    this.memo.set('tagRoots', roots);
    return roots;
  }

  private tagChildren(tag: string): string[] {
    const prefix = `${tag}/`;
    const children = new Set<string>();
    for (const note of this.visibleNotes()) {
      if (note.archived) continue;
      for (const candidate of note.tags) {
        if (!candidate.startsWith(prefix)) continue;
        const rest = candidate.slice(prefix.length);
        if (!rest) continue;
        children.add(`${tag}/${rest.split('/')[0]}`);
      }
    }
    return [...children].sort((a, b) => a.localeCompare(b));
  }

  private notesWithTag(tag: string): NoteFile[] {
    const state = this.app.viewStateStore.get();
    return sortNotes(
      this.visibleNotes().filter((note) => !note.archived && note.tags.includes(tag)),
      state.sortBy,
      state.sortOrder,
      true,
    );
  }

  getTreeItem(node: NotesNode): vscode.TreeItem {
    const store = this.store;
    switch (node.kind) {
      case 'tagGroup': {
        const children = this.tagChildren(node.tag);
        const notes = this.notesWithTag(node.tag);
        const item = new vscode.TreeItem(
          node.label,
          children.length > 0 || notes.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        );
        item.description = String(notes.length);
        item.iconPath = new vscode.ThemeIcon('tag');
        item.contextValue = 'folium.tagGroup';
        item.id = `tagGroup:${node.tag}`;
        item.tooltip = `#${node.tag} — ${notes.length} note(s)`;
        item.accessibilityInformation = { label: `Tag ${node.tag}, ${notes.length} notes` };
        item.command = {
          command: 'folium.toggleTagFilter',
          title: 'Toggle Tag Filter',
          arguments: [node.tag],
        };
        return item;
      }
      case 'group': {
        const item = new vscode.TreeItem(
          node.group.label,
          node.group.section === 'archive'
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.Expanded,
        );
        item.description = String(node.group.notes.length);
        item.contextValue = 'folium.group';
        item.id = `group:${node.group.id}`;
        const id = node.group.id;
        if (id.startsWith('color-')) {
          const color = id.slice('color-'.length);
          item.iconPath = new vscode.ThemeIcon(
            'circle-filled',
            color === 'none' ? undefined : new vscode.ThemeColor(COLOR_THEME[color as Color]),
          );
        } else if (id.startsWith('tag-')) {
          item.iconPath = new vscode.ThemeIcon('tag');
        } else if (id.startsWith('date-')) {
          item.iconPath = new vscode.ThemeIcon('calendar');
        } else if (node.group.section === 'archive') {
          item.iconPath = new vscode.ThemeIcon('archive');
        } else {
          item.iconPath = new vscode.ThemeIcon('folder');
        }
        item.tooltip = `${node.group.label} — ${node.group.notes.length} note(s)`;
        return item;
      }
      case 'note': {
        const note = store?.byKey(node.key);
        if (!note) return new vscode.TreeItem('Missing note');
        const state = this.app.viewStateStore.get();
        const item = new vscode.TreeItem(note.title, vscode.TreeItemCollapsibleState.None);
        item.id = `note:${note.key}`;
        item.resourceUri = vscode.Uri.file(note.absPath);
        item.description = this.app.settings.treeDescription ? this.noteDescription(note, state.sortBy) : undefined;
        item.contextValue = `folium.note${note.encrypted ? '.encrypted' : ''}${note.archived ? '.archived' : ''}`;
        item.iconPath = this.noteIcon(note);
        item.command = {
          command: 'folium.openNote',
          title: 'Open Note',
          arguments: [note.key],
        };
        item.tooltip = this.noteTooltip(note);
        item.accessibilityInformation = { label: accessibleLabel(note), role: 'treeitem' };
        return item;
      }
      case 'filters': {
        const state = this.app.viewStateStore.get();
        const item = new vscode.TreeItem(`Filters: ${filterSummary(state.filters)}`);
        item.iconPath = new vscode.ThemeIcon('filter');
        item.contextValue = 'folium.filters';
        item.tooltip = 'Click to clear all filters';
        item.command = { command: 'folium.clearFilters', title: 'Clear Filters' };
        const chips = filterChips(state.filters);
        item.description = chips.map((chip) => chip.label).join(' · ');
        return item;
      }
      case 'trash': {
        const item = new vscode.TreeItem('Trash', vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('trash');
        item.description = String(store?.trashEntries.length ?? 0);
        item.contextValue = 'folium.trash';
        item.id = 'trash';
        item.tooltip = 'Deleted notes are kept for a while and can be restored';
        return item;
      }
      case 'trashEntry': {
        const item = new vscode.TreeItem(node.entry.relPath.split('/').pop() ?? node.entry.relPath);
        item.description = `${node.entry.scope} · deleted ${node.entry.deletedAt.slice(0, 10)}`;
        item.iconPath = new vscode.ThemeIcon('trash');
        item.contextValue = 'folium.trashEntry';
        item.tooltip = `Restore to ${node.entry.originalPath}`;
        return item;
      }
      case 'empty': {
        const item = new vscode.TreeItem('No notes yet');
        item.description = 'Create a shared or private note';
        item.iconPath = new vscode.ThemeIcon('book');
        item.command = { command: 'folium.newSharedNote', title: 'New Shared Note' };
        item.contextValue = 'folium.empty';
        return item;
      }
      default: {
        const item = new vscode.TreeItem(node.label);
        item.description = node.description;
        item.contextValue = 'folium.message';
        return item;
      }
    }
  }

  private noteIcon(note: NoteFile): vscode.ThemeIcon {
    if (note.encrypted) return new vscode.ThemeIcon('lock');
    if (note.color) {
      return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(COLOR_THEME[note.color]));
    }
    return new vscode.ThemeIcon(note.scope === 'shared' ? 'note' : 'file-text');
  }

  private noteDescription(note: NoteFile, sortBy: string): string {
    const state = this.app.viewStateStore.get();
    if (state.groupBy === 'color' && note.tags.length > 0) return note.tags.slice(0, 2).join(' ');
    const date = sortBy === 'created' ? note.created : note.updated;
    return formatDisplay(date);
  }

  private noteTooltip(note: NoteFile): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${note.title}**\n\n`);
    tooltip.appendMarkdown(`_${note.scope} note_ · ${note.relPath}\n\n`);
    if (note.tags.length > 0) tooltip.appendMarkdown(`${note.tags.map((tag) => `\`#${tag}\``).join(' ')}\n\n`);
    if (note.sensitive) tooltip.appendMarkdown('Sensitive — never shared, exported or sent to AI.\n\n');
    if (note.encrypted) tooltip.appendMarkdown('Encrypted (AES-256-GCM).\n\n');
    const preview = bodyPreview(note.body);
    if (preview) tooltip.appendMarkdown(`${preview}\n\n`);
    if (note.openTasks > 0) tooltip.appendMarkdown(`${note.openTasks} open task(s)\n`);
    tooltip.isTrusted = false;
    return tooltip;
  }

  /* --------------------------- drag and drop --------------------------- */

  handleDrag(source: readonly NotesNode[], dataTransfer: vscode.DataTransfer): void {
    const keys = source.filter((node) => node.kind === 'note').map((node) => (node as { key: string }).key);
    if (keys.length === 0) return;
    dataTransfer.set(NOTES_MIME, new vscode.DataTransferItem(JSON.stringify(keys)));
  }

  async handleDrop(target: NotesNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const store = this.store;
    if (!store || !target) return;
    const raw = dataTransfer.get(NOTES_MIME)?.value;
    if (!raw) return;
    let keys: string[] = [];
    try {
      keys = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw as Uint8Array).toString('utf8'));
    } catch {
      return;
    }
    const notes = keys.map((key) => store.byKey(key)).filter((note): note is NoteFile => !!note);
    if (notes.length === 0) return;
    if (target.kind === 'trash') {
      if (this.app.settings.confirmDelete) {
        const answer = await vscode.window.showWarningMessage(
          `Move ${notes.length} note(s) to the trash?`,
          { modal: true },
          'Move to Trash',
        );
        if (answer !== 'Move to Trash') return;
      }
      for (const note of notes) await store.trashNote(note);
      this.app.refresh();
      return;
    }
    if (target.kind === 'tagGroup') {
      for (const note of notes) {
        if (note.tags.includes(target.tag)) continue;
        await store.updateFrontMatter(note, [['tags', [...note.tags, target.tag]]]);
      }
      this.app.refresh();
      return;
    }
    if (target.kind !== 'group') return;
    const id = target.group.id;
    if (id === 'shared' || id === 'private') {
      const blocked = notes.filter((note) => note.sensitive && id === 'shared');
      if (blocked.length > 0) {
        void vscode.window.showWarningMessage('Sensitive notes can never be shared.');
        return;
      }
      const answer = await vscode.window.showWarningMessage(
        `Move ${notes.length} note(s) to ${id} notes?`,
        { modal: true },
        'Move',
      );
      if (answer !== 'Move') return;
      for (const note of notes) {
        if (note.scope !== id) await store.moveNote(note, id as 'shared' | 'private');
      }
      this.app.refresh();
      return;
    }
    if (id.startsWith('color-')) {
      const color = id.slice('color-'.length) as Color | 'none';
      for (const note of notes) await store.setColor(note, color === 'none' ? undefined : color);
      this.app.refresh();
      return;
    }
    if (id.startsWith('tag-')) {
      const tag = id.slice('tag-'.length);
      if (tag === 'none') return;
      for (const note of notes) {
        if (note.tags.includes(tag)) continue;
        await store.updateFrontMatter(note, [['tags', [...note.tags, tag]]]);
      }
      this.app.refresh();
      return;
    }
    if (id === 'archive') {
      for (const note of notes) await store.setArchived(note, true);
      this.app.refresh();
    }
  }
}
