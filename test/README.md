# Tests

Everything here runs from a clean checkout (`npm ci`). No network access is needed for the unit
suite; the integration suite downloads VS Code on first run.

```
src/core ──▶ test/unit/*.test.ts          Vitest, plain Node, no VS Code
src/store ─▶ test/unit/store.test.ts      real temporary folders
src/** ────▶ test/perf/perf.test.ts        5,000-note performance budget
src/mcp ───▶ test/unit/mcp.test.ts        real stdio JSON-RPC against a bundled server
dist/** ───▶ test/unit/bundle.test.ts     smoke-loads the esbuild bundle
real VS Code▶ test/integration/**         @vscode/test-electron (first/restart/perf phases)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | every Vitest file (unit + perf) |
| `npm run test:unit` | unit files only (no perf timings) |
| `npm run test:win` | the Windows path simulation (`test/unit/windows.test.ts`, uses `path.win32`) |
| `npm run test:perf` | the 5,000-note perf test with its measured numbers |
| `npm run test:integration` | builds, then runs the extension inside a real VS Code (needs a display or `xvfb-run`; set `VSCODE_EXECUTABLE=/path/to/code` to reuse an installed VS Code) |
| `npm run verify` | typecheck + unit tests + stale-fixture check (what CI runs) |
| `npm run fixtures:check` | fails when `spec/fixtures` no longer matches the TS core |

## Layout

* `unit/frontmatter.test.ts` — parse/serialise round-trips and byte-preserving field edits.
* `unit/basics.test.ts` — time, ULIDs, slugs, file names, project keys, colors.
* `unit/tags-tasks-crypto.test.ts` — inline tags, task offsets/due buckets, AES-256-GCM, key backups,
  our tar writer/reader, **GNU tar interoperability**, backup/restore planning.
* `unit/search-views.test.ts` — ranking, typo tolerance, `#tag` filters, grouping, filters, labels.
* `unit/links-code.test.ts` — code-link resolution (exact/moved/first/fuzzy/lost, `endText` growth) and
  wiki links (resolution, backlinks, rename, diagnostics).
* `unit/templates.test.ts` — built-ins, placeholders/questions, validation problems, file parsing,
  precedence and scope filtering.
* `unit/import-export.test.ts` — Markdown/Obsidian, Joplin `.jex`, Evernote `.enex`, ENML conversion,
  export formats, sensitive-note skipping.
* `unit/followup.test.ts` — AI answer parsing (YAML block/headings/options/questions), note composition,
  replies, inbox request validation.
* `unit/state-issues-joplin.test.ts` — personal state precedence/remap, settings merge, issue request
  builders and host trust, Joplin API client against a fake `fetch`.
* `unit/store.test.ts` — scan/write/tag/trash/rename/move/overlay/search/tasks/templates/backup on real
  temporary folders.
* `unit/manifest.test.ts` — every contributed command is registered, menus/keybindings point at known
  commands, `package.json` is in sync with the generator.
* `unit/bundle.test.ts` — loads `dist/extension.js` in a child process with a CJS `vscode` stub
  (`test/stubs/cjs/vscode/index.js`, injected via `NODE_PATH`) and checks the MCP bundle exists.
* `unit/mcp.test.ts` — spawns the bundled MCP server, exercises `initialize`, `tools/list`,
  `tools/call`, both stdio framings (newline and `Content-Length`) and the 200 KB cap.
* `unit/windows.test.ts` — drive letters, reserved device names, case-insensitive collisions, win32
  relative paths, all with `path.win32` so it runs on every OS.
* `perf/perf.test.ts` — core-level 5,000-note timings (parse/index/search/group/tasks).
* `perf/store.test.ts` — store-level stress test on a real temporary folder: seeds 5,000 Markdown files and
  prints cold load + index, search, cached tags/tasks, incremental refresh (no change / one changed file /
  own write) and note creation. Also asserts upper bounds.
* `integration/` — `run.mjs` prepares a temporary workspace (5,000 seeded notes for the perf phase) and
  launches VS Code three times: `first` (create/open/search/encryption key), `restart` (notes, colors,
  pins and the secret key survive), `perf` (extension-host timings).
* `stubs/vscode.ts` — the ESM VS Code stub used by Vitest's `vscode` alias if a unit test imports UI code.

## Notes

* Unit tests never touch your real notes: they use `fs.mkdtemp` folders and a throw-away home directory.
* The MCP test builds its own temporary bundle from `src/mcp/server.ts`, so it does not depend on `dist/`.
* `bundle.test.ts` builds `dist/extension.js` and `dist/mcp-server.js` on demand (with the same esbuild
  options as `esbuild.mjs`), so it also works in a fresh clone; `npm run verify` builds before testing.
* Integration tests are not part of `npm test` because they need a graphical session (and either download VS
  Code or use `VSCODE_EXECUTABLE`). On Linux without an OS keyring, the restart phase detects that
  SecretStorage is not persistent (canary secret) and skips only the key-persistence assertion; notes,
  colors and pins are still asserted.
