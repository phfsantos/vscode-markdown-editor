# Markdown Studio pre-release readiness — 2026-11-14

**Pre-release automated checks pass. No publication was performed.** This report
supersedes the partial host verification in `release-readiness-2026-11-14.md`.
The user explicitly scoped this work to preparation, native UI screenshots and
inspection of one built VSIX, without requiring a release.

## Exact artifact and environment

- macOS 15.8.1 (24H32), Node 22.22.3, Yarn 1.22.22, VSCE 4.1.1.
- Native UI: ExTester 8.28.1, VS Code 1.140.0 and matching ChromeDriver.
- Extension: `phfsantos.markdown-editor`, version **0.5.14**, display name **Markdown Studio**.
- Direct repository command: `vsce package --no-dependencies --out /private/tmp/markdown-studio-prerelease/markdown-studio-0.5.14-ready.vsix`.
- Artifact: `/private/tmp/markdown-studio-prerelease/markdown-studio-0.5.14-ready.vsix`;
  **416 archive entries, 7,455,999 bytes**.
- SHA-256: `b76ae141627e60d25d60cfcdd123981fcee332ed9ea2b40a162cc3e712788801`.

Unlike the earlier staging experiment, this final artifact was packaged directly
from the repository by the documented VSCE CLI, including its successful fresh
`vscode:prepublish` build. It contains the current manifest, icon, captured public
screenshot and runtime bundles, verified byte-for-byte by
`node scripts/inspect-vsix.cjs <artifact.vsix> <report.json>`.
No source/test directories, maps, environment files or local usage report leaked
into the archive. See the [archive report](artifacts/pre-release-readiness-2026-11-14/archive-report.json).
Concurrent pending-edit changes already in the workspace are included in this
working-tree artifact; this is not a claim that the tree is a clean release commit.

## Fresh automated evidence

| Gate | Result |
| --- | --- |
| Lint | Passed |
| Type checks, core, unit, widgets | Passed: 106 core + 680 unit + 35 widget = 821 tests |
| Browser | Passed: 14 files / 155 tests |
| Production build | Passed in the final VSCE prepublish hook |
| Tag/version validator | Matching `v0.5.14` passed; a missing tag was rejected |
| Native packaged-VSIX suite | **9 passed / 0 failed** |
| Native negative control | Deliberately wrong name failed with `Markdown Studio` versus `Wrong`, not a locator or setup error |

[Gate summary](artifacts/pre-release-readiness-2026-11-14/gate-summary.md),
[native results](artifacts/pre-release-readiness-2026-11-14/ui-result.json),
[negative control](artifacts/pre-release-readiness-2026-11-14/negative-control.json).
Full command/host logs remain in `/private/tmp/markdown-studio-prerelease/` and
`/private/tmp/md-release-final/`.

The native suite **installs the supplied artifact with VS Code's CLI** into an
isolated extension directory, rather than extracting it or opening source in a
development host. The test-only driver is independently packaged and installed;
no fixture code is included in the product VSIX. The suite asserts:

1. Local 0.5.11 → 0.5.14 upgrade, retaining custom CSS, editor associations and workspace note bytes.
2. Stable extension identity, a single original view type and real Vditor rendering; inline AI remains off.
3. Installed-details name/version and icon resource, supported by the inspected colored-icon screenshot.
4. Real native Settings rows retain the `markdown-editor.*` namespace; contribution title and Output channel are Markdown Studio.
5. Native sidebar/Activity Bar and editor rendering in dark, light and high-contrast themes.
6. Checkbox edit → host document dirty → Save → Undo → Save → Redo → Save → close/reopen, with disk assertions.
7. Unrelated global JSON association and a conflicting workspace override survive the real contributed default command.
8. Real graph nodes for both sample notes and rendered links, alongside the rich editor.
9. Actual native breadcrumb picker contents, including the accepted provider suffix.

Save comparisons allow Vditor's task-marker case, table-padding and blank-line
normalization outside fenced code. All nonblank document content is compared,
and both complete fenced blocks are separately compared exactly. This is not a
claim that WYSIWYG serialization preserves all formatting byte-for-byte.

## Screenshots and fix found by the tests

- [Installed details](artifacts/pre-release-readiness-2026-11-14/installed-details.png)
- [Dark](artifacts/pre-release-readiness-2026-11-14/theme-dark.png),
  [light](artifacts/pre-release-readiness-2026-11-14/theme-light.png),
  [high contrast](artifacts/pre-release-readiness-2026-11-14/theme-contrast.png)
- [Editor and rendered graph](artifacts/pre-release-readiness-2026-11-14/connected-notes-graph.png)
- [Native Settings](artifacts/pre-release-readiness-2026-11-14/native-settings.png),
  [Output channel](artifacts/pre-release-readiness-2026-11-14/native-output.png)
