# Folium Notes

**Project notes for developers.** Shared notes live in `.notes/` and are committed with the code;
private notes live outside the repository. One view, one search, one task list.

![Folium Notes](https://raw.githubusercontent.com/folium-notes/folium-notes/main/images/icon.png)

No telemetry. No servers. Just Markdown files you can read, diff and review.

## Why Folium Notes?

Most note apps keep notes far away from the code they describe. Folium Notes puts project notes where
they belong:

* **Shared notes** are Markdown files in `<project>/.notes` — reviewed with pull requests, searchable
  with the repo, and readable by your whole team.
* **Private notes** are Markdown files in `~/FoliumNotes/<project>` — outside the repository, never
  committed, never pushed. Perfect for credentials, half-formed ideas and “why does this fail on
  staging?”.
* **One view** merges both, without ever leaking private notes into shared ones.

![Notes view](https://raw.githubusercontent.com/folium-notes/folium-notes/main/images/walkthrough-notes.png)

## Highlights

### Notes that follow your code

Capture a snippet with **New Note from Selection** and Folium remembers the file, the line range and the
text. Move the code around and **Update Code Links** finds it again: exact match, moved snippet, moved
first line, fuzzy match (≥ 75% similar) or a clear “lost” warning. CodeLens and a colored gutter dot show
the note right above the code.

![Code links](https://raw.githubusercontent.com/folium-notes/folium-notes/main/images/walkthrough-code.png)

### Templates for the notes you write twice a week

Bug investigations, meeting notes, decision records, manual test prerequisites, credentials, TILs,
checklists, branch notes and AI prompts ship built-in. Add team templates in `.notes/.templates` and
personal ones in `~/FoliumNotes/.templates`; for the same name team wins over personal, personal wins
over built-in.

### Tasks where you already write them

`- [ ]` in any note becomes a task. Add `due:2026-11-22` or 📅 for due dates, group by note or due date,
and get a 🔔 status bar reminder for overdue work. Ticking a task rewrites one character in the file.

### AI without giving away your notes

AI tools **cannot read** your notes. You choose what to send:

* **Prompt notes** fill `{{selection}}`, `{{file}}`, `{{language}}` and `{{clipboard}}` and send to
  Copilot Chat, Cline, Roo Code or Kilo Code, or copy for Continue, Claude Code, Codex and JetBrains AI.
* **Follow-ups** turn an AI answer into a shared note with questions, decisions and open items; answer
  them in Markdown and send the answers back.
* Private and sensitive notes are never sent. Sensitive notes are never exported, published or shared.

### Private, by design

* Shared-note colors and pins are personal (`state.json` in your private folder).
* Encryption is AES-256-GCM with the key in VS Code secret storage; the key is portable between machines
  and IDEs as base64 text.
* Trash is per project and covers shared notes too; restore brings your colors and pins back.

![AI follow-up](https://raw.githubusercontent.com/folium-notes/folium-notes/main/images/walkthrough-ai.png)

## Also included

* Search with title boost, typo tolerance and `#tag` filters.
* `[[Wiki links]]` with completion, diagnostics and backlinks.
* Import from Markdown/Obsidian folders, Joplin `.jex` and Evernote `.enex`.
* Export to Obsidian or Joplin Markdown, send to Joplin, create GitHub/GitLab/Jira issues.
* Tar backups of all private notes (the encryption key stays separate).
* Branch notes that follow your git branch.
* A getting-started walkthrough, keyboard shortcuts and a status bar that tells you where a note lives.

## Keyboard

<kbd>Alt</kbd>+<kbd>N</kbd> then:

| Key | Action |
| --- | --- |
| <kbd>N</kbd> | New note |
| <kbd>T</kbd> | New note from template |
| <kbd>S</kbd> | Search |
| <kbd>C</kbd> | New note from selection |
| <kbd>L</kbd> | Link selection to note |
| <kbd>B</kbd> | Branch note |
| <kbd>P</kbd> | Send prompt |
| <kbd>F</kbd> | Follow-up from clipboard |

On macOS use <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd>.

## Requirements

VS Code 1.90 or newer. Notes are plain Markdown; no other extension is required.

## Privacy

Folium Notes collects nothing. It does not include telemetry, a sync service or an account. Network
requests happen only when you send a prompt, talk to Joplin or create an issue, and only with the
credentials you configure.

## Documentation

[User guide](https://github.com/folium-notes/folium-notes/blob/main/USER_GUIDE.md) ·
[File format](https://github.com/folium-notes/folium-notes/blob/main/spec/FORMAT.md) ·
[Design notes](https://github.com/folium-notes/folium-notes/blob/main/DESIGN.md)

## Open format

The note format is documented in `spec/FORMAT.md` and exported as fixtures so other IDEs can read and
write the same files. Your notes stay yours.
