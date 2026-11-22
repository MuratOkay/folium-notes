#!/usr/bin/env node
/** Generate package.json contributions from src/manifest/contributions.ts. */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(os.tmpdir(), `folium-contributions-${process.pid}.mjs`);

await build({
  entryPoints: [path.join(root, 'src/manifest/contributions.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const { MANIFEST } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
await fs.unlink(outfile).catch(() => undefined);

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));

pkg.contributes = {
  commands: MANIFEST.commands.map((command) => {
    const entry = { command: command.command, title: command.title };
    if (command.category) entry.category = command.category;
    if (command.icon) entry.icon = command.icon;
    if (command.enablement) entry.enablement = command.enablement;
    return entry;
  }),
  viewsContainers: MANIFEST.viewsContainers,
  views: MANIFEST.views,
  viewsWelcome: MANIFEST.viewsWelcome,
  menus: MANIFEST.menus,
  keybindings: MANIFEST.keybindings,
  configuration: {
    title: 'Folium Notes',
    properties: MANIFEST.configuration,
  },
  walkthroughs: MANIFEST.walkthroughs,
};

pkg.activationEvents = ['onStartupFinished'];

await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log(`[gen] ${MANIFEST.commands.length} commands, ${Object.keys(MANIFEST.configuration).length} settings`);
