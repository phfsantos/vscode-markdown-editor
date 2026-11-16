# ADR 0001: Diff view architecture

- **Status:** Accepted, 2026-11-16
- **Context plan:** `plan-diff-view-overhaul-inline-previous-version-full`
- **Evidence:** [docs/testing/diff-view-findings.md](../testing/diff-view-findings.md);
  raw measurements in `.extest/diff-evidence.json` from `yarn test:ui --grep "Diff view"`
  on VS Code 1.140.0 (the version the UI harness pins).

## Context

Markdown Studio is a `CustomTextEditorProvider`. VS Code renders a diff of two
Markdown resources by resolving **two** custom editors (two webviews) side by side.
The overhaul has to answer four API questions before building anything.

## API findings

### 1. Custom-editor priority is per mode since 1.133

`contributes.customEditors[].priority` may be an object
`{ "textEditor": …, "diffEditor": … }` with values `default`, `option` or `explicit`
([microsoft/vscode#292379](https://github.com/microsoft/vscode/issues/292379),
finalized by [PR #329002](https://github.com/microsoft/vscode/pull/329002), milestone 1.133).
A scalar keeps working for text editors, but diff editors treat it as `explicit`.

**Measured (S1):** with the shipped scalar `"default"`, a Git working-tree diff and
a file↔file compare of `.md` files both open in VS Code's *Text Diff Editor*.
With the staged object `{"textEditor":"default","diffEditor":"default"}`, both open
in Markdown Studio.

### 2. The tab input of a custom-editor diff is undefined

**Measured (N1):** when Markdown Studio is the diff editor, `tab.input` is
`undefined` for both a Git working-tree diff (label `diff.md (Working Tree)`) and a
file↔file compare (label `diff.md ↔ diff.md`). `TabInputTextDiff` is reported only
when the text diff editor wins. `TabInputCustom` exposes a single `uri` and no side.
So the API offers **no** statement of which custom editor is original and which is
modified.

What is reliable is each side's **document URI**. For every diff whose sides differ
in kind, the original is the non-writable or virtual one:

- Git: `git:` versus `file:`
- chat-editing baselines: `chat-editing-*`
- review schemes

That holds for both resolve orders. Only a compare of two writable `file:` documents
carries no signal. There, VS Code 1.140 resolved the **modified** side first in 3 of 3
observed opens (findings, S2). That is observed behaviour, not a contract.

### 3. No scroll-synchronisation API for webviews

VS Code synchronises scrolling only between its own text editors. Nothing in the
stable or proposed webview API links two custom editors in a diff, so the extension
must transport scroll positions itself.

### 4. Both diff webviews share one origin

**Measured:** both panes report the same `location.origin`
(`vscode-webview://<extension-scoped id>`), so `BroadcastChannel` works between them.
VS Code does not document that origin scheme.

## Scroll transport spike

The two panes of a 300+ line Git diff exchanged 20 messages each way at 50 ms
spacing. Latency was measured between frames on the same clock (`spike.transports`).

| Transport | Delivered | p50 | p95 | max | Notes |
| --- | --- | --- | --- | --- | --- |
| Host relay (`webview.postMessage` → host → `webview.postMessage`) | 20/20 | 2 ms | 2 ms | 2 ms | Documented API. The host already knows the pair. |
| `BroadcastChannel` between the two webviews | 20/20 | 0 ms | 1 ms | 1 ms | Relies on the undocumented shared origin. It reaches **every** Markdown Studio webview, so it still needs a host-issued session id. |
| One webview hosting both sides | not built | n/a | n/a | n/a | Rejected without a build (see below). |

End-to-end latency of the shipped design is measured by the UI case
*scrolls the other pane to the aligned row within 100 ms without echo* and recorded
under **Measured result** below.

## Decision

1. **Manifest:** declare `"priority": { "textEditor": "default", "diffEditor": "default" }`.
   Keep the engine floor at `^1.95` only if VS Code 1.95 accepts the object form.
   Step 15 proves this on a 1.95 build. If 1.95 rejects it, raise the floor to the
   first version that accepts it, and record which one.
2. **Pairing and sides:** a host-side `DiffSessionRegistry` pairs the two resolved
   editors of one diff tab under a stable session id. It never parses the label as
   the primary signal, and it never reads the *active* tab to identify the editor
   being resolved.
   - **Sides:** decided by document facts. The side whose document is not a writable
     `file:` (by scheme, or by `vscode.workspace.fs.isWritableFileSystem`) is the
     original.
   - **Two writable files:** the registry falls back to resolve order (modified
     first, as observed on 1.140). It records the fallback on the session, so a
     wrong assignment is diagnosable.
   - **Dispose:** removes only the disposing side.
3. **Read-only** follows the role and file-system writability: the original side of a
   diff whose original is not a writable file is read-only. The `git` and
   `showModifications` schemes stop being special cases.
4. **Scroll sync:** use the host relay with an **anchor** payload
   `{ row, offset }`. `row` is the aligned diff row at the top of the viewport.
   `offset` is the pixel distance of the viewport top into that row, as a fraction
   of the row height.
   - Coalesce emission with `requestAnimationFrame`.
   - The pane that last received pointer, wheel, touch or keyboard input **owns**
     scrolling. Only the owner emits, and a follower applies positions without
     emitting. Echo suppression by timers goes away.
5. **Rendered-ready handshake:** a webview signals `diff-rendered` once Vditor has
   rendered. The host calculates the diff when both sides of a session have signalled,
   and a per-session timeout posts an error state to the status bar. This replaces the
   two fixed 1000 ms sleeps and the 3 s poll.
6. **Webview rendering:** diff artifacts never enter Vditor's contenteditable DOM or
   inline styles.
   - Highlights and previous-version rows are painted in an overlay layer that
     scrolls with the content.
   - Space for a previous-version row is reserved by a generated stylesheet rule keyed
     on `data-diff-line`.
   - Save cleaning works on a DOM clone, and strips every node or attribute the diff
     view owns.
7. **Protocol:** `diff-view-detected`, `diff-view-cleared` and `diff-scroll-sync` move
   into the typed protocol in `packages/core/src/editorProtocol.ts`, with one stats
   shape `{ added, deleted, modified }`.

## Rejected alternatives

- **Label parsing** (the old design): ambiguous for same-named files, and the label
  of a Git diff (`x.md (Working Tree)`) carries no "↔". Kept only inside the
  file↔file fallback, as a diagnostic, never as the signal.
- **Reading the active tab while resolving:** the editor being resolved is not
  necessarily the active one. Both sides of a diff resolve under one tab.
- **`BroadcastChannel` transport:** about 1 ms faster, but it depends on an
  undocumented origin scheme that VS Code could make per-webview at any time. It also
  broadcasts to all panels. The host relay already meets the budget with a large margin.
- **One webview hosting both sides:** VS Code's diff always creates two custom
  editors. A single-webview compare would need its own command, would lose SCM
  integration (Open Changes, inline navigation) and would duplicate VS Code's diff
  chrome. It would only be worth it if both transports missed the 100 ms budget, and
  neither does.
- **Percentage scroll sync** (the old design): with 10 added paragraphs near the top,
  the same percentage lands about 24 rows apart (findings, issue 4). Only an aligned
  row is correct.

## Consequences

- Two writable files stay order-dependent. This is an API gap, not a design
  choice; the registry exposes the fallback so the UI test can assert it on the
  pinned VS Code version.
- The rendered handshake is the existing `vditorReady` message. A paired side
  that never sends it gets the timeout error state instead of a silent "no diff".
  A side that never finds a partner is treated as a plain editor (red-team A1).
- **Accepted risk A5:** two diffs that resolve in the same editor column at the
  same moment could pair across each other. Pairing is per column, and the
  sides of one diff resolve back to back.
- **Accepted risk A6:** on a table row preceded by a gap, the line number sits at
  the top of the gap. Table rows take the gap as cell padding, because margins
  do not apply to table rows.

## Measured result

All figures come from `yarn test:ui --grep "Diff view"` with the shipped manifest
(no staging override), 2026-11-16.

| Check | VS Code 1.140.0 | VS Code 1.95.3 (engine floor) |
| --- | --- | --- |
| `.md` opens in Markdown Studio by default | yes (`TabInputCustom`, `markdown-editor`) | yes |
| Git working-tree diff opens in Markdown Studio | yes, original left / modified right | yes, original left / modified right |
| File↔file compare of same-named files | original left / modified right (`basis: active-side`) | not run |
| Time from both panes rendered to decorations applied | **185–297 ms** over 4 runs with the idle handshake (budget 500 ms); 279–608 ms before it | not measured |
| Scroll sync: follower settles after the source | **24–29 ms** over 3 consecutive runs (budget 100 ms) | not measured |
| Scroll sync: aligned row offset, left vs right | identical (−19.9 px vs −19.9 px) | not measured |
| Echo: source scroll events 300 ms after the follower settled | 0 | not measured |
| Host relay alone (spike) | p95 2 ms, 20/20 delivered | not measured |

Two implementation findings changed the design during the work:

- **Resolve order is a race.** A file↔file compare once resolved the original
  first. The resolve-order fallback is therefore only provisional; VS Code's
  focus of the modified (primary) side on open decides (`DiffSessionRegistry.noteActivated`).
- **The handshake fired before the webview was idle.** Vditor's `after()` is
  followed by about 200 ms of post-render work (wiki links, line numbers,
  diagnostics). The host's HTML request queued behind it, and one run reached
  608 ms. `vditorReady` is now sent from `requestIdleCallback` (300 ms cap),
  which brought latency to 185–297 ms.
- **Wheel events arrive late.** With passive wheel listeners, Chrome scrolls on the
  compositor before the `wheel` event reaches the main thread. That made follower
  lag 85–88 ms when ownership waited for the wheel event. A pane now also claims
  ownership on any scroll it did not cause, recognising its own follow by the exact
  position it set (no timers). Lag dropped to 24–29 ms.

1.95.3 was checked with `MARKDOWN_UI_STORAGE=.extest/v195` and
`MARKDOWN_UI_CODE` pointing at a downloaded 1.95.3 build. The storage path must
stay under the 103-byte IPC socket limit.
