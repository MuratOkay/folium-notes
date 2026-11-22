# Folium Notes

Project notes for developers: **shared notes inside the repository, private notes outside it, in one
view.** A VS Code extension in TypeScript with no telemetry and no servers — notes are plain Markdown.

```
my-project/.notes/                ← shared notes, committed with the code
my-project/.notes/.templates/     ← team templates
~/FoliumNotes/<project key>/      ← private notes, outside the repository
  .Folium/state.json              ← personal colors, pins, Joplin ids
  .Folium/trash/                  ← project trash (shared notes too)
```

## What it does

* **One view for shared and private notes.** Shared notes live in `<project>/.notes` (`sharedFolder`),
  private notes in `~/FoliumNotes/<project key>` (`privateRoot`). The key comes from the git remote
  (`origin`, else the first remote), normalised to `host/path`: `git@github.com:Org/Repo.git` →
  `github.com/org/repo`, SCP/ssh/https alike, Azure DevOps forms unified, monorepo sub folders appended.
  Without a remote the key is `local/<folder>-<sha1(path) 8 hex>` (Windows drive letter lower-cased).
* **Grouping, sorting and filters.** By scope, nested tag, date (Today, Yesterday, This Week, This Month,
  Month YYYY), color or none; sort by created/updated/title with pins first; filters for tags (any/all),
  colors (including none), date presets and custom ranges, text and scope; a filter summary with clear;
  Archive and Trash groups; drag & drop; multi-select; auto-reveal; tooltips and screen-reader labels.
* **Search.** Title boost 3, tags 2, body 1, prefix matching, typo tolerance (~20% edits for terms over
  three characters), `#tag` filters, snippets, recent notes, “create a note with this title”.
* **Templates.** Ten built-ins (Bug investigation, Meeting notes, Decision record, Manual test
  prerequisites, Credentials, Today I learned, Checklist, Branch note, AI prompt, Other), team templates
  in `<sharedFolder>/.templates`, personal in `<privateRoot>/.templates`, team > personal > built-in.
  Placeholders, questions, prompt context, diagnostics, completion, hover and live preview.
* **Code links.** `{ path, lines, text, endText }` snippets resolve exact › moved › moved-first ›
  fuzzy (≥ 75%) › lost, with CodeLens, gutter dots, hover, new-note-from-selection, link selection and
  re-capture (`Update Code Links`).
* **Wiki links** with completion, navigation, diagnostics, backlinks and rename updates; **tasks** with
  due dates, buckets, a 🔔 status bar item and ✓ editor marks; **branch notes**; **related** view.
* **Encryption** (AES-256-GCM, secret storage, portable key backup) and **safe AI**: tools cannot read
  notes; prompt and follow-up notes send content only when you ask, and never from private or sensitive
  notes. Copilot Chat, Cline, Roo, Kilo, clipboard targets, a `#followUp` tool and a stdio MCP server.
* **Import/export**: Markdown/Obsidian, Joplin `.jex`, Evernote `.enex`; Obsidian or Joplin export; Joplin
  sync; GitHub/GitLab/Jira issues; tar backups of private notes.

## Quick start

1. Open a project. Folium creates `.notes/` and `~/FoliumNotes/<project>/`.
2. **Folium: New Note** (<kbd>Alt</kbd>+<kbd>N</kbd> then <kbd>N</kbd>; macOS <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>).
3. Link code with **New Note from Selection** (<kbd>C</kbd>) or **Link Selection to Note** (<kbd>L</kbd>).
4. Search with <kbd>S</kbd>; templates with <kbd>T</kbd>; branch note <kbd>B</kbd>; prompt <kbd>P</kbd>;
   follow-up <kbd>F</kbd>.

## Settings (excerpt)

All settings are under `foliumNotes.*` (user or `.vscode/settings.json`).

| Setting | Default | Meaning |
| --- | --- | --- |
| `sharedFolder` | `.notes` | Shared notes folder |
| `privateRoot` | `~/FoliumNotes` | Private notes root |
| `privateProjectKey` | `""` | Override the private folder key |
| `fileNamePattern` | `{date}-{slug}` | `{date}`, `{time}`, `{slug}`, `{id}` |
| `defaultTemplate` | `""` | `""` blank, `ask`, or a name |
| `inlineTags` | `true` | Read `#hashtags` outside code |
| `shareColors` | `false` | Store shared-note colors in the file |
| `trashRetentionDays` | `30` | 0 keeps everything |
| `branchNotes.onBranchSwitch` | `notify` | `none`/`notify`/`open`/`create` |
| `tasks.showCheckMarks` | `true` | ✓ after done tasks |
| `codeLens`, `gutterIcons`, `linkDiagnostics` | `true` | Editor integration |
| `encryptSensitiveNotes` | `false` | User-level setting only |
| `prompts.defaultTarget` | `copilot` | copilot/cline/roo/kilo/continue/claude/codex/jetbrains/custom |
| `issues.provider` | `""` | `github`, `gitlab`, `jira` |
| `joplin.url` | `http://localhost:41184` | Joplin Data API |

View state (sort, grouping, filters) is stored per workspace, not in settings.

## Privacy and security

* No telemetry. Network calls only when you trigger them (AI targets, Joplin, issues).
* Tokens live in VS Code secret storage and are only sent to github.com/gitlab.com or hosts you confirmed;
  project settings are ignored in untrusted workspaces.
* Sensitive notes are never shared, exported, published or sent to AI. Encrypted notes stay encrypted on
  disk and open decrypted only in the editor.
* `prompts.customCommand` and `encryptSensitiveNotes` are user-level settings.

Format: [spec/FORMAT.md](spec/FORMAT.md). Architecture: [DESIGN.md](DESIGN.md). Test plans:
[docs/test-plans](docs/test-plans). Marketplace copy: [MARKETPLACE.md](MARKETPLACE.md).

## Development

```bash
npm install
npm run build              # dist/extension.js + dist/mcp-server.js
npm run typecheck
npm test                   # Vitest (unit, Windows simulation, 5,000-note perf, MCP protocol)
npm run fixtures           # regenerate spec fixtures (TZ=UTC)
npm run fixtures:check
npm run test:integration   # VS Code host tests (display or xvfb required)
npm run package            # pre-release VSIX + companion zip
```

## Status

This repository contains the VS Code extension. `spec/` defines the shared on-disk format; the companion
zip ships that spec, the built-in templates and the MCP server for other IDE implementations. The
JetBrains plugin itself is not part of this repository.

MIT licensed.
