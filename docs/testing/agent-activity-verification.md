# Agent activity implementation verification

Implemented for explicit cooperating producers in Markdown Studio API v1.
Activity is transient metadata, never a Markdown edit. API reference:
[extension-api.md](../extension-api.md#explicit-agent-activity-api-v1).

Verified on November 4, 2026 (America/Los_Angeles). Remaining environment checks
were exercised November 5; see the [compatibility matrix](agent-activity-compatibility-matrix.md)
for exact evidence, the remote URI fix, Save As semantics and external blockers.

## Tested behavior

The independent `agent-activity-consumer` extension uses only public exports and
serializable commands. The isolated ExTester runner builds extension/webview
production assets, packages a new VSIX, and installs it with the consumer and a
public-API driver into a temporary workspace/profile. It does not activate or
submit work to any AI service.

Observed host: VS Code **1.140.0**, macOS; Vditor **3.11.2**; provider **0.5.11**;
consumer fixture **0.0.1**. Runtime evidence lives in `.extest/activity/result.json`,
`.extest/activity/screenshots/`, and the runner's temporary `activity.json` report.

Verified in a real VS Code window:

- Cold JSON `startSession` activates the previously inactive provider, then ends
  cleanly before explicit API activation.
- Exported and JSON-command sessions show one indicator on the second of two
  identical tasks. The other checkbox remains undecorated.
- The native custom tab has a static `A` badge and the original resource URI,
  with no hidden native text editor. Dirty state, source text and document version
  remain unchanged when activity is reported.
- Badge settings disabled: native `A` disappears while status/header/checkbox
  fallbacks remain. Re-enabling restores the badge; the provider does not write settings.
- Two producers aggregate on one task. Clearing the command producer leaves
  the second producer and its indicator visible. Clear/dispose removes owned activity.
- Split and closed/reopened renderer subscriptions retain file activity.
- Inserting text above the target remaps its source line. Editing its checkbox
  invalidates the task projection while file activity remains.
- Rename clears old-URI reports; new URI requires an explicit producer report.
- Window reload clears reports. Stopping heartbeats clears the producer after
  its 120-second lease (tested within 125 seconds from heartbeat stop, including
  scheduling and UI polling tolerance).

Core/unit tests additionally cover session isolation and equal activity IDs,
input/size validation, 1000 activities/session, immutable snapshots, targeted
notifications, heartbeat renewal, expired/unknown/token-mismatched commands,
remote URI serialization, disposed-registry cleanup, task versions and source
identity, CRLF/Unicode, nested/checked tasks, overlapping/deleted/whole-document
edits, list-marker fences and unsupported container rejection. A 1000-session
simultaneous-expiry regression verifies synchronous subscribers do not recurse.
Shared-document closure invalidates task anchors while retaining file reports,
preventing reused version numbers from reviving stale anchors.

Real Chromium/Vditor tests verify overlay geometry among duplicate tasks,
producer coalescing, read-only views, rerendering, stale/malformed messages,
unsynchronized edit hiding, unchanged Markdown/selection/copy fragments/save
serialization, pointer-transparent mouse clicks, Vditor's Cmd/Ctrl+Shift+J task
toggle, real Vditor undo history, reduced-motion via CDP, and viewport widths
360/768/1280. Transient markup is defensively excluded from save sanitization.

## Compatibility boundaries

- Block quotes, HTML blocks and tab-indented containers use file-only activity;
  task anchors in those documents are rejected. Other unmappable render layouts
  hide checkbox projection. No nearest-line or label matching occurs.
- Vditor normalizes whitespace after checkboxes. Projection compares the actual
  serialization with the same Vditor instance's deterministic source roundtrip;
  original Markdown is never replaced by that normalization.
- Static badge priority relative to Git/native chat decorations is owned by
  VS Code. The follow-up matrix verifies compact sticky/Git fallbacks, separate-host
  URI command RPC, and Save As. Baseline 1.95 editor visuals and native chat badge
  competition remain explicitly blocked. JSON-only strings use receiver-host URI identity.
- No Codex/Claude/Copilot adapter or automatic agent discovery was implemented or
  verified. Installed agent extensions do not imply adoption of this API.
- Tokens scope command-session ownership; they are not an extension-host security
  boundary. Producer identity is attribution, not authentication.

The follow-up environment results are in the [compatibility matrix](agent-activity-compatibility-matrix.md); execution is tracked in
[plan-complete-agent-activity-compatibility-matrix](../../.projectmind/plans/plan-complete-agent-activity-compatibility-matrix.md).

## Review

Local review retained the activation-owned shared registry, stable string badge,
versioned protocol and out-of-editor overlays. Regression-driven corrections
cover ambiguous block parsing, synchronous expiry reentrancy and document
lifetime boundaries. External review was unavailable: automatic approval review
rejected sending private repository source to an unverified external reviewer.
No alternative external transmission was attempted.

## Reproduce

```sh
yarn test
yarn lint
yarn test:browser
yarn build:extension
MARKDOWN_UI_TOOLS=/path/to/extester/tools \
MARKDOWN_UI_CODE=/path/to/Code \
MARKDOWN_UI_DRIVER=/path/to/chromedriver \
node scripts/activityUiTest.mjs
```

Use `--skip-setup` only when the currently installed VSIX was built from unchanged
production source. The isolated test harness may write badge settings in its own
profile to exercise the settings-off scenario.

## Final command results

| Gate | Result |
| --- | --- |
| `yarn test` | Passed type checks; core 91/6 files, root 628/70 files, widgets 35/4 files. Root includes core, so these counts are not additive. |
| `yarn lint` | Passed. |
| `yarn test:browser` | Chromium 146/13 files passed, including six activity browser scenarios. |
| `yarn build:extension` | Passed as part of fresh UI VSIX packaging. |
| `yarn --cwd packages/media build` | Passed as part of fresh UI VSIX packaging. |
| Real VS Code activity suite | Seven-scenario full run including 120-second expiry passed; final fresh VSIX run passed eight scenarios (cold activation and rename added, long expiry excluded because just verified separately). |
| `git diff --check` | Passed. |

The final host report records VS Code 1.140.0 and zero failures. There are no
proposed APIs in the manifest. The November 5 matrix supersedes this earlier
environment snapshot: remote URI command RPC, compact sticky/Git fallbacks and
Save As were exercised; baseline editor visuals and native chat competition remain
blocked. No third-party agent compatibility claim is made.

Screenshots from the final fresh VSIX run:

- [Second duplicate checkbox, native A badge and status](artifacts/agent-activity/activity-exports-second-checkbox.png)
- [Badge setting disabled with header/status fallback](artifacts/agent-activity/activity-badges-disabled-fallback.png)
- [Split/reopened custom tabs](artifacts/agent-activity/activity-split-reopened.png)

## Files changed

| File |
| --- |
| [package.json](../../package.json) |
| [src/integration/AgentActivityRegistry.ts](../../src/integration/AgentActivityRegistry.ts) |
| [src/integration/AgentActivityApi.ts](../../src/integration/AgentActivityApi.ts) |
| [src/integration/AgentActivityDecorations.ts](../../src/integration/AgentActivityDecorations.ts) |
| [src/integration/MarkdownStudioApi.ts](../../src/integration/MarkdownStudioApi.ts) |
| [src/integration/MarkdownStudioApiService.ts](../../src/integration/MarkdownStudioApiService.ts) |
| [src/runtime/ExtensionRuntime.ts](../../src/runtime/ExtensionRuntime.ts) |
| [src/app/EditorPanel.ts](../../src/app/EditorPanel.ts) |
| [packages/core/src/taskAnchorMapping.ts](../../packages/core/src/taskAnchorMapping.ts) |
| [packages/core/src/editorProtocol.ts](../../packages/core/src/editorProtocol.ts) |
| [packages/core/src/index.ts](../../packages/core/src/index.ts) |
| [packages/core/test/taskAnchorMapping.test.ts](../../packages/core/test/taskAnchorMapping.test.ts) |
| [packages/media/src/agent-activity-controller.ts](../../packages/media/src/agent-activity-controller.ts) |
| [packages/media/src/agent-activity.css](../../packages/media/src/agent-activity.css) |
| [packages/media/src/main.ts](../../packages/media/src/main.ts) |
| [packages/media/src/utils.ts](../../packages/media/src/utils.ts) |
| [test/agent-activity-registry.test.ts](../../test/agent-activity-registry.test.ts) |
| [test/agent-activity-api.test.ts](../../test/agent-activity-api.test.ts) |
| [test/agent-activity-decorations.test.ts](../../test/agent-activity-decorations.test.ts) |
| [test/agent-activity-protocol.test.ts](../../test/agent-activity-protocol.test.ts) |
| [test/agent-checkbox-activity.browser.test.ts](../../test/agent-checkbox-activity.browser.test.ts) |
| [test/mocks/vscode.ts](../../test/mocks/vscode.ts) |
| [test/service-ownership.test.ts](../../test/service-ownership.test.ts) |
| [test/fixtures/agent-activity-consumer/extension.js](../../test/fixtures/agent-activity-consumer/extension.js) |
| [test/fixtures/agent-activity-consumer/package.json](../../test/fixtures/agent-activity-consumer/package.json) |
| [test/ui/activity-driver/extension.js](../../test/ui/activity-driver/extension.js) |
| [test/ui/activity-driver/package.json](../../test/ui/activity-driver/package.json) |
| [test/ui/agentActivity.test.cjs](../../test/ui/agentActivity.test.cjs) |
| [scripts/activityUiTest.mjs](../../scripts/activityUiTest.mjs) |
| [docs/extension-api.md](../../docs/extension-api.md) |
| [docs/testing/agent-editor-compatibility.md](../../docs/testing/agent-editor-compatibility.md) |
| [docs/testing/agent-activity-verification.md](../../docs/testing/agent-activity-verification.md) |
| [plans/do/agent-activity-checkbox-api.md](../../plans/do/agent-activity-checkbox-api.md) |

Open **Source Control** (`Ctrl/Cmd+Shift+G`) to review each diff.
