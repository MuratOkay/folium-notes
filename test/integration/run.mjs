#!/usr/bin/env node
/** Run the VS Code integration tests (needs a display or xvfb). */
import { runTests } from '@vscode/test-electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const suite = path.join(root, 'test/integration/suite/runner.cjs');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'folium-it-'));
const userDataDir = path.join(tmp, 'user-data');
const extensionsDir = path.join(tmp, 'extensions');
await fs.mkdir(userDataDir, { recursive: true });
await fs.mkdir(extensionsDir, { recursive: true });

async function prepareWorkspace(name) {
  const workspace = path.join(tmp, name);
  await fs.mkdir(path.join(workspace, '.notes'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'README.md'), '# Test project\n');
  return workspace;
}

async function seedNotes(workspace, count) {
  for (let i = 0; i < count; i++) {
    const title = `Generated note ${i}`;
    const body = [
      '---',
      `id: 01J0${String(i).padStart(22, '0')}`,
      `title: ${title}`,
      'created: 2026-11-22T10:00:00+00:00',
      `tags: [ generated, area/${i % 25} ]`,
      '---',
      '',
      `# ${title}`,
      '',
      `Body of note ${i}.`,
      '- [ ] follow up',
      '',
    ].join('\n');
    await fs.writeFile(path.join(workspace, '.notes', `note-${i}.md`), body);
  }
}

async function launch(phase, workspace) {
  console.log(`[it] launching phase ${phase} (${workspace})`);
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: suite,
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`],
    extensionTestsEnv: {
      FOLIUM_IT_PHASE: phase,
      FOLIUM_IT_WORKSPACE: workspace,
    },
  });
}

const firstWorkspace = await prepareWorkspace('project');
try {
  await launch('first', firstWorkspace);
  await launch('restart', firstWorkspace);
  const perfWorkspace = await prepareWorkspace('perf-project');
  await seedNotes(perfWorkspace, 5000);
  await launch('perf', perfWorkspace);
  console.log('[it] all integration phases passed');
} catch (error) {
  console.error('[it] integration tests failed');
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  console.error('Integration tests need a graphical session (use xvfb-run on headless Linux) and download VS Code on first run.');
  process.exit(1);
} finally {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
}
