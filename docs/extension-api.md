# Markdown Studio extension context API

Cooperating VS Code extensions can request the active Markdown Studio document and a verified Markdown source range. The extension ID is `phfsantos.markdown-editor`; API major version is `1`. This API requires consumer adoption. It does not automatically attach custom-editor context to Codex, Claude Code, or GitHub Copilot.

## Direct exports in the same extension host

```ts
import * as vscode from 'vscode';

interface MarkdownStudioContext {
  readonly panelId: string;
  readonly uri: vscode.Uri;
  readonly documentVersion: number;
  readonly selection?: vscode.Range;
  readonly selectionStatus: 'exact' | 'unavailable';
}
interface MarkdownStudioApiV1 {
  readonly apiVersion: 1;
  getActiveContext(): MarkdownStudioContext | undefined;
  readonly onDidChangeActiveContext: vscode.Event<MarkdownStudioContext | undefined>;
}

export async function activate(context: vscode.ExtensionContext) {
  const extension = vscode.extensions.getExtension<MarkdownStudioApiV1>(
    'phfsantos.markdown-editor',
  );
  const api = await extension?.activate();
  if (!api || api.apiVersion !== 1) return;

  function update(value: MarkdownStudioContext | undefined) {
    // Apply your own context, workspace-trust, and ignored-file policies.
    // A clearing event must clear your cached context too.
    console.log(value?.uri.toString(), value?.selectionStatus);
  }
  context.subscriptions.push(api.onDidChangeActiveContext(update));
  update(api.getActiveContext());
}
```

Activation returns the API; it does not open a source editor. Read the initial snapshot as well as subscribing to changes. Dispose subscriptions with the consumer's lifecycle. The returned URI remains a `vscode.Uri`; do not convert a remote resource into a local path.

## Command fallback

```ts
interface ContextJson {
  panelId: string;
  uri: string;
  documentVersion: number;
  selectionStatus: 'exact' | 'unavailable';
  selection?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}
// Preserve VS Code's URI translation when the provider is in a remote host.
const wire = await vscode.commands.executeCommand<
  (Omit<ContextJson, 'uri'> & { uri: vscode.Uri }) | undefined
>('markdown-editor.getActiveContext', { uriFormat: 'object' });
const value: ContextJson | undefined = wire && { ...wire, uri: wire.uri.toString() };
const uri = value && vscode.Uri.parse(value.uri);
```

The command has an explicit activation event, so callers may invoke it before Markdown Studio has activated. With no argument it returns the original JSON snapshot (`uri` is a string), or `undefined`, with no callbacks. With `{ uriFormat: 'object' }`, it returns a URI-bearing snapshot for VS Code command transport; serialize that URI only after the command returns to the consumer. Catch command errors if Markdown Studio is not installed. A remote Node host intentionally sees its own filesystem URIs as `file://`. Serializing there bypasses VS Code's cross-host URI transformation. Remote/UI consumers must request object mode, let VS Code translate/revive the `vscode.Uri`, then call `toString()` in their own host. Preserve the resulting entire URI string, including scheme and authority, when transporting it. For example, `vscode-remote://ssh-remote+notes/home/me/tasks.md` must not become `file:///home/me/tasks.md`.

Exports and events need a compatible extension host. Object-mode command transport is the request/response fallback when exports are inaccessible across hosts; remote transport must be tested for the consumer's actual local/remote placement. Cross-host push events are outside this API's scope. The presence of a command is not a claim that every remote configuration has been verified; see the [compatibility evidence](testing/agent-editor-compatibility.md).

## Context and coordinate rules

- Context describes the active supported editor tab, including when focus moves to a sidebar or chat surface while that tab remains active. An unrelated tab clears it.
- `panelId` identifies an editor instance, not a file. Switching two panels for the same URI is a context change. Treat IDs as opaque and activation scoped.
- `documentVersion` is the shared VS Code document version. A range is meaningful only for its associated version; re-read after document changes and avoid applying it to a later revision.
- Positions are zero-based UTF-16 code units, matching `vscode.Position`. Emoji can occupy two units. CRLF line endings do not add a character to the following line.
- An exact range spans Markdown source, including intervening syntax. In `- [ ] **Ship**`, selecting visible `Ship` maps to line `0`, characters `8`–`12`.
- `selectionStatus: 'unavailable'` omits `selection`. Ambiguous mapping, stale revisions, uneditable rendered content, and widget/toolbar selections must not be treated as source selections. A collapsed exact range is a source caret.
- Snapshots and events contain document identity and range metadata, not document text. Consumers decide whether and how to read the shared `TextDocument`, including their privacy and ignored-file policies.

