# Publishing Checklist

Repeatable release checklist for **Markdown Studio** (`phfsantos.markdown-editor`).
Start every release from a fresh copy of the unchecked list below; do not reuse
results from a previous release.

Releases are published by `.github/workflows/main.yml` when a `v*` tag is pushed.
The workflow refuses to publish unless the tag equals `v` + the `version` in
`package.json`, then lints, tests, and publishes the **same VSIX** to Open VSX and
the Visual Studio Marketplace.

## 1. Prepare

- [ ] Read the release version: `node -p "require('./package.json').version"`
- [ ] Bump `version` in `package.json` manually if needed (there is no auto-bump script).
- [ ] Move the `CHANGELOG.md` "Unreleased" entries under that version with today's date.
- [ ] README describes current behavior, command names, and settings.
- [ ] If the icon changed, regenerate it: `yarn icon:render` (writes `media/logo.png` from `media/marketplace-icon.svg`).
- [ ] If the UI changed, recapture `media/screenshot-main.png` (see "Screenshot recipe" below).

## 2. Verify locally (fresh runs)

- [ ] `yarn --frozen-lockfile`
- [ ] `yarn lint`
- [ ] `yarn test`
- [ ] `yarn test:browser`
- [ ] `GITHUB_REF_NAME=v$(node -p "require('./package.json').version") node scripts/verify-release.cjs`

## 3. Inspect the VSIX

- [ ] Use VSCE 4.1.1 for reproducible local packaging (`vsce --version`); if unavailable, use `npx --package=@vscode/vsce@4.1.1 vsce` for the commands below.
- [ ] `yarn package` builds the runtime bundles before packaging.
- [ ] Choose a new output filename if `markdown-studio.vsix` already exists; do not overwrite earlier evidence.
- [ ] `vsce package --no-dependencies --out markdown-studio.vsix` (runtime dependencies are bundled by esbuild).
- [ ] `vsce ls --no-dependencies` contains no `src/`, `scripts/`, sourcemaps, test files, or local verification reports.
- [ ] `unzip -p markdown-studio.vsix extension/package.json` shows the expected `displayName`, `version`, and `icon`.
- [ ] `node scripts/inspect-vsix.cjs markdown-studio.vsix artifact-report.json` verifies identity, exact source manifest/icon/runtime bundles, required assets, and excluded development files.
- [ ] Run `MARKDOWN_UI_VSIX=/absolute/path/markdown-studio.vsix yarn test:ui:release` with the native prerequisites below. Keep its result, install log and screenshots as pre-release evidence.
- [ ] Install it in a clean profile: `code --profile release-check --install-extension markdown-studio.vsix`
  - [ ] The Extensions view shows "Markdown Studio" with the colored icon.
  - [ ] Opening a `.md` file with "Open in Markdown Studio" works.
  - [ ] "Set Markdown Studio as Default" adds only `*.md` / `*.markdown` and keeps other `workbench.editorAssociations` entries.
- [ ] Retain the inspected VSIX and its SHA-256 with the verification evidence; publishing is a separate action.

## 4. Publish

- [ ] Commit the release changes.
- [ ] Synchronize the new logo and screenshot to the public repository ref used by VSCE. Inspect the packaged README image URLs and confirm their bytes match the intended release assets; reachable old artwork is not sufficient. Prefer an immutable release ref when packaging for publication.
- [ ] `git tag -a v<version> -m "Release v<version>"`
- [ ] `git push origin v<version>`
- [ ] Watch the "Deploy Extension" workflow until it succeeds.

## 5. After publishing

- [ ] Marketplace listing (https://marketplace.visualstudio.com/items?itemName=phfsantos.markdown-editor) shows the new version, name, and icon.
- [ ] Open VSX listing (https://open-vsx.org/extension/phfsantos/markdown-editor) shows the same version.
- [ ] Install from the Marketplace in a clean profile and open a Markdown file.
- [ ] Create a GitHub release for the tag with the changelog section.

## Screenshot recipe

`media/screenshot-main.png` is the first image on the Marketplace page, so it should show the editor and the sidebar together.

The assertion-based native suite creates an isolated workspace containing only
sample notes, installs the supplied VSIX through VS Code's CLI, and captures
`connected-notes-graph.png`, `installed-details.png`, three theme screenshots,
and `editor-type-picker.png`. Review the graph screenshot and copy it to
`media/screenshot-main.png`; no private workspace content is used.

Install the optional test tools with `npm --prefix test/ui install`, then supply
`MARKDOWN_UI_CODE` and `MARKDOWN_UI_DRIVER` pointing at matching, ExTester-supported
VS Code and ChromeDriver binaries. `MARKDOWN_UI_TOOLS` can point at another local
directory with `vscode-extension-tester`, Mocha and VSCE already installed.
`yarn test:ui:release` prints its temporary evidence directory and refuses a
zero-test run. It does not build or publish the supplied artifact.

For upgrade continuity, also set `MARKDOWN_RELEASE_PREVIOUS_VSIX` to the preceding
artifact and `MARKDOWN_RELEASE_PREVIOUS_VERSION` to its verified version. A local
artifact establishes local continuity only; record registry evidence before
calling it a published-version upgrade. Public registries returned no matching
published baseline during the 2026-11-14 readiness run.

Pre-release readiness ends at artifact inspection and local verification.
Sections 4–5 require separate release authorization and are not prerequisites
for completing the pre-release work.
