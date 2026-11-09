# Agent/editor context compatibility evidence

Recorded 2026-11-03; updated 2026-11-04 for [the context API plan](../../plans/do/agent-editor-context-api.md).
The implementation's automated assertions and an actual VS Code Development Host
run provide different evidence. This report does not claim automatic adoption by
Codex, Claude Code, Copilot Chat, or built-in chat.

## Activity compatibility follow-up (2026-11-05)

The [activity compatibility matrix](agent-activity-compatibility-matrix.md) records
real compact sticky/Git, Save As, and separate browser-worker/Node-host activity
checks. Command updates now accept a real `vscode.Uri` for host translation;
JSON-only strings retain receiver-host identity. Baseline 1.95 activity contract
checks pass, while document opening stalls before task/editor visuals. Native
chat decoration competition remains unavailable in the isolated profile.
Save As requires a fresh report for the new URI and preserves a valid report for
the unchanged original; no automatic activity transfer or agent adoption occurs.

## Context API outcome (2026-11-04)

All five API acceptance criteria are now verified. A packaged VS Code1.140
ExTester run passed six real-window checks, including exact source selection,
chat focus, badge settings and restored custom tabs. A browser-worker consumer
reached a real remote Node provider, preserved remote URI authority and selected
source range, and cleared context for an unrelated tab. That run exposed and
verified the URI object transport fix. Full evidence, negative assertion proof,
reproduction commands, log warnings and the partial1.95 outcome are in
[Context API real-host verification](context-api-ui-tests.md).

The remaining sections preserve the original November3 evidence. Statements
about unavailable runs below describe that earlier snapshot; the latest report
above is authoritative for completed remote/UI cases. Full1.95 editor behavior
and native AI-edit badge appearance remain unverified, with explicit reasons.

## Available environments and observed limits

| Environment | Evidence gathered | Live result |
| --- | --- | --- |
| Installed local stable VS Code | `1.115.0`, commit `41dd792b5e652393e7787322889ed5fdc58bd75b`, x64; read from installed product/package metadata and confirmed by the app's `bin/code --version` | Local diagnostic probe passed outside the execution sandbox: host exit `0`, 38 events and six checkpoints. Source/custom identity, duplicate groups, inactive duplicate closure, Explorer focus and final closure observed. See results below. |
| Required baseline VS Code `1.95.0` | Research directory contains `1.95.0-vscode.d.ts`; local `.vscode-test` directory absent | No baseline executable found in checked locations; not run. Declarations prove type availability, not runtime behavior. |
| Existing remote server installations | `1.142.0-insider`, `1.143.0-insider`, `1.144.0-insider`, `1.145.0-insider` metadata under `.vscode-server-insiders/bin` | These are preview server installations. No controlled remote Development Host/remote workspace session was available to the diagnostic fixture. Remote transport not run. |
| Headless browser tests | Repository uses Vitest with Playwright Chromium | Can verify Vditor/source mapping. Cannot establish VS Code native tab resource identity, decorations, chat context, or cross-host transport. See the execution work record for test results. |

The launch ran with separate temporary user-data and extensions directories and
both the provider and diagnostic extension as development extensions. The first
attempt inside the execution sandbox exited `134` before reaching the runner.
The same isolated launch outside the sandbox then completed successfully. The
available tools did not expose a VS Code workbench UI automation surface; this
probe runs through the real extension host's stable APIs. No third-party
extension bundles were edited.

Installed extension manifests were inspected only to identify versions:

| Location | Extension | Versions present | Adoption observed |
| --- | --- | --- | --- |
| Local `.vscode/extensions` | `GitHub.copilot-chat` | `0.42.3`, `0.43.0` | Not tested; manifest presence does not establish which version is active. |
| Remote `.vscode-server-insiders/extensions` | `Anthropic.claude-code` | `2.1.310`, `2.1.312`, `2.1.314`, `2.1.316`, `2.1.317` | Not tested. |
| Remote `.vscode-server-insiders/extensions` | `openai.chatgpt` | `26.1021.22027` | Not tested. |