The first implementation supports uniquely matching text in simple paragraphs, headings,
lists/checkboxes, emphasis, links, and literal fenced-code lines. Its inverse
projection is deliberately conservative: unsupported Markdown constructs anywhere
in the document can make selection unavailable because uniqueness cannot be
proven. Examples include HTML/entities, tables, images, escapes, math, closing
heading hashes, and whitespace-normalized code spans. Duplicate rendered text,
element-boundary selections, source-view mode, and nested DOM blocks also fall
back to file-only context. This may omit usable ranges; it must never guess one.

A rendered DOM cursor position is not automatically an exact Markdown source position. Consumers must honor `selectionStatus` and should use file-only context when a range is unavailable.

## Independent consumer fixture

The development-only extension at `test/fixtures/agent-context-consumer` exercises this contract without an AI extension or a native source editor. Its manifest defaults to a UI extension so remote-host command behavior can be tested independently. It has no runtime dependency on Markdown Studio and does not open files or submit content to chat.

Launch an Extension Development Host with both development extensions (adjust the VS Code executable for the machine):

```sh
code --new-window \
  --extensionDevelopmentPath="$PWD" \
  --extensionDevelopmentPath="$PWD/test/fixtures/agent-context-consumer" \
  "$PWD"
```

The consumer registers commands on startup but waits until `readExports` is explicitly invoked before activating the provider through exports. To test a cold command, use a clean host/profile with no restored Markdown custom tab and invoke **Context Test: Read Command Fallback** first. Opening a custom tab activates the provider and therefore cannot test cold activation.

Use the Command Palette for:

| Command | Purpose |
| --- | --- |
| `agent-context-consumer.readExports` | Activate the same-host provider, read its API, subscribe to events |
| `agent-context-consumer.readCommand` | Request a JSON snapshot through the command |
| `agent-context-consumer.getObservations` | Return captured snapshots and clearing events |
| `agent-context-consumer.assertContext` | Assert caller-supplied expectations; rejects mismatches |
| `agent-context-consumer.copyContext` | Explicitly copy file/version/range metadata to the clipboard |

The **Agent Context Consumer** output channel records observations. No document text is logged. A clearing observation has a transport and no `context` field. Copying only happens when the user invokes the copy command; the clipboard contains URI, document version, status, and an exact range when available.

For assertions from an extension-host test driver, invoke the fixture's public commands with explicit expected values:

```js
const a = await vscode.commands.executeCommand(
  'agent-context-consumer.assertContext',
  {
    transport: 'exports',
    uri: uriA.toString(),
    selectionStatus: 'exact',
    selection: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } },
  },
);
// After the user switches to custom tab B:
await vscode.commands.executeCommand('agent-context-consumer.assertContext', {
  uri: uriB.toString(), differentPanelId: a.panelId,
});
// After switching to a non-Markdown editor:
await vscode.commands.executeCommand('agent-context-consumer.assertContext', {
  unavailable: true,
});
```

Run the A → B sequence again with two groups displaying the same URI, then close inactive A. Verify B's panel identity survives. Move focus to chat/sidebar without changing the active editor tab and verify context persists. The driver or user performs UI actions; the fixture only observes and asserts. Selection of `Ship` requires a fixture document containing `- [ ] **Ship**` and selecting just that text in the custom editor.

Repeat `readCommand` in the remote configuration, compare the full URI to the custom tab's `TabInputCustom.uri.toString()`, and record the VS Code version, consumer/provider host placement, and result. Test exports separately with both extensions placed in the same host. A passing unit test of remote URI serialization is not evidence of a live remote-host pass.

Automated fixture tests run with `yarn vitest run test/agent-context-consumer.test.ts`. They verify consumer behavior against a simulated provider. Live-host adoption remains a separate acceptance gate documented in the compatibility report.

## Upstream adoption notes for agent maintainers

Codex and Claude integrations can first discover file identity using stable `window.tabGroups.activeTabGroup.activeTab.input`: `TabInputCustom` supplies `uri` and `viewType`, while `TabInputText` supplies a source URI. Subscribe to both tab and group changes and read initial state. Define separate policies for diff, notebook, and unsupported inputs.

For `viewType === 'markdown-editor'`, optionally activate `phfsantos.markdown-editor`, check API version, and consume its exact-range context. If exports are unavailable, call the JSON command. Clear cached state on `undefined`, retain full URI identity, and treat unavailable selection as file-only context. Keep permission, ignored-file, and context-submission decisions in the agent. These are integration notes for a cooperating consumer, not evidence that existing agents already adopt the API. Sending upstream requests is separate work.

## Stable API boundary

