---
name: test-guide
description: Pick the right test layer under test/ in vscode-markdown-editor (vscode-mock unit, real-Vditor browser, native ExTester) and write tests there that cannot pass vacuously.
tags: ["testing", "vitest", "vditor", "extester", "vscode-mock", "regression"]
generated: 2026-11-16T17:38:35.437Z
source: agent-promoted
sourceSignal: "cand-fe1e149b7b area-guide: Working in test"
---

# test-guide

Pick the right test layer under test/ in vscode-markdown-editor (vscode-mock unit, real-Vditor browser, native ExTester) and write tests there that cannot pass vacuously.

## Prerequisites

- Node 22 from ~/.nvm/versions/node/v22.22.3/bin on PATH, Yarn, repository dependencies installed
- Playwright Chromium and packages/media's pinned Vditor 3.11.2 for *.browser.test.ts
- For test/ui: vscode-extension-tester 8.28.1 + mocha via `npm --prefix test/ui install` or MARKDOWN_UI_TOOLS, plus matching MARKDOWN_UI_CODE / MARKDOWN_UI_DRIVER binaries

## When to Use

Adding or changing a test under test/ or packages/core/test in vscode-markdown-editor, or reproducing a reported bug as a failing test, especially for the editor webview (Vditor), host↔webview messages, document sync or anything VS Code renders (custom editors, diffs, tabs). For which gate commands to run afterwards, use vscode-markdown-editor-verification; for driving a real VS Code window in detail, use vscode-ui-testing.

## Workflow

## 1. Choose the layer by what must be true

| Layer | Files | Runs in | Use it for |
| --- | --- | --- | --- |
| Unit | `test/**/*.test.{ts,js}`, `packages/core/test/**` | Node; `vscode` is aliased to `test/mocks/vscode.ts` (vitest.config.ts) | Host logic, protocol parsing, algorithms, controllers driven through fake hosts |
| Browser | `test/**/*.browser.test.ts` (vitest.browser.config.ts) | Headless Chromium with the real pinned Vditor | Rendered DOM, geometry, Vditor input/getValue round trips, webview modules |
| Native | `test/ui/*.test.cjs`, registered in `scripts/uiTest.mjs` | Real VS Code with the packaged VSIX (ExTester) | Anything VS Code itself decides: custom-editor priority, diff tabs, two webviews, the app stylesheet, on-disk saves |

- A unit mock cannot prove what VS Code does. Signal sig-1794850427403-ntb1w6: highlights passed in the browser layer but were invisible in VS Code. The browser layer does not load the app stylesheet (`main.css` paints opaque backgrounds), so visibility needs a native assertion.

## 2. Test the shipped code, never a copy

- Import the real module. `test/clean-content-for-save.test.js` used to re-declare the save cleaner, so it could never catch a leak. It now imports `packages/media/src/save-cleaning.ts`.
- If a webview module drags in globals (jQuery, `acquireVsCodeApi`), extract the pure part into its own module (as `save-cleaning.ts` was) instead of copying it into the test.
- Host↔webview messages are typed in `packages/core/src/editorProtocol.ts`. Two schema tables drive both the TypeScript unions and the parsers (evidence 3). A message test should run the payload through `parseHostToWebviewMessage` / `parseWebviewToHostMessage`, not just compare object shapes.

## 3. Keep the shared mock faithful

`test/mocks/vscode.ts` is shared by every unit test. Model what real VS Code has, or integration tests pass for the wrong reason or crash later:
- `workspace.fs.isWritableFileSystem`: `true` for `file`, `undefined` for content-provider schemes.
- `window.tabGroups.all` and `activeTabGroup.tabs`.
- `TabInputText`, `TabInputTextDiff` and `TabInputCustom` classes.

When a test overrides a mock member, save it and restore it in `afterEach`; never `delete` it.

## 4. Real Vditor in the browser layer

Boot it with `test/helpers/realVditor.ts` (`mountRealVditor`, `renderedLineOf`, `renderedLineElement`). It installs the `vditorLuteScript` / `vditorIconScript` sentinels so the pinned local assets are used, not a CDN.

Rendered line indices come from `buildRenderedLineMap` (`packages/media/src/diff-line-dom-mapper.ts`). Source lines and rendered lines are different coordinate systems:
- A leading blank line shifts rendered indices (evidence 11).
- Look up targets by text, not by a hard-coded index.

## 5. Native suites (test/ui)

The runner is `scripts/uiTest.mjs`:
- It strips `ELECTRON_RUN_AS_NODE` and `VSCODE_*`, and creates a temporary workspace (Git-initialised for diffs).
- It installs the driver extension from `test/ui/driver`; tests trigger driver commands from the command palette by title.
- Each run writes per-test results to `result.json`.

Useful variables:
- `MARKDOWN_UI_STORAGE`: a separate tester storage per VS Code version.
- `MARKDOWN_UI_TEST_VSIX`: test an already-built artifact instead of building one.
- `MARKDOWN_UI_EDITOR_PRIORITY`: stage a manifest experiment without touching `package.json`.

Rules:
- Enter webviews from `defaultContent` by content marker every time; VS Code replaces the inner frame. In this repo the editor root is `#app .vditor-ir pre.vditor-reset`, because the hidden diff renderer and Vditor's other modes have their own `pre.vditor-reset`.
- Identify tab inputs with `instanceof`. Shipped builds minify class names (`zd`).
- Selenium cannot resize the Electron window. Size the webview iframe instead.
- Keep storage paths short: the IPC socket is limited to 103 bytes.
- Save dirty documents before `workbench.action.closeAllEditors`, or a modal blocks every later click.
- The webview `vscode` API object is frozen. Expose test hooks as `data-*` attributes outside the saved content.
- Poll with `eventually`; never sample once. `editorContext`'s chat check flaked until it polled.

Evidence: `docs/testing/diff-view-findings.md`, signal sig-1794850427403-ntb1w6.

## 6. Prove the test can fail

- Write the repro first and watch it fail for the stated reason.
- Flip-probe the guard: break the production line, see the test go red with an assertion (not a locator error), then restore. With a dirty tree, use `cp` to a scratch backup, or `git stash push <one file>`.
- For a whole native suite, run it against a VSIX built from HEAD in a temporary `git worktree` with symlinked `node_modules`. The diff suite failed 13/14 there.
- Timing assertions: compare against a cost measured in the same test (for example `elapsed < 2.5 × parse time + 20 ms`), not a wall-clock constant. A parallel suite turns 110 ms into 650 ms.
- A failure in an unrelated case: run the same case on the baseline build before calling it a regression or pre-existing.

## Examples

Diff save-integrity leak (plan-diff-view-overhaul-inline-previous-version-full):
- **Unit/copy layer:** green, because it tested a copy of the cleaner.
- **Browser layer:** `test/diff-view-repros.browser.test.ts` mounted real Vditor, sent deleted nested list, table and code rows, and asserted `getValue()` contained no `LEAK` text. It went red with the deleted content in the output.
- **Native layer:** `test/ui/diffView.test.cjs` typed into the modified pane, saved with the real toolbar button, and compared the on-disk file with `window.vditor.getValue()`.

All three are green after the fix. Before the fix, the native case was blocked by a header covering the toolbar, which was a second confirmed bug.