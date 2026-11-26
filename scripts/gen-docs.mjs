#!/usr/bin/env node
/** Regenerate the reference tables inside USER_GUIDE.md from package.json. */
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const commands = pkg.contributes.commands;
const settings = pkg.contributes.configuration.properties;
const keybindings = pkg.contributes.keybindings;

const HIDDEN = new Set([
  'folium.newNoteWithTitle',
  'folium.openNote',
  'folium.statusMenu',
  'folium.toggleTagFilter',
  'folium.openTask',
  'folium.createMissingNote',
  'folium.searchWithQuery',
  'folium.deleteTrashEntry',
]);

const cell = (value) =>
  String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
const defaultText = (value) => {
  if (typeof value === 'string') return value === '' ? '""' : JSON.stringify(value);
  return JSON.stringify(value);
};

const commandsTable = [
  '| Command | What it does |',
  '| --- | --- |',
  ...commands
    .filter((command) => !HIDDEN.has(command.command))
    .map((command) => `| \`${command.command}\` | ${cell(command.title)} |`),
].join('\n');

const groups = [
  {
    title: 'Notes and storage',
    keys: [
      'sharedFolder',
      'privateRoot',
      'privateProjectKey',
      'defaultScope',
      'fileNamePattern',
      'renameFileOnTitleChange',
      'inlineTags',
      'shareColors',
      'defaultTemplate',
      'confirmDelete',
      'trashRetentionDays',
    ],
  },
  { title: 'View and interface', keys: ['defaultSort', 'defaultOrder', 'defaultGroupBy', 'treeDescription', 'autoReveal', 'statusBar'] },
  { title: 'Editor integration', keys: ['codeLens', 'gutterIcons', 'linkDiagnostics', 'updateLinksOnRename'] },
  { title: 'Tasks', prefix: 'tasks.' },
  { title: 'Branch notes', prefix: 'branchNotes.' },
  { title: 'AI prompts and follow-ups', prefix: ['prompts.', 'followUps.'] },
  { title: 'Security', keys: ['encryptSensitiveNotes'] },
  { title: 'Issue trackers', prefix: 'issues.' },
  { title: 'Joplin', prefix: 'joplin.' },
];

const byName = new Map(
  Object.entries(settings).map(([key, value]) => [key.replace('foliumNotes.', ''), value]),
);
const used = new Set();
const settingsBlocks = [];
for (const group of groups) {
  const keys = group.prefix
    ? [...byName.keys()].filter((key) =>
        Array.isArray(group.prefix) ? group.prefix.some((prefix) => key.startsWith(prefix)) : key.startsWith(group.prefix),
      )
    : group.keys.filter((key) => byName.has(key));
  if (keys.length === 0) continue;
  keys.sort((a, b) => a.localeCompare(b));
  for (const key of keys) used.add(key);
  settingsBlocks.push(
    [
      `### ${group.title}`,
      '',
      '| Setting | Default | Scope | Description |',
      '| --- | --- | --- | --- |',
      ...keys.map((key) => {
        const value = byName.get(key);
        const description = value.markdownDescription || value.description || '';
        return `| \`${key}\` | \`${cell(defaultText(value.default))}\` | ${value.scope || 'window'} | ${cell(description)} |`;
      }),
    ].join('\n'),
  );
}
const leftovers = [...byName.keys()].filter((key) => !used.has(key));
if (leftovers.length > 0) {
  settingsBlocks.push(
    [
      '### Other',
      '',
      '| Setting | Default | Scope | Description |',
      '| --- | --- | --- | --- |',
      ...leftovers.map((key) => {
        const value = byName.get(key);
        return `| \`${key}\` | \`${cell(defaultText(value.default))}\` | ${value.scope || 'window'} | ${cell(value.markdownDescription || value.description || '')} |`;
      }),
    ].join('\n'),
  );
}
const settingsTable = settingsBlocks.join('\n\n');

const titles = new Map(commands.map((command) => [command.command, command.title]));
const keybindingsTable = [
  '| Windows / Linux | macOS | Action |',
  '| --- | --- | --- |',
  ...keybindings.map(
    (binding) =>
      `| \`${binding.key}\` | \`${binding.mac || binding.key}\` | ${cell(titles.get(binding.command) || binding.command)} |`,
  ),
].join('\n');

const guidePath = path.join(root, 'USER_GUIDE.md');
let guide = await fs.readFile(guidePath, 'utf8');

function replaceBlock(source, name, content) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Missing ${name} markers in USER_GUIDE.md`);
  }
  return `${source.slice(0, startIndex + start.length)}\n${content}\n${source.slice(endIndex)}`;
}

const next = replaceBlock(
  replaceBlock(replaceBlock(guide, 'commands', commandsTable), 'settings', settingsTable),
  'keybindings',
  keybindingsTable,
);

if (next === guide) {
  console.log('[docs] USER_GUIDE.md is up to date');
  process.exit(0);
}
if (check) {
  console.error('[docs] USER_GUIDE.md reference tables are stale. Run `npm run docs`.');
  process.exit(1);
}
await fs.writeFile(guidePath, next, 'utf8');
console.log('[docs] updated USER_GUIDE.md reference tables');