These are installed versions, not a claim about current upstream releases. No
agent was observed consuming tabs, extension exports, or native-editor events.
Record the active version and observed context source during each actual run.

## Disposable diagnostic extension

[`test/fixtures/agent-context-diagnostic`](../../test/fixtures/agent-context-diagnostic)
is a separate extension using stable APIs. It subscribes to document, native
selection, tab, and tab-group events. Every entry includes full URI identity,
document version/dirty state, native editor visibility, input kind/view type,
active group, all tabs, and relevant badge/tab sizing settings. It records no
document content. Output stays in a bounded in-memory log and an output channel;
only the explicit **Copy Event Log** command writes to the clipboard. Review
resource paths before sharing the result.

Build the provider first with `yarn build:extension` and the normal repository
webview build if its assets are absent. Then launch an isolated Development Host
using your VS Code executable, passing these arguments (replace the repository
and temporary directory paths):

```sh
code --new-window \
  --user-data-dir=/tmp/markdown-studio-context-user \
  --extensions-dir=/tmp/markdown-studio-context-extensions \
  --skip-welcome --skip-release-notes \
  --extensionDevelopmentPath=/absolute/path/to/vscode-markdown-editor \
  --extensionDevelopmentPath=/absolute/path/to/vscode-markdown-editor/test/fixtures/agent-context-diagnostic
```

Use **Markdown Studio Diagnostic: Record Snapshot** at each checkpoint, then
**Markdown Studio Diagnostic: Copy Event Log** to export the trace. Avoid opening
the output channel during focus checks because it changes focus. The fixture
records `activation` immediately and subscribes before the manual steps.

The same fixture has a VS Code extension test entry point, `probe.js`, for local
source/custom switching, duplicate groups, closing an inactive duplicate, sidebar
focus, another Markdown file, an unrelated source file, and closing all tabs. It
now also activates the independent consumer and compares its exports, command,
and event observations to the provider. Add
`--extensionTestsPath=/absolute/path/to/vscode-markdown-editor/test/fixtures/agent-context-diagnostic/probe.js`
and
`--extensionDevelopmentPath=/absolute/path/to/vscode-markdown-editor/test/fixtures/agent-context-consumer`,
then set `MARKDOWN_STUDIO_DIAGNOSTIC_OUTPUT` to an absolute JSON report path. It
creates a temporary Markdown fixture and runs only in the isolated host. It does
not verify badges, agent context, restored tabs, remote authority, or DOM ranges.

Original metadata-only command (this machine, before adding consumer assertions):

```sh
MARKDOWN_STUDIO_DIAGNOSTIC_OUTPUT=/private/tmp/markdown-studio-context-baseline-report.json \
env -u ELECTRON_RUN_AS_NODE \
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron' \
  --new-window \
  --user-data-dir=/private/tmp/markdown-studio-context-baseline-user \
  --extensions-dir=/private/tmp/markdown-studio-context-baseline-extensions \
  --skip-welcome --skip-release-notes --disable-updates --disable-workspace-trust \
  --extensionDevelopmentPath=/Users/pedrosantos/www/vscode-markdown-editor \
  --extensionDevelopmentPath=/Users/pedrosantos/www/vscode-markdown-editor/test/fixtures/agent-context-diagnostic \
  --extensionTestsPath=/Users/pedrosantos/www/vscode-markdown-editor/test/fixtures/agent-context-diagnostic/probe.js
```

Results: inside-sandbox exit `134` with no output/report; approved outside-sandbox
retry exit `0`. The retry produced
`/private/tmp/markdown-studio-context-baseline-report.json`, with 38 event entries,
six checkpoint snapshots and no `failure` field. Host initialization at
`2026-11-03T23:00:34Z` and test completion at `23:00:42Z` were recorded in the
process output. This is a successful local metadata baseline. JavaScript syntax
validation passed with `node --check` for both fixture files.

## Observed local baseline

The fixture resource was
`file:///var/folders/8f/978wxslx0flgmr5j6ln2bgcj1s4x3l/T/markdown-studio-context-baseline-qswUxr/tasks.md`.
Every checkpoint retained the same shared document, version `1`, language
`markdown`, and clean state. Settings were `decorations.badges=true` and
`tabSizing=fit`; native badge rendering was not inspected.

