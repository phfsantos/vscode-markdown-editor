# Plan: Fix line-number alignment when lines wrap

## 1. Intake

**Goal**
Make the gutter line numbers stay visually aligned with the source line they represent, even when long source lines wrap to multiple visual rows in the rendered editor.

**User outcome**
A long list item or paragraph whose rendered content wraps shows exactly one line number, positioned at the first visual row of that line. Subsequent line numbers continue from below the wrapped block — not from the next visual row inside the same source line. No off-by-N drift between gutter and content for the rest of the document.

**Observed bug**
In a wrapped list item, the next gutter number ("26") renders next to the wrap continuation ("change.") instead of next to the next source line. Every gutter entry after a wrap drifts upward by one visual row.

---

## 2. Scope

**Scope:** Bug — single file change likely, plus a regression test fixture.

**Domains**
- Code: line-number renderer, line-DOM mapper
- QA: visual + DOM-based regression test for wrapping cases

---

## 3. Repo touchpoints

- [packages/media/src/line-number-renderer.ts:340-401](packages/media/src/line-number-renderer.ts#L340-L401) — `render()` builds the gutter; positions each number using `element.getBoundingClientRect()`.
- [packages/media/src/line-number-renderer.ts:374-396](packages/media/src/line-number-renderer.ts#L374-L396) — per-line positioning block (`top`, `height` calculation).
- [packages/media/src/line-number-renderer.ts:523-539](packages/media/src/line-number-renderer.ts#L523-L539) — CSS for the line-number item; `align-items: flex-start`, `line-height: 1.4`.
- [packages/media/src/diff-line-dom-mapper.ts](packages/media/src/diff-line-dom-mapper.ts) — `getRenderedLineElements()` defines what counts as a "line" element. Drift cause likely lives here OR in how its output is positioned.

---

## 4. Hypotheses (investigate before fixing)

The bug has more than one plausible cause; nail it down before patching.

### H1 — Inline-wrap is being emitted as separate line elements
`collectRenderedLineElements` might be emitting nested inline-flow blocks (e.g. a wrapped `<span>` child) as additional line entries, so a single source line produces 2 line elements when it wraps. **Check:** in DevTools on the failing doc, count elements with `data-line-number-anchor="true"` inside the wrapped list item. Should be 1; if 2+, H1 is the cause.

### H2 — `rect.top` collapses when the next element is a sibling of the wrapping element
If `getRenderedLineElements` returns elements whose `getBoundingClientRect()` reflects their *logical* position rather than the visual position after wrap (e.g. an element with `position: absolute` somewhere up the tree), then the "next" line gets placed at the visual row immediately under the first visual row of the previous line, not under the wrapped portion. **Check:** log `rect.top` of consecutive line elements; if the diff equals one `line-height` instead of `wrapped-height`, H2 holds.

### H3 — Off-by-one between rendered-block index and source line
The gutter shows `index + 1` where `index` is the position in `getRenderedLineElements(...)`. That's a rendered-block index, not a markdown source line number. Blank source lines and frontmatter may not produce a block, so the displayed number drifts from the source line for the entire document — not just at wraps. **Check:** open a doc with frontmatter and blank lines; verify whether displayed numbers exactly match the underlying file's line numbers when nothing wraps. If they already drift, H3 is part of the picture and the fix needs source-line-aware numbering, not just better positioning.

### H4 — Fallback `line-height` defeats wrap-height
[Line 390](packages/media/src/line-number-renderer.ts#L390) takes `max(rect.height, fallbackLineHeight)`. If `rect.height` is correct (e.g. 40px for a wrapped line) but a downstream layout step squishes the gutter item, it could mask the wrap. Probably not the cause but cheap to verify.

Recommend running all four checks before choosing the fix.

---

## 5. Product definition

### In scope
1. Reproduce in a minimal fixture (markdown doc + viewport width that forces wrap).
2. Identify which hypothesis (H1–H4) actually fires.
3. Fix the root cause:
   - If **H1**: tighten `shouldEmitAsLine`/transparent-container handling so wrap continuations are not emitted as new line entries.
   - If **H2**: in `render()`, when consecutive elements' `rect.top` deltas are less than the previous element's `rect.height`, push the next `top` to `previous.bottom`. Or measure via the last text node's range rect instead of the block rect.
   - If **H3**: change the displayed number from rendered-block index to actual source line number (extension-host already knows this — pass it through the existing line-mapping messages, or compute via `data-source-line` already set on the element).
   - If **H4**: clamp the fallback only when `rect.height === 0`.
4. Add a DOM-based unit test that constructs a wrapped block and asserts each `[data-vditor-line-number]` element's `top + height` does not overlap the next item's `top`.
5. Add an integration smoke test that opens the editor at a narrow width with a known doc and snapshots the gutter positions.

### Out of scope
- Reflow on font-size or theme change (already covered by `ResizeObserver` in the renderer).
- Diff-mode line numbers (separate code path).
- Soft-wrap toggling (no setting exists today; do not add).

---

## 6. Execution plan

| Step | What | Depends on | Done when |
|------|------|------------|-----------|
| 1 | Build minimal repro: doc with a wrapping list item, a wrapping paragraph, a blank line, and a heading. Capture screenshot + DOM snapshot | None | Repro reproducibly shows the drift |
| 2 | Diagnostic logging: log `(index, sourceLine, rect.top, rect.height, displayed)` for every line element on the repro doc | Step 1 | One of H1–H4 is confirmed |
| 3 | Apply fix targeted at the confirmed hypothesis (see Section 5.3) | Step 2 | Gutter aligns on the repro doc |
| 4 | Add unit test for the line-mapper / renderer covering the wrapping case | Step 3 | Test fails on the pre-fix code, passes on post-fix |
| 5 | Manual regression sweep: code blocks, tables, nested lists, blockquotes, headings, frontmatter, empty doc, very long doc | Step 3 | No new alignment regressions |

---

## 7. Acceptance criteria
- On the repro doc, every gutter number's vertical center is within `½ × line-height` of its target line's first visual row.
- No two consecutive gutter numbers overlap vertically.
- If H3 turns out to be in play: gutter numbers exactly match the source file's line numbers (verifiable by comparing against `File → Open` line count for any cursor position).
- Existing alignment for non-wrapping docs is preserved.

---

## 8. Risks
| Risk | Mitigation |
|------|------------|
| Fixing H2 by chaining `previous.bottom` masks an upstream bug | Only adopt that approach if H1 and H3 are ruled out; document why in a code comment |
| Changing `getRenderedLineElements` affects diff view (shared helper) | Add explicit tests for the diff path before changing the mapper |
| Source-line numbering (H3 fix) requires plumbing source-line through the webview message protocol | If H3 is real, coordinate with [typed-webview-message-protocol](typed-webview-message-protocol.md) to add a typed `sourceLineMap` payload rather than retro-fitting an untyped one |

---

## 9. Validation fixtures
Commit these alongside the fix so the regression is locked in:
- `test/fixtures/line-numbers/wrapped-list.md` — long list item that wraps at ≤ 80 col viewport
- `test/fixtures/line-numbers/wrapped-paragraph.md` — long paragraph that wraps
- `test/fixtures/line-numbers/frontmatter-and-blanks.md` — exercises H3 if present
- `test/fixtures/line-numbers/code-block.md` — make sure code blocks (which already line-number internally) are not double-numbered
