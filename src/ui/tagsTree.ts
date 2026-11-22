/** Tags view: nested tags with counts; click toggles the tag filter. */

import * as vscode from 'vscode';
import type { FoliumApp } from '../app';

export interface TagNode {
  kind: 'tag' | 'message';
  tag?: string;
  label?: string;
  depth?: number;
}

export class TagsTreeProvider implements vscode.TreeDataProvider<TagNode> {
  private readonly changes = new vscode.EventEmitter<TagNode | undefined>();
  readonly onDidChangeTreeData = this.changes.event;

  constructor(private readonly app: FoliumApp) {}

  refresh(): void {
    this.changes.fire(undefined);
  }

  private segments(): Map<string, number> {
    const counts = this.app.store?.allTags() ?? new Map<string, number>();
    const out = new Map<string, number>();
    for (const [tag, count] of counts) out.set(tag, count);
    return out;
  }

  getChildren(node?: TagNode): TagNode[] {
    if (!this.app.store) return [{ kind: 'message', label: 'Open a folder to see tags' }];
    const counts = this.segments();
    if (counts.size === 0) return [{ kind: 'message', label: 'No tags yet' }];
    const prefix = node?.tag ? `${node.tag}/` : '';
    const depth = node?.depth ?? 0;
    const direct = new Set<string>();
    for (const tag of counts.keys()) {
      if (!tag.startsWith(prefix)) continue;
      const rest = tag.slice(prefix.length);
      if (!rest) continue;
      direct.add(rest.split('/')[0]);
    }
    return [...direct]
      .sort((a, b) => a.localeCompare(b))
      .map((segment) => ({
        kind: 'tag' as const,
        tag: `${prefix}${segment}`,
        label: segment,
        depth,
      }));
  }

  getTreeItem(node: TagNode): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label ?? '');
      item.contextValue = 'folium.message';
      return item;
    }
    const tag = node.tag!;
    const counts = this.segments();
    const count = counts.get(tag) ?? 0;
    const children = this.getChildren(node).some((child) => child.kind === 'tag');
    const state = this.app.viewStateStore.get();
    const active = state.filters.tags.includes(tag);
    const item = new vscode.TreeItem(
      node.label ?? tag,
      children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${count}${active ? ' · filter' : ''}`;
    item.iconPath = new vscode.ThemeIcon(active ? 'filter-filled' : 'tag');
    item.contextValue = 'folium.tag';
    item.tooltip = `#${tag} — ${count} note(s). Click to filter.`;
    item.accessibilityInformation = { label: `Tag ${tag}, ${count} notes${active ? ', filter active' : ''}` };
    item.command = { command: 'folium.toggleTagFilter', title: 'Toggle Tag Filter', arguments: [tag] };
    if (active) item.checkboxState = vscode.TreeItemCheckboxState.Checked;
    else item.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
    item.checkboxState = active
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    return item;
  }
}
