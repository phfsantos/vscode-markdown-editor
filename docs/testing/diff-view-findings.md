# Diff view findings

Reproduction of the reported diff-view issues (1–5) and the suspected issues
(S1–S8) from plan `plan-diff-view-overhaul-inline-previous-version-full`.
Measured 2026-11-16 on VS Code **1.140.0** (the version the UI harness pins),
Markdown Studio 0.5.14 at commit `984bb15`.

**How to reproduce:** `yarn test:ui --grep "Diff view"` (real VS Code, see
[test/ui/diffView.test.cjs](../../test/ui/diffView.test.cjs)),
`yarn vitest run --config vitest.browser.config.ts test/diff-view-repros.browser.test.ts`
(real Vditor) and `yarn vitest run test/diff-view-repros.test.ts` (host logic).
Side-by-side cases needed the staged VSIX built with
`MARKDOWN_UI_EDITOR_PRIORITY='{"textEditor":"default","diffEditor":"default"}'`,
because of S1. Raw measurements are in
[artifacts/diff-view/before/ui-evidence.json](artifacts/diff-view/before/ui-evidence.json).

| # | Verdict | Evidence | Repro test (red before the fix) |
| --- | --- | --- | --- |
| 1 | **Confirmed** | Single view shows only the new text. The old text exists only as a raw-HTML tooltip (`Modified from: <p>Old wording here.</p>`). The deleted line is a 0.4-opacity striped spacer. `pending.rows`: 0 previous rows, 1 legacy spacer. Screenshot: [pending-single-view.png](artifacts/diff-view/before/pending-single-view.png) | UI: *Single-view pending edit › renders the previous text…* |
| 2 | **Confirmed** | Real Vditor: the painted box for a changed heading starts 10 px inside the content column, because the inline background sits on the element box. Task-list `li` boxes exclude the checkbox. Screenshot: [highlight-geometry-browser.png](artifacts/diff-view/before/highlight-geometry-browser.png) | Browser: *full-row highlight spans the content column…* |
| 3 | **Confirmed** | The header is 37 px tall at `top:0` over the 36 px toolbar (`gitDiff.layout.*`), at both 1280 and 600 px. The toolbar Save button cannot be clicked: *"Other element would receive the click: `<span style="font-weight: 600…">`"* (the header's role label). The toolbar is invisible in both panes. Screenshot: [header-over-toolbar.png](artifacts/diff-view/before/header-over-toolbar.png) | UI: *keeps the status bar clear of the toolbar at 1280px / 600px*, *toolbar save in one pane writes only that pane's file*, *saves exactly the editor markdown…* |
| 4 | **Confirmed: sync is dead** | A wheel scroll of 2400 px in the original pane produced 0 scroll events in the modified pane (`gitDiff.scroll.rightEvents: 0`). ROW-124 is at −32 px on the left and −1573 px on the right. Root cause: `DiffVisualizer.setupScrollSyncListeners` posts `diff-scroll-sync-local` to its own window, nothing forwards it to the host, and `setupScrollSync` is an empty placeholder. Screenshot: [git-diff-scroll-desync.png](artifacts/diff-view/before/git-diff-scroll-desync.png) | UI: *scrolls the other pane to the aligned row within 100 ms without echo* |
| 5 | **Confirmed** | `test/ui` had only the editorContext, agentActivity, activity-baseline and releaseReadiness suites. No diff case existed. | The new suite `test/ui/diffView.test.cjs` |
| S1 | **Confirmed** | With the shipped scalar `"priority": "default"`, both the Git working-tree diff and the file↔file compare open VS Code's **Text Diff Editor**. No Markdown Studio webview exists. With the per-mode object, both open in Markdown Studio. Screenshots: [s1-git-diff-text-editor-scalar-priority.png](artifacts/diff-view/before/s1-git-diff-text-editor-scalar-priority.png), [git-diff-opened.png](artifacts/diff-view/before/git-diff-opened.png) | UI: *Git working-tree diff › opens Markdown Studio on both sides* (fails on the scalar build) |
| S2 | **Confirmed** | Label parsing with `isRight = … \|\| true` assigns sides by resolve order. When the original side resolves first, it is assigned `right`. Both live runs passed only because VS Code 1.140 happened to resolve the modified side first (3 of 3 opens). | Unit: *S2: file compare of same-named files assigns original=left when original-first* |
| S3 | **Confirmed** | `dispose()` deletes the whole `panelTracking` entry. When one side is re-resolved, the surviving side never pairs again and no diff is sent. | Unit: *S3: disposing one side keeps the other side registered…* |
| S4 | **Confirmed** | There are two fixed 1000 ms sleeps (host `calculateAndApplyDiff`, webview `DELAY_VDITOR_RENDER_MS`) plus a 3 s ready poll. A failed render returns silently (`return` after `logger.error`). Opening the diff until both panes showed content took 3.8–4.2 s (`gitDiff.tabs.openedMs`). No ready signal or timing mark exists (`gitDiff.timing`: no marks). | UI: *decorates both panes within 500 ms of both rendering*. A fake-timer unit test is added red-first in step 7. |
| S5 | **Confirmed: data loss** | With real Vditor and deletions in a nested list, a table and a code block, `getValue()` (the save path) emitted `- LEAK-nested-child`, `LEAK-table-cell` and the deleted code fence. This happened as soon as the diff painted, before any edit. The non-greedy regex stops at the first closing tag. Screenshot: [save-integrity-browser.png](artifacts/diff-view/before/save-integrity-browser.png) | Browser: *save integrity: nested spacer and previous-version content never reaches getValue* |
| S6 | **Confirmed (code)** | `PreviewCustomEditorProvider` sets `readOnly = scheme === "git" \|\| scheme === "showModifications"`. Any other non-writable original (chat-editing snapshots, PR/review schemes, read-only file systems) opens editable with an active toolbar. | Unit test added red-first in step 13 |
| S7 | **Confirmed** | `calculateDiffFromHTML` on 6000 vs 6000 lines took **1185 ms** (an (m+1)×(n+1) table of about 36 M cells). Every recalculation `JSON.stringify`s all changes into debug logs. The webview hashes the full `diffInfo` with `JSON.stringify`. | Unit: *S7: a 6000-line diff stays bounded in time* |
| S8 | **Confirmed** | `diff-view-detected` and `diff-view-cleared` use `type`, not `command`, and parse as `unknown` in `editorProtocol.ts`. The host sends `stats.spacer` while the webview reads `stats.spacers`. The indicator strip is `position:fixed; height:100vh` and is never recomputed on resize. | Unit: *S8: diff-view-detected and diff-view-cleared are typed host protocol messages* |

## New findings

- **N1: no tab input for custom-editor diffs.** On 1.140, `tab.input` is
  `undefined` for both a Git working-tree diff and a file↔file compare that open
  in Markdown Studio (`gitDiff.tabs`, `fileCompare.roles`). `TabInputTextDiff` is
  reported only when the text diff editor wins. Side detection therefore
  **cannot** be derived from tab input URIs, as step 6 assumed. See the ADR.
- **N2: the save-cleaning unit test tested a copy.** `test/clean-content-for-save.test.js`
  re-declares `cleanContentForSave` instead of importing it, so it could never
  catch S5. The shipped function now lives in `packages/media/src/save-cleaning.ts`.
- **N3: a vacuous read-only check.** The toolbar on the read-only side looks
  inoperable only because the header covers it (`gitDiff.readOnlyToolbar.hitIsButton: false`).
  The UI case for the read-only side must also prove the editable side's button
  is reachable.
- **N4: Selenium cannot resize the Electron window** (`Browser.getWindowForTarget`
  is unsupported). Width cases size the pane's webview iframe instead.

## Regression results (after the overhaul)

Fresh runs on 2026-11-16 with the shipped manifest:

- `yarn test:ui`: **20/20** on VS Code 1.140.0 (6 editor-context and 14 diff
  cases). See [artifacts/diff-view/after/result.json](artifacts/diff-view/after/result.json)
  and the screenshots in [artifacts/diff-view/after/](artifacts/diff-view/after/).
- The 1.95.3 compatibility cases pass: default editor, Git diff opens, sides.

| # | Regression test, now green | Measured |
| --- | --- | --- |
| 1 | UI *Single-view pending edit* (2 cases), browser *inline mode renders each previous version…* | Previous text sits directly above its line as a `role="note"` row with an `aria-label`; typing into it changes nothing; the saved file equals the editor markdown. |
| 2 | Browser *full-row highlight spans the content column…*, UI *decorates both panes…* (`paintOnTop`) | Left edge at the column edge, width equals the column (±1 px), text x unchanged. The tint is topmost at a changed row in real VS Code. |
| 3 | UI *status bar clear of the toolbar at 1280/600px*, *toolbar inoperable on the read-only side…*, *toolbar save in one pane…*; browser *diff-status-bar* (6 cases) | 24 px bar in flow under the toolbar. The read-only toolbar is inert and dimmed; the editable one is reachable; the panes are level. |
| 4 | UI *scrolls the other pane to the aligned row within 100 ms without echo*; browser follower/echo/ownership cases | Follower lag 24–29 ms over 4 runs. Same aligned row (≤ 8 px apart; one row is 48 px). 0 echo events. |
| 5 | The new suite itself | 14 diff cases in `test/ui/diffView.test.cjs`. |
| S1 | `test/manifest-custom-editor-priority.test.ts`, UI *opens a .md file…by default*, *opens Markdown Studio on both sides* | Per-mode priority object; Markdown Studio opens in diffs on 1.140 and 1.95.3. |
| S2 | `test/diff-session-registry.test.ts` (both resolve orders), unit *S2: a Git diff assigns original=left…*, UI *File compare…assigns original left…* | Writability decides Git/read-only diffs; the first activated side decides two writable files. |
| S3 | Unit *S3: disposing one side keeps the other side registered…*, registry *leaving removes only that side* | — |
| S4 | Unit *the diff waits for both sides to render…*, *a side that never renders produces an error state…*, *…cannot return its HTML yields an error state*; UI *decorates both panes within 500 ms* | 185–297 ms from both rendered to decorations applied (idle handshake); 5 s timeout shows an error state for paired sides. |
| S5 | Browser *save integrity: nested spacer and previous-version content never reaches getValue*; UI *saves exactly the editor markdown with the diff active* | `getValue()` is unchanged by the diff and after an edit next to a deleted nested block. The on-disk file equals the editor markdown. |
| S6 | `test/diff-context.test.ts` (red on the old provider for the chat-editing snapshot, `pr:` and read-only-fs schemes) | — |
| S7 | Unit *S7: a 6000-line diff costs little more than parsing it*, `test/diff-cost.test.ts` (Myers property test) | 6000×6000 lines: 110 ms total, of which Myers takes 0.8 ms (was 1185 ms). |
| S8 | Unit *S8: … typed host protocol messages*, `packages/core/test/editorProtocol.test.ts` *diff view messages* | — |
| N2 | `test/clean-content-for-save.test.js` now imports the shipped function | 47/47 |
| N3 | UI read-only case asserts the editable toolbar is reachable *and* the read-only one is inert | — |
| A1–A4 (red-team) | Unit *A1: a side that never finds a partner…*; browser *A2: row HTML…cannot run script* (red: `onerror` executed), *A3: a burst of editor mutations repaints once…*, *A4: ghost rows are not tab stops* | — |

The release gate (`yarn test:ui:release`) also runs the diff suite against the
built VSIX: 14/14 on the candidate, and 13/14 **failing** on a VSIX built from
the pre-overhaul HEAD. Its one unrelated failure, *shows connected notes and
opens the real graph*, fails identically on that baseline VSIX, so it predates
this work (follow-up plan).

