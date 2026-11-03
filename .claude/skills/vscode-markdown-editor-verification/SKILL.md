---
name: vscode-markdown-editor-verification
description: Use when validating changes in vscode-markdown-editor, especially document synchronization, diff/line mapping, or Vditor browser behavior.
tags: ["vscode", "markdown", "verification", "vitest", "typescript", "playwright"]
generated: 2026-10-26T18:53:20.705Z
source: agent-promoted
sourceSignal: "cand-775cfa381f"
---

# vscode-markdown-editor-verification

Use when validating changes in vscode-markdown-editor, especially document synchronization, diff/line mapping, or Vditor browser behavior.

## Prerequisites

- Run from the vscode-markdown-editor repository root.
- Node.js and Yarn, with the repository's declared dependencies available in the root and relevant packages.
- For browser tests, Playwright Chromium and the packages/media Vditor dependency must be available.

## When to Use

- Verify a feature, bugfix, or refactor in this repository.
- Validate document synchronization, newline normalization, or diff/line mapping.
- Check rendered editor interactions and Vditor input callbacks in a real browser.

## Workflow

1. Identify the changed behavior and its regression tests. Check the current scripts and test configuration before selecting commands; historical evidence is not a substitute for the current configuration.
2. Run focused regression tests first: `yarn vitest run <path>` (evidence 3–4). Replace `<path>` with the actual relevant non-browser test path. `npx vitest run <path>` is an evidenced alternative (1). Passing means exit code zero and assertions proving the requested behavior, including preservation of unrelated content/state.
3. For browser/editor interactions, run `yarn test:browser` (9–10). Passing means real-browser assertions succeed; unit-only mocks do not prove production Vditor callback behavior. Current configuration uses headless Playwright Chromium.
4. For TypeScript changes, run `yarn check-types` (15–16); for changes covered by ESLint, run `yarn lint` (19). Each must exit zero without errors. `npm run check-types` is an evidenced alternative (17), but the current script still invokes Yarn internally.
5. Escalate to `yarn test:unit` (12–13) when wider root-unit/coverage validation is needed, or `yarn test` (7) for cross-package changes or a full non-browser gate. The current `yarn test` runs type checks, core, root-unit, and widget tests; it does not include lint or browser tests. Avoid rerunning gates already covered unless changes or failures require it.
6. Read the output before claiming success. Report commands run, outcomes, behavior proven, and checks skipped or blocked. Surface failures explicitly; fix regressions and rerun affected checks. Never present historical evidence as a fresh passing run.

Evidence references from candidate cand-775cfa381f:
- 1: telemetry/2026-10.jsonl:L1635 — npx vitest run <path>, 45 runs on 4 days.
- 3–4: wr-2026-09-02-execute-stored-plan-plan-1777659482650-3 — focused tests prove gutter clicks focus/reveal editable lines without content mutation, exclude gutters/diff spacers from mapping, and preserve maps after simulated undo/redo DOM rerender.
- 7: wr-2026-07-07-execute-plan-plan-1783385268412-wjozt1-r — yarn test runs typecheck and unit tests and exits non-zero on failure.
- 9–10: wr-2026-09-04-execute-plan-plan-add-browser-level-vdit — real pinned Vditor 3.11.2 receives dispatchVditorInput through its production callback and emits complete mutated Markdown preserving unrelated custom blocks, Unicode, blank lines, and ordering.
- 12–13: wr-2026-09-04-execute-plan-plan-make-synchronized-writ — LF snapshot consumption for equivalent CRLF text; internal synchronized writes leave DocumentSyncController generation unchanged.
- 15, 19: wr-2026-09-04-execute-plan-plan-make-synchronized-writ — fresh Vitest, lint, type checks, builds, and diff-check pass.
- 16: wr-2026-09-04-execute-stored-plans-plan-1776910562222 — diff/parser tests compile and run through test:unit/check-types.
- 17: telemetry/2026-06.jsonl:L1921 — npm run check-types, 18 runs on 4 days.
Current command composition checked against package.json and vitest.browser.config.ts when drafting; recheck before use.

## Examples

For synchronized writes, focused assertions should prove an LF snapshot is consumed when VS Code reports equivalent CRLF text, and that the internal write leaves DocumentSyncController generation unchanged (evidence 12–13). For browser input changes, assert the real Vditor callback emits the complete mutated Markdown while preserving unrelated custom blocks, Unicode, blank lines, and ordering (9–10).