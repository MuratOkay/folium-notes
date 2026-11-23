# Publishing Folium Notes to the VS Code Marketplace — step by step

This is the long version of [publishing-checklist.md](publishing-checklist.md): every command, every
account, every error you are likely to hit. It targets VS Code Marketplace as of **November 2026**, when
Azure DevOps is retiring global Personal Access Tokens (December 1, 2026) in favour of federated
(trusted) publishing.

The extension identity is:

| Field | Value |
| --- | --- |
| Publisher ID | `folium` (from `package.json`) |
| Extension `name` | `folium-notes` |
| Marketplace ID | `folium.folium-notes` |
| Version | `0.1.0` (pre-release channel) |

The publisher ID and the extension name are **permanent** once published, and both the `name` and the
`displayName` must be globally unique on the Marketplace. Decide before the first upload.

---

## 0. What you publish and how versioning works

Two artifacts are produced by `npm run package`:

* `dist/folium-notes-<version>.vsix` — the extension package. By default it is marked **pre-release**;
  `npm run package:stable` builds the same VSIX without that flag.
* `dist/folium-notes-<version>-companion.zip` — MCP server, spec/fixtures, templates, user guide, docs.
  This is not a Marketplace artifact; attach it to the GitHub release.

Marketplace version rules (official, and different from npm):

* Only `major.minor.patch` is supported; `1.2.3-beta.1` style versions are rejected.
* Pre-release and regular releases need **different versions**. If `0.1.0` is pre-release, the first stable
  release must be something like `0.2.0` (never the same number).
* VS Code updates users to the highest available version, so a stable release can supersede a higher
  pre-release. The recommendation is even minor numbers for stable (`0.2.x`) and odd minor numbers for
  pre-release (`0.3.x`). This repository starts at `0.1.0` as a pre-release.
* Pre-release requires `engines.vscode` of at least `1.63`; Folium requires `^1.90`, so this is fine.

Users opt in to pre-release per extension (Extensions view → the extension → **Switch to Pre-Release
Version**), or from the CLI:

```bash
code --install-extension folium.folium-notes --pre-release
```

---

## 1. One-time accounts and publisher

1. Sign in to the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage) with
   a Microsoft account.
2. Create a publisher: **Create publisher**. Use `folium` as the **ID** (it must match `publisher` in
   `package.json`; it cannot be changed later) and “Folium Notes” as the display name.
3. Keep the extension `name` as `folium-notes`. If the Marketplace already has that name (or the display
   name), choose another `name`/`displayName` **before** publishing; names are reserved forever once used.

---

## 2. Choose how you authenticate

There are three supported paths. Pick one and write it down in your release notes so the next release is
repeatable.

### 2a. Trusted publishing with GitHub Actions (recommended, no long-lived secret)

Trusted publishing uses OIDC: GitHub proves the workflow identity to the Marketplace, and there is no PAT
to leak or rotate.

One-time setup:

1. Marketplace → publisher `folium` → **Trusted Publishing** → **Create**.
2. Fill in the policy:
   * **Policy name**: `Release workflow`
   * **Repository owner**: the GitHub user/org that owns the repository
   * **Repository**: `folium-notes`
   * **Workflow**: `publish.yml` (the file name under `.github/workflows`)
   * **Environment**: leave empty unless the workflow uses a GitHub environment
3. For a **private** repository, run the workflow within 48 hours: the first successful token exchange
   activates the policy permanently.
4. Add a repository variable **`PUBLISH_ENABLED=true`** (Settings → Secrets and variables → Actions →
   Variables). Until it exists the publish job is skipped, so tagging a release does not create a failed run.
5. The workflow must request an OIDC token and publish with vsce 4.x:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22
  - run: npm ci
  - run: npx @vscode/vsce publish --oidc
