# Test plan — Folium Notes on Windows (VS Code)

Build: `npm ci && npm run build && npm run package`, install `dist/folium-notes-1.0.0.vsix` with
`code --install-extension`.

## 1. Install and first run

| # | Step | Expected |
| --- | --- | --- |
| 1.1 | Open a repository with a GitHub origin | Folium activity bar icon appears; Notes/Tags/Tasks/Related views render |
| 1.2 | Check `~/FoliumNotes` equivalent (`%USERPROFILE%\FoliumNotes`) | Folder `github.com_org_repo` created with `.Folium/project.json` |
| 1.3 | Create a shared note | File in `.notes\YYYY-MM-DD-slug.md`, header with id/created/title |
| 1.4 | Create a private note | File under `%USERPROFILE%\FoliumNotes\...`, not in the repo |
| 1.5 | Create notes titled `CON`, `AUX`, `LPT1` | Files are `con_.md`, `aux_.md`, `lpt1_.md` |
| 1.6 | Create the same title twice in one day | Second file gets `-2` |
| 1.7 | Folder without a remote | Private folder `local\<folder>-<hash>`; same key after reopening VS Code |

## 2. Notes view

| # | Step | Expected |
| --- | --- | --- |
| 2.1 | Group by scope/tag/date/color | Groups and counts match; tag groups nest |
| 2.2 | Sort by created/updated/title, toggle order | Stays after reloading the window (per-workspace state) |
| 2.3 | Pin a note | Stays on top; pin survives reload |
| 2.4 | Set a shared note color | Color is personal: `state.json` in the private folder, not the file |
| 2.5 | Filter tags any/all, colors incl. “No color”, dates incl. custom | Filter summary line appears; clear works |
| 2.6 | Drag note onto Private group | Confirmation; file moves outside the repo; private color applies afterwards |
| 2.7 | Drag note onto Trash | Confirmation; Trash group shows entry; restore brings color/pin back |
| 2.8 | Multi-select and drag two notes onto a tag group | Both get the tag; files unchanged otherwise |
| 2.9 | Screen reader (Narrator) on a note item | Reads “Title, shared note, red color, pinned, 2 open tasks, tags …” |
| 2.10 | Delete a note in Explorer while VS Code is open | It disappears from the view within ~1 s |

## 3. Search and tags

| # | Step | Expected |
| --- | --- | --- |
| 3.1 | Search `login` with a title match and a body match | Title match ranks first |
| 3.2 | Search `redreict` | Redirect note still found (typo tolerance) |
| 3.3 | Search `#auth` | Only notes with the tag or its children |
| 3.4 | Search text with no exact note | “Create note: …” row appears and creates a note |
| 3.5 | Rename a tag used in a shared note | Confirmation warns about shared notes; children and inline tags renamed |
| 3.6 | Remove a tag | Inline `#tag` becomes plain `tag` |

## 4. Templates

| # | Step | Expected |
| --- | --- | --- |
| 4.1 | New Note with `defaultTemplate: ask` | Template picker lists built-ins filtered by scope |
| 4.2 | Credentials template | Private-only, `sensitive: true`, encrypted automatically |
| 4.3 | Create a team template in `.notes\.templates` | Same name as a built-in: team version wins |
| 4.4 | `{{ask:Question|A|B}}` | Question asked; chosen option inserted |
| 4.5 | Invalid placeholder `{{titel}}` in a template | Error marker with “Did you mean {{title}}?” |
| 4.6 | `{{selection}}` in a non-prompt template | Warning marker |
| 4.7 | Manage Templates → Customize built-in | Copy appears in the chosen folder and opens |

## 5. Code links

| # | Step | Expected |
| --- | --- | --- |
| 5.1 | Select code → New Note from Selection | Note with fenced snippet and body link; CodeLens shows the note above the code |
| 5.2 | Add two lines above the snippet, run Update Code Links | Status “Moved”, range still correct |
| 5.3 | Move the snippet to another file, update | Link re-points to the new file |
| 5.4 | Edit the snippet slightly | Fuzzy match (≥ 75%) keeps the link |
| 5.5 | Delete the code | Warning CodeLens + gutter warning; hover shows it is lost |
| 5.6 | Private note code link | `file:///C:/…` URI; opens correctly |
| 5.7 | Rename the code file in Explorer | Link follows the rename after refresh |

## 6. Wiki links, tasks, related

| # | Step | Expected |
| --- | --- | --- |
| 6.1 | Type `[[` | Completion lists note titles |
| 6.2 | Ctrl+Click `[[Note#Heading]]` | Opens the note at the heading |
| 6.3 | Link to a missing note | Warning diagnostic; shared→private link is an error |
| 6.4 | Rename a linked note | Links in other notes update |
| 6.5 | Add `- [ ] Task due:2026-11-22` | Appears in Tasks under Today/Overdue; ticking writes `[x]` |
| 6.6 | Tasks: show/hide done, group by note/due | Persists after reload |
| 6.7 | Related view with a note open | Links to/from, code link status, issue |
| 6.8 | Related view with a code file open | Notes for the file and the branch note |

## 7. Branch notes, encryption, AI

| # | Step | Expected |
| --- | --- | --- |
| 7.1 | Switch to `feature/x` with `onBranchSwitch: notify` | Notification offers Open/Create |
| 7.2 | Switch to `main` | No notification (ignored branch) |
| 7.3 | Encrypt a note | Header keeps `sensitive: true`, body replaced by the fence, editor shows decrypted text |
| 7.4 | Save the decrypted editor | File stays encrypted on disk |
| 7.5 | Remove the key (fresh profile) and open the note | Clear error; Restore Key works; fingerprint shown |
| 7.6 | Encrypt a private note, try Send Prompt | Refused; “Move to Shared” offered |
| 7.7 | Prompt note with `{{selection}}` → Send Prompt to Copilot | Chat opens with the filled prompt; note records the send |
| 7.8 | Copy an AI answer with questions → Capture Follow-up | Shared follow-up note with Answer slots and options |
| 7.9 | Answer and Send Answers | Reply copied/sent; note archived when configured |
| 7.10 | Run the MCP server with the shown config, call `create_followup_note` | Note appears in the open IDE |

## 8. Import, export, issues, backup

| # | Step | Expected |
| --- | --- | --- |
| 8.1 | Import an Obsidian folder | Preview counts; folders become tags; links become `[[…]]` |
| 8.2 | Import a Joplin `.jex` | Notebooks become tags; to-dos become tasks with due dates |
| 8.3 | Import an Evernote `.enex` | ENML converted; checkboxes become `- [ ]` |
| 8.4 | Export to a folder inside the repository | Warning modal before writing |
| 8.5 | Export both scopes | Sensitive/encrypted notes skipped and counted |
| 8.6 | Send to Joplin twice | Second run updates notes by stored `joplinId` |
| 8.7 | Create a GitHub issue | Issue URL stored in `issue:`; tokens only to github.com |
| 8.8 | Back up private notes, delete a note, restore | Missing files added, existing files kept and logged |

## 9. Remote and performance

| # | Step | Expected |
| --- | --- | --- |
| 9.1 | Open in a container | One-time notice about data loss; Back Up / Set Private Root offered |
| 9.2 | Open over SSH | Notice shows the remote path of private notes |
| 9.3 | Open a workspace with 5,000 notes | View renders in a few seconds; typing is responsive |
| 9.4 | Search in that workspace | Results within ~50-100 ms |