The implementation targets stable VS Code 1.95+ APIs: custom text editors, tabs, shared text documents, extension exports/events, and commands. No native `TextEditor` is fabricated. The proposed `chatContextProvider` and `customTextEditorNavigation` APIs are not production dependencies. Native chat decoration/badge behavior and existing Codex/Claude/Copilot context detection require separate live verification; no unconditional agent compatibility is claimed. See [the research report](../plans/do/agent-editor-integration-research.md) for the distinction between stable contracts, proposals, and source-based inferences.

## Verified UI and remote runs

The 2026-11-04 run verified the packaged extension in a real VS Code 1.140.0
window with ExTester and a separate consumer. A pinned VS Code 1.115.0 browser
workbench connected to an isolated loopback remote Node server verified the
consumer in a browser worker (`nodeRuntime: false`), provider in the remote Node
host, actual Vditor selection at 0:8–0:12, full `vscode-remote` authority through
object-mode command RPC, and clearing on an unrelated remote tab. Exports were
unavailable in the consumer's host; the command performed the integration.

This is a tested browser-worker/remote-Node configuration, not evidence for every
SSH, WSL, Dev Container, tunnel, or AI-agent placement. The default no-argument
JSON command remains compatible for same-host callers; it does not by itself
canonicalize a remote host's local URI into a UI resource URI. See the
[compatibility report](testing/agent-editor-compatibility.md) for exact evidence,
runner instructions, negative checks, and observed environment limitations.

## Explicit agent activity (API v1)

The same v1 export includes `activity.createSession({ id, label })`. Attribution is
producer-supplied plain text, not authenticated extension identity. Report only
work your integration owns; Markdown Studio does not observe arbitrary agents.

```ts
const extension = vscode.extensions.getExtension('phfsantos.markdown-editor');
const api = extension && await extension.activate();
if (!api || api.apiVersion !== 1 || !api.activity) return;
const session = api.activity.createSession({ id: 'my-extension', label: 'My Agent' });
context.subscriptions.push(session); // also dispose on producer deactivation
const heartbeat = setInterval(() => session.heartbeat(), 30_000);
try {
  const document = await vscode.workspace.openTextDocument(uri);
  session.setActivity({
    id: 'edit', uri, state: 'working', label: 'Editing task',
    task: { documentVersion: document.version, line: 1,
      expectedLineText: document.lineAt(1).text },
  });
  await doWork();
  session.clearActivity('edit'); // completed, cancelled and failed work clears
} finally {
  clearInterval(heartbeat);
  session.dispose();
}
```

`task` is optional; file-only reports need no document access. States are
`working`, `waiting`, and `review`, in aggregation priority order. IDs are at
most 128 characters, labels at most 120, with at most 1000 activities per session.
Invalid inputs, unavailable/stale task documents and updates to closed/expired
sessions throw explicit errors. Tasks require an exact source line and document
version. Edits touching the line invalidate the task indicator while retaining
file activity; submit a fresh anchor to restore it. Reports never edit Markdown.

Leases last 120 seconds, renewed by successful updates or heartbeat. Heartbeat
every 30 seconds. Expiry clears owned reports within one additional second of
timer scheduling; disposal clears immediately. Tab closure only unsubscribes
renderers. If the shared TextDocument itself closes, task anchors invalidate
(version numbers can restart on reopen); file activity remains until cleared. Window reload/deactivation clears all reports; activity is not saved.

For JSON integrations, execute these commands (all activate the extension):

| Command prefix `markdown-editor.agentActivity.` | Argument / result |
| --- | --- |
| `startSession` | `{id, label}` → `{sessionId, token}` |
| `update` | `{sessionId, token, activity: {id, uri, state, label, task?}}` |
| `clear` | `{sessionId, token, id}` |
| `heartbeat` / `endSession` | `{sessionId, token}` |

`uri` in JSON is a full URI string interpreted exactly in the receiving host.
For callers and provider in separate extension hosts, pass a real `vscode.Uri`
as `activity.uri` to `executeCommand` instead; VS Code translates and revives it
across command RPC. Obtain it from the custom tab or from
`markdown-editor.getActiveContext` with `{ uriFormat: 'object' }`. Keep the
consumer's full URI, including authority, until command transport handles it.
Do not strip remote authorities or guess a receiving-host filesystem path.
Plain JSON URI-shaped objects are rejected; JSON-only callers must already use
the receiving host's exact resource identity. Existing string calls are unchanged.
Tokens are opaque ownership credentials: retain privately and never log them.
Unknown, expired or mismatched command sessions are rejected. Tokens are not an
extension-host security boundary. Direct clear/dispose are idempotent; command
calls with ended credentials are rejected. A static `A` badge is subject to
VS Code badge settings and decoration competition. Status/header fallbacks show
activity even when tab badges are hidden. No native animated file badge or
third-party agent support is implied. The independent producer fixture lives in
`test/fixtures/agent-activity-consumer`.

