# Agent activity compatibility matrix

Verified November 5, 2026 (America/Los_Angeles), using Markdown Studio 0.5.11,
Vditor 3.11.2 and independent cooperating fixture 0.0.1. These checks exercise
public APIs and commands; they do not establish adoption by installed AI agents.

## Environments and limits

| Environment | Setup and result | Evidence |
| --- | --- | --- |
| Baseline VS Code 1.95.0, macOS x64, commit `912bb683695358a54ae0c670461738984cbb5b95` | Cold activation, API v1, JSON file activity start/update/heartbeat/clear/end, exported session APIs pass. **Editor/task visuals blocked:** reproduced on a fresh profile. Narrowed to document opening after provider activation, even for plain text without activity calls. Provider-free control passes. | `node scripts/activityBaselineTest.mjs`, `--document-only`, and `--host-only`; diagnostic reports and host logs below. No editor/task screenshot or preservation claim is made for the blocked case. |
| VS Code 1.140.0, macOS x64, compact sticky tabs | Separate pinned native-text and custom-editor tabs use the same resource; actual built-in Git changes compete with activity. Header/status and exact checkbox projection remain available. | `scripts/activityUiTest.mjs`; screenshots below. |
| Native chat decoration competition, VS Code 1.140.0, commit `07f806f999227108933c2e30515b26eecc1fda74` | **Session prerequisite unavailable:** fresh disposable profile opens native Chat to an empty **Build with Agent** view with **Sign In** in the title bar. No authenticated edit session was supplied or created and no model requests were submitted. | Fresh prerequisite screenshot/report below. Actual decoration competition remains unverified; Git competition and command availability do not prove native chat decoration behavior. |
| User-assisted native Copilot session, VS Code 1.145.0-insider over SSH; Copilot Chat 0.73.2026102902 | **Working and clear pass alongside pending native Chat edits:** both visible `tasks.md` tabs, Open Editors and Explorer show `A` during activity; the active Markdown Studio editor shows the first-task indicator and working fallback. These clear while Chat retains **1 file changed / Keep / Undo**. Start and clear preserve source/disk hashes, version 1, dirty=false and inspected settings. | [Successful working report](artifacts/agent-activity-matrix/native-chat-145-working-report.json), [successful clear report](artifacts/agent-activity-matrix/native-chat-145-cleared-report.json), following the [initial failed helper report](artifacts/agent-activity-matrix/native-chat-145-failed-probe-report.json). User screenshots supplied in conversation; no retained screenshot files are claimed. |
| Separate browser worker → Node provider, VS Code server-web 1.115.0, commit `41dd792b5e652393e7787322889ed5fdc58bd75b` | Authenticated loopback workspace; browser producer uses remote URI authority, provider runs in a separate Node host. See URI transport distinction below. | `scripts/activityRemoteTest.mjs`; remote report/screenshots below. This does not establish SSH, WSL or Dev Container coverage. |

The automated isolated harnesses use temporary workspaces, profiles and extension directories.
Provider workspace placement in the remote harness is a disposable installation
setting; the production manifest is unchanged. AI features are disabled in those
automated profiles. The user-assisted Copilot case uses an enabled Chat session
and the disposable `test/markdown-activity-check` workspace.

## URI transport

The initial remote run reproduced a real defect: a browser's full
`vscode-remote://127.0.0.1:<port>/.../tasks.md` **string** reached Node unchanged,
where the document has a `file:` URI, and task update failed with
`Task document is unavailable`.

