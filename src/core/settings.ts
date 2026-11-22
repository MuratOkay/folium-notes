/** Extension settings, defaults and normalisation (FoliumNotes.*). */

import type { BranchAction } from './branch';
import type { IssueProvider } from './issues';
import type { GroupBy, SortBy, SortOrder } from './views';
import type { Scope } from './state';

export interface BranchNoteSettings {
  /** What happens when the git branch changes. */
  onBranchSwitch: BranchAction;
  /** Scope used for automatically created branch notes. */
  scope: Scope;
  /** Extra ignored branches (main/master/develop/dev/trunk are always ignored). */
  ignored: string[];
}

export interface TaskSettings {
  showCheckMarks: boolean;
  statusBar: boolean;
}

export interface PromptSettings {
  defaultTarget: string;
  submit: boolean;
  customCommand: string;
  showInNotes: boolean;
}

export interface IssueSettingsShape {
  provider: IssueProvider | '';
  githubApiUrl: string;
  gitlabUrl: string;
  jiraUrl: string;
  jiraProjectKey: string;
  jiraIssueType: string;
  tagsAsLabels: boolean;
  permalinks: boolean;
}

export interface JoplinSettingsShape {
  url: string;
  notebook: string;
}

export interface FoliumSettings {
  sharedFolder: string;
  privateRoot: string;
  privateProjectKey: string;
  defaultScope: 'ask' | Scope;
  fileNamePattern: string;
  renameFileOnTitleChange: boolean;
  inlineTags: boolean;
  shareColors: boolean;
  defaultTemplate: string;
  confirmDelete: boolean;
  trashRetentionDays: number;
  defaultSort: SortBy;
  defaultOrder: SortOrder;
  defaultGroupBy: GroupBy;
  treeDescription: boolean;
  autoReveal: boolean;
  statusBar: boolean;
  codeLens: boolean;
  gutterIcons: boolean;
  linkDiagnostics: boolean;
  updateLinksOnRename: boolean;
  branchNotes: BranchNoteSettings;
  tasks: TaskSettings;
  encryptSensitiveNotes: boolean;
  prompts: PromptSettings;
  followUps: { archiveWhenSent: boolean };
  issues: IssueSettingsShape;
  joplin: JoplinSettingsShape;
}

export const DEFAULT_SETTINGS: FoliumSettings = {
  sharedFolder: '.notes',
  privateRoot: '~/FoliumNotes',
  privateProjectKey: '',
  defaultScope: 'ask',
  fileNamePattern: '{date}-{slug}',
  renameFileOnTitleChange: true,
  inlineTags: true,
  shareColors: false,
  defaultTemplate: '',
  confirmDelete: true,
  trashRetentionDays: 30,
  defaultSort: 'updated',
  defaultOrder: 'desc',
  defaultGroupBy: 'scope',
  treeDescription: true,
  autoReveal: false,
  statusBar: true,
  codeLens: true,
  gutterIcons: true,
  linkDiagnostics: true,
  updateLinksOnRename: true,
  branchNotes: { onBranchSwitch: 'notify', scope: 'shared', ignored: [] },
  tasks: { showCheckMarks: true, statusBar: true },
  encryptSensitiveNotes: false,
  prompts: { defaultTarget: 'copilot', submit: false, customCommand: '', showInNotes: true },
  followUps: { archiveWhenSent: true },
  issues: {
    provider: '',
    githubApiUrl: 'https://api.github.com',
    gitlabUrl: '',
    jiraUrl: '',
    jiraProjectKey: '',
    jiraIssueType: 'Task',
    tagsAsLabels: true,
    permalinks: true,
  },
  joplin: { url: 'http://localhost:41184', notebook: '' },
};

/** Merge a partial (VS Code) configuration into the defaults. */
export function mergeSettings(partial: Record<string, unknown> | undefined): FoliumSettings {
  const source = partial ?? {};
  const pick = <T>(value: unknown, fallback: T): T =>
    value === undefined || value === null ? fallback : (value as T);
  const nested = (key: string): Record<string, unknown> =>
    (source[key] && typeof source[key] === 'object' ? source[key] : {}) as Record<string, unknown>;
  const branch = nested('branchNotes');
  const tasks = nested('tasks');
  const prompts = nested('prompts');
  const followUps = nested('followUps');
  const issues = nested('issues');
  const joplin = nested('joplin');
  return {
    ...DEFAULT_SETTINGS,
    ...(source as Partial<FoliumSettings>),
    branchNotes: { ...DEFAULT_SETTINGS.branchNotes, ...(branch as object) },
    tasks: { ...DEFAULT_SETTINGS.tasks, ...(tasks as object) },
    prompts: { ...DEFAULT_SETTINGS.prompts, ...(prompts as object) },
    followUps: { ...DEFAULT_SETTINGS.followUps, ...(followUps as object) },
    issues: { ...DEFAULT_SETTINGS.issues, ...(issues as object) },
    joplin: { ...DEFAULT_SETTINGS.joplin, ...(joplin as object) },
    trashRetentionDays: Number(pick(source.trashRetentionDays, DEFAULT_SETTINGS.trashRetentionDays)) || 0,
  };
}
