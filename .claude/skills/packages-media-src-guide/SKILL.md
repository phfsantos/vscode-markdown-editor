---
name: packages-media-src-guide
description: Use when changing Markdown Studio’s Vditor webview under packages/media/src, especially synchronization, clipboard selections, source-line mapping, or transient editor UI.
tags: ["vditor", "webview", "markdown", "synchronization", "source-mapping"]
generated: 2026-11-16T16:10:50.679Z
source: agent-promoted
sourceSignal: "cand-5bc15ce416 area-guide: Working in packages/media/src"
---

# packages-media-src-guide

Use when changing Markdown Studio’s Vditor webview under packages/media/src, especially synchronization, clipboard selections, source-line mapping, or transient editor UI.

## Prerequisites

- Work from the vscode-markdown-editor repository root with its declared Node.js/Yarn dependencies installed.
- Browser verification needs Playwright Chromium and packages/media's Vditor dependency.

## When to Use

- Change Vditor input or host-to-webview synchronization.
- Fix clipboard selections, diagnostics, source navigation, or line-number mapping.
- Add transient activity, diff, or toolbar UI around the editable document.

## Workflow

1. Locate the boundary before editing: `packages/media/src/main.ts` routes host messages; `host-message-router.ts` handles routing; `init-vditor.ts` creates editors; `content-sync.ts` carries generation/revision state. Read the relevant focused controller instead of adding unrelated behavior to the entrypoint.

2. Preserve canonical Markdown from the input callback. Do not immediately reserialize mutable rendered DOM or issue concurrent full-document replacements per keystroke. Keep synchronization metadata and the existing serialized update path. A full-state message rejected as stale may need replay after the receiver catches up; payload equality alone does not prove delivery. Evidence: candidate signals sig-1788387087184-1un73k and sig-1794588162469-bp5kut.

3. Treat rendered positions and source positions as different coordinate systems. In `line-number-renderer.ts`, `source-position-navigation.ts`, and diagnostics, reuse the existing mapping rules. Blank lines, frontmatter and table delimiters can invalidate rendered-block indexing. Exclude transient gutter/diff spacer nodes from logical source lines. Evidence: work records wr-2026-09-11-review-changes-on-polish-before-release and wr-2026-09-02-execute-stored-plan-plan-1777659482650-3.

4. For clipboard changes, inspect `clipboard-selection.js`. A DOM Range offset belongs to its container, not the document. Selecting part of a code block must not silently copy the whole block. Test partial selections and preservation of unrelated Markdown. Evidence: sig-1789070165391-30ar9f.

5. Keep transient UI outside editable content and saved Markdown. Attach activity summaries to the visible toolbar after initialization, reattach after replacement, and exclude `.vditor-toolbar--hide` used by the internal diff renderer. Use theme tokens, a full hover title for truncated summaries, and the existing polite live region. Responsive assertions should compare element rectangles against the chat action with crowded controls. Browser fixtures using VS Code colors need `body[data-use-vscode-theme-color="1"]`. Evidence: wr-2026-11-16-fix-overlapping-agent-activity-status-by and `test/agent-activity-toolbar.browser.test.ts`.

6. Use the existing `vscode-markdown-editor-verification` skill for commands and gate selection. Browser behavior requires real Vditor assertions, including source/selection preservation; unit mocks alone cannot prove it. Discover the current native runner for host lifecycle claims. An older failed criterion or human smoke-test handoff is historical evidence, not a passing check or a requirement to delegate testing to the user.

## Examples

For an activity summary overlapping Add to Chat, place it in normal toolbar flow and assert non-overlapping rectangles at 320, 768 and 1280px. Also cover empty/stale summaries, toolbar replacement, and exclusion of the hidden diff toolbar.