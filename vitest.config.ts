import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/perf/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      reporter: ['text-summary'],
    },
  },
  resolve: {
    alias: {
      vscode: new URL('./test/stubs/vscode.ts', import.meta.url).pathname,
    },
  },
});
