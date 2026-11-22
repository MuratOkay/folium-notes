/**
 * Minimal CommonJS `vscode` stub used only by test/unit/bundle.test.ts.
 * It is loaded through NODE_PATH (see the test) because dist/extension.js keeps
 * `require('vscode')` external. Keep this file out of any node_modules path so it
 * is committed and available in a fresh clone.
 */
class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => {
      this.listeners.push(listener);
      return { dispose: () => undefined };
    };
  }
  fire(value) {
    for (const listener of this.listeners) listener(value);
  }
  dispose() {
    this.listeners = [];
  }
}
module.exports = {
  EventEmitter,
  Uri: { file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => `file:${p}` }) },
  workspace: { getConfiguration: () => ({ get: (_k, d) => d }) },
  window: {},
  commands: {},
  languages: {},
  env: {},
};
