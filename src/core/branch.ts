/** Branch notes: one note per git branch, with a configurable action on switch. */

import type { NoteMeta } from './frontmatter';

/** Branches that never get automatic branch notes. */
export const IGNORED_BRANCHES = ['main', 'master', 'develop', 'dev', 'trunk'];

export type BranchAction = 'none' | 'notify' | 'open' | 'create';

export function isIgnoredBranch(branch: string | undefined): boolean {
  if (!branch) return true;
  return IGNORED_BRANCHES.includes(branch.trim().toLowerCase());
}

/** Title convention for branch notes (`Branch: feature/login`). */
export function branchNoteTitle(branch: string): string {
  return `Branch: ${branch}`;
}

export function branchNoteBody(branch: string, base?: string): string {
  const lines = [`# ${branchNoteTitle(branch)}`, ''];
  if (base) lines.push(`Base: ${base}`, '');
  lines.push('## Checklist', '', '- [ ] Review changes', '- [ ] Run tests', '');
  return lines.join('\n');
}

export function isBranchNote(meta: NoteMeta, branch?: string): boolean {
  if (!meta.branch) return false;
  return branch === undefined || meta.branch === branch;
}

/** Find the branch note for a branch in a list of notes. */
export function findBranchNote<T extends { meta: NoteMeta }>(notes: T[], branch: string): T | undefined {
  return notes.find((note) => note.meta.branch === branch);
}

/** Whether the switch action should run for this branch. */
export function shouldHandleBranchSwitch(branch: string | undefined, action: BranchAction): boolean {
  if (!branch || action === 'none') return false;
  return !isIgnoredBranch(branch);
}