```

Marketplace credentials from OIDC expire after 15 minutes and each OIDC token can be exchanged only once.
Run the publish step once per release.

### 2b. Microsoft Entra ID (Azure Pipelines)

Use this when your pipeline lives in Azure DevOps. Create a user-assigned managed identity, federate it with
the service connection, add the identity to the publisher with the **Contributor** role, then publish with:

```bash
npx @vscode/vsce publish --azure-credential
```

### 2c. Personal Access Token (legacy, until December 1, 2026)

PATs still work today but global PATs are being retired. Do not build new automation on them.

1. Azure DevOps → **User settings** → **Personal access tokens** → **New token**.
2. **Organization: All accessible organizations** (a specific organization is the most common 401/403
   cause), **Scopes: Custom defined → Show all scopes → Marketplace → Manage**.
3. Copy the token once, then:

```bash
npx @vscode/vsce login folium
# paste the PAT when prompted
```

For a single publish without login you can pass `--pat <token>` or set `VSCE_PAT`.

---

## 3. Prepare the metadata

Open `package.json` and check every field below before the first upload:

| Field | Current | What to do |
| --- | --- | --- |
| `publisher` | `folium` | Must match the publisher ID exactly |
| `name` | `folium-notes` | Permanent Marketplace id; keep it short |
| `displayName` | `Folium Notes` | Must be unique on the Marketplace |
| `description` | one sentence | Shown under the title and in search results |
| `version` | `0.1.0` | See §0: odd minor = pre-release, even minor = stable |
| `engines.vscode` | `^1.90.0` | Minimum supported VS Code |
| `icon` | `images/icon.png` | PNG, at least 128×128 (ours is 256×256); SVG is rejected |
| `repository` | `https://github.com/MuratOkay/folium-notes` | Matches `package.json` |
| `license` | `MIT` + `LICENSE` | A license file must be included (ours is) |
| `categories` | Other, Notebooks | At most three; keep them accurate |
| `keywords` | 5 keywords | Marketplace allows at most **30** |
| `galleryBanner` | dark green | Optional but makes the listing look finished |
| `private` | absent | Do **not** add `private: true`; npm-only field |

`vsce` also validates the readme and changelog:

* Images in README/MARKETPLACE and CHANGELOG must be served over **https**.
* SVG images (and `data:image/svg`) are rejected in README/CHANGELOG unless they come from an approved
  badge host. Use PNG/JPG/GIF for screenshots.
* `MARKETPLACE.md` is the marketplace readme: `npm run package` temporarily copies it over `README.md`,
  packages, and restores the developer README. You can also publish with
  `--readme-path MARKETPLACE.md`.

### Screenshots

The real screenshots are committed as `images/screenshot-*.png` (1440×900 at 1.5×, 2160×1350).
Refresh them with:

```bash
npm run screenshots
```

The script packages the extension, writes a fictional demo project to `/tmp/folio-demo`, launches an
isolated VS Code profile with the Chrome DevTools protocol and drives the UI through seven scenes:

1. **Notes view** — shared/private groups, colors, a pin, tasks and related notes (`screenshot-notes.png`).
2. **AI follow-up** — questions, `Answer:` slots and options (`screenshot-ai-followup.png`).
3. **Code links** — CodeLens with the note title and a colored gutter dot (`screenshot-code-links.png`).
4. **Tasks** — grouped by due date with the release checklist open (`screenshot-tasks.png`).
5. **Search** — title match and “create note with this title” (`screenshot-search.png`).
6. **Templates** — the Terminal Prompts template (`screenshot-templates.png`).
7. **Terminal Prompts** — the note beside the integrated terminal (`screenshot-terminal.png`).

`MARKETPLACE.md` points at `https://raw.githubusercontent.com/MuratOkay/folium-notes/main/images/...`.
After pushing, verify every URL returns `200`:

```bash
for url in $(grep -o 'https://[^) ]*' MARKETPLACE.md | sort -u); do
  printf '%s ' "$url"; curl -s -o /dev/null -w '%{http_code}\n' "$url"
done
```

Marketplace images must be https PNG/JPG/GIF (SVG is rejected). Re-capture on Windows or macOS only if
you need platform-specific UI; the committed captures are real VS Code, not mockups.

---

## 4. Quality gates

Run these from a clean checkout before **every** release:

```bash
npm ci
npm run verify          # typecheck + build + 184 unit tests + fixtures + docs check
npm run test:perf       # 5,000-note core and store benchmarks
npm run test:integration  # real VS Code (first/restart/perf); needs a display or xvfb
```

On headless Linux use `xvfb-run -a npm run test:integration`; on a machine with VS Code installed you can
skip the download with `VSCODE_EXECUTABLE=/usr/share/code/code`. Without an OS keyring the restart phase
skips only the key-persistence assertion (it says so in the log).

Then run the platform test plans manually:

* [test plans — Windows](test-plans/vscode-windows.md)
* [test plans — macOS](test-plans/vscode-macos.md)

Finally install the built VSIX into a **fresh profile** and smoke test it:

```bash
rm -rf /tmp/folio-profile /tmp/folio-ext
code --user-data-dir=/tmp/folio-profile --extensions-dir=/tmp/folio-ext \\
  --install-extension dist/folium-notes-0.1.0.vsix
code --user-data-dir=/tmp/folio-profile --extensions-dir=/tmp/folio-ext /path/to/some/project
```

Check: the walkthrough opens, the four views render, a shared and a private note can be created, search
finds them, a task appears in the Tasks view, a code selection shows the CodeLens, and the status bar menu
works for both scopes.

