/** Per-workspace view state (sort/group/filters) stored in workspaceState, not settings. */

import * as vscode from 'vscode';
import type { GroupBy, SortBy, SortOrder } from '../core/views';
import { emptyFilters, type FilterState } from '../core/views';

export interface WorkspaceViewState {
  groupBy: GroupBy;
  sortBy: SortBy;
  sortOrder: SortOrder;
  filters: FilterState;
  showDoneTasks: boolean;
  tasksGroupBy: 'note' | 'due';
}

export function defaultViewState(defaults: { groupBy?: GroupBy; sortBy?: SortBy; sortOrder?: SortOrder }): WorkspaceViewState {
  return {
    groupBy: defaults.groupBy ?? 'scope',
    sortBy: defaults.sortBy ?? 'updated',
    sortOrder: defaults.sortOrder ?? 'desc',
    filters: emptyFilters(),
    showDoneTasks: false,
    tasksGroupBy: 'due',
  };
}

export class ViewStateStore {
  constructor(
    private readonly memento: vscode.Memento,
    private readonly key: string,
  ) {}

  get(): WorkspaceViewState {
    const stored = this.memento.get<Partial<WorkspaceViewState>>(this.key);
    const base = defaultViewState({});
    if (!stored) return base;
    return {
      ...base,
      ...stored,
      filters: { ...base.filters, ...(stored.filters ?? {}) },
    };
  }

  async update(patch: Partial<WorkspaceViewState>): Promise<void> {
    const next = { ...this.get(), ...patch };
    await this.memento.update(this.key, next);
  }

  async updateFilters(filters: FilterState): Promise<void> {
    await this.update({ filters });
  }

  async resetFilters(): Promise<void> {
    await this.update({ filters: emptyFilters() });
  }
}
