import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMMANDS, CONFIGURATION, MANIFEST, MENUS, VIEWS, KEYBINDINGS } from '../../src/manifest/contributions';

const root = path.resolve(__dirname, '../..');

describe('manifest', () => {
  it('registers every contributed command in the extension', () => {
    const index = fs.readFileSync(path.join(root, 'src/commands/index.ts'), 'utf8');
    const missing = COMMANDS.filter((command) => !index.includes(`'${command.command}'`));
    expect(missing.map((command) => command.command)).toEqual([]);
  });

  it('prefixes every command with the Folium category for the Command Palette', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
    expect(COMMANDS.filter((command) => command.title.startsWith('Folium: '))).toEqual([]);
    expect(MANIFEST.commands.filter((command) => command.category !== 'Folium')).toEqual([]);
  });

  it('keeps the Notes toolbar in the documented order', () => {
    const navigation = MENUS['view/title']
      .filter((item) => item.when === 'view == folium.notes' && item.group?.startsWith('navigation'))
      .sort((a, b) => Number(a.group?.split('@')[1]) - Number(b.group?.split('@')[1]))
      .map((item) => item.command);
    expect(navigation).toEqual([
      'folium.newNote',
      'folium.search',
      'folium.filterMenu',
      'folium.sortBy',
      'folium.groupBy',
    ]);
  });

  it('keeps the Notes menu groups in order with separators', () => {
    const groups = MENUS['view/title']
      .filter((item) => item.when === 'view == folium.notes' && /^\d_/.test(item.group ?? ''))
      .map((item) => item.group!.split('@')[0]);
    expect([...new Set(groups)]).toEqual(['1_filter', '2_new', '3_workspace', '4_io']);
  });

  it('keeps the note context menu in the documented order', () => {
    const order = MENUS['view/item/context']
      .filter((item) => item.when?.includes('folium\\.note') && !item.group?.startsWith('inline'))
      .sort((a, b) => {
        const left = a.group!.split('@')[0];
        const right = b.group!.split('@')[0];
        return left.localeCompare(right) || Number(a.group!.split('@')[1]) - Number(b.group!.split('@')[1]);
      })
      .map((item) => item.command);
    const expected = [
      'folium.openNote',
      'folium.renameNote',
      'folium.editTags',
      'folium.setColor',
      'folium.togglePin',
      'folium.moveToPrivate',
      'folium.moveToShared',
      'folium.archive',
      'folium.unarchive',
      'folium.copyNoteLink',
      'folium.copyNotePath',
      'folium.revealNote',
      'folium.saveAsTemplate',
      'folium.updateCodeLinks',
      'folium.createIssue',
      'folium.linkIssue',
      'folium.sendToJoplin',
      'folium.trashNote',
    ];
    expect(order.filter((command) => expected.includes(command))).toEqual(expected);
  });

  it('only references known commands from menus and keybindings', () => {
    const ids = new Set(COMMANDS.map((command) => command.command));
    const unknown = new Set<string>();
    for (const items of Object.values(MENUS)) {
      for (const item of items) if (!ids.has(item.command)) unknown.add(item.command);
    }
    for (const binding of KEYBINDINGS) if (!ids.has(binding.command)) unknown.add(binding.command);
    expect([...unknown]).toEqual([]);
  });

  it('uses the documented view ids and settings prefix', () => {
    expect(VIEWS.map((view) => view.id)).toEqual([
      'folium.notes',
      'folium.tags',
      'folium.tasks',
      'folium.related',
      'folium.ai',
      'folium.commands',
    ]);
    for (const key of Object.keys(CONFIGURATION)) expect(key.startsWith('foliumNotes.')).toBe(true);
  });

  it('keeps the generated package.json in sync', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.contributes.commands.map((c: { command: string }) => c.command)).toEqual(
      COMMANDS.map((command) => command.command),
    );
    expect(Object.keys(pkg.contributes.configuration.properties).sort()).toEqual(
      Object.keys(CONFIGURATION).sort(),
    );
  });

  it('marks the documented user-level settings', () => {
    expect(CONFIGURATION['foliumNotes.prompts.customCommand'].scope).toBe('application');
    expect(CONFIGURATION['foliumNotes.encryptSensitiveNotes'].scope).toBe('application');
  });
});
