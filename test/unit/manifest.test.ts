import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { COMMANDS, CONFIGURATION, MENUS, VIEWS, KEYBINDINGS } from '../../src/manifest/contributions';

const root = path.resolve(__dirname, '../..');

describe('manifest', () => {
  it('registers every contributed command in the extension', () => {
    const index = fs.readFileSync(path.join(root, 'src/commands/index.ts'), 'utf8');
    const missing = COMMANDS.filter((command) => !index.includes(`'${command.command}'`));
    expect(missing.map((command) => command.command)).toEqual([]);
  });

  it('prefixes every command title with Folium:', () => {
    expect(COMMANDS.length).toBeGreaterThan(0);
    expect(COMMANDS.filter((command) => !command.title.startsWith('Folium: '))).toEqual([]);
    expect(COMMANDS.filter((command) => command.category !== undefined)).toEqual([]);
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
    expect(VIEWS.map((view) => view.id)).toEqual(['folium.notes', 'folium.tags', 'folium.tasks', 'folium.related']);
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
