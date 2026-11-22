import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

rmSync('dist', { recursive: true, force: true });

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  logLevel: 'info',
  sourcemap: !production,
  minify: production,
  external: ['vscode'],
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

const builds = [
  { ...shared, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
  { ...shared, entryPoints: ['src/mcp/server.ts'], outfile: 'dist/mcp-server.js' },
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
  console.log('[esbuild] watching');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  console.log('[esbuild] done');
}