- [Actual picker](artifacts/pre-release-readiness-2026-11-14/editor-type-picker.png)

The public `media/screenshot-main.png` was recaptured with the same suite and
production rendering from the candidate preceding the final artifact. It is now
included in the VSIX. The obsolete pre-branding GIF promotion was removed from
the README; the GIF source file was retained.

The smoke test found that opening/focusing the graph cleared its source note.
`GraphViewPanel` now retains the source while its own panel is active, then
reconciles on deactivation so an unrelated editor still clears it even when the
active-document service deduplicates `undefined` events. Three regression cases
cover source retention, unrelated-editor clearing, and that deduplicated sequence;
red/green evidence is retained in the temporary logs. Independent review approved
this fix and the regression coverage.

## Accepted limitations and release handoff

- The real picker still reads **Markdown Studio - Markdown Studio** on this host.
  [Recorded picker text](artifacts/pre-release-readiness-2026-11-14/editor-type-picker.txt)
  and screenshot establish the exact behavior. The prior work record
  `wr-2026-10-26-implement-plan-markdown-studio-release-r` records the user's
  acceptance of this host limitation until upstream changes it. No unsupported
  workaround, invisible name or second registration was introduced.
- Public Marketplace/Open VSX exact-ID queries returned no published predecessor;
  GitHub tags/releases were empty. The tested 0.5.11 baseline is a **local VSIX**,
  not a verified published release. See [registry/media evidence](artifacts/pre-release-readiness-2026-11-14/release-history.md)
  and [local upgrade state](artifacts/pre-release-readiness-2026-11-14/upgrade-state.json).
  A published-predecessor test is unavailable with the observed public baseline.
- README image URLs are reachable but public HEAD still has older artwork.
  The intended icon and screenshot are correct in the inspected artifact.
  Synchronizing them to the public release ref and verifying the rewritten URLs
  belongs to the authorized publication procedure in `PUBLISHING_CHECKLIST.md`.
  This report does not claim the unmodified public page already shows new assets.
- No version bump, tag, push, registry authentication or publication occurred.
  Version/date selection, changelog promotion, public media synchronization,
  registry publication and subsequent listing inspection remain release actions.

## Reproduce

Install optional tools with `npm --prefix test/ui install`, or point
`MARKDOWN_UI_TOOLS` at an existing tools directory. Supply matching supported
native binaries and the exact artifact:

```sh
MARKDOWN_UI_TOOLS=/path/to/ui-tools \
MARKDOWN_UI_CODE='/path/to/Visual Studio Code.app/Contents/MacOS/Code' \
MARKDOWN_UI_DRIVER=/path/to/chromedriver \
MARKDOWN_UI_VSIX=/path/to/markdown-studio-0.5.14-ready.vsix \
MARKDOWN_RELEASE_PREVIOUS_VSIX=/path/to/verified-local-0.5.11.vsix \
MARKDOWN_RELEASE_PREVIOUS_VERSION=0.5.11 \
yarn test:ui:release
node scripts/inspect-vsix.cjs /path/to/markdown-studio-0.5.14-ready.vsix report.json
```

The runner prints a fresh temporary evidence directory, rejects zero-test runs,
and preserves failure screenshots. To reproduce the negative control, set
`MARKDOWN_RELEASE_EXPECT_NAME=Wrong` and filter with `--grep 'stable identity'`;
omit the predecessor variables for that focused run.

## Changed files and plan bookkeeping

Review these changes in Source Control (`Ctrl/Cmd+Shift+G`):

- [Native release runner](../../scripts/uiReleaseTest.mjs), [VSIX inspector](../../scripts/inspect-vsix.cjs), [package script](../../package.json).
- [UI assertions](../../test/ui/releaseReadiness.test.cjs), [test-driver manifest](../../test/ui/release-driver/package.json), [test-driver implementation](../../test/ui/release-driver/extension.cjs).
- [Graph fix](../../src/app/GraphViewPanel.ts), [regressions](../../test/graphview-panel.test.ts).
- [README](../../README.md), [public screenshot](../../media/screenshot-main.png), [changelog](../../CHANGELOG.md), [release checklist](../../PUBLISHING_CHECKLIST.md), [packaging exclusions](../../.vscodeignore).
- [This evidence report](pre-release-readiness-2026-11-14.md) and [retained evidence files](artifacts/pre-release-readiness-2026-11-14/).

Independent final review approved the artifact, tests and screenshots. Engineering
readiness is complete within the scope above. ProjectMind change request
`chg-d0e5606f` was approved by the user, aligning the stored plan with the explicit
pre-release-only scope and prior acceptance of the host suffix. The plan is now
completed: all nine steps and six acceptance criteria are checked against the
retained evidence. Publication remains a separately authorized release action.
