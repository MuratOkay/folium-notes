import { beforeAll, describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'dist');
const extensionBundle = path.join(dist, 'extension.js');
const mcpBundle = path.join(dist, 'mcp-server.js');

/** Build on demand so the test works in a fresh clone (CI builds first, but this keeps it simple). */
function ensureBundle(entryPoint: string, outfile: string): void {
  if (fs.existsSync(outfile)) return;
  fs.mkdirSync(dist, { recursive: true });
  buildSync({
    entryPoints: [path.join(root, entryPoint)],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['vscode'],
    logLevel: 'silent',
    sourcemap: false,
    legalComments: 'none',
  });
}

describe('bundled extension', () => {
  beforeAll(() => {
    ensureBundle('src/extension.ts', extensionBundle);
    ensureBundle('src/mcp/server.ts', mcpBundle);
  });

  it('loads without touching the VS Code API at import time', () => {
    const script = `
      const m = require(${JSON.stringify(extensionBundle)});
      if (typeof m.activate !== 'function') throw new Error('activate missing');
      if (typeof m.deactivate !== 'function') throw new Error('deactivate missing');
      console.log('ok');
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, NODE_PATH: path.join(root, 'test/stubs/cjs') },
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('ok');
  });

  it('bundles the MCP server as a standalone script', () => {
    expect(fs.existsSync(mcpBundle)).toBe(true);
    expect(fs.statSync(mcpBundle).size).toBeGreaterThan(1000);
  });
});
