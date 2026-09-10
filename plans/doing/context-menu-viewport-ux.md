# Context Menu Viewport UX Implementation Plan

> Execute with the `executing-plans` skill, task by task. Status: implemented; automated verification passed; manual VS Code zoom/split-editor smoke checks remain pending.

**Goal:** Keep the editor context menu and its submenus inside the visible webview, choose useful opening directions, and make every action reachable in small windows.
**Architecture:** Use one pure placement helper and one DOM menu controller shared by the existing invocation paths. Render menu panels under `document.body` with fixed positioning so submenu panels are not clipped by a scrolling parent. Keep existing action builders and clipboard selection handling.
**Tech stack:** TypeScript, DOM/CSS, existing Vitest unit runner and Chromium browser runner. No new runtime dependency.

## Findings and scope

- `packages/media/src/init-vditor.ts` assigns `window.createManualContextMenu`: it clamps position but never constrains dimensions. Its 150px minimum width can exceed a narrow viewport.
- `packages/media/src/context-menu.ts` independently enhances submenus and attaches keyboard handling after the renderer already does so. Submenus flip left, but oversized panels still overflow; closing the root does not consistently dispose child panels and timers.
- `packages/media/src/vscode-integrator.ts#createAndDisplayContextMenu` has a separate fallback renderer with no viewport correction. Route this fallback through the same controller.
- The existing `plans/do/accessibility-pass.md` covers broader accessibility. This plan covers only menu semantics and interaction needed for this UX.
- Existing uncommitted changes in `package.json`, `src/app/EditorPanel.ts`, and `test/ai-markdown-editor.integration.test.ts` are unrelated; preserve them.

ProjectMind MCP and TodoWrite were unavailable during planning. Local knowledge and work-state files were read; no MCP work record or saved-plan ID was created. This file is the planning handoff.

## Design decision

Recommended: a small shared placement helper plus a controller. It addresses geometry, duplicate listeners, and lifecycle together using existing infrastructure.

Alternatives considered: patch each renderer separately (less initial movement, but keeps divergent behavior and duplicate ownership); adopt a positioning library (more capabilities, but adds a dependency and still requires interaction cleanup). Neither is needed for this bounded menu tree.

### Placement contract

1. Use the **visible webview viewport**, not the monitor or document scroll area. Use `visualViewport` bounds when available, otherwise `innerWidth/innerHeight`; normalize anchors and bounds into the same CSS coordinate space.
2. Keep a 10px inset on each edge. Reduce it for exceptionally tiny viewports so available dimensions never become negative.
3. Measure hidden panels after applying border-box width constraints. Re-measure wrapped content before choosing vertical position; reveal only after final placement.
4. Root: prefer right of the pointer if the full panel fits; otherwise choose left if it fits; otherwise choose the side with more space (right on ties), then clamp within viewport bounds. Prefer below the anchor, then above, then clamp.
5. Submenu: anchor to the actual parent row rectangle, with a 4px horizontal gap. Prefer right if it fits, then left. If neither fits, choose the side with more space and clamp; allow overlap with the parent in very narrow windows rather than making commands inaccessible. Align top with the row and clamp vertically.
6. Limit each panel's border-box width and height to the usable viewport. Override minimum width when needed. Wrap long labels, keep submenu indicators visible, and avoid horizontal scrolling. Tall panels scroll vertically with `overflow-y: auto` and `overscroll-behavior: contain`.
7. Reposition the open tree on viewport resize/visual-viewport changes using one scheduled animation frame. On parent-menu scroll, reposition children; close a child if its parent row leaves the visible scroll area. Dismiss on outside document/editor scrolling or window blur.

### Interaction contract

- One controller owns all panels, listeners, timers, and focus state. Opening another root disposes the previous tree. One sibling submenu can be open per depth.
- Retain the existing 180ms hover-close grace period and cancel it when entering either the parent or submenu. Apply it in both directions across the gap. Show the submenu indicator in the actual opening direction while open.
- Up/Down move between enabled actions within the active panel; Home/End reach its first/last enabled action. Explicitly scroll focused rows into view inside the panel without scrolling the editor.
- Right opens a submenu; Left closes it and returns focus to its parent, independent of visual placement. Enter/Space open a parent or invoke a leaf once. Escape closes the deepest panel first, then the root. Tab dismisses without trapping focus.
- Add `role="menu"`, `role="menuitem"`, `role="separator"`, `aria-disabled`, and submenu `aria-haspopup`, `aria-expanded`, `aria-controls`. Retain VS Code theme colors and visible focus treatment.
- Outside click treats every panel as inside the same tree. Restore the invoking editor focus on Escape; do not steal focus from an outside-click destination. Preserve selection snapshots and existing command dispatch.
- An empty or all-disabled menu must not attempt modulo-zero navigation or focus a nonexistent item. Dispose listeners/timers on every dismissal route, including action activation and replacement.

## File map

