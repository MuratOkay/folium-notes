# Test plan — Folium Notes on macOS (VS Code)

Install `dist/folium-notes-1.0.0.vsix` (`code --install-extension`). Use a case-insensitive APFS volume for
the workspace (the default).

## 1. Shortcuts and menus

| # | Step | Expected |
| --- | --- | --- |
| 1.1 | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> then <kbd>N</kbd> | New note flow |
| 1.2 | <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> <kbd>T</kbd> / <kbd>S</kbd> / <kbd>C</kbd> / <kbd>L</kbd> / <kbd>B</kbd> / <kbd>P</kbd> / <kbd>F</kbd> | Template / search / selection note / link selection / branch note / prompt / follow-up |
| 1.3 | Editor context menu on a selection | Folium entries present; hidden inside notes for selection actions |
| 1.4 | Editor title on a prompt note | Send Prompt action visible |
| 1.5 | Notes view title buttons | New, template, search, group, sort, filter, clear, refresh |

## 2. Paths and home folder

| # | Step | Expected |
| --- | --- | --- |
| 2.1 | First run | `~/FoliumNotes/<host>_<org>_<repo>/.Folium/project.json` created |
| 2.2 | Set `privateRoot` to `~/Documents/Folium` | Notes move to the new root after reload; old folder untouched |
| 2.3 | Workspace on an external volume | Shared notes on that volume; private notes still in home |
| 2.4 | Case-insensitive collision (`Fix Login` vs `fix login`) | Second file gets `-2` |
| 2.5 | Accented title (`Café Crème`) | Slug `cafe-creme` |
| 2.6 | Turkish dotless ı (`Iğdır`) | Slug `igdir` |

## 3. Editor and views

| # | Step | Expected |
| --- | --- | --- |
| 3.1 | CodeLens above a linked snippet | Note title visible; click opens the note |
| 3.2 | Gutter dot color | Matches the note color (theme-aware) |
| 3.3 | Hover on a linked line | Markdown preview with snippet and Open note link |
| 3.4 | Unsaved edit in a note | Tree title and search update immediately; reverting restores |
| 3.5 | Save the note | File updated; no duplicate entries |
| 3.6 | Full-screen + split editor | Views and status bar remain usable |
| 3.7 | VoiceOver on a note | Label reads title, scope, color, pin, open tasks and tags |

## 4. Encryption

| # | Step | Expected |
| --- | --- | --- |
| 4.1 | Encrypt a note | Key stored in Keychain-backed secret storage; fingerprint shown |
| 4.2 | Open the encrypted note | Decrypted text in a `folium-secure:` tab |
| 4.3 | Edit and save | File on disk stays encrypted; `git diff` shows only ciphertext changes |
| 4.4 | Back Up Key, remove the key with a fresh profile, Restore Key | Note decrypts again |
| 4.5 | Export/Joplin/issue on an encrypted note | Skipped or refused with a clear message |

## 5. AI and integrations

| # | Step | Expected |
| --- | --- | --- |
| 5.1 | Send Prompt to Copilot Chat | Prompt appears; `prompts.submit` controls auto-send |
| 5.2 | Target Continue / Claude Code / JetBrains | Prompt copied to clipboard with an explanation |
| 5.3 | Custom target command set at user level | Command runs in trusted workspace; refused when untrusted |
| 5.4 | Save as Copilot Prompt File | `.github/prompts/<slug>.prompt.md` created with `mode: agent` |
| 5.5 | MCP server via the Connect AI Tools snippet | `create_followup_note` creates a note in the open window |
| 5.6 | Joplin running locally | Send to Joplin creates/updates a notebook per project |

## 6. Backup and restore

| # | Step | Expected |
| --- | --- | --- |
| 6.1 | Back Up Private Notes | `.tar` with `Folium-backup.json` first; key not included |
| 6.2 | Inspect with `tar -tf` | `.inbox` excluded, long paths intact (GNU long names) |
| 6.3 | Restore into an empty profile | Files restored; conflicts (existing files) are logged, not overwritten |
| 6.4 | Restore the same backup twice | Second run writes nothing and reports conflicts |

## 7. Remote windows

| # | Step | Expected |
| --- | --- | --- |
| 7.1 | Dev Container | One-time warning; Back Up Now / Set Private Root |
| 7.2 | Codespaces | Notice points at the remote private folder |
| 7.3 | WSL | Notice explains where private notes live |
| 7.4 | Rebuild the container | Notice appears again for the new container; backup offered |

## 8. Performance

| # | Step | Expected |
| --- | --- | --- |
| 8.1 | 5,000 notes, cold start | Notes view usable in a few seconds |
| 8.2 | Type in the search box | Results update within ~100 ms |
| 8.3 | Rename a tag used by 500 notes | Completes in a few seconds with a progress-free UI |
