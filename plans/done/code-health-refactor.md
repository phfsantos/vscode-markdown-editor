# Code Health: God-File Split & Test Modernization

**Priority:** HIGH (after release hygiene). **Role:** code / qa
**Created:** 2026-07-06 (codebase state audit)

## Problem / Context

The extension works (typecheck clean, 22 unit tests green) but maintainability
is degrading at the current feature velocity:

- `src/app/EditorPanel.ts` — **5,561 lines**; owns webview lifecycle, message
  routing, save/sync, AI hooks, diff, and more.
- `packages/media/src/diagnostic-visualizer.ts` (2,961), `main.ts` (2,894),
  `vscode-integrator.ts` (1,240), `find-replace.ts` (1,375) — the webview side
  has the same problem.
- Tests are hand-rolled `.js` files run by a homegrown `test/run-all.js`
  (execSync per file, hard-coded list — new test files are silently skipped);
  no framework, no coverage, not wired into CI.
- Compiled artifacts committed inside source trees (`*.js.map`,
  `packages/media/src/dashboard/types/kabamBoard.js`).
- Three separate build units (root, `packages/media`, `packages/widgets`) with
  independent `yarn.lock`s — consider a proper workspace.

## Steps

1. Adopt a real test runner (vitest recommended — TS-native, fast): port the
   23 existing `test/*.test.js` files, delete `run-all.js`, auto-discover tests.
2. Add coverage reporting; set an initial floor (~40%) on core logic
   (sync, link resolution, diff, clean-content-for-save).
3. Split `EditorPanel.ts` by concern behind its existing public surface:
   webview lifecycle, message protocol/router, document sync, AI integration,
   diff support. Target ≤1,000 lines per module. Refactor-only — behavior
   frozen by the ported test suite.
4. Same treatment for `packages/media/src/main.ts` (init/orchestration only).
5. Remove committed build artifacts from src trees; extend `.gitignore`.
6. Convert root + packages into yarn workspaces (single lockfile, one install).
7. Add a lint/format gate (eslint config exists but isn't enforced in CI).

## Acceptance criteria

- [x] `yarn test` runs the full suite via the framework with coverage output
      (vitest, 24 files / 180 tests; coverage-v8 with an enforced 40% floor —
      actual 52.4% lines / 65.4% functions on the measured core scope)
- [ ] No source file over ~1,500 lines in `src/` — **partial**: EditorPanel.ts
      5,571 → 3,696 via four clean extractions (NativeNotificationService 489,
      RendererDataStore 1,074, webviewHtml 235, CalendarMessageHandler 158);
      the remaining concerns (diff cluster, AI handlers, message router) have
      15+ mutable-state cross-refs and need characterization tests first —
      see follow-up plan "God-file split phase 2". packages/media/main.ts
      untouched, same follow-up.
- [x] New test files run without editing a runner list (vitest auto-discovery;
      run-all.js deleted; the previously silently-skipped graphview-panel test
      now runs)
- [x] Single `yarn install` at repo root builds everything (yarn workspaces +
      nohoist for vditor/vite/vitest; nested lockfiles removed; vsce packaging
      verified in both modes, 418 files / 6.76MB)
- [x] CI enforces lint + typecheck + tests (eslint 8 installed, 19 pre-existing
      errors fixed; workflow: Install → Lint → Test)

## Files

`src/app/EditorPanel.ts`, `test/run-all.js`, `packages/media/src/main.ts`,
`packages/media/src/diagnostic-visualizer.ts`, `package.json`
