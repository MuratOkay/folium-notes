# Folium Notes format (version 1)

This document is the shared on-disk contract between Folium Notes for VS Code and
any other IDE implementation (for example a JetBrains plugin). Everything here is
implemented in `src/core` (pure TypeScript, no editor API) and exported as machine
readable fixtures in `spec/fixtures/*.json`. The built-in templates are in
`spec/resources/templates/*.md`.

All fixtures are generated with `TZ=UTC` (`npm run fixtures`). CI fails when the
fixtures are stale (`npm run fixtures:check`).

---

## 1. Folders

| Purpose | Location | Setting |
| --- | --- | --- |
| Shared notes | `<project>/.notes/**/*.md` | `foliumNotes.sharedFolder` (default `.notes`) |
| Private notes | `<privateRoot>/<project folder>/**/*.md` | `foliumNotes.privateRoot` (default `~/FoliumNotes`) |
| Personal state | `<private folder>/.Folium/state.json` | — |
| Trash | `<private folder>/.Folium/trash/` + `trash.json` | — |
| Project record | `<private folder>/.Folium/project.json` | — |
| Team templates | `<sharedFolder>/.templates/*.md` | — |
| Personal templates | `<privateRoot>/.templates/*.md` | — |
| AI inbox | `<privateRoot>/.inbox/` | — |

Directories starting with `.` are skipped when scanning notes (except the roots
above, which are themselves hidden). `.Folium`, `.templates`, `.inbox`, `.git` and
`node_modules` are never scanned for notes.

`project.json` is informational only:

```json
{ "version": 1, "key": "github.com/org/repo", "folder": "github.com_org_repo", "recordedAt": "…" }
```

---

## 2. Project key and private folder name

The project key comes from the git remote (`origin`, else the first remote).
Remote URLs are normalised to `host/path`, lower case, without `.git`:

| Remote | Key |
| --- | --- |
| `git@github.com:Org/Repo.git` | `github.com/org/repo` |
| `ssh://git@github.com/Org/Repo.git` | `github.com/org/repo` |
| `https://user@gitlab.com/Group/Sub/Repo.git/` | `gitlab.com/group/sub/repo` |
| `https://dev.azure.com/Contoso/Proj/_git/Repo` | `dev.azure.com/contoso/proj/repo` |
| `https://contoso.visualstudio.com/Proj/_git/Repo` | `dev.azure.com/contoso/proj/repo` |
| `git@ssh.dev.azure.com:v3/Contoso/Proj/Repo` | `dev.azure.com/contoso/proj/repo` |

When the workspace is a sub folder of the repository, the relative path is appended
(`github.com/org/repo/packages/web`).

No remote: `local/<folder>-<sha1(canonical path)[0..8]>`, where `<folder>` is the
last path segment (unsafe characters replaced by `-`) and the canonical path uses
`/` separators; on Windows the drive letter is lower-cased first
(`local/App-066945e6`). `foliumNotes.privateProjectKey` overrides the key verbatim
(separators normalised, surrounding slashes removed).

Folder name: `/` → `_`, every other character outside `[A-Za-z0-9._-]` → `-`,
leading/trailing separators removed, collapsed `-`. Names longer than 120
characters are truncated to 111 characters plus `-` and the first 8 hex characters
of SHA-1 of the key (so the result is exactly 120 characters).

---

## 3. Note file

A note is Markdown with an optional YAML front-matter header. Unknown header keys
are preserved. Canonical key order:

`id`, `title`, `created`, `updated`, `tags`, `color`, `archived`, `sensitive`,
`encrypted`, `code`, `branch`, `kind`, `target`, `status`, `issue`, `imported_from`.

```markdown
---
id: 01J0ABCDEFGHJKMNPQRSTVWXYZ
title: Fix login redirect
created: 2026-11-22T14:14:05+03:00
tags: [ bug, auth/login ]
color: red
code:
  - path: ../src/auth/login.ts
    lines: 12-18
    text: |-
      export function login() {
      return redirect(url);
    endText: }
---

# Fix login redirect

Text with a [[Auth flow]] link and an inline #needs-review tag.

- [ ] Reproduce due:2026-11-25
- [x] Write test
```

* `id` — ULID (26 characters, Crockford base32). Created once, never changed.
* `created`/`updated` — local ISO-8601 with explicit offset, second precision, no
  milliseconds (`2026-11-22T14:14:05+03:00`).
* `tags` — list or comma separated string. Normalised (lower case, spaces → `-`,
  nested with `/`).
* `color` — `red orange yellow green blue purple pink gray` (`grey` accepted).
  Private notes store their color in the file. Shared notes store the color in
  personal state unless `foliumNotes.shareColors` is on.
* `archived` — date/time when archived (a bare `true` is also accepted).
* `sensitive` — `true` for notes that may never be shared, exported, published or
  sent to AI.
* `encrypted` — `aes-256-gcm:<fingerprint>` when the body is encrypted.
* `code` — list of code links (see §7).
* `branch` — git branch for branch notes.
* `kind` — `prompt` or `followup` for AI notes.
* `target` — AI target (`copilot`, `cline`, `roo`, `kilo`, `continue`, `claude`,
  `codex`, `jetbrains`, `custom`).
* `status`, `issue` — workflow status and linked issue URL.
* `imported_from` — stable import id (`md:<path>`, `joplin:<id>`, `enex:<file>:<n>:<title>`).

### Title

`title:` field → first non-empty body line with leading `#` marks removed → file
name (`2026-11-22-fix-login.md` → `Fix login`).

### Write style

* Plain scalars when safe, otherwise double quotes (`title: "Fix: login error"`).
  Values that look like numbers/booleans (`12`, `true`) are quoted. Empty string is
  `""`.
* Flow lists with spaces: `tags: [ bug, auth/login ]`; empty list `[]`.
* Block lists of maps for `code:`.
* Multi-line strings use `|-` with two-space content indentation.
* Editing a field must not rewrite other lines. The VS Code implementation locates
  the field and replaces only its bytes (YAML `parseDocument` ranges for reading,
  a line-range replacement for writing). New fields are inserted after the last
  single-line field, before block lists.

---

## 4. File names

Pattern `{date}-{slug}` with tokens `{date}` (`YYYY-MM-DD`), `{time}` (`HH-mm-ss`),
`{slug}`, `{id}` (ULID). The slug is lower case, accents removed, `ı` → `i`,
everything outside `[a-z0-9]` → `-`, collapsed, trimmed, maximum 60 characters.
`< > : " / \ | ? *` and control characters are removed from the final name;
trailing dots and spaces are trimmed. Windows device names (`CON`, `PRN`, `AUX`,
`NUL`, `CLOCK$`, `COM1-9`, `LPT1-9`) get `_` (`CON` → `con_.md`). Collisions get
`-2`, `-3`, … (comparison is case-insensitive).

---

## 5. Tags

Header tags plus inline `#hashtags` when `foliumNotes.inlineTags` is on. An inline
tag starts a line or follows whitespace, must contain at least one letter, may use
`/` for nesting and is ignored inside fenced blocks and inline code. `#123` is not a
tag; e-mail addresses are not tags. Tags are lower case; spaces become `-`. Tag
views count parents (`a/b/c` counts for `a`, `a/b` and `a/b/c`, once per note).
Renaming a tag also renames children and inline occurrences; removing a tag turns
inline `#tag` into the plain word `tag`.

---

## 6. Personal state, trash and archive

`state.json` (shared-note colors, pins, Joplin ids):

```json
{
  "version": 1,
  "notes": {
    "01J0ABCDEFGHJKMNPQRSTVWXYZ": { "color": "red", "pinned": true },
    "shared:2026-11-22-note.md": { "color": "none" }
  }
}
```

The key is the note `id`, or `<scope>:<relPath>` when there is no id. `color: none`
means "explicitly no color". Pins are always personal. Trash entries store the
original path and a copy of the personal data, so restoring brings colors and pins
back. `trash.json`:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "…",
      "scope": "shared",
      "relPath": "2026-11-22-note.md",
      "storedName": "1700000000000-note.md",
      "deletedAt": "2026-11-22T14:14:05+03:00",
      "originalPath": "/repo/.notes/2026-11-22-note.md",
      "personal": { "color": "red", "pinned": true }
    }
  ]
}
```

Entries older than `foliumNotes.trashRetentionDays` (default 30) are removed on
load. `0` keeps everything.

---

## 7. Code links

```yaml
code:
  - path: ../src/auth/login.ts
    lines: 12-18
    text: |-
      export function login() {
      return redirect(url);
    endText: }
```

* `path` — relative to the note file for shared notes, `file://` URI for private notes.
* `lines` — 1-based inclusive range, `12-18` or `12`.
* `text` — first ≤ 3 non-empty trimmed lines of the snippet, newline separated.
* `endText` — last line of the snippet; used to grow the range when the snippet
  got longer.

Resolution order: **exact** (all captured lines match at `lines`) → **moved** (the
whole captured block appears elsewhere; nearest to the original line) →
**moved-first** (first captured line appears elsewhere) → **fuzzy** (best window
with bigram similarity ≥ 0.75) → **lost**. Resolution is case/whitespace tolerant
on line content (trimmed comparison).

---

## 8. Wiki links

`[[Target]]`, `[[Target#Heading]]`, `[[Target|alias]]`, `[[Target#Heading|alias]]`.
Links inside code are ignored. Targets resolve case-insensitively within the
project by title, file name (with and without the date prefix), relative path (with
and without `.md`) and `id`, preferring the note's own scope. Shared notes may not
link to private notes (diagnostic `private-from-shared`). Renaming a note rewrites
links that used the old title, file name or path, keeping `#heading` and alias.

---

