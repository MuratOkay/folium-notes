# Publishing checklist

For the full, command-by-command walkthrough see [PUBLISHING.md](PUBLISHING.md). The checklist below
is the short version to run through on release day.


## Before the first publish

- [ ] `npm ci` on a clean clone; `npm run verify` passes (typecheck, unit tests, fixtures check).
- [ ] `npm run build` produces `dist/extension.js` and `dist/mcp-server.js`.
- [ ] `npm run test:integration` passes on Windows and macOS (needs a graphical session; use
      `xvfb-run -a npm run test:integration` on headless Linux).
- [ ] Manual test plans executed: `docs/test-plans/vscode-windows.md`, `docs/test-plans/vscode-macos.md`.
- [x] Real screenshots captured with `npm run screenshots` into `images/screenshot-*.png` and referenced
      from `MARKETPLACE.md` via public https URLs (re-capture on Windows/macOS if platform UI matters).
- [ ] `MARKETPLACE.md` read end-to-end; verify every https image URL returns 200.
- [ ] `CHANGELOG.md` has an entry for the version being published; the version in `package.json` matches.
- [ ] `README.md` and `spec/FORMAT.md` describe every setting that exists in `package.json`.
- [ ] `npm run fixtures:check` is green (CI fails otherwise).
- [ ] No secrets, tokens or personal paths in the repository (`git grep -n "token\|secret\|/home/"`).
- [ ] `git status` clean; tag the release commit.

## Packaging

- [ ] `npm run package` → `dist/folium-notes-<version>.vsix` (pre-release) and
      `dist/folium-notes-<version>-companion.zip` (MCP server + spec + docs).
- [ ] Install the VSIX on a clean VS Code profile (`--profile`), run the smoke section of the test plan.
- [ ] Check the VSIX size and the packaged file list (`npx vsce ls --tree`).
- [ ] Confirm `MARKETPLACE.md` was used as the VSIX readme (the packaging script swaps it in).

## Publish

- [ ] `npx vsce publish --pre-release --packagePath dist/folium-notes-<version>.vsix` (or upload via the
      Marketplace web UI).
- [ ] Verify the marketplace listing: title, description, categories, icon, screenshots, README rendering.
- [ ] Install from the marketplace on Windows and macOS; confirm activation has no errors in the developer
      tools console.
- [ ] Attach the companion zip and the VSIX to the GitHub release with release notes from `CHANGELOG.md`.

## After publishing

- [ ] Watch the first issues for format compatibility reports; keep `spec/fixtures` stable within a minor
      version.
- [ ] When changing the on-disk format: regenerate fixtures, bump the spec version, and document migration.
- [ ] Rotate any test tokens used during verification.
