# Custom editor context API implementation plan

> Implementation delivered 2026-11-03. All API acceptance criteria verified; compatibility limitations are recorded in docs/testing/agent-editor-compatibility.md. This file remains the original execution specification.

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

- [x] Open one fixture Markdown file in source and custom tabs; record document URI/version, `activeTextEditor`, tab input kind/viewType/URI, tab/group events, and dirty state using a small disposable diagnostic command in a separate test extension.
- [x] Test switching two custom tabs, two groups showing the same URI, closing an inactive duplicate, focus moving into chat, restored tabs, and remote URI authority. Use baseline VS Code 1.95 and a current stable release; record exact versions and unavailable environments explicitly.
- [x] Compare built-in chat activity on source/custom tabs with badges enabled and compact tabs disabled; also test badges disabled. If an ordinary webview appears after disposed-panel recovery, capture its missing URI. Add any reproduced fix as a bounded regression task; do not assert native badge support from mocks alone.
- [x] Record agent versions and whether file context comes from tabs, exports, or text-editor-only behavior. Do not guess command arguments or patch third-party bundles.

### 2. Make active context panel-aware [code · tdd]

Files: create registry and `test/editor-context-registry.test.ts`; modify runtime, ports, active-document adapter, and panel wiring listed above. The registry is the authority; legacy `ActiveDocumentEvents` becomes a projection for existing internal features.

- [x] Add failing tests for panel A/B with one URI, close inactive A while B is active, switch Markdown to non-Markdown custom tab, close final tab, out-of-order view-state events, activation with restored tabs, and disposal twice.
- [x] Run `yarn vitest run test/editor-context-registry.test.ts`; observe assertion failures before production code.
- [x] Implement `registerPanel(panelId, document, panel)`, reconciliation against active tab/group plus panel active state, and disposal by panel identity. Use full URI identity including scheme/authority; never collapse to basename/fsPath. On async initialization, recheck actual active state before publishing.
- [x] Re-run the focused test and `yarn vitest run test/extension-runtime.test.ts`; preserve existing navigation and sidebar behavior.

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

- [x] Write pure mapping fixtures before implementing the mapper: `- [x] **Ship**` has visible `Ship` at source characters 8–12; cover duplicate paragraphs, nested lists, Unicode surrogate pairs, CRLF, links, fenced blocks, multi-block selection, hidden syntax, and selection in widget/toolbar UI.
- [x] Run `yarn vitest run packages/core/test/sourceSelectionMapping.test.ts` and observe failing assertions.
- [x] Implement an explicit rendered-text-to-source projection with confidence. Do not invert `mapSourcePosition`'s nearest-match result. If unique exact source endpoints cannot be established, return `selectionStatus: 'unavailable'`; source-view mode may map directly. Report source range including intervening Markdown syntax for exact endpoints.
- [x] Extend typed messages with `editor-context` carrying panel-scoped source revision, selection status and optional plain range. Validate finite non-negative integers, ordering, line/UTF-16 bounds, and current revision; clear selection on edits until remapped. Existing DOM cursor bookkeeping remains separate.
- [x] Subscribe to DOM `selectionchange`, focus and document render updates; throttle context to at most one update per animation frame, suppress unchanged snapshots, and dispose subscriptions. Reject delayed messages from inactive/disposed panels. Never steal focus to publish context.
- [x] Browser tests use real Vditor where source/DOM serialization matters; verify selecting `Ship` reports source 8–12 and selecting an icon reports unavailable. Run `yarn test:browser test/editor-context-controller.browser.test.ts` and the core focused test.

### 4. Publish exports and serializable context command [code · tdd]

Files: create API/service files and `test/markdown-studio-api.test.ts`; modify activation/runtime, `package.json`, and shared VS Code mock only for APIs under test.

- [x] Write failing tests for cold activation, API version, snapshot immutability, context event delivery, no active document, command URI/range serialization, and cleanup; run `yarn vitest run test/markdown-studio-api.test.ts`.
- [x] Return the API from `activate()` and make runtime own its lifetime. Register the command and explicit command activation; return no executable callbacks in JSON. Keep URI objects in the direct VS Code API.
- [x] Re-run focused API/registry/runtime tests. Ensure the activity plan can add an optional API capability without changing existing fields or resetting registry state.