| File | Responsibility |
|---|---|
| Create `packages/media/src/context-menu-placement.ts` | Pure geometry types and placement calculation |
| Create `packages/media/src/context-menu-controller.ts` | Panel DOM, measurement, scrolling, keyboard/pointer behavior, disposal |
| Modify `packages/media/src/context-menu.ts` | Keep item builders/invocation; remove duplicate enhancement/navigation ownership |
| Modify `packages/media/src/init-vditor.ts` | Replace inline renderer with controller adapter |
| Modify `packages/media/src/vscode-integrator.ts` | Delegate fallback rendering to controller |
| Modify `packages/media/src/main.css` | Scoped shared panel, row, label, indicator and focus styles |
| Create `test/context-menu-placement.test.ts` | Deterministic geometry cases |
| Create `test/context-menu.browser.test.ts` | Real layout, scrolling, input and disposal regression tests |
| Modify `vitest.browser.config.ts` | Bundle the real CommonJS clipboard helper for browser integration tests |

## Ordered implementation tasks

### 1. [code · tdd] Implement pure placement

- [x] Define exported `placeMenu` input: `anchor: {left, top, right, bottom}`, `size: {width, height}`, `viewport: {left, top, width, height}`, `kind: 'root' | 'submenu'`; output `{left, top, width, height, side: 'left' | 'right'}`. Root anchors are zero-area rectangles. Width/height are measured border-box sizes capped to usable bounds.
- [x] Add failing table-driven tests in `test/context-menu-placement.test.ts` for every corner, exact fits, left flip, neither-side fit, oversized height/width, nonzero viewport origin, and tiny positive viewport sizes. Include this concrete case:

```ts
import { expect, it } from 'vitest';
import { placeMenu } from '../packages/media/src/context-menu-placement';

it('opens a root left and above when right and bottom cannot fit', () => {
  expect(placeMenu({
    anchor: { left: 780, right: 780, top: 590, bottom: 590 },
    size: { width: 200, height: 300 },
    viewport: { left: 0, top: 0, width: 800, height: 600 },
    kind: 'root',
  })).toEqual({ left: 580, top: 290, width: 200, height: 300, side: 'left' });
});
```

- [x] Run `yarn vitest run test/context-menu-placement.test.ts`; verify failure before implementing the helper.
- [x] Implement the placement contract and rerun the same command to green. Assert all returned edges remain inside usable bounds, not just expected coordinates.

### 2. [code · tdd; design] Build constrained panel rendering

Depends on task 1. Files: controller, `main.css`, browser test.

- [x] Define exported `ContextMenuItem` as a separator or an action with `label`, optional `icon`, `disabled`, `click`, and recursive `submenu`. Export `openContextMenu(x, y, items): { dispose(): void }`. Keep the existing `manual-context-menu` root ID and `vscode-submenu` child class for integration compatibility.
- [x] Add a browser fixture with a focusable editor and 80 action rows; open at `innerWidth - 2, innerHeight - 2`. Assert root bounds stay inside the viewport and `scrollHeight > clientHeight`. Add long-label and submenu fixtures and assert no panel has horizontal overflow.
- [x] Run `yarn test:browser test/context-menu.browser.test.ts` and observe the missing-controller failure.
- [x] Implement hidden measurement, shared theme styles, body-mounted panels and geometry application. Use natural dimensions when sufficient space returns after resizing; do not retain stale constrained measurements.
- [x] Rerun the browser test to green. Verify the last action becomes visible after scrolling and clicking it invokes its callback once.

### 3. [code · tdd] Own menu interaction and lifecycle

Depends on task 2. Files: controller and browser test.

- [x] Add failing browser tests for Right → Down → Enter activating the second enabled submenu leaf once, End scrolling to the final root row, Escape returning to its parent, and reopening a dismissed submenu.
- [x] Add tests for pointer travel across the 4px gap in both directions, sibling replacement, scrolling a parent anchor out of view, resizing with a child open, outside click, window blur, all-disabled menus, and repeated open/close cycles.
- [x] Run `yarn test:browser test/context-menu.browser.test.ts`; implement the interaction contract and disposable menu tree, then rerun to green. Assert no submenu remains after root disposal and one key press moves exactly one row after repeated openings.

### 4. [code · tdd] Connect all existing render paths

Depends on task 3. Files: `init-vditor.ts`, `context-menu.ts`, `vscode-integrator.ts`, browser test.

- [x] Add integration regressions exercising the manual renderer adapter, editor `contextmenu`, Shift+F10/ContextMenu invocation, and integrator fallback. Verify only one root and one keyboard response per event.
- Integration sequencing deviation: invocation regressions were added after renderer wiring, not before it. The completed tests exercise the real builders, clipboard snapshots and callbacks; the shared controller and review fixes had observed failing tests before implementation.
- [x] Replace `window.createManualContextMenu` implementation with the shared controller adapter; route integrator fallback directly through the same exported controller. Remove the old submenu enhancer and both redundant keyboard implementations/call sites.
- [x] Rerun browser tests. Test Cut/Copy selection preservation with clipboard mocks and representative Format Document/widget insertion callbacks. Assert disabled items never execute and menu DOM remains outside editable content.

### 5. [qa · test-generation] Complete layout regression coverage

