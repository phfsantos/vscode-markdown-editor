# Markdown Studio: editor context and agent activity research

Research date: 2026-11-03. Deliverable: research and plans only; no runtime changes.

## Answer

Markdown Studio already uses the appropriate `CustomTextEditorProvider` and shared `TextDocument`. There is no stable API that makes a custom webview a native `TextEditor`, fires native selection events for it, or makes every agent consume it automatically. Other extensions can discover its file through `window.tabGroups` and `TabInputCustom.uri`. We should expose our richer selection/context and explicit agent activity through a versioned extension API, with serializable commands for integrations across extension hosts.

File activity badges are possible through `FileDecorationProvider`; checkbox spinners are possible inside our webview. Reliable agent identity, lifecycle, and task targeting require cooperation from the agent or an adapter. Editing a document is not evidence that a particular agent is working on a particular checkbox.

## Evidence boundary

Upstream source was inspected at VS Code commit `53d2211d37ea4112096159c6efb75d513c8d975e`. Links below pin that snapshot. The current public declarations and the `1.95.0` declarations were checked: Tabs, text documents, file decorations, extension exports, and `lm.registerTool` exist at our declared `^1.95.0` baseline. Presence in newer source does not prove availability in every released build. The installed VS Code app reports 1.115.0; the extension-host UI was not exercised during this research.

Copilot Chat 0.42.3 and 0.43.0 manifests were available locally and demonstrate extensive proposed-API use. No local Codex or Claude Code extension implementation was located in the checked `.vscode`/`.vscode-insiders` extension folders. Their current behavior and supported external contracts remain unverified; do not advertise compatibility from this report alone. Network source downloads went only into `/tmp/markdown-studio-vscode-research`.

## Opening a document is different from activating an editor

| Signal | What it represents | Consequence for Markdown Studio |
| --- | --- | --- |
| `workspace.onDidOpenTextDocument` | Text model loaded, or language changed | Our shared Markdown document participates; switching to an already loaded document does not emit a new open event. |
| `workspace.onDidChangeTextDocument` | Shared document content/state changed | Applies to edits from our editor and other clients; does not identify the editing extension. |
| `window.onDidChangeActiveTextEditor` / `onDidChangeVisibleTextEditors` | Native code editor instances | A custom webview does not create one. |
| `window.onDidChangeTextEditorSelection` | A native text editor's selection | DOM selections in our webview do not produce this event. |
| `window.tabGroups.onDidChangeTabs` / `onDidChangeTabGroups` | Workbench tabs and groups | Works for custom tabs; inspect `activeTab.input instanceof TabInputCustom`, `uri`, and `viewType`. Subscribe to both and read initial state. |
| `WebviewPanel.onDidChangeViewState` / `onDidDispose` | Our panel's active/visible state and lifetime | Useful internally; can be exposed through our own API. |
| `onCustomEditor:markdown-editor` | Extension activation when our custom editor opens | VS Code handles custom-editor activation from the contribution on supported versions; this does not notify every other extension. |