---

## 5. Build and inspect the package

```bash
npm run package          # pre-release VSIX + companion zip
npm run package:stable   # stable VSIX (same version) + companion zip
```

Inspect what is inside before uploading:

```bash
npx @vscode/vsce ls --tree
dist/folium-notes-0.1.0.vsix   # 53 files, ~196 KB
unzip -p dist/folium-notes-0.1.0.vsix extension.vsixmanifest | grep -i -E 'Identity|PreRelease'
unzip -p dist/folium-notes-0.1.0.vsix extension/readme.md | head -5   # must be MARKETPLACE.md
```

The manifest must contain `Id="folium-notes" Publisher="folium"` and, for a pre-release,
`Microsoft.VisualStudio.Code.PreRelease = true`. The package contains `dist/`, `images/`, `spec/`,
`USER_GUIDE.md`, the marketplace readme and the changelog; `src/`, `test/`, `docs/` and `scripts/` are
excluded by `.vscodeignore`.

---

## 6. Publish the first pre-release

Pick one of these, depending on your authentication choice from §2.

### Option A — Trusted publishing (no local credentials)

Commit `.github/workflows/publish.yml` (see §9), create a tag, and let GitHub Actions publish:

```bash
git tag v0.1.0-pre
git push origin v0.1.0-pre
```

The workflow runs `npx @vscode/vsce publish --oidc --pre-release --packagePath dist/folium-notes-0.1.0.vsix`.

### Option B — Microsoft Entra ID on this machine

```bash
npx @vscode/vsce publish --azure-credential --pre-release \\
  --packagePath dist/folium-notes-0.1.0.vsix
```

A browser window asks you to sign in; no PAT is stored.

### Option C — PAT (legacy)

```bash
npx @vscode/vsce login folium        # paste a Marketplace (Manage) PAT
npx @vscode/vsce publish --pre-release --packagePath dist/folium-notes-0.1.0.vsix
```

### Option D — manual upload

Marketplace → Manage publishers & extensions → **New extension** → **Visual Studio Code** → upload the
VSIX. The pre-release flag inside the package is preserved.

Then verify:

1. The listing appears (search can take a few minutes to update).
2. `code --install-extension folium.folium-notes --pre-release` installs it.
3. In the Extensions view the extension offers **Switch to Pre-Release Version**.
4. The marketplace page renders the readme images (https) and the changelog.

### Publish a stable release later

1. Bump to an even minor version (`0.2.0`), e.g. `npm version 0.2.0 --no-git-tag-version`.
2. Update `CHANGELOG.md` and `MARKETPLACE.md` if needed.
3. Run the gates in §4, then `npm run package:stable`.
4. Publish **without** `--pre-release`:

```bash
npx @vscode/vsce publish --azure-credential --packagePath dist/folium-notes-0.2.0.vsix
# or --oidc in CI, or --pat/VSCE_PAT with a legacy PAT
```

Users on the pre-release channel are updated to the higher stable version automatically; users who want
future pre-releases remain opted in.

---

## 7. After publishing

1. Tag the release in git and push the tag:

```bash
git tag v0.1.0-pre
git push origin main --tags
```

2. Create a GitHub release for the tag and attach:
   * `dist/folium-notes-<version>.vsix`
   * `dist/folium-notes-<version>-companion.zip`
3. Add release notes from `CHANGELOG.md`.
4. Watch the first installs and reviews; the publisher page shows acquisition trends and ratings.
5. Keep `spec/fixtures` stable within a minor version and regenerate them for format changes
   (`npm run fixtures`).

---

## 8. Publishing the companion zip

The JetBrains/other-IDE work is not built in this repository. The companion zip contains the MCP server,
`spec/FORMAT.md`, fixtures, built-in templates and the docs so another IDE can implement the same format.
Attach it to the GitHub release (it is not a Marketplace artifact) and mention it in the release notes.

---

## 9. Automating releases

### Trusted publishing workflow (recommended)

`.github/workflows/publish.yml` in this repository is wired for OIDC. Create the policy in §2a with the
workflow file name `publish.yml`, then push a tag:

```bash
git tag v0.1.0-pre && git push origin v0.1.0-pre
```

The workflow runs the gates, packages a pre-release for `*-pre` tags and a stable build for other tags, and
publishes with `--oidc`.

If you prefer to write it yourself:

```yaml
name: Publish
on:
  push:
    tags: ['v*']
permissions:
  contents: read
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run verify
      - name: Package
        run: |
          if [[ "${GITHUB_REF_NAME}" == *-pre* ]]; then
            npm run package
            echo 'PRERELEASE=--pre-release' >> "$GITHUB_ENV"
          else
            npm run package:stable
          fi
      - run: npx @vscode/vsce publish --oidc $PRERELEASE --skip-duplicate --packagePath dist/*.vsix
```

