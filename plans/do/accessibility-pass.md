# Plan: Accessibility pass

## 1. Intake

**Goal**
Audit and remediate accessibility gaps across the custom editor and widgets so the extension is usable with a screen reader, fully keyboard-navigable, and conformant with WCAG 2.1 AA where applicable.

**User outcome**
- Screen reader users can navigate widgets, toolbars, and the editor surface and understand state changes.
- Keyboard-only users can reach and operate every interactive element without a mouse.
- High-contrast and reduced-motion VS Code themes are respected.

---

## 2. Scope

**Scope:** Project — touches all webview UI surfaces and widget code. Scoped audit first, then incremental remediation.

**Domains**
- Code: webview, all widgets, modals (tool selector, etc.)
- QA: assistive-tech smoke tests

---

## 3. Repo touchpoints

Webview UI surfaces:
- [packages/media/src/main.ts](packages/media/src/main.ts) — editor host
- [packages/media/src/toolbar.ts](packages/media/src/toolbar.ts) — main toolbar
- [packages/media/src/tool-selector-modal.ts](packages/media/src/tool-selector-modal.ts), [packages/media/src/tool-selector.ts](packages/media/src/tool-selector.ts) — modals
- [packages/media/src/find-replace.ts](packages/media/src/find-replace.ts) — search UI
- [packages/media/src/wiki-link-autocomplete.ts](packages/media/src/wiki-link-autocomplete.ts) — completion popup
- [packages/media/src/ai-markdown-ui.ts](packages/media/src/ai-markdown-ui.ts)
- All [widgets](packages/widgets/src/widgets/) — 20+ React components

Graph view:
- [src/app/GraphViewPanel.ts](src/app/GraphViewPanel.ts) — needs keyboard nav for node selection

---

## 4. Product definition

### Audit categories

1. **Semantic HTML / ARIA**
   - Replace `div`/`span` controls with `button`/`input` where appropriate.
   - Add `role`, `aria-label`, `aria-pressed`, `aria-expanded`, `aria-controls` to bespoke controls.
   - Use `aria-live` regions for transient announcements (save status, AI action results).

2. **Keyboard navigation**
   - Every interactive element reachable via Tab in logical order.
   - Modals trap focus and restore on close.
   - Custom widgets with grids implement arrow-key nav (e.g. DevCommands, MacroBoard, CalendarMonth).
   - Escape closes popovers/modals.

3. **Focus visibility**
   - Visible focus ring on every focusable element, including custom buttons.
   - Honor `:focus-visible`.

4. **Color/contrast**
   - Audit against VS Code's high-contrast themes; use theme tokens (`--vscode-*`) rather than hardcoded colors.
   - Verify text contrast ≥ 4.5:1 (3:1 for large text/icons).

5. **Motion**
   - Respect `prefers-reduced-motion` — disable animations, force-simulation transitions, etc.

6. **Forms**
   - Inputs have associated `<label>`; error states announced via `aria-invalid` + `aria-describedby`.

### Tooling
- Add `@axe-core/playwright` (or `axe-core` directly) to the test pipeline; run against rendered webview snapshots.
- Lint with `eslint-plugin-jsx-a11y` on the widgets package.

---

## 5. Execution plan

| Step | What | Depends on | Done when |
|------|------|------------|-----------|
| 1 | Add `eslint-plugin-jsx-a11y` to widgets; fix or `// eslint-disable` with comment | None | Lint passes; baseline of known issues recorded |
| 2 | Run axe-core scan against editor + each widget; record findings as checklist | Step 1 | Issue list per surface committed |
| 3 | Fix semantic HTML / ARIA issues, prioritizing toolbar + modals + DevCommands/MacroBoard | Step 2 | Axe scan clean for those surfaces |
| 4 | Keyboard nav pass: focus order, focus traps, arrow-key grid nav | Step 3 | Manual test sheet completed |
| 5 | Theme token + contrast pass; honor `prefers-reduced-motion` | Step 3 | High-contrast theme works without remaining colors fixes |
| 6 | Graph view keyboard nav: tab between nodes, arrow keys, enter to open | Step 4 | Graph operable without mouse |
| 7 | Add axe-core smoke test to CI for editor + widget gallery | All | CI fails on regressions |

---

## 6. Acceptance criteria
- Axe-core scan reports zero serious or critical violations on the editor surface and each shipped widget.
- All interactive elements are keyboard-reachable in logical order; modals trap focus.
- High-contrast theme renders all controls legibly with no hardcoded colors.
- `prefers-reduced-motion` disables non-essential animations.
- Graph view nodes can be focused and opened via keyboard.

---

## 7. Risks
| Risk | Mitigation |
|------|------------|
| Vditor (third-party editor core) has its own a11y gaps | Document upstream issues; remediate at extension layer where possible (live regions, focus management) |
| Force simulation / canvas in graph is hard to make screen-reader-friendly | Provide an accessible list view as alternative (already partial via sidebar) |
| Widget authors regress a11y | Document a11y requirements in the new [widget-plugin-api](widget-plugin-api.md) authoring guide; CI lint rule |

---

## 8. Cross-plan references
- The [widget plugin API](widget-plugin-api.md) authoring docs should include an a11y checklist.
- The [typed message protocol](typed-webview-message-protocol.md) should include typed events for `aria-live` announcements so any panel can request one without ad-hoc DOM access.
