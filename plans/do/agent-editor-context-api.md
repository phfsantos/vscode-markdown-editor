# Custom editor context API implementation plan

> Execute with `executing-plans`, task by task. This is planned work, not an implemented API.

**Goal:** Let cooperating extensions discover the active Markdown Studio document and its verified source selection without changing editor focus.
**Architecture:** One activation-owned context registry tracks panels by identity. A versioned extension export and JSON command expose snapshots; a webview controller supplies source-mapped selections. Consumers remain responsible for adopting the API.
**Tech stack:** TypeScript, stable VS Code 1.95+ APIs, Vditor, existing core source mapping and typed webview protocol, Vitest/Playwright.

Read [the research report](agent-editor-integration-research.md) before implementation. Planning context: CEO vision revision 3, `g-2026-trust`, `g-2026-ai`, `r-next-navigation-ai`. Preserve current unrelated edits and existing save/navigation work.

## File responsibilities

Create `src/integration/MarkdownStudioApi.ts` for public VS Code types, `src/integration/MarkdownStudioApiService.ts` for exports/commands, `src/runtime/EditorContextRegistry.ts` for panel lifecycle, `packages/core/src/sourceSelectionMapping.ts` for pure inverse mapping, and `packages/media/src/editor-context-controller.ts` for DOM events. Modify `src/extension.ts`, `src/runtime/ExtensionRuntime.ts`, `src/runtime/ActiveDocumentContext.ts`, `src/contracts/ports.ts`, `src/app/EditorPanel.ts`, `src/app/EditorMessageHandlers.ts`, `packages/core/src/editorProtocol.ts`, `packages/core/src/index.ts`, `packages/media/src/main.ts`, and `package.json` only as required to wire those responsibilities. Publish usage in `docs/extension-api.md`.

## API contract

Use extension ID `phfsantos.markdown-editor` and public API major version 1. The export is one object; the activity plan adds fields to this object when both features ship.

```ts
import type * as vscode from 'vscode';
export interface MarkdownStudioContext {
  readonly panelId: string;
  readonly uri: vscode.Uri;
  readonly documentVersion: number;
  readonly selection?: vscode.Range;
  readonly selectionStatus: 'exact' | 'unavailable';
}
export interface MarkdownStudioApiV1 {
  readonly apiVersion: 1;
  getActiveContext(): MarkdownStudioContext | undefined;
  readonly onDidChangeActiveContext: vscode.Event<MarkdownStudioContext | undefined>;
}
```

`getActiveContext` describes the active supported editor tab, not a random visible file. It clears for a different editor type and keeps the active editor tab while the user focuses chat/sidebar UI. Panel-switch events fire even for the same URI. Selection uses zero-based UTF-16 source coordinates; omit selection when unknown, stale, or outside the editable document. No raw full-document text or selected-text cache is broadcast; consumers read the shared `TextDocument` under their own context policies.

Register `markdown-editor.getActiveContext` returning a JSON snapshot with URI string and plain range positions; `undefined` means unavailable. Add `onCommand:markdown-editor.getActiveContext` activation so command callers can activate a cold extension. Direct exports work through `getExtension('phfsantos.markdown-editor')?.activate()`, followed by `apiVersion` checking. Do not require installing an AI extension or introducing a hard dependency on one. Exports/events are for compatible hosts; commands are the fallback for cross-host request/response. Cross-host push events are out of scope.

## Tasks

### 1. Establish an extension-host baseline [researcher · documentation]

Files: create `docs/testing/agent-editor-compatibility.md`; inspect `src/app/PreviewCustomEditorProvider.ts` without changing it unless a defect is reproduced. Exception: non-behavioral research documentation.

- [ ] Open one fixture Markdown file in source and custom tabs; record document URI/version, `activeTextEditor`, tab input kind/viewType/URI, tab/group events, and dirty state using a small disposable diagnostic command in a separate test extension.
- [ ] Test switching two custom tabs, two groups showing the same URI, closing an inactive duplicate, focus moving into chat, restored tabs, and remote URI authority. Use baseline VS Code 1.95 and a current stable release; record exact versions and unavailable environments explicitly.
- [ ] Compare built-in chat activity on source/custom tabs with badges enabled and compact tabs disabled; also test badges disabled. If an ordinary webview appears after disposed-panel recovery, capture its missing URI. Add any reproduced fix as a bounded regression task; do not assert native badge support from mocks alone.
- [ ] Record agent versions and whether file context comes from tabs, exports, or text-editor-only behavior. Do not guess command arguments or patch third-party bundles.

### 2. Make active context panel-aware [code · tdd]

Files: create registry and `test/editor-context-registry.test.ts`; modify runtime, ports, active-document adapter, and panel wiring listed above. The registry is the authority; legacy `ActiveDocumentEvents` becomes a projection for existing internal features.