| Checkpoint | Actual observation |
| --- | --- |
| `probe-source` | Source tab active in group 1. `activeTextEditor` and the single visible native editor identify the fixture URI. |
| `probe-custom` | Custom tab active in group 1, URI exactly matches the fixture and `viewType=markdown-editor`. These two fields were asserted by the probe. `activeTextEditor` is undefined and `visibleTextEditors=[]`. The explicitly opened source tab remains inactive. |
| `probe-duplicate` | Groups 1 and 2 each contain a custom tab for the same full URI, with group 2 active. The probe asserted an inactive duplicate exists using `instanceof vscode.TabInputCustom`. No native editor is visible. |
| `probe-close-inactive-duplicate` | Group 1's inactive custom tab is closed. Group 2 retains the active custom tab and full URI. The explicitly opened source tab becomes visible in inactive group 1; it does not become `activeTextEditor`. This demonstrates why visible-native-editor heuristics are insufficient. |
| `probe-sidebar-focus` | After the stable Explorer-focus command, group 2's custom tab remains the active tab with the same full URI. `activeTextEditor` remains undefined. Actual chat focus was not exercised. |
| `probe-close-all` | All groups contain no tabs; native active/visible editors are absent. The shared text document remains loaded, illustrating that document presence is not active-editor identity. |

The event trace contains document-open, active/visible native-editor, tab, and
tab-group notifications. The diagnostic's raw `constructor.name` values are
minified by the installed host (`od` for source and `rd` for custom); the custom
classification is established by its typed `instanceof` assertion and resource
fields, not by interpreting those constructor names. No hidden native editor
was opened by the provider during these observed checkpoints. The probe itself
explicitly opened the source tab for comparison.

These observations do not assert public API context delivery or source-range
accuracy; the independent consumer and browser checks provide separate evidence.
Subsequent log inspection also found two `FAILED to handle event` entries on
final closure in this first metadata run. Its exit-zero assertion result must
therefore be read together with the host-error limitation below.

## Observed same-host API and independent consumer

The extended probe ran against the rebuilt provider and webview assets in a
second isolated VS Code `1.115.0` Development Host at
`2026-11-03T23:02:31Z`–`23:02:40Z`. The command above used separate
`/private/tmp/markdown-studio-context-api-user` and
`/private/tmp/markdown-studio-context-api-extensions` directories, a report path
of `/private/tmp/markdown-studio-context-api-report.json`, and the additional
consumer development-extension path described above.

The test runner exited `0`, recording 54 metadata events and eight successful
context assertion checkpoints. It asserted `apiVersion === 1` and a real
`vscode.Uri` in direct exports. At every checkpoint it compared the provider's
direct snapshot with its serializable command result and the independent
consumer's `assertContext` command through both exports and command transports.

| Context assertion | Result |
| --- | --- |
| Native source tab | Provider and consumer context unavailable. |
| First custom tab | Correct full file URI, nonempty panel ID, document version `1`. |
| Duplicate custom tab | Same URI/version, different panel ID. |
| Close inactive duplicate | Active duplicate panel ID retained. |
| Explorer focus | Active duplicate panel ID retained. |
| Different custom Markdown file | Correct second URI and a third distinct panel ID. |
| Unrelated `.txt` native source tab | Context unavailable. |
| Final closure | Context unavailable. |

The provider and consumer both delivered events for all three panel IDs and
context clearing. Intermediate unavailable events occurred while switching
panels. Every observed selection was `unavailable`; no DOM range was selected.
The consumer opens no native source editor; only the diagnostic probe explicitly
opened source tabs for comparison and the unrelated-tab check.

`providerWasActiveBeforeProbe` was `false`, followed by explicit provider
`activate()` in this first consumer run. Cold command activation was tested
separately in the final run below.

