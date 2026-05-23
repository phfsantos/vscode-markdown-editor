# Plan: Export formats (PDF, HTML, Obsidian vault)

## 1. Intake

**Goal**
Add first-class export of the current note (or the whole workspace) to portable formats: PDF, standalone HTML, and an Obsidian-compatible vault snapshot.

**User outcome**
- "Export → PDF" produces a paginated, themed PDF of the active note that matches the WYSIWYG view.
- "Export → HTML" produces a single self-contained `.html` (inlined CSS + images) suitable for sharing.
- "Export → Obsidian vault" zips the current workspace with wiki-links preserved and any necessary `.obsidian/` metadata so the result opens cleanly in Obsidian.

---

## 2. Scope

**Scope:** Project — new commands, new renderer pipeline, new packaging step. Per-format complexity differs.

---

## 3. Repo touchpoints

- [packages/media/src/main.ts](packages/media/src/main.ts) — owns the rendered DOM (source of truth for HTML/PDF)
- [src/app/EditorPanel.ts](src/app/EditorPanel.ts) — already has render-HTML message paths (search `requestRenderedMarkdownHtml`)
- [src/services/LinkResolver.ts](src/services/LinkResolver.ts), [src/services/LinkGraphGenerator.ts](src/services/LinkGraphGenerator.ts) — link rewriting for vault export
- [src/extension.ts](src/extension.ts) — command registration
- `package.json` — new commands under "Export" submenu

---

## 4. Product definition

### Per-format approach

#### HTML (lowest risk; ship first)
- Reuse the existing rendered HTML produced for `requestRenderedMarkdownHtml`.
- Inline stylesheets (read from `out/media`) and base64-encode images (with size cap; offer "external images" alternative).
- Wrap in minimal HTML shell with `<meta charset>`, doctype, title from H1 or filename.

#### PDF
- Render the same HTML through VS Code's headless capability? VS Code does not ship a Chromium renderer for extensions. Two viable paths:
  - **(a) System print pipeline:** open the exported HTML in the default browser with `?print=1` query and trigger `window.print()`. Lowest dependency; user picks "Save as PDF" in the print dialog.
  - **(b) Headless dependency:** ship `puppeteer-core` and auto-detect installed Chrome/Edge. Best fidelity, larger surface.
- Recommendation: ship **(a)** first; gate **(b)** behind a setting for users who want one-step PDF.

#### Obsidian vault
- Copy workspace files into a target folder, preserving structure.
- Rewrite wiki-link syntax variants if the user uses non-Obsidian forms (the codebase already supports Obsidian-style — confirm via [LinkResolver](src/services/LinkResolver.ts)).
- Write a minimal `.obsidian/app.json` so the vault opens cleanly.
- Bundle attachments referenced by relative paths.
- Output as folder or `.zip` (user choice).

### Commands
- `markdown-editor.export.html` — current file or selection
- `markdown-editor.export.pdf` — current file
- `markdown-editor.export.obsidianVault` — workspace folder (asks which root in multi-root)

---

## 5. Execution plan

| Step | What | Depends on | Done when |
|------|------|------------|-----------|
| 1 | `ExportService` skeleton + command registration + UI menu entries | None | Commands appear in palette and editor title menu |
| 2 | HTML export: pull rendered HTML, inline CSS + image-encode pipeline | Step 1 | Output opens correctly in browser with no missing assets |
| 3 | PDF (path A): write HTML to temp file, open in OS browser with print hint | Step 2 | User can save as PDF; works on macOS/Windows/Linux |
| 4 | Obsidian vault: file copy + link audit + `.obsidian/` shell + zip option | Step 1 | Output folder opens in Obsidian; wiki-links navigate correctly |
| 5 | PDF (path B, optional): puppeteer-core integration behind setting | Step 3 | One-step PDF when Chrome/Edge detected |
| 6 | Progress UI + cancellation for large exports | Steps 2-5 | Vault export of 1000+ files shows progress and can be cancelled |

---

## 6. Acceptance criteria
- HTML export is byte-identical to the rendered WYSIWYG view (modulo VS Code-only chrome).
- PDF export works without extra installs (print path) and produces a usable file.
- Obsidian export round-trips: export → open in Obsidian → re-import to the extension → no broken links.
- README's "TODO: export" item is removed.

---

## 7. Risks
| Risk | Mitigation |
|------|------------|
| PDF fidelity varies across browsers | Document this; offer the puppeteer path for fidelity-critical users |
| Large workspaces are slow to vault-export | Stream + show progress; allow folder-only (no zip) |
| Image inlining bloats HTML | Cap inline size; fall back to `assets/` sibling folder when over threshold |
| Wiki-link dialect mismatch | Reuse existing resolver; add a normalization pass in the export pipeline |