## 9. Tasks

`- [ ]`, `* [x]` and `1. [ ]` outside code. Due dates: `due:YYYY-MM-DD` or
`📅 YYYY-MM-DD`. Buckets: overdue, today, next 7 days, later, none (local days).
Ticking a task rewrites only the status character. `foliumNotes.tasks.showCheckMarks`
adds a ✓ decoration after done tasks in the editor.

---

## 10. Templates

A template is Markdown with a `template:` map:

```yaml
---
template:
  name: Team bug
  description: Our bug flow
  scope: shared        # optional
  privateOnly: false
  sharedOnly: false
---
```

Other front-matter fields (tags, color, kind, target, sensitive, …) are copied into
new notes. Precedence for the same name: **team** (`<sharedFolder>/.templates`) >
**personal** (`<privateRoot>/.templates`) > **built-in**.

Built-ins: Bug investigation, Meeting notes, Decision record, Manual test
prerequisites (`## Prerequisites` + bash block), Credentials (No/Name/Username/
Password table, private only, sensitive, encrypted on create), Today I learned,
Checklist, Branch note, AI prompt (shared only, `kind: prompt`), Terminal Prompts, Other.

Placeholders: `{{title}}`, `{{date}}`, `{{time}}`, `{{datetime}}`, `{{user}}`
(git `user.name`), `{{project}}`, `{{branch}}`, `{{ask:Question}}`,
`{{ask:Question|Option A|Option B}}`, `{{cursor}}`; prompt templates also
`{{selection}}`, `{{file}}`, `{{language}}`, `{{clipboard}}`. Problems reported by
validation: unknown placeholder (with suggestion), prompt-only placeholder in a
non-prompt template, empty ask, more than one cursor, bad options.

`foliumNotes.defaultTemplate`: `""` blank, `ask`, or a template name.

---

## 11. Encryption

AES-256-GCM with a 32-byte key stored in the IDE secret storage. The key is shared
as base64 text (portable between IDEs); the fingerprint is the first 8 hex
characters of SHA-256(key). Encrypting keeps the header and the title line and
replaces the rest:

````markdown
```Folium-encrypted
v1.<base64(iv12 | tag16 | ciphertext)>
```
````

The payload is wrapped at 76 characters. The header gets `sensitive: true` and
`encrypted: aes-256-gcm:<fingerprint>`. Encrypted notes open decrypted in the editor
only (VS Code: virtual `folium-secure:` file system); saving re-encrypts. Sensitive
notes are never shared, exported, published or sent to AI tools.

Deterministic crypto fixture (`spec/fixtures/crypto.json`): key base64
`AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=`, IV `000102…0b`.

---

## 12. AI follow-ups

`kind: followup` notes are always shared. Parsers accept a ```` ```followup ```` YAML
block (`questions` with `options`, `decisions`, `openItems`), `Questions`/`Decisions`
headings with lists, `Option A:` lines and sentences ending in `?`. The note body
contains `- Answer:` slots and `- [ ]` options. Sending answers composes answers,
decisions and open items and archives the note when configured.

AI tools can only *send* content: clipboard capture, the Copilot `#followUp` tool,
JetBrains MCP toolset, or the bundled MCP server tool `create_followup_note`, which
writes a JSON request to `<privateRoot>/.inbox` (temp file + rename). An IDE claims a
request by atomically renaming it to `.<ide>-<pid>.claimed`. Content is capped at
200,000 bytes.

---

## 13. Imports, exports, backup

* Markdown/Obsidian: front matter (`tags`, `tag`, `keywords`, `created`, `date`),
  folders as tags, local `.md` links become `[[wiki links]]`, duplicates skipped by
  `imported_from`/id.
* Joplin `.jex`: notebooks → tags, internal `:/id` links → `[[title]]`, to-dos with
  due dates.
* Evernote `.enex`: ENML → Markdown, checkboxes → tasks.
* Export: Markdown (Obsidian, keeps wiki links) or Joplin Markdown (front matter
  title/created/updated/tags, relative links); shared/private/both; sensitive notes
  are skipped; warns when the target is inside the project.
* Backup: tar with `Folium-backup.json` first
  (`format`, `version: 1`, `created`, `source`, `counts`), everything below the
  private root except `.inbox`, GNU long names. Restore adds missing files only and
  reports conflicts. The encryption key is not part of the backup.

---

## 14. Issues

Body: note body without header and title, `[[links]]` as plain text, code links as
permalinks at the pushed commit (GitHub/GitLab). Tags become labels when enabled.
Tokens are only sent to github.com / gitlab.com or hosts the user confirmed; URLs
from project settings are ignored in untrusted workspaces.

---

## 15. Fixtures

`spec/fixtures`: `frontmatter.json`, `project-keys.json`, `filenames.json`,
`tags.json`, `tasks.json`, `search.json`, `templates.json`, `code-links.json`,
`links.json`, `views.json`, `crypto.json`.
