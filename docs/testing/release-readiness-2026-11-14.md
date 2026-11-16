# Markdown Studio release verification — 2026-11-14

Status: **partial; release readiness is not established**.

This resumes `plan-markdown-studio-release-readiness-and-consistenc` without
publishing, changing the version, or modifying the persisted extension identity.
The workspace contains concurrent pending-edit work; these results describe that
working tree, not a clean release commit.

## Environment and fresh gates

macOS 15.8.1 (24H32); Node 22.22.3; Yarn 1.22.22; VSCE 4.1.1; installed VS Code 1.115.0;
extension 0.5.14 (`phfsantos.markdown-editor`).

| Command | Result |
| --- | --- |
| `yarn lint` | Passed |
| `yarn test` | Passed: all type checks, 106 core tests, 677 unit tests, 35 widget tests |
| `yarn test:browser` | Passed: 14 files / 155 tests on approved unsandboxed retry; initial sandbox attempt failed to bind the local test server (`EPERM`) before tests ran |
| `yarn package` | Passed: production extension, media, and widget bundles |
| `GITHUB_REF_NAME=v0.5.14 node scripts/verify-release.cjs` | Passed |
| `yarn vitest run test/branding-assets.test.ts test/package-layout.test.js test/release-metadata.test.ts test/default-editor-checker.test.ts test/default-editor-command.test.ts` | Passed: 5 files / 35 tests |

See [gate summary](artifacts/release-readiness-2026-11-14/gate-summary.md).
Full command logs remain in `/private/tmp/markdown-studio-release-2026-11-14/`.

## Archive inspection

Artifact: `/private/tmp/markdown-studio-release-2026-11-14/markdown-studio-0.5.14.vsix`.
415 archive entries, 7,126,700 bytes. SHA-256:
`095cec79acf57a304c1dc5908eaf425323b08012f27bc08fa68f49748b621ea4`.

[Machine-readable inspection](artifacts/release-readiness-2026-11-14/archive-report.json)
confirms the packaged manifest and icon match source byte-for-byte, the extension,
media and widget entry points exist, and source/test directories, maps, environment
files and the local `test-usage.json` report are absent. File enumeration exposed
that report before it was excluded in `.vscodeignore`.

Root `vsce ls` and `vsce ls --no-dependencies` eventually completed, but enumerating
ignored worktrees was slow. Root `vsce package --no-dependencies` completed its
prepublish build and then stalled during enumeration; that process was terminated.
The inspected artifact was built with VSCE 4.1.1's `listFiles` and `pack` functions
from a temporary staging copy after the successful production build. Staging
omitted only already-ignored repository/development directories (including Git
metadata, worktrees, node_modules, test, source, docs and plans); it retained the
original manifest and `.vscodeignore`. This does not prove the tag-triggered remote
workflow or substitute for a final package from the release commit.

VSCE rewrites the README logo, screenshot, and GIF to GitHub `raw/HEAD` URLs.
Attempts to retrieve those URLs through the web tool returned cache misses;
public accessibility and release-branch media contents remain unverified.

## Partial installed-host evidence

The exact VSIX above was extracted into a new isolated extensions directory and
launched with a separate user-data directory and temporary fixture workspace.
This exercises packaged files, not an extension-development checkout; it does
not prove the VS Code CLI/GUI VSIX installer flow.

One run visibly rendered real Vditor content:
[host screenshot](artifacts/release-readiness-2026-11-14/host-editor.png).
The screenshot shows the native monochrome Activity Bar glyph in the dark theme;
light/high-contrast legibility and installed-details artwork remain unverified.

Invoking **Set Markdown Studio as Default** through the real command palette
produced these user-scope associations:

```json
{
  "*.json": "global.jsonEditor",
  "*.md": "markdown-editor",
  "*.markdown": "markdown-editor"
}
```

The workspace-scope `{"*.json":"workspace.jsonEditor"}` remained unchanged.
No workspace override was copied into the user settings.
Retained fixture snapshots: [user settings](artifacts/release-readiness-2026-11-14/global-settings.json)
and [workspace settings](artifacts/release-readiness-2026-11-14/workspace-settings.json).
That run subsequently timed out finding **Reopen Editor With** in the command
palette. Further harness attempts encountered command-registration/menu readiness
timeouts. They are failed/incomplete verification, not evidence of an extension
regression or a passed picker/details check. The latest harness report is in the
temporary evidence directory; its failure does not erase the earlier two observed
checks. No edit/save/undo, upgrade or full feature smoke matrix was completed.

## Outstanding requirements

- Exact reported dropdown: current upstream
  [editorTypePicker.ts](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/parts/editor/editorTypePicker.ts)
  still composes the editor label and extension detail. The earlier work record
  `wr-2026-10-26-implement-plan-markdown-studio-release-r` records the user's
  decision to accept the duplicate temporarily; this run preserves that choice.
  The exact single-label authored requirement remains unfulfilled. This is source
  evidence, not reproduction of that dropdown on the installed build.
- Recapture the public screenshot from the branded build, complete installed
  details and theme checks, and verify README media publicly.
- Reconcile release history with registry evidence before choosing a release
  version. `[Unreleased]` now avoids implying the current manifest is 0.5.0;
  no version or date has been invented for these changes.
- Run the preceding-published-version upgrade check and the complete installed
  feature smoke matrix in the detailed handoff plan.
- Inspect Marketplace and Open VSX artwork/media after a separately authorized
  publication. No publication or tag push was performed here.

The stored plan remains active. Documentation/packaging changes received an
independent review; that approval does not certify the outstanding release gates.