**Host error limitation:** although all context assertions passed, the host
logged three `ExtensionError: ... FAILED to handle event` entries and an
`Error: Webview is disposed` during the final rapid tab transitions. The latter
stack reads a webview's `visible` property in a timer at
`dist/extension.js:480:5389`. The full log is
`/private/tmp/markdown-studio-context-api-user/logs/20261103T150231/window1/exthost/exthost.log`.
These errors prevent treating this first run as a clean release gate. They were
investigated and the rerun below verifies the disposal correction. No ordinary recovery webview
with a missing URI was observed in the captured metadata; that specific recovery
case remains unverified.

### Final rerun after lifecycle correction

The provider was rebuilt with disposed-panel accessor guards and cancelled
panel-owned timers. The same independent-consumer probe ran again at
`2026-11-03T23:05:06Z`–`23:05:14Z`, using fresh temporary directories
`/private/tmp/markdown-studio-context-api-final-user` and
`/private/tmp/markdown-studio-context-api-final-extensions`. The report is
`/private/tmp/markdown-studio-context-api-final-report.json`.

Results on VS Code `1.115.0`: host exit `0`, no report failure, eight context
assertion checkpoints, 54 metadata events, six provider events and 23 independent
consumer observations. All comparisons and event assertions described above
passed again. Before any provider activation or document opening, the provider
was inactive; executing `markdown-editor.getActiveContext` returned `undefined`
and activated it. The report records
`coldCommandActivation={tested:true,initialContextUnavailable:true,providerActivated:true}`.
Direct API activation and usage were then verified on the activated provider.

The new logs under
`/private/tmp/markdown-studio-context-api-final-user/logs/20261103T150505/`
were inspected for extension errors. No `FAILED to handle event`,
`Webview is disposed`, unknown-error, or extension-host error entries remained.
The renderer log retained a Node `punycode` deprecation warning, and process
stderr included a Chromium `MojoAudioOutputIPC failed to acquire factory`
message. Neither caused a context assertion failure; this was not an audio
feature test. The prior disposed-panel errors were not reproduced in this final
run. This closes the local lifecycle/context-consumer checks without establishing
remote transport or real-agent adoption.

## Required live matrix

Repeat this matrix on baseline `1.95.0` and a current stable version. Record exact
host/agent versions, remote type/authority, badge settings, checkpoint trace, and
observed chat attachment/badge UI. Only the local metadata subset documented
above ran here; the remaining UI/agent/transport cases remain **not run**.

| Scenario | Procedure and observations to record |
| --- | --- |
| Source/custom identity | Open `tasks.md` containing `- [ ] **Ship**` in source, record a snapshot; reopen with Markdown Studio, record again. Compare full URI, version, dirty state, native editor and `TabInputCustom` view type. Opening the custom tab must not create a hidden native source editor. |
| Different documents | Open custom A and B, switch in each direction. Compare active-tab URI and context export/command. |
| Duplicate URI | Split the same custom file into groups A and B, activate B, close inactive A. The public context must still identify B. Repeat with differing full remote authorities and matching basenames. |
| Focus | Keep a custom tab active, focus Explorer and then an actual agent/chat view. Record tab state before/after and inspect the agent's visible file context. Do not infer agent support from the provider API alone. |
| Unrelated tabs/final close | Activate a non-Markdown custom tab, source tab and an ordinary webview, then close the last supported custom tab. Record when provider context clears; a different editor type must not inherit the prior selection. |
| Restore | Reload the isolated window with two custom groups restored. Compare initial tab state to the first provider context and later panel initialization. |
| Exact range | Select visible `Ship` in real Vditor. Inspect provider context: source line `0`, UTF-16 characters `8`–`12`. Select toolbar/widget UI and edit the source; stale/ambiguous ranges must be unavailable. |
| Native chat decoration | With `workbench.editor.decorations.badges=true` and compact tab sizing disabled, initiate a user-authorized chat edit on a disposable fixture. Compare source/custom badges for the same URI. Repeat with badges disabled. Record screenshots/settings and competing decorations. |
| Disposed-panel recovery | If the provider's disposed-panel recovery is reached naturally, record tab input kind, view type and URI before/after. Report an ordinary webview with missing resource URI if reproduced. Do not force a production patch from source suspicion alone. |
| Same-host consumer | Passed on installed stable `1.115.0` with the assertions described above. Repeat on baseline `1.95.0`; verify exports/events while switching A → B → unrelated tab and no hidden native editor appears. |
| Remote command fallback | In an actual remote workspace, place the consumer/provider in separate hosts where supported. Invoke the command, retain the complete `vscode-remote://authority/path` string, and compare source range/version to same-host output. Record unsupported transport combinations explicitly. |

