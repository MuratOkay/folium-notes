#!/usr/bin/env node
/** Generate (or verify) spec fixtures from the TypeScript core. Run with TZ=UTC. */
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

process.env.TZ = 'UTC';
const check = process.argv.includes('--check');
const root = path.resolve(import.meta.dirname, '..');
const outfile = path.join(os.tmpdir(), `folium-fixtures-${process.pid}.cjs`);

await build({
  entryPoints: [path.join(root, 'spec/gen/fixtures.ts')],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  logLevel: 'silent',
});
const module = createRequire(import.meta.url)(outfile);
await fs.unlink(outfile).catch(() => undefined);

const fixtures = module.buildFixtures();
const resources = module.buildTemplateResources();
const fixtureDir = path.join(root, 'spec/fixtures');
const resourceDir = path.join(root, 'spec/resources/templates');
await fs.mkdir(fixtureDir, { recursive: true });
await fs.mkdir(resourceDir, { recursive: true });

const stale = [];
const writeOrCheck = async (file, content) => {
  const existing = await fs.readFile(file, 'utf8').catch(() => undefined);
  if (existing === content) return;
  if (check) {
    stale.push(path.relative(root, file));
    return;
  }
  await fs.writeFile(file, content, 'utf8');
};

for (const [name, data] of Object.entries(fixtures)) {
  await writeOrCheck(path.join(fixtureDir, name), `${JSON.stringify(data, null, 2)}\n`);
}
for (const [name, content] of Object.entries(resources)) {
  await writeOrCheck(path.join(resourceDir, name), content);
}

if (check) {
  if (stale.length > 0) {
    console.error(`[fixtures] stale: ${stale.join(', ')}`);
    console.error('[fixtures] run `npm run fixtures` and commit the result');
    process.exit(1);
  }
  console.log('[fixtures] up to date');
} else {
  console.log(`[fixtures] wrote ${Object.keys(fixtures).length} fixtures and ${Object.keys(resources).length} template resources`);
}
