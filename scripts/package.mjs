#!/usr/bin/env node
/** Package the VSIX (pre-release) and a companion zip with the MCP server + spec. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '..');
const stable = process.argv.includes('--stable');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const outDir = path.join(root, 'dist');
await fs.mkdir(outDir, { recursive: true });

const vsix = path.join(outDir, `${pkg.name}-${pkg.version}.vsix`);
const readme = path.join(root, 'README.md');
const backup = path.join(os.tmpdir(), `folium-readme-${process.pid}.md`);
await fs.copyFile(readme, backup);
await fs.copyFile(path.join(root, 'MARKETPLACE.md'), readme);
try {
  execFileSync(
    'npx',
    [
      'vsce',
      'package',
      ...(stable ? [] : ['--pre-release']),
      '--no-dependencies',
      '--allow-missing-repository',
      '--out',
      vsix,
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, VSCE_DISABLE_UPDATE_CHECK: '1' },
    },
  );
} finally {
  await fs.copyFile(backup, readme);
  await fs.rm(backup, { force: true });
}

const staging = path.join(outDir, 'companion');
await fs.rm(staging, { recursive: true, force: true });
await fs.mkdir(staging, { recursive: true });
for (const item of ['dist/mcp-server.js', 'spec', 'README.md', 'USER_GUIDE.md', 'CHANGELOG.md', 'docs']) {
  const source = path.join(root, item);
  const target = path.join(staging, item === 'dist/mcp-server.js' ? 'mcp-server.js' : item);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(source, target, { recursive: true });
}
await fs.writeFile(
  path.join(staging, 'COMPANION.md'),
  [
    '# Folium Notes companion package',
    '',
    'This zip contains the portable parts of Folium Notes:',
    '',
    '- `mcp-server.js` — the stdio MCP server (`create_followup_note`), run with `node mcp-server.js`.',
    '- `spec/FORMAT.md` and `spec/fixtures` — the on-disk format contract used by other IDE implementations.',
    '- `spec/resources/templates` — the built-in templates as Markdown files.',
    '- `docs/` — test plans and the publishing checklist.',
    '',
    'The JetBrains plugin itself is not built in this repository; it is expected to',
    'implement `spec/FORMAT.md` and can reuse `mcp-server.js` unchanged.',
    '',
  ].join('\n'),
);
const zip = path.join(outDir, `${pkg.name}-${pkg.version}-companion.zip`);
execFileSync('zip', ['-qr', zip, '.'], { cwd: staging });
await fs.rm(staging, { recursive: true, force: true });
console.log(`[package] ${path.relative(root, vsix)}`);
console.log(`[package] ${path.relative(root, zip)}`);
