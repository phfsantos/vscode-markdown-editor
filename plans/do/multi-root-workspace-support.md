# Plan: Multi-root workspace support

## 1. Intake

**Goal**
Make the extension correctly handle VS Code multi-root workspaces so daily notes, templates, wiki-link resolution, and graph/sidebar features work per-root rather than silently assuming the first folder.

**User outcome**
Users running "vault of vaults" setups (e.g. multiple knowledge bases opened together, or repo + scratch notes) get correct, root-aware behavior: links resolve inside the owning root, templates and daily notes live in the right vault, graph view scopes to the active root by default.

**Core framing**
- **Root-aware resolution everywhere `workspaceFolders[0]` is used today.**
- **Per-root configuration** for vault-specific settings (templates dir, daily notes dir, link style) layered over global defaults.
- **Cache and indexing keyed by root URI**, not by global state.

---

## 2. Scope

**Scope:** Project — touches multiple services, sidebar/graph, commands, and settings schema.

**Domains involved**
- Code: services (LinkResolver, TemplateManager, commands), sidebar context, graph, settings
- QA: regression coverage for single-root, multi-root, and out-of-workspace files

---

## 3. Repo touchpoints

Single-root assumptions live in:

- [src/extension.ts:115](src/extension.ts#L115) — fallback target uses `workspaceFolders?.length`
- [src/services/TemplateManager.ts:279](src/services/TemplateManager.ts#L279), [src/services/TemplateManager.ts:361](src/services/TemplateManager.ts#L361), [src/services/TemplateManager.ts:417](src/services/TemplateManager.ts#L417) — `workspaceFolders?.[0]`
- [src/services/LinkResolver.ts:181](src/services/LinkResolver.ts#L181), [src/services/LinkResolver.ts:348](src/services/LinkResolver.ts#L348) — iterates folders but defaults to `[0]`
- [src/commands/MarkdownCommandProvider.ts:377](src/commands/MarkdownCommandProvider.ts#L377) — daily notes target
- [src/app/_utils.ts:21-24](src/app/_utils.ts#L21-L24) — search roots
- [src/sidebar/MarkdownSidebarContext.ts](src/sidebar/MarkdownSidebarContext.ts) — graph/backlink caches
- [src/services/LinkGraphGenerator.ts](src/services/LinkGraphGenerator.ts) — index keyed globally

---

## 4. Product definition

### In scope
1. Helper `getActiveWorkspaceRoot(uri?)` that returns the root containing a given URI, falling back to active editor's root, then user setting, then `[0]`.
2. Per-root settings layer: `markdown-editor.daily.directory`, `markdown-editor.templates.directory`, `markdown-editor.linkStyle` can be overridden per `WorkspaceFolder`.
3. Wiki-link resolution scoped to the owning root by default, with optional cross-root fallback (config flag).
4. Graph/backlink cache keyed by root URI; invalidation reacts to `onDidChangeWorkspaceFolders`.
5. Quick Pick when an action is ambiguous (e.g. "Create daily note" with multiple roots).

### Out of scope
- Per-root activation/deactivation of the extension.
- Cross-vault link rewriting on move.

---

## 5. Execution plan

| Step | What | Depends on | Done when |
|------|------|------------|-----------|
| 1 | Add `WorkspaceRootResolver` service: `forUri()`, `forActive()`, `all()` | None | All single-folder lookups go through it |
| 2 | Migrate call sites (TemplateManager, LinkResolver, daily-notes command, _utils) | Step 1 | grep for `workspaceFolders?.[0]` returns 0 results outside the resolver |
| 3 | Extend settings to support per-root scope; document precedence | Step 1 | `WorkspaceFolderConfiguration` honored for daily/templates/linkStyle |
| 4 | Add `onDidChangeWorkspaceFolders` listener; invalidate caches per root | Steps 1-3 | Adding/removing a root rebuilds only that root's index |
| 5 | Quick Pick disambiguation for daily notes/templates when >1 root and no active file | Steps 1-3 | Manual test in 3-root workspace |
| 6 | Regression matrix: single-root, 2-root, file outside any root | All | All scenarios pass |

---

## 6. Acceptance criteria
- No `workspaceFolders?.[0]` outside the resolver.
- Daily notes/templates land in the root owning the active file.
- Wiki-links resolve to same-root targets first; cross-root behavior is opt-in.
- Graph/backlink cache is partitioned by root and survives add/remove root events.
- Single-root behavior is unchanged.

---

## 7. Risks
| Risk | Mitigation |
|------|------------|
| Existing users rely on implicit `[0]` behavior | Make resolver's fallback identical to today; only change behavior when >1 root |
| Cache key changes invalidate persisted state | Version the cache; rebuild on first run |
| Cross-root wiki-link expectations vary | Ship same-root-only default, add config flag for cross-root fallback |

---

## 8. Out-of-the-box defaults
- `markdown-editor.workspace.linkScope`: `"sameRoot"` (alt: `"allRoots"`)
- `markdown-editor.workspace.ambiguousActionBehavior`: `"prompt"` (alt: `"activeRoot"`, `"firstRoot"`)