## Source inspection and interpretation

`src/app/PreviewCustomEditorProvider.ts` currently has a recovery branch for
`Error('Webview is disposed')` that calls `window.createWebviewPanel`. An ordinary
webview does not carry a custom text editor's document resource contract. This
is a source-inspection concern; the recovery branch was not reproduced in a live
host, so this task made no provider fix and makes no native badge claim.

Stable Tabs API URI discovery, extension exports/events, and command snapshots
are cooperation mechanisms. The research report separately identifies proposed
chat-context/navigation APIs; those are not production dependencies. A consumer
must adopt tabs or the API. No unconditional compatibility claim follows from
this implementation or from the installed agent manifests.

## Remaining release evidence at the November 3 snapshot

Baseline `1.95.0`, native chat/badge comparisons, restored-tab behavior, and the
independent consumer's remote transport remain unverified. The installed stable
`1.115.0` local metadata, cold command activation and same-host consumer
assertions passed as recorded above; the final run no longer reproduced the
disposed-panel errors.
Keep the corresponding plan steps/criteria open until a controlled live run
produces evidence. Automated regression results belong in the implementation
work record and must not be substituted for these UI/transport observations.

## Final automated implementation gates (2026-11-03)

All commands completed with exit code zero after review fixes:

| Command | Fresh result |
| --- | --- |
| `yarn test` | Type checks passed; core 85 tests / 5 files; root unit/coverage 608 tests / 65 files; widgets 35 tests / 4 files. The root suite includes core tests; counts are not additive. |
| `yarn lint` | Passed. Removed a pre-existing unnecessary regex escape in widget command ID validation without changing its accepted characters. |
| `yarn test:browser` | Chromium: 140 tests / 12 files, including six real-Vditor context controller tests. |
| `yarn build:extension` | Production extension bundle passed. |
| `yarn --cwd packages/media build` | Production webview bundle/assets passed. |
| `git diff --check` | Passed. |

Real-Vditor assertions cover checkbox/bold `Ship` at source 8–12 without document
mutation, non-source UI, pending source edits, normalized duplicate text,
toolbar focus, toolbar typing recovery, and controller cleanup. Pure mapping and
registry tests cover UTF-16, CRLF, source bounds, stale revisions, duplicate
resources, disposal ordering, same-version save events, and conservative
unavailable results. The controller verifies the entire source/rendered block
projection in document order before publishing an exact range. These browser
checks do not substitute for an actual webview selection in a live VS Code host.

Local read-only review approved the final implementation with no unresolved
high/medium findings. An external Claude consultant was not used: automatic
approval review rejected sending the repository diff to that unverified external
destination. No source was transmitted through an alternative external route.

## Final November 4 release gates

Fresh `yarn test` passed type checks, core85/root609/widgets35 tests; `yarn lint`
and `yarn test:browser` passed (140 tests/12files). Production extension and media
builds and fresh runtime VSIX packaging passed. The real ExTester suite passed
6/6 and the separate real remote command/selection/clearing test passed.
Local read-only review approved the URI transport option, compatibility docs,
and fresh-install cleanup with no unresolved high/medium findings. All five API
acceptance criteria are verified, with the1.95/nativeAIbadge limitations above.

## Changed files

