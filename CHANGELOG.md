# Changelog

## 0.1.0 (pre-release)

First pre-release of Folium Notes for VS Code.

* Notes view with shared/private scopes, grouping (scope, nested tags, dates, colors), sorting, filters,
  filter summary, drag & drop, multi-select, archive and a per-project trash with restore.
* Note format: ULID ids, local ISO timestamps, tags, colors, archive, sensitive/encrypted flags, code
  links, branch, prompt/follow-up metadata, unknown field preservation and byte-preserving field edits.
* Project keys from git remotes (SCP/ssh/https, Azure DevOps, monorepos, local fallback with hashed path)
  and Windows-safe folder names.
* File names from `{date}-{slug}` (also `{time}`, `{id}`), accented/Turkish slugs, Windows device names
  and collision suffixes.
* Search with title/tag/body weights, prefix and typo tolerance, `#tag` filters, snippets, recent notes
  and create-from-query.
* Tags view with parent counts, filter toggling, rename/remove everywhere (children and inline tags).
* Templates: eleven built-ins (including Terminal Prompts), team/personal folders with precedence, placeholders (including questions and
  prompt context), diagnostics, completion, hover, preview, create/save/manage/copy/customize.
* Code links with exact/moved/moved-first/fuzzy/lost resolution, range growth via `endText`, CodeLens,
  gutter dots, hover, new-note-from-selection, link selection, re-capture and “notes for file”.
* Wiki links with resolution by title/file name/path/id, completion, navigation, diagnostics, backlinks
  and rename updates.
* Tasks view grouped by note or due date, due/overdue status bar item, `[x]` writes and ✓ editor marks.
* Related view (links in/out, code link status, issues, notes for a file, branch note).
* Branch notes with none/notify/open/create modes and ignored branches.
* Encryption: AES-256-GCM, portable key backup, `folium-secure:` virtual filesystem, sensitive-note
  guarantees.
* AI: prompt notes and follow-ups, target dispatch (Copilot/Cline/Roo/Kilo/clipboard/custom), Copilot
  prompt files, clipboard capture, `#followUp` language model tool, stdio MCP server, AI inbox with atomic
  claiming.
* Import (Markdown/Obsidian, Joplin, Evernote), export (Obsidian/Joplin), Joplin sync, GitHub/GitLab/Jira
  issues, private-note backups.
* Remote-window notices, getting-started walkthrough, status bar, keyboard shortcuts and 40+ settings.
* Documentation: a full [USER_GUIDE.md](USER_GUIDE.md) (generated command/settings reference) and a
  step-by-step [marketplace publishing guide](docs/PUBLISHING.md) with trusted-publishing (OIDC) CI.
* Tags view checkboxes toggle the tag filter.
* New **Terminal Prompts** built-in template and **Send Line to Terminal** command (current note line or a
  selection, with Markdown markers and `$` prompts stripped), covered by unit tests and an extension-host
  integration test against a real terminal.
* Real VS Code screenshots in `USER_GUIDE.md`, `README.md` and `MARKETPLACE.md`, captured with
  `scripts/capture-screenshots.mjs` against an isolated profile.
* Manifest contributions pass the current VS Code extension schema: every view has an icon and walkthrough
  media no longer uses the unsupported `alt` property; the codebase has no unused imports or locals.
* Incremental store refresh (stat-based reuse) and per-note task/tag caches: a 5,000-note refresh dropped
  from ~1.3 s to ~150 ms (164 ms in the VS Code extension host).
* 180+ unit tests (including a Windows path simulation and a 5,000-note performance test), extension-host
  integration tests with a restart phase, and generated `spec/` fixtures that CI keeps fresh.