### 5. Document and verify adoption [qa · test-generation; researcher · documentation]

Files: create `docs/extension-api.md`, `test/fixtures/agent-context-consumer/extension.js`, and `test/fixtures/agent-context-consumer/package.json`; update compatibility report. The fixture consumes exports/events and command snapshots; it never opens a hidden source editor.

- [x] Exercise the fixture in an Extension Development Host: activate provider, open custom tab A, select source-backed text, switch to custom tab B, then a non-Markdown editor. Assert the observed URI/range/context clearing against the report.
- [x] Verify same-host exports and remote command fallback separately. Label unsupported transport combinations clearly. Include a user-invoked “copy file/range context” fallback; do not silently submit content to chat or call undocumented third-party commands.
- [x] Document the consumer example, coordinate units, lifecycle and limitations. Prepare actionable upstream integration notes for Codex/Claude: use Tabs API URI fallback and optionally our API; sending those notes externally is separate work.
- [x] Run `yarn test`, `yarn lint`, `yarn test:browser`, and `yarn build:extension`. Record exact results plus live-host evidence; no compatibility claim without a reproduced pass.

## Acceptance criteria

- [x] Active document identity survives duplicate panels and focus changes and clears for unrelated editor tabs.
- [x] Exact source ranges are demonstrated; ambiguous/stale selections are explicitly unavailable.
- [x] A separate consumer extension reads context without opening a native text editor; command serialization works in its tested remote configuration.
- [x] Documentation distinguishes stable support, proposed APIs, tested agents and adoption dependencies.
- [x] Shared-document fidelity, source navigation and current runtime checks remain green.

Out of scope: impersonating native text-editor events, automatically controlling third-party chat, production proposed APIs, agent activity storage, MCP, and guaranteed automatic adoption by existing agents.

## November 3 execution evidence and remaining checks (historical)

Implementation, regression coverage, consumer fixture, API documentation, and
all automated release gates passed on 2026-11-03. An isolated VS Code 1.115.0
Development Host verified genuine cold command activation and eight checkpoints
across provider exports/events, JSON command, and the independent consumer,
including duplicate panels, inactive closure, Explorer focus, document switching,
and context clearing. A final rerun had no extension-host/disposed-panel errors.

The plan remains active: baseline 1.95, live remote command transport, chat/native
badges, restored tabs, actual agent adoption, and a live-host DOM source-range
check remain unverified. Exact DOM ranges are proven separately by real-Vditor
Chromium tests. See [the compatibility report](../../docs/testing/agent-editor-compatibility.md)
and [consumer API documentation](../../docs/extension-api.md) for reproduction
procedures, supported projection limits, and evidence boundaries.

## Final acceptance verification (2026-11-04)

All five API acceptance criteria are met. The remaining remote criterion exposed
and verified a real fix: callers across extension hosts use
`markdown-editor.getActiveContext({ uriFormat: 'object' })` through
`commands.executeCommand` and serialize the returned Uri after VS Code RPC;
default no-argument JSON is unchanged. An independent browser worker consumed
the remote Node provider, preserved the exact vscode-remote authority, obtained
real Vditor Ship selection 0:8–0:12, and observed unrelated-tab clearing.

The packaged VS Code1.140 ExTester suite passed six checks, including no hidden
native source editor, actual source selection, toolbar invalidation, document
switching, badge User settings on disk, built-inchatfocus without submission,
and custom-tab restoration after reload. A deliberately incorrect end offset13
failed with actual12, then correct expectations passed. Original release gates
were rerun successfully (types/core85/root609/widgets35; browser140; lint;
production extension/webview builds) and local review approved the URI fix.

Baseline research tasks are closed as evidence recording, including unavailable
cases, not as universal compatibility certification: official1.95 cold command,
API1 and consumer activation passed, but file opening stalled before any document
opened; full1.95 editor behavior remains unverified. Actual AI-edit badge
appearance and automatic Codex/Claude/Copilot adoption were not tested. The badge
settings/chatfocus checks do not establish those capabilities. These outcomes
and run procedures are in
[Context API real-host verification](../../docs/testing/context-api-ui-tests.md).
