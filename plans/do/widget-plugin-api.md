# Plan: Widget plugin API

## 1. Intake

**Goal**
Replace the hardcoded widget registration in [registerWidgets.ts](packages/widgets/src/widgets/registerWidgets.ts) with a manifest-driven plugin API so users (and other extensions) can contribute widgets without forking the package.

**User outcome**
Power users drop a widget manifest + bundle into a known folder (or another extension declares one in its `package.json`) and the widget appears in the toolbar/inserter, persists across reloads, and behaves like a first-class core widget.

**Core framing**
- **Manifest-first.** A small JSON manifest describes the widget; the runtime loads the component lazily.
- **Two entry paths.** (a) Workspace-local widgets folder, (b) VS Code extension contribution point.
- **Sandboxed runtime.** Widgets run in the existing webview; no new privileges.

---

## 2. Scope

**Scope:** Project — touches the widget package, extension host (discovery + loader), and webview bootstrap.

---

## 3. Repo touchpoints

- [packages/widgets/src/widgets/registerWidgets.ts](packages/widgets/src/widgets/registerWidgets.ts) — single hardcoded function today
- [packages/widgets/src/widgets/index.ts](packages/widgets/src/widgets/index.ts) — barrel exports
- `WidgetRegistry` core (in `packages/widgets/src/core`)
- [src/extension.ts](src/extension.ts) — discovery happens here at activation
- [packages/media/src/main.ts](packages/media/src/main.ts) — webview side that consumes registrations
- [src/app/EditorPanel.ts](src/app/EditorPanel.ts) — webview message protocol for sending widget list

---

## 4. Product definition

### Manifest schema (proposed)

```json
{
  "id": "my-org.weather-pro",
  "displayName": "Weather Pro",
  "description": "...",
  "category": "info",
  "version": "1.0.0",
  "entry": "./dist/widget.js",
  "tagName": "weather-pro-widget",
  "icon": "./icon.svg",
  "permissions": ["network"],
  "configSchema": { "$ref": "./config.schema.json" }
}
```

### Two contribution paths

1. **Workspace widgets:** `.vscode/markdown-widgets/<id>/manifest.json` + bundle. Discovered on activation and on file change.
2. **Extension contribution:** other extensions declare in their `package.json`:
   ```json
   "contributes": {
     "markdownEditorWidgets": [{ "manifestPath": "./widgets/manifest.json" }]
   }
   ```

### In scope
1. Manifest schema + JSON Schema file for editor validation.
2. Discovery service in extension host: scan workspace + read contributing extensions.
3. Loader: bundle URL → webview-safe import, register with `WidgetRegistry`.
4. Lifecycle: dispose on workspace-folder remove or extension deactivation.
5. Migrate 2-3 core widgets to manifest form as proof-of-pattern (keep the rest hardcoded initially).
6. Error UI for invalid manifests (show in Problems panel via diagnostics).

### Out of scope
- Marketplace / discovery beyond VS Code's existing extension marketplace.
- Cross-widget IPC.
- Per-widget process isolation.

---

## 5. Execution plan

| Step | What | Depends on | Done when |
|------|------|------------|-----------|
| 1 | Draft manifest schema + JSON Schema; publish to `packages/widgets/schemas/` | None | Schema validates the example manifests |
| 2 | `WidgetManifestLoader` (extension host) with workspace + extension contribution scanning | Step 1 | Returns `WidgetManifest[]` from both sources |
| 3 | Webview-side dynamic loader (fetch bundle URI via `webview.asWebviewUri`, register) | Steps 1-2 | A test widget loaded from `.vscode/markdown-widgets/` renders |
| 4 | Lifecycle hooks: file-watcher reload, extension activation events | Step 3 | Removing manifest unregisters the widget |
| 5 | Migrate `HelloWorldWidget` and one calendar widget to manifest form as reference | Steps 1-4 | Both still work end-to-end |
| 6 | Author docs at `docs/widgets/authoring.md` with an end-to-end example | Step 5 | A new dev can ship a widget from the doc alone |

---

## 6. Acceptance criteria
- Hardcoded `registerWidgets.ts` shrinks (or becomes a thin core bootstrap).
- A workspace can add a widget by adding files only — no rebuild required.
- A third-party extension can contribute widgets via its `package.json`.
- Invalid manifests surface as diagnostics, not silent failures.
- All existing widgets keep working.

---

## 7. Risks
| Risk | Mitigation |
|------|------------|
| Webview sandbox restricts dynamic import | Use `import()` against `webview.asWebviewUri`; bundle widgets as ESM with declared globals |
| Untrusted widget code | Same sandbox as core widgets today; document the trust model; do not auto-enable from network sources |
| Manifest schema churn | Version field; loader rejects newer-than-supported with clear error |
| Performance with many widgets | Lazy import; register only when category opened |