Source: [`mainThreadDocumentsAndEditors.ts`](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vs/workbench/api/browser/mainThreadDocumentsAndEditors.ts), [`mainThreadEditorTabs.ts`](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vs/workbench/api/browser/mainThreadEditorTabs.ts), and [custom editor guide](https://code.visualstudio.com/api/extension-guides/custom-editors). The first source computes public text-editor state from code-editor instances. The second explicitly maps custom editor inputs into tab inputs containing the resource and view type.

Consumer-side fallback using stable APIs:

```ts
function activeResource(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined; // Define separate policies for diff/notebook/other tabs.
}
const listeners = [
  vscode.window.tabGroups.onDidChangeTabs(() => refresh(activeResource())),
  vscode.window.tabGroups.onDidChangeTabGroups(() => refresh(activeResource())),
];
refresh(activeResource());
// `refresh` is the consuming extension's context updater; dispose listeners on shutdown.
```

Prefer the active tab over an arbitrary visible/last text editor when deciding which file the user is viewing. Opening a hidden companion source editor, stealing focus, mutating VS Code exports, or manufacturing native events is not a supported solution. Opening the real source editor can remain an explicit user action.

## Built-in chat and proposed context/navigation APIs

VS Code's [`chatImplicitContext.ts`](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vs/workbench/contrib/chat/browser/attachments/chatImplicitContext.ts) observes workbench editor changes, native selections/scrolling, and webview messages. Its webview path asks the chat context service for provider context. This does not imply every custom editor is automatically included, and another visible native editor can influence the selected context. Settings and ignored-file policies also matter.

The [`chatContextProvider` proposal](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vscode-dts/vscode.proposed.chatContextProvider.d.ts) includes `chat.registerChatTabContextProvider`, with a `{ viewType: 'markdown-editor' }` selector and tab-based context. It is a promising future bridge for built-in chat, not a stable Marketplace dependency and not a universal Codex/Claude integration.

The [`customTextEditorNavigation` proposal](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vscode-dts/vscode.proposed.customTextEditorNavigation.d.ts) adds `resolveCustomTextEditorNavigation`, per-panel selection events, reveal-range, and capture/restore view state. It targets Outline/breadcrumb/navigation integration. It does not promise to turn the panel into `window.activeTextEditor` or deliver its selection to every agent. Reuse our planned context/navigation model if this proposal stabilizes.

VS Code documents [proposed API restrictions](https://code.visualstudio.com/api/advanced-topics/using-proposed-api). Do not enable proposals in the production plan or bypass runtime gates with casts.

## Native “agent is editing” indicators

[`ChatDecorationsProvider` in `chatEditingServiceImpl.ts`](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingServiceImpl.ts) observes chat edit sessions. For resources currently being modified, it returns an internal loading icon with the spin modifier; pending changes get a modified icon. This is private workbench state, not a public event stream.

[`multiEditorTabsControl.ts`](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vs/workbench/browser/parts/editor/multiEditorTabsControl.ts) renders file decorations using the editor's resource. [`CustomEditorInput`](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vs/workbench/contrib/customEditor/browser/customEditorInput.ts) preserves that resource. Therefore existing URI-based chat decorations should be eligible for our custom tabs too. This is a source-based inference requiring UI verification, not a newly observed pass.

First compare source/custom tabs for the same URI, badge settings (`workbench.editor.decorations.badges`), compact sticky tabs, and decoration competition. Our `PreviewCustomEditorProvider` has a disposed-panel recovery branch that creates an ordinary `createWebviewPanel`; inspect this because such a panel loses the custom tab's resource identity. If reproduced, recover through custom-editor resolution rather than creating an unbound replacement.

Stable [`FileDecoration`](https://code.visualstudio.com/api/references/vscode-api#FileDecoration) accepts a short string badge, tooltip, and theme color. Use a static `A` badge plus tooltip for activity we own; honor VS Code's settings and keep an in-editor/status-bar fallback. There is no public API to query all other extensions' decorations or subscribe to their activity. A provider publishes its own metadata.

The [`codiconDecoration` proposal](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vscode-dts/vscode.proposed.codiconDecoration.d.ts) permits `ThemeIcon` badges. [`extHostDecorations.ts`](https://github.com/microsoft/vscode/blob/53d2211d37ea4112096159c6efb75d513c8d975e/src/vs/workbench/api/common/extHostDecorations.ts) explicitly gates non-string badges on that proposal. A literal `$(loading~spin)` string is not the stable solution for an animated file badge. A status-bar item can use its supported icon syntax; our webview can animate its own spinner.

## Repository findings

- `src/extension.ts` registers `CustomTextEditorProvider` with multiple panels per document, but `activate()` currently returns no public integration API.
- `src/runtime/ActiveDocumentContext.ts` owns an internal event. It uses native-editor visibility heuristics and URI-only equality; it cannot distinguish two panels showing one URI or reliably model all focus transitions.
- `src/app/EditorPanel.ts` publishes the document on activation and clears by URI on disposal. Closing an inactive duplicate panel can therefore affect another panel's context; make panel identity explicit and regression-test it.
- `src/app/EditorMessageHandlers.ts` accepts `cursorPosition`; `packages/media/src/cursor-manager.ts` calculates positions from DOM text. Those are not proven Markdown source ranges. Existing `sourcePositionMapping.ts` maps source to rendering, not an exact general inverse.
- `src/app/chatEditingDiff.ts` matches private `chat-editing-*` documents for pending diff display. This is compatibility glue, not a supported agent lifecycle or agent identity API. Do not extend it into task activity inference.
- `DocumentSyncController.ts` and `DocumentWriteOriginTracker.ts` already coordinate shared-document synchronization. Preserve their ownership; activity decorations must never become edits or alter save/undo behavior.
- Existing line mapping, source navigation, typed message parsing, and real-Vditor browser tests are useful infrastructure. Checkbox anchors need stricter matching than nearest-line navigation.

## Feasibility and delivery order

| Request | Feasibility | Delivery |
| --- | --- | --- |
| Agents notice the open Markdown file | Stable Tabs API already exposes URI; universal adoption requires consumer changes | [Context plan](agent-editor-context-api.md), then verified adapters/upstream integration requests |
| Agents receive the selected source range | Feasible through our API after exact source mapping | Context plan; report unavailable rather than invent coordinates |
| Existing native chat tab badges appear | Likely already eligible through resource identity | Diagnostic spike first; repair only reproduced resource/lifecycle defects |
| We detect arbitrary agents working | No generic stable observer | Explicit activity reporting by cooperating extensions |
| We mark files as active | Stable static badge, tooltip, status bar/header | [Activity and checkbox plan](agent-activity-checkbox-api.md) |
| A specific checkbox spins | Feasible with an explicit source task target | Activity plan; transient render-only overlay |
| Native animated badge from our extension | Proposed API only in inspected source | Defer production use; use stable fallback |
| MCP | Possible as a later adapter | VS Code API/commands first; MCP does not fix native editor events |

The two implementation plans can ship separately. The activity plan does not require selection context: producers supply explicit resource/task targets. Use stable [`lm.registerTool`](https://code.visualstudio.com/api/extension-guides/ai/tools) only as a later adapter to the same service if useful; registering a tool does not force models or third-party clients to call it.

## Research completion

Verified by source inspection: event boundaries, public API baseline, private native chat decorations, proposed API gates, and repository integration points. Not performed: product implementation, live extension-host compatibility testing, or full runtime tests. Existing unrelated workspace changes were preserved. Implementation acceptance criteria remain in the two plans.