The update command now additionally accepts a real `vscode.Uri`. Stable VS Code
command RPC translates and revives it across hosts. The original string form
continues to represent exact receiving-host identity; arbitrary JSON URI-shaped
objects remain rejected. Do not strip remote authorities or reinterpret paths.
The browser fixture compares its full resource URI with
`getActiveContext({ uriFormat: 'object' })`, then uses real URI command arguments.
This proves command RPC compatibility, **not JSON-only remote-string translation**.
See [the API contract](../extension-api.md#explicit-agent-activity-api-v1).

## Reproduce

Build a fresh provider package with the UI runner after source changes:

```sh
MARKDOWN_UI_TOOLS=/path/to/extester-tools \
MARKDOWN_UI_CODE='/path/to/Visual Studio Code.app/Contents/MacOS/Code' \
MARKDOWN_UI_DRIVER=/path/to/matching/chromedriver \
node scripts/activityUiTest.mjs

node scripts/activityBaselineTest.mjs '/path/to/1.95/Visual Studio Code.app/Contents/MacOS/Electron'
# Control without Markdown Studio, then activated provider without activity calls:
node scripts/activityBaselineTest.mjs --host-only
node scripts/activityBaselineTest.mjs --document-only

VSCODE_WEB_SERVER_ROOT=/path/to/server-web \
VSCODE_PROVIDER_VSIX="$PWD/.extest/activity/markdown-studio.vsix" \
node scripts/activityRemoteTest.mjs
```

`--skip-setup` is valid only with an installed VSIX built from unchanged production
source. Local socket listeners and GUI launches require execution outside the
process sandbox on this machine. ChromeDriver and the Code binary must match.
The optional UI dependencies are declared in `test/ui/package.json`.

The UI harness alone sets compact tabs, simple Save As dialogs and Git decoration
settings in its own profile. It compares settings bytes before/after activity;
production activity does not write those settings. A disposable Git commit has
a different baseline text, allowing real modified-file decoration without
altering the task fixture during the activity assertion.

## Observed resource and decoration behavior

In the inspected compact-tab screenshot, the inactive sticky tabs reduce to
icons; the active custom tab and Explorer show the combined `M, A` decoration.
Header/status and exact task projection remain visible. This is one observed
VS Code composition, not a promise of badge order or priority across hosts.
The earlier activity-only badge assertion failed when Git supplied combined
badge content; the harness now isolates activity-only and competing cases.

Save As creates `saved.md` with no inherited task indicator or activity status.
An explicit report for `saved.md` displays its indicator while preserving the
new document's text, version and dirty state. Reopening `tasks.md` retains its
valid original report because VS Code keeps that unchanged document live.
This **corrects the plan's expectation of unconditional old-target invalidation**;
no speculative invalidation was added. Actual document closure/edit invalidation
continues to be tested separately.

The separate-host run verifies working → review → clear and lease expiry after
**121471 ms**. Full browser authority equals the context URI returned in object
mode. Source bytes, document version 1, dirty=false and badge setting=true remain
unchanged. The browser reported an icon asset request failure and a Vditor `ir`
initialization error; task content rendered and all activity assertions passed.
These results do not certify every remote editor asset or workflow.

## Retained evidence

- [Baseline 1.95 partial contract report](artifacts/agent-activity-matrix/baseline195-report.json)
- [Baseline host termination result](artifacts/agent-activity-matrix/baseline195-result.json)
- [Initial remote string rejection](artifacts/agent-activity-matrix/remote-string-rejection.json)
- [Remote command RPC result and preservation snapshots](artifacts/agent-activity-matrix/remote-result.json)
- [Remote working](artifacts/agent-activity-matrix/remote-working.png),
  [review](artifacts/agent-activity-matrix/remote-review.png),
  [clear](artifacts/agent-activity-matrix/remote-clear.png),
  [expiry](artifacts/agent-activity-matrix/remote-final.png)
- [Compact sticky tabs and Git](artifacts/agent-activity-matrix/activity-compact-sticky-git.png)
- [Save As before fresh report](artifacts/agent-activity-matrix/activity-save-as-no-inherited-task.png),
  [after fresh report](artifacts/agent-activity-matrix/activity-save-as-new-report.png)

## Regression gates

Fresh type checks passed. Core 91 tests/6 files, root 629 tests/70 files (including
core), widgets 35 tests/4 files, and real Chromium browser 146 tests/13 files
passed. Root/browser suites used `--maxWorkers=2` after an interrupted overloaded
parallel run hit timeouts. Lint, production extension/media builds, packaging,
JavaScript syntax and whitespace checks passed. Live UI results are recorded below.

The original baseline reports below predate the output-path cleanup. The
follow-up reran the activity-specific runner and added the two document controls;
their reports are indexed separately below. Blocked editor checks return failure,
not a full compatibility pass. A passing `--host-only` run proves only host APIs
without Markdown Studio, not provider/editor compatibility.

## Changed-file index

| File |
| --- |
| [src/integration/AgentActivityApi.ts](../../src/integration/AgentActivityApi.ts) |
| [test/agent-activity-api.test.ts](../../test/agent-activity-api.test.ts) |
| [docs/extension-api.md](../../docs/extension-api.md) |
| [scripts/activityUiTest.mjs](../../scripts/activityUiTest.mjs) |
| [scripts/activityBaselineTest.mjs](../../scripts/activityBaselineTest.mjs) |
| [scripts/activityRemoteTest.mjs](../../scripts/activityRemoteTest.mjs) |
| [test/ui/agentActivity.test.cjs](../../test/ui/agentActivity.test.cjs) |
| [test/ui/activity-driver/extension.js](../../test/ui/activity-driver/extension.js) |
| [test/ui/activity-driver/package.json](../../test/ui/activity-driver/package.json) |
| [test/fixtures/agent-activity-consumer/baseline-probe.js](../../test/fixtures/agent-activity-consumer/baseline-probe.js) |
| [test/fixtures/agent-activity-remote-driver/extension.js](../../test/fixtures/agent-activity-remote-driver/extension.js) |
| [test/fixtures/agent-activity-remote-driver/package.json](../../test/fixtures/agent-activity-remote-driver/package.json) |
| [docs/testing/agent-editor-compatibility.md](../../docs/testing/agent-editor-compatibility.md) |
| [docs/testing/agent-activity-verification.md](../../docs/testing/agent-activity-verification.md) |
| [docs/testing/agent-activity-compatibility-matrix.md](../../docs/testing/agent-activity-compatibility-matrix.md) |

Retained JSON and screenshot artifacts are linked above. Open **Source Control**
(`Ctrl/Cmd+Shift+G`) to review the diffs. Earlier workspace edits remain preserved.

## Final full local host result

Fresh VSIX with the URI transport fix, VS Code **1.140.0**: **11/11** real-window
scenarios passed, including cold activation, both producer transports, settings,
splits/reopening, remapping/invalidation, reload, **122591 ms** lease expiry,
compact sticky/Git fallbacks, Save As and rename.

- [Final local result](artifacts/agent-activity-matrix/local-result.json)
- [Complete UI command output](artifacts/agent-activity-matrix/local-ui.log)
- [Final public-API snapshot](artifacts/agent-activity-matrix/local-final-snapshot.json)
- [Save As original resource retains its valid report](artifacts/agent-activity-matrix/activity-save-as-original-retained.png)

The full-run fixture explicitly saves earlier deliberate edits before closing
sticky tabs; an earlier run was interrupted at the resulting save prompt. This
fixture correction does not change the production activity behavior. All listed
local screenshots were refreshed from the final passing run.

## Follow-up: narrowed baseline failure and Chat prerequisite

Fresh isolated 1.95 activity run again passes the two file/session contract checks,
then reports `Timed out after 15s: openTextDocument` and reaches the 180-second
host termination bound (exit 1). The document controls use the same host and
independent consumer fixture:

- With Markdown Studio absent from the extension registry (`--host-only`), file
  reads and opening plain text, Markdown and untitled documents all pass (exit 0).
- With Markdown Studio explicitly activated but **no activity API calls**
  (`--document-only`), activation and the first file read pass; opening
  `control.txt` times out. Subsequent host API operations also time out. The
  control was repeated after `yarn build:extension`; its result records the
  provider bundle SHA-256.

This isolates an activated-provider/1.95 document-open interaction. It does not
identify the responsible registration or establish a VS Code upstream bug.
The retained renderer and extension-host logs show activation and no diagnostic
exception explaining the stall. Timeout callbacks run; the extension-host sample
does not establish a JavaScript busy loop. Baseline task producer/editor visuals
and source/version/dirty preservation remain unverified. No production fix is
inferred from these controls.

Native Chat was opened in a separate fresh 1.140 profile. The retained screenshot
shows an empty **Build with Agent** view and **Sign In**; no real profile or
credentials were copied, no authentication API queried and no model request sent.
This is a prerequisite check, not an account-wide authentication inventory. To
finish the live competition check, supply an explicitly authorized authenticated
native chat edit session in a disposable workspace, report cooperating activity
for that same resource, and capture native/custom decorations, fallbacks, settings
and source/version/dirty snapshots. Preservation during competing edits is not
claimed. The remote string-versus-real-URI results above are unchanged.

Fresh evidence:

- [Activity reproduction report](artifacts/agent-activity-matrix/baseline195-reproduced-activity-report.json),
  [termination result](artifacts/agent-activity-matrix/baseline195-reproduced-result.json),
  [host output](artifacts/agent-activity-matrix/baseline195-reproduced-host.log),
  [renderer log](artifacts/agent-activity-matrix/baseline195-reproduced-renderer.log),
  [extension-host log](artifacts/agent-activity-matrix/baseline195-reproduced-exthost.log),
  [extension-host sample excerpt](artifacts/agent-activity-matrix/baseline195-extension-host.sample-excerpt.txt)
- [Provider-free control](artifacts/agent-activity-matrix/baseline195-host-only-activity-report.json),
  [result](artifacts/agent-activity-matrix/baseline195-host-only-result.json)
- [Activated-provider control](artifacts/agent-activity-matrix/baseline195-activated-provider-activity-report.json),
  [result](artifacts/agent-activity-matrix/baseline195-activated-provider-result.json),
  [host output](artifacts/agent-activity-matrix/baseline195-activated-provider-host.log),
  [renderer log](artifacts/agent-activity-matrix/baseline195-activated-provider-renderer.log),
  [extension-host log](artifacts/agent-activity-matrix/baseline195-activated-provider-exthost.log)
- [Native Chat prerequisite screenshot](artifacts/agent-activity-matrix/native-chat-prerequisite-empty-chat.png),
  [report](artifacts/agent-activity-matrix/native-chat-prerequisite-result.json),
  [UI text](artifacts/agent-activity-matrix/native-chat-prerequisite-ui.txt),
  [reproducer](artifacts/agent-activity-matrix/native-chat-prerequisite-probe.mjs)

The Chat reproducer asserts the actual host version, successful Chat command,
both UI labels, and unchanged fixture bytes before returning success. Its fresh
replay passed after independent review tightened these checks.

Follow-up regression checks passed: type checks, core 91/6 files, root 629/70,
widgets 35/4, real Chromium 146/13, production extension build, and diagnostic
JavaScript syntax checks. See [full test output](artifacts/agent-activity-matrix/followup-full-test.log)
and [browser output](artifacts/agent-activity-matrix/followup-browser-test.log).

Follow-up source files:

| File |
| --- |
| [scripts/activityBaselineTest.mjs](../../scripts/activityBaselineTest.mjs) |
| [test/fixtures/agent-activity-consumer/host-probe.js](../../test/fixtures/agent-activity-consumer/host-probe.js) |
| [docs/testing/agent-activity-compatibility-matrix.md](agent-activity-compatibility-matrix.md) |

Evidence files are linked above. Open **Source Control** (`Ctrl/Cmd+Shift+G`) to
review the changes; pre-existing production and UI harness edits are preserved.

Baseline editor visuals remain blocked; verified native Chat results are tracked in
[the active follow-up plan](../../.projectmind/plans/plan-verify-blocked-baseline-editor-and-native-chat-a.md).

### User-assisted 1.145 follow-up

The user's native Copilot session supplies the edit-session prerequisite missing
from the earlier isolated 1.140 profile. Their screenshot shows the edited heading
in Markdown Studio and Chat's pending **Keep / Undo** controls. The initial
failed report did not prove native tab decoration removal or successful activity.

The pasted probe report has `reported: false` and no `after` snapshot. A deferred
file-read regression reproduces a helper race: another Start command can replace
the shared report during the first Start's asynchronous snapshot, resulting in
an undefined comparison. This reproduces the failure shape without a document
mutation; the report alone cannot establish which command overlap occurred in
the user's window. The helper clears its activity session on failure, so the
absence of its badge afterward is inconclusive. This is a probe defect, not
evidence that activity changed source/settings or that VS Code removed native
review functionality.

Probe 0.0.2 prevents overlapping Start/Clear operations and compares the local
completed snapshot. The subsequent user run at **2026-11-05T15:54:30.834Z**
(07:54:30 America/Los_Angeles) returns `reported: true`, `preserved: true`, and
identical before/after snapshots. Text and disk hashes are both
`6ff274a223f45c425cacb2c2e0318b6b83e47a3d48cc4954e39bb598bfa47ca5`;
document version remains 1, dirty remains false, and all inspected configuration
values remain unchanged. The report was also read from the fixture's own
remote global-storage file and retained as the successful working report above.

The accompanying user screenshot shows `A` on both visible `tasks.md` tabs,
Open Editors and Explorer, a working indicator at the first checkbox (source
line 2, zero-based), and **Agent activity: working — Cooperating Test** in the
custom editor fallback. Chat simultaneously shows its second heading edit and
pending **Keep / Undo** controls. This verifies this observed coexistence on
1.145.0-insider; it does not guarantee badge priority or show the native text
editor's diff overlay because the custom editor is active in that screenshot.
Activity comes from the explicit test producer, not automatic Copilot adoption.

The [manual test fixture](../../test/fixtures/agent-activity-chat-check/README.md)
cleanup is now verified. The latest saved report, whose start timestamp is
**2026-11-05T16:00:55.924Z**, includes `clear.preserved: true`; start-before,
start-after, clear-before and clear-after snapshots all match. The current test
file's disk SHA-256 also matches these snapshots. The user's final screenshot
shows both tab badges, Explorer/Open Editors badges, first-task working indicator
and activity fallback gone, while Chat still displays **1 file changed / Keep /
Undo**. The document heading and both unchecked tasks remain intact.

The successful clear report is retained above. No further user-assisted checks
are required for this observed native Chat/activity scenario. Baseline 1.95
editor visuals remain the outstanding authored plan step; broader host versions,
native diff overlays, automatic adoption and badge priority are not implied.