### PAT fallback (until December 1, 2026)

Add `VSCE_PAT` as an encrypted repository secret and run the same publish step with:

```yaml
      - run: npx @vscode/vsce publish $PRERELEASE --skip-duplicate --packagePath dist/*.vsix
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
```

Do not put the PAT in the workflow file or in `package.json`. Plan the move to OIDC before the retirement
date; global PATs stop working for publishing.

---

## 10. Updating, rolling back and removing

| Action | How | Consequences |
| --- | --- | --- |
| Publish an update | Bump the version, run the gates, publish again | Users update automatically |
| Fix a bad release | Publish a higher patch version as soon as possible | Preferred over deleting |
| **Unpublish** | Publisher page → extension → **More Actions → Unpublish** | Availability becomes “Unpublished”; statistics are kept; still reachable through the API |
| **Remove** | Publisher page → **More Actions → Remove**, or `npx @vscode/vsce unpublish folium.folium-notes` | **Irreversible**; statistics are deleted and the extension name is permanently reserved |
| Delete one version | Publisher page → Reports → **Manage** → **Delete this version** | Irreversible; the version number can never be reused; the latest version cannot be deleted |
| Deprecate | Publisher page → extension → deprecate (optionally pointing at a replacement) | Dimmed listing with a warning and a link to the alternative |

Use **Unpublish** for a broken release and publish a fix; reserve **Remove** for abandoning an extension name.

---

## 11. Troubleshooting

| Error / symptom | Cause and fix |
| --- | --- |
| `401 Unauthorized` or `403 Forbidden` | PAT created for a single organization or without `Marketplace (Manage)`. Recreate it with **All accessible organizations** and that scope. With OIDC, check the policy’s repository owner/name/workflow/environment exactly match the workflow; a token can be exchanged only once. |
| `The extension 'folium-notes' already exists` | The `name` or `displayName` is taken. Choose another and update `package.json` (the id changes, so do this before the first publish). |
| `SVGs are restricted in README.md` / `SVG tags are not allowed` | Marketplace readme/changelog and the icon may not use SVG. Use PNG/JPG/GIF over https; badges must be from approved hosts. |
| Images do not render on the listing | Relative images and non-https URLs are not fetched. Host the images and use absolute https URLs, or pass `--baseImagesUrl`. |
| `You exceeded the number of allowed tags of 30` | Reduce `keywords` to 30 or fewer. |
| Publishing a version fails because it exists | Versions are immutable. Bump the version; in CI use `--skip-duplicate` for idempotent reruns. |
| Pre-release does not appear | Users must opt in with **Switch to Pre-Release Version** (or `--pre-release` on install). Pre-release and stable must use different version numbers. |
| `private` field / missing repository warnings | Remove `private` from `package.json`; set a real `repository` URL or pass `--allow-missing-repository` for private builds. |
| VSIX installs but the extension does not activate | Check `engines.vscode`, the `main` bundle path (`dist/extension.js`), and the Developer Tools console. `code --status` shows the running version. |
| Large extension warning (about 600 KB) | Expected with the bundled MCP server; it is under the Marketplace size limits. Bundle splitting is only worth it if it grows much larger. |
| File permissions lost when publishing from Windows | vsce does not preserve POSIX modes; publish from Linux/macOS (the workflow uses Ubuntu). |
| Marketplace search does not show a new listing yet | Indexing can take a few minutes; check Availability on the publisher page. |

---

## 12. Release checklist (short)

- [ ] `publisher`/`name`/`displayName` final and unique; `repository` URL real.
- [ ] Version follows the pre-release/stable rule (odd minor pre-release, even minor stable).
- [ ] `CHANGELOG.md` updated; `MARKETPLACE.md` images are https PNGs and return 200.
- [ ] `npm ci && npm run verify && npm run test:perf` green.
- [ ] Integration tests green on a machine with a display (or `xvfb-run`).
- [ ] Windows and macOS test plans executed.
- [ ] `npm run package` / `npm run package:stable` produced the VSIX; manifest publisher/version/pre-release verified.
- [ ] Clean-profile install smoke test passed.
- [ ] Trusted publishing policy exists (or Entra ID/PAT credentials are ready).
- [ ] Tag pushed, marketplace listing verified, GitHub release with VSIX + companion zip published.
- [ ] Release notes mention the pre-release channel and how to switch.

See also [publishing-checklist.md](publishing-checklist.md) for the same list in checklist form.