Task projection currently supports ordinary/nested Markdown lists with `-`, `*`,
`+` or ordered markers, checked tasks, and fenced-code exclusion. Documents with
block quotes, HTML blocks or tab-indented containers deliberately use file-only
activity: their task anchors are rejected rather than approximated. Checkbox
projection also hides when Vditor's task count, checked states, or deterministic
source serialization differ. Full-source coordinates remain authoritative.

### ProjectMind as an activity producer

ProjectMind (a separate extension) reports which step of a saved plan an agent
is executing. Its plans are rendered to `.projectmind/plans/<id>.md`; each step
and acceptance criterion is a `- [ ]` / `- [x]` line under `## Steps` and
`## Acceptance criteria`. ProjectMind is an ordinary producer of the activity
API above: it creates a session, sets a `working` activity anchored to the
step's exact line and document version, and clears it when the step is ticked.
The producer side is ProjectMind's work, not Markdown Studio's; this extension
only renders what it receives.

The plan file must stay inside the task parser's supported subset, or every
anchor is rejected (see the paragraph above). Two constructs found in real plan
files on 2026-11-13 fail closed: the `> Created: … · ID: …` metadata blockquote,
and any unescaped free-text line (problem, notes or work summary) that starts
with `<`. With the metadata line rendered as a plain paragraph, 436 of 442
plan files in the ProjectMind and Markdown Studio repositories parse; the other 6 contain such a `<` line. The fixture in
`packages/core/test/taskAnchorMapping.test.ts` pins the plan shape that parses.

The checkbox ticks themselves are written directly, never as a pending edit:
the `.md` is a projection of ProjectMind's plan JSON, and undoing a tick in a
host's review UI would make the two disagree.

### Pending (not yet kept) agent edits

Markdown Studio also marks, as `review` task indicators, the checkboxes an
agent's not-yet-accepted edit changes. The host sends a `pending-edits` message
with the open document's text and, per host, the version it is reviewed
against. The webview marks only checkbox lines with no unchanged counterpart in
that version (a line alignment in `findChangedTasks`, `packages/core`), labels
them by host in the status text (for example `Copilot review on task 2`), and
clears them when the host's pending state resolves. An agent's `working` or
`waiting` activity on the same task outranks its `review` marker. The same
projection rules apply: no markers when the rendered checkboxes, their checked
state or the serialized source disagree with the reported text.

| Host | Pending state Markdown Studio reads | Notes |
| --- | --- | --- |
| VS Code / GitHub Copilot Chat | Private `chat-editing-text-model` (pre-edit baseline) and `chat-editing-snapshot-text-model` documents for the same path (`src/app/chatEditingDiff.ts`). The open document already holds the edit. | Only the host's own agent edit tools enter the working set. Terminal, script, extension, MCP and LM-tool writes are applied immediately and are never pending. |
| Claude Code | A `TabInputTextDiff` tab whose modified side is `_claude_vscode_fs_right:<same path>` (extension) or `_claude_fs_right:<same path>` (terminal/IDE-MCP integration), with that exact right-hand URI open in `workspace.textDocuments` (`src/app/claudeCodePendingEditSource.ts`). The open document still holds the original; the proposal is the right-hand document. | Both shapes were captured from actual anthropic.claude-code 2.1.323 diff handlers in an isolated VS Code 1.115.0 host; both exact right-hand documents were open. The diagnostic invoked handlers directly, without a model conversation; Windows and Remote-SSH path forms remain unverified. Only proposed Edit/Write diffs enter this path; direct terminal, script and MCP-tool file writes apply immediately. Renamed edited-text-only fragments do not match. |
| Codex | None. | Codex has no pending state in VS Code; review happens after the write (its Review tab, or Git). |
| ProjectMind | None. | Every ProjectMind MCP/LM tool write goes through `workspace.fs.writeFile` or a saved `WorkspaceEdit`, so nothing it writes is pending in any host. |

**Private-scheme caveat.** Neither host offers a stable API for pending edits
(see microsoft/vscode#279040, open with no PR). Both sources recognise private,
undocumented document schemes and tab shapes that can change in any host
release. They are compatibility glue that fails closed: when the scheme, the
path, the `TabInputTextDiff` class or the compared document is missing or
unrecognised, the source reports no pending edit and no marker is drawn. A host
change therefore removes the review markers rather than drawing wrong ones.