Depends on task 4. File: browser test. Expand coverage with failures first if a gap exposes incorrect behavior.

- [x] Use real Chromium viewport sizes 320×240, 800×600 and 1280×800 via the browser test runner's viewport API. Exercise four corners, center, both submenu directions, long labels, tall roots and tall children. Test viewport shrinking while open and theme focus visibility.
- [x] Add deterministic geometry coverage for visual-viewport offsets.
- [ ] Manually verify webview zoom at 100%, 150%, and 200%; browser resizing does not prove VS Code zoom behavior.
- [x] Run `yarn vitest run test/context-menu-placement.test.ts`, `yarn test:browser`, `yarn test`, and `yarn compile`. Record exact failures if unrelated existing changes prevent a clean baseline; do not silently declare success.
- [ ] Smoke-test in a VS Code split editor: narrow/short panel, mouse and keyboard invocation, scroll to last item, select submenu actions at both edges, resize, dismiss, reopen. Record manual checks separately from automation.

Tasks are sequential because they share controller and regression-test ownership. A future reviewer may independently assess the completed diff against the criteria below.

## Acceptance criteria

- [x] AC1: Root and every child panel stay inside usable visible viewport bounds at all tested sizes, with no horizontal overflow.
- [x] AC2: Right is preferred when it fits; left is selected when right does not fit and left does; neither-side-fit cases remain usable and on-screen.
- [x] AC3: Oversized menus scroll independently; the last enabled action is reachable by pointer and keyboard without scrolling the editor.
- [x] AC4: Pointer transitions, keyboard focus, submenu state and resize/scroll behavior follow the interaction contract, including left-opening menus.
- [x] AC5: Each invocation creates one tree; each action executes once; dismissal/replacement leaves no orphan panels or active per-menu handlers/timers.
- [x] AC6: Existing actions, disabled states and editor selections are preserved; unit/browser/type/build checks pass or pre-existing failures are explicitly documented.

## Planning verification

Plan reviewed against the request: visible bounds → tasks 1–2; right/left root and child placement → tasks 1–2; scrolling → tasks 2–3; UX and regressions → tasks 3–5. No application code changed or runtime tests run during this plan-only session. This paragraph records the original planning session; implementation evidence follows below.

## Execution log

- Shared placement: 35 unit cases pass, including offset and tiny viewports.
- Rendering/navigation: initial 4 Chromium regressions pass after observed failures.
- Replaced manual/fallback renderers and duplicate handlers with one controller.
- `yarn compile` passed; expanded QA subsequently completed as recorded below.
- ProjectMind MCP remains unavailable; this log is the durable local work record.

### Review remediation

- [x] [code · tdd] Synchronize pointer-hover row with DOM focus so Enter/arrow navigation agrees with visible focus. Add mixed-input browser regression, observe failure, fix and rerun.
- [x] [code · tdd] Preserve parent scroll offset when a focused submenu's anchor scrolls out of view; return focus to the panel without revealing the hidden anchor.

- Review remediation: 3 observed browser failures fixed; 26 menu browser tests now pass. Hover focus matches keyboard target, and parent scroll position survives child closure.
- `yarn test`: type checks and 308 unit tests passed; `yarn compile` and direct media esbuild bundle passed.

- [x] [code · tdd] Preserve the original editor invoker when replacing a focused menu; QA observed Escape incorrectly focusing body before the fix.
- Browser integration tests exposed a CommonJS source helper being served directly to Chromium. Added a narrowly scoped esbuild transform in `vitest.browser.config.ts` to match production bundling and test the real clipboard helper.

- Final automated gate (before final action-coverage additions): 308 unit tests and 94 browser tests passed; type checks, extension compile and media bundle passed. Manual VS Code zoom/split-editor access is unavailable in this session, so those checkboxes remain pending.


## Final verification

- `yarn test`: 34 files / 308 tests passed, including 35 placement tests; extension and media TypeScript checks passed.
- `yarn test:browser`: 7 files / 99 tests passed, including 36 menu tests.
- `yarn compile`: extension bundle passed.
- `yarn --cwd packages/media esbuild ./src/main.ts --bundle --minify --sourcemap --outfile=/tmp/context-menu-build/main.js`: webview JS/CSS bundle passed.
- `git diff --check`: passed.
- AC1–AC6 verified by the geometry and real-browser regressions. Real action coverage includes Cut/Copy, Format Document and clock widget insertion. Hover grace uses deterministic dispatched enter/leave events; widget insertion uses a real browser pointer click.
- Review found and fixed hover/keyboard focus mismatch, parent scroll restoration, and replacement invoker focus. No remaining high/medium issue identified in the final local review.
- Manual VS Code zoom and split-editor checks remain unchecked above; the plan stays in `plans/doing/` solely for those checks. No live VS Code UI control was available.
- Existing changes to `package.json`, `src/app/EditorPanel.ts` and `test/ai-markdown-editor.integration.test.ts` were preserved.
- Durable lesson: a scrollable menu needs one owner for placement, focus, descendant panels and cleanup. Test transitions between pointer and keyboard, not only each input method independently.