| File |
| --- |
| [.gitignore](../../.gitignore) |
| [.vscodeignore](../../.vscodeignore) |
| [docs/extension-api.md](../../docs/extension-api.md) |
| [docs/testing/agent-editor-compatibility.md](../../docs/testing/agent-editor-compatibility.md) |
| [docs/testing/context-api-ui-tests.md](../../docs/testing/context-api-ui-tests.md) |
| [package.json](../../package.json) |
| [packages/core/src/editorProtocol.ts](../../packages/core/src/editorProtocol.ts) |
| [packages/core/src/index.ts](../../packages/core/src/index.ts) |
| [packages/core/src/sourceSelectionMapping.ts](../../packages/core/src/sourceSelectionMapping.ts) |
| [packages/core/test/sourceSelectionMapping.test.ts](../../packages/core/test/sourceSelectionMapping.test.ts) |
| [packages/media/src/editor-context-controller.ts](../../packages/media/src/editor-context-controller.ts) |
| [packages/media/src/main.ts](../../packages/media/src/main.ts) |
| [plans/do/agent-editor-context-api.md](../../plans/do/agent-editor-context-api.md) |
| [scripts/uiBaselineTest.mjs](../../scripts/uiBaselineTest.mjs) |
| [scripts/uiRemoteTest.mjs](../../scripts/uiRemoteTest.mjs) |
| [scripts/uiTest.mjs](../../scripts/uiTest.mjs) |
| [src/app/EditorMessageHandlers.ts](../../src/app/EditorMessageHandlers.ts) |
| [src/app/EditorPanel.ts](../../src/app/EditorPanel.ts) |
| [src/app/widgetCommandPolicy.ts](../../src/app/widgetCommandPolicy.ts) |
| [src/contracts/ports.ts](../../src/contracts/ports.ts) |
| [src/extension.ts](../../src/extension.ts) |
| [src/integration/MarkdownStudioApi.ts](../../src/integration/MarkdownStudioApi.ts) |
| [src/integration/MarkdownStudioApiService.ts](../../src/integration/MarkdownStudioApiService.ts) |
| [src/runtime/ActiveDocumentContext.ts](../../src/runtime/ActiveDocumentContext.ts) |
| [src/runtime/EditorContextRegistry.ts](../../src/runtime/EditorContextRegistry.ts) |
| [src/runtime/ExtensionRuntime.ts](../../src/runtime/ExtensionRuntime.ts) |
| [test/agent-context-consumer.test.ts](../../test/agent-context-consumer.test.ts) |
| [test/editor-context-controller.browser.test.ts](../../test/editor-context-controller.browser.test.ts) |
| [test/editor-context-protocol.test.ts](../../test/editor-context-protocol.test.ts) |
| [test/editor-context-registry.test.ts](../../test/editor-context-registry.test.ts) |
| [test/fixtures/agent-context-consumer/extension.js](../../test/fixtures/agent-context-consumer/extension.js) |
| [test/fixtures/agent-context-consumer/package.json](../../test/fixtures/agent-context-consumer/package.json) |
| [test/fixtures/agent-context-diagnostic/extension.js](../../test/fixtures/agent-context-diagnostic/extension.js) |
| [test/fixtures/agent-context-diagnostic/package.json](../../test/fixtures/agent-context-diagnostic/package.json) |
| [test/fixtures/agent-context-diagnostic/probe.js](../../test/fixtures/agent-context-diagnostic/probe.js) |
| [test/fixtures/agent-context-remote-driver/extension.js](../../test/fixtures/agent-context-remote-driver/extension.js) |
| [test/fixtures/agent-context-remote-driver/package.json](../../test/fixtures/agent-context-remote-driver/package.json) |
| [test/markdown-studio-api.test.ts](../../test/markdown-studio-api.test.ts) |
| [test/mocks/vscode.ts](../../test/mocks/vscode.ts) |
| [test/ui/driver/extension.js](../../test/ui/driver/extension.js) |
| [test/ui/driver/package.json](../../test/ui/driver/package.json) |
| [test/ui/editorContext.test.cjs](../../test/ui/editorContext.test.cjs) |
| [test/ui/package.json](../../test/ui/package.json) |

Open **Source Control** (`Ctrl/Cmd+Shift+G`) to review each diff. The user-provided UI skill files are untouched.

## Explicit activity API verification (November 4, 2026)

The separate activity feature is now implemented and verified with an independent
producer extension. See [agent-activity-verification.md](agent-activity-verification.md)
for exact host versions, screenshots, source-fidelity/lifecycle regression tests,
release gates and untested environments. These are explicit producer reports;
this does not establish native chat activity observation or agent adoption.