- [ ] Add failing tests for panel A/B with one URI, close inactive A while B is active, switch Markdown to non-Markdown custom tab, close final tab, out-of-order view-state events, activation with restored tabs, and disposal twice.
- [ ] Run `yarn vitest run test/editor-context-registry.test.ts`; observe assertion failures before production code.
- [ ] Implement `registerPanel(panelId, document, panel)`, reconciliation against active tab/group plus panel active state, and disposal by panel identity. Use full URI identity including scheme/authority; never collapse to basename/fsPath. On async initialization, recheck actual active state before publishing.
- [ ] Re-run the focused test and `yarn vitest run test/extension-runtime.test.ts`; preserve existing navigation and sidebar behavior.

Example required regression (registry API named above; `fixture` constructs fake document/panels and emits tab events):

```ts
it('keeps B active when inactive A for the same URI closes', () => {
  const { registry, open, activate, close } = fixture();
  open('A', 'file:///notes/tasks.md');
  open('B', 'file:///notes/tasks.md');
  activate('B');
  close('A');
  expect(registry.getActiveContext()?.panelId).toBe('B');
});
```

### 3. Add source-accurate selection context [code · tdd; designer · design]

Files: create core mapper/controller and `packages/core/test/sourceSelectionMapping.test.ts`, `test/editor-context-controller.browser.test.ts`; modify core exports/protocol, message handlers and media bootstrap.

- [ ] Write pure mapping fixtures before implementing the mapper: `- [ ] **Ship**` has visible `Ship` at source characters 8–12; cover duplicate paragraphs, nested lists, Unicode surrogate pairs, CRLF, links, fenced blocks, multi-block selection, hidden syntax, and selection in widget/toolbar UI.
- [ ] Run `yarn vitest run packages/core/test/sourceSelectionMapping.test.ts` and observe failing assertions.
- [ ] Implement an explicit rendered-text-to-source projection with confidence. Do not invert `mapSourcePosition`'s nearest-match result. If unique exact source endpoints cannot be established, return `selectionStatus: 'unavailable'`; source-view mode may map directly. Report source range including intervening Markdown syntax for exact endpoints.
- [ ] Extend typed messages with `editor-context` carrying panel-scoped source revision, selection status and optional plain range. Validate finite non-negative integers, ordering, line/UTF-16 bounds, and current revision; clear selection on edits until remapped. Existing DOM cursor bookkeeping remains separate.
- [ ] Subscribe to DOM `selectionchange`, focus and document render updates; throttle context to at most one update per animation frame, suppress unchanged snapshots, and dispose subscriptions. Reject delayed messages from inactive/disposed panels. Never steal focus to publish context.
- [ ] Browser tests use real Vditor where source/DOM serialization matters; verify selecting `Ship` reports source 8–12 and selecting an icon reports unavailable. Run `yarn test:browser test/editor-context-controller.browser.test.ts` and the core focused test.

### 4. Publish exports and serializable context command [code · tdd]

Files: create API/service files and `test/markdown-studio-api.test.ts`; modify activation/runtime, `package.json`, and shared VS Code mock only for APIs under test.

- [ ] Write failing tests for cold activation, API version, snapshot immutability, context event delivery, no active document, command URI/range serialization, and cleanup; run `yarn vitest run test/markdown-studio-api.test.ts`.
- [ ] Return the API from `activate()` and make runtime own its lifetime. Register the command and explicit command activation; return no executable callbacks in JSON. Keep URI objects in the direct VS Code API.
- [ ] Re-run focused API/registry/runtime tests. Ensure the activity plan can add an optional API capability without changing existing fields or resetting registry state.

### 5. Document and verify adoption [qa · test-generation; researcher · documentation]

Files: create `docs/extension-api.md`, `test/fixtures/agent-context-consumer/extension.js`, and `test/fixtures/agent-context-consumer/package.json`; update compatibility report. The fixture consumes exports/events and command snapshots; it never opens a hidden source editor.

- [ ] Exercise the fixture in an Extension Development Host: activate provider, open custom tab A, select source-backed text, switch to custom tab B, then a non-Markdown editor. Assert the observed URI/range/context clearing against the report.
- [ ] Verify same-host exports and remote command fallback separately. Label unsupported transport combinations clearly. Include a user-invoked “copy file/range context” fallback; do not silently submit content to chat or call undocumented third-party commands.
- [ ] Document the consumer example, coordinate units, lifecycle and limitations. Prepare actionable upstream integration notes for Codex/Claude: use Tabs API URI fallback and optionally our API; sending those notes externally is separate work.
- [ ] Run `yarn test`, `yarn lint`, `yarn test:browser`, and `yarn build:extension`. Record exact results plus live-host evidence; no compatibility claim without a reproduced pass.

## Acceptance criteria

- [ ] Active document identity survives duplicate panels and focus changes and clears for unrelated editor tabs.
- [ ] Exact source ranges are demonstrated; ambiguous/stale selections are explicitly unavailable.
- [ ] A separate consumer extension reads context without opening a native text editor; command serialization works in its tested remote configuration.
- [ ] Documentation distinguishes stable support, proposed APIs, tested agents and adoption dependencies.
- [ ] Shared-document fidelity, source navigation and current runtime checks remain green.

Out of scope: impersonating native text-editor events, automatically controlling third-party chat, production proposed APIs, agent activity storage, MCP, and guaranteed automatic adoption by existing agents.
