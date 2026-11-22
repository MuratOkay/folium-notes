import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

describe('bundled extension', () => {
  it('loads without touching the VS Code API at import time', () => {
    const script = `
      const m = require(${JSON.stringify(path.join(root, 'dist/extension.js'))});
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
    const script = `
      const fs = require('node:fs');
      const file = ${JSON.stringify(path.join(root, 'dist/mcp-server.js'))};
      if (!fs.existsSync(file)) throw new Error('mcp bundle missing');
      console.log('ok');
    `;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    expect(result.stdout.trim()).toBe('ok');
  });
});
