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

- [ ] `npx @vscode/vsce package --out markdown-studio.vsix`
- [ ] `npx @vscode/vsce ls` contains no `src/`, `scripts/`, sourcemaps, or test files.
- [ ] `unzip -p markdown-studio.vsix extension/package.json` shows the expected `displayName`, `version`, and `icon`.
- [ ] Install it in a clean profile: `code --profile release-check --install-extension markdown-studio.vsix`
  - [ ] The Extensions view shows "Markdown Studio" with the colored icon.
  - [ ] Opening a `.md` file with "Open in Markdown Studio" works.
  - [ ] "Set Markdown Studio as Default" adds only `*.md` / `*.markdown` and keeps other `workbench.editorAssociations` entries.
- [ ] Delete the local VSIX afterwards.

## 4. Publish

- [ ] Commit the release changes.
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

1. Open `demo-workspace/` as the workspace folder, using a dark theme and a window about 1600×1000.
2. Open `Markdown Studio Showcase.md` in Markdown Studio (Instant Rendering mode).
3. Open the Markdown Studio sidebar, with Backlinks, Outgoing Links and Tags expanded.
4. Run `Markdown Studio: Open Link Graph View` and place it to the side, or capture it as a second image.
5. Hide the minimap, close the panel and other tabs, then capture the whole window. Before publishing, make sure the dated widgets still show data for the current month.
