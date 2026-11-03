# Agent activity and checkbox indicators implementation plan

> Execute with `executing-plans`, task by task. This is planned work, not an implemented API.

**Goal:** Let cooperating extensions report file/task activity and show it through stable file badges and transient checkbox indicators.
**Architecture:** An activation-owned activity registry accepts explicit scoped producer sessions. Decorations and webview overlays subscribe to it. Neither registry state nor spinner markup is part of document content. API exports and JSON commands share one service.
**Tech stack:** TypeScript, stable VS Code APIs, Vditor, typed core protocol, Vitest/Playwright.

Read [the research report](agent-editor-integration-research.md). This plan can ship independently of [selection context](agent-editor-context-api.md); merge both capabilities into one `MarkdownStudioApiV1` export if present. Planning linkage: vision revision 3, `g-2026-trust` and `g-2026-ai`. Existing private chat diff detection is not an activity source.

## File responsibilities

Create `src/integration/AgentActivityRegistry.ts` (lifecycle), `src/integration/AgentActivityApi.ts` (export/command adapter), `src/integration/AgentActivityDecorations.ts` (file/status-bar projections), `packages/core/src/taskAnchorMapping.ts` (source task matching), `packages/media/src/agent-activity-controller.ts` (overlay projection), and `packages/media/src/agent-activity.css` (accessible animation). Modify `src/extension.ts`, `src/runtime/ExtensionRuntime.ts`, `src/app/EditorPanel.ts`, `packages/core/src/editorProtocol.ts`, `packages/core/src/index.ts`, `packages/media/src/main.ts`, `packages/media/src/utils.ts`, `package.json`, and `docs/extension-api.md` for wiring and sanitization. If the API document/export does not exist yet, create it using the same version and extension ID specified in the context plan.

## Public contract and lifecycle

```ts
import type * as vscode from 'vscode';
export interface TaskTarget {
  readonly documentVersion: number;
  readonly line: number;              // zero-based source line
  readonly expectedLineText: string; // exact source line, excluding EOL
}
export interface ActivityInput {
  readonly id: string;                // unique within the session
  readonly uri: vscode.Uri;
  readonly state: 'working' | 'waiting' | 'review';
  readonly label: string;
  readonly task?: TaskTarget;
}
export interface AgentActivitySession extends vscode.Disposable {
  readonly sessionId: string;
  setActivity(activity: ActivityInput): void;
  clearActivity(id: string): void;
  heartbeat(): void;
}
export interface AgentActivityCapability {
  createSession(producer: { id: string; label: string }): AgentActivitySession;
}
```

Expose `activity: AgentActivityCapability` on API version 1. Producer ID/label are declared attribution, not authenticated caller identity. Treat labels as plain text, cap at 120 characters, IDs at 128, and allow at most 1000 activities per session. Reject invalid URI/range/state/size with explicit errors. Store full URIs; preserve remote authorities and schemes. Activity metadata does not write files or grant access to their contents.

Use a 120-second lease, renewed by session heartbeat or a successful update. Callers heartbeat every 30 seconds while working; API docs require `try/finally` cleanup and disposal on extension deactivation. Disposing/expiring one session removes only that session's activities. Closing a tab removes its renderer subscription, not the producer session. Clear all state on Markdown Studio deactivation/window reload; do not persist “working” state. `clearActivity`/`dispose` are idempotent. Bound terminal states are unnecessary: completed/error/cancelled work clears the activity; an agent that needs durable outcomes updates its own task system.

Register JSON commands `markdown-editor.agentActivity.startSession`, `.update`, `.clear`, `.heartbeat`, `.endSession`. Start returns `{sessionId, token}`; others require both plus serialized URI and task target where applicable. Generate opaque random tokens, never log them, and reject unknown/expired/token-mismatched sessions. Tokens provide scoped ownership, not an extension-host security boundary. Add explicit `onCommand:` activation events for all five commands. Commands and direct exports use exactly the same validation and storage.

Aggregate file activity by URI: working wins over waiting, which wins over review. Tooltip lists up to three producers and a remaining count. A stable static `A` badge signals any active report; a status bar/header describes its state. VS Code owns badge competition and settings; no guarantee our badge outranks Git or private native chat decorations. Do not rename file tabs or simulate dirty state.

Task targets are optimistic versioned anchors. Validate against the current shared document and require the exact line to be a task-list item outside fenced code. Reject stale targets on initial submission. After edits, transform offsets only through non-overlapping content changes and recheck exact task identity; edits overlapping the task line, whole-document replacement, task deletion or ambiguity invalidate the task projection. Retain file activity and request that the producer submit a fresh task anchor. Never guess by checkbox label or nearest rendered line.

## Tasks

### 1. Implement producer-scoped activity [code · tdd]

Files: create registry and `test/agent-activity-registry.test.ts`.

- [ ] Write failing tests for two producers on one URI, identical activity IDs in different sessions, state aggregation, explicit clear, idempotent disposal, lease renewal/expiry with fake timers, late updates after expiry, invalid targets and input limits.
- [ ] Run `yarn vitest run test/agent-activity-registry.test.ts`; observe assertion failures before implementation.
- [ ] Implement registry with injected clock/timer dependencies and immutable per-URI snapshots. Emit only changed URI snapshots, and release timers/events on disposal. Do not infer activity from text changes or private virtual documents.
- [ ] Re-run tests. Required invariant: clearing session A never clears B.

Concrete regression using `createRegistry` with the contract above:

```ts
it('retains another producer after disposal', () => {
  const registry = createRegistry();
  const a = registry.createSession({ id: 'a', label: 'Agent A' });
  const b = registry.createSession({ id: 'b', label: 'Agent B' });
  const uri = vscode.Uri.parse('file:///notes/tasks.md');
  a.setActivity({ id: '1', uri, state: 'working', label: 'Planning' });
  b.setActivity({ id: '1', uri, state: 'working', label: 'Editing' });
  a.dispose();
  expect(registry.getActivities(uri).map(item => item.producer.id)).toEqual(['b']);
});
```

### 2. Publish the activity API and commands [code · tdd]

Files: create adapter and `test/agent-activity-api.test.ts`; modify extension/runtime/package, API export/types, and documentation.

- [ ] Write failing tests for activation/export version, commands mapping to the same registry, token mismatch, JSON URI validation, remote URI round-trip, expiry, and cold command activation; run `yarn vitest run test/agent-activity-api.test.ts`.
- [ ] Implement the capability and command adapter with typed validation at each external boundary. Do not expose callbacks/Disposables in JSON. Keep registration and session cleanup activation-owned.
- [ ] Document a complete producer example: activate extension, check `apiVersion`/activity capability, create session, set file/task activity, heartbeat, clear/dispose in `finally`. Document failures and the lease.
- [ ] Re-run API and registry tests. Add an independent tiny consumer fixture under `test/fixtures/agent-activity-consumer/` to report and clear file activity without an AI account.

### 3. Render stable file/status indicators [code · tdd; designer · design]

Files: create decoration service and `test/agent-activity-decorations.test.ts`; modify runtime wiring.

- [ ] Write failing tests proving `A`/tooltip/state projection for file and remote URIs, no decoration after clear, targeted decoration-change events, active-document status changes, and subscription cleanup; run `yarn vitest run test/agent-activity-decorations.test.ts`.
- [ ] Register `FileDecorationProvider` with a static badge, `propagate: false`, and plain-text tooltip. Use a status bar item with supported loading icon syntax for working state; waiting/review use readable labels. Never pass `ThemeIcon` as a stable file badge or inspect another provider's private data.
- [ ] Check custom/native tabs in a Development Host using the same consumer fixture. Test badge settings off, compact sticky tabs and Git/native chat badge competition; preserve the in-editor/header/status fallback. Record screenshots/results in `docs/testing/agent-editor-compatibility.md`.
- [ ] Re-run focused tests. Existing native URI badges should be left to VS Code; repair any separately reproduced resource-identity bug through its own regression task.

### 4. Resolve task anchors against source [code · tdd]

Files: create mapper and `packages/core/test/taskAnchorMapping.test.ts`; modify core exports and registry document listener.

- [ ] Add failing fixtures for duplicate checkbox labels, nested lists, `-`/`*`/`+` markers, checked tasks, CRLF/Unicode, fenced code containing `- [ ]`, insertions above an anchor, overlapping edits, deletion, and full-document replacement. Run `yarn vitest run packages/core/test/taskAnchorMapping.test.ts`.
- [ ] Recognize tasks through parsed Markdown structure/source positions, reusing a current parser dependency if it provides offsets; do not use a standalone line regex that accepts fenced code. Store versioned source offsets internally and transform non-overlapping edit batches in original-coordinate order. Reject overlapping/ambiguous anchors, keeping file activity visible.
- [ ] When a checkbox is checked, invalidate its working task projection rather than changing its checked state or marking the agent finished. Producers clear file work explicitly.
- [ ] Re-run mapper and registry tests; prove insertions above preserve identity and duplicate labels are never matched by text alone.

### 5. Render checkbox spinners without content mutation [code · tdd; designer · design]

Files: create controller/CSS and `test/agent-checkbox-activity.browser.test.ts`; modify protocol, panel, media bootstrap and save sanitizer. Use the existing real-Vditor harness in `test/vditor-synchronization.browser.test.ts`.

- [ ] Write browser tests first for one target among duplicate tasks, multiple producers on one task, rerender/undo, task invalidation, read-only panels, malformed/old messages, keyboard checkbox toggle, reduced motion, serialization and copy. Run `yarn test:browser test/agent-checkbox-activity.browser.test.ts` and observe the missing-overlay failures.
- [ ] Add typed `agent-activity` messages with document generation/version, per-URI sequence, and validated task projections. On webview ready, send the current snapshot; ignore stale messages. Fan out to every live panel for that URI and reproject after render changes.
- [ ] Anchor an absolutely positioned overlay outside the editable Vditor root to the task checkbox rectangle. Set `pointer-events: none`; follow scroll/resize/rerender and hide when the target is unmappable. Preserve the actual checkbox and its click/keyboard behavior. Avoid inserting decorative text into editable DOM.
- [ ] Show an animated ring only for working; waiting/review use static indicators. Respect reduced motion, theme contrast and zoom. Provide plain text “Agent name working on task” in a separate accessible status region; avoid repeated live announcements on every heartbeat. Do not mark the whole editor busy.
- [ ] Defensively exclude any transient activity selectors/attributes from export/save paths, and verify clipboard excludes overlays. Test byte-equivalent `getValue()` output, unchanged dirty/version state, and undo history before/after activity updates. Confirm document edits still flow through existing synchronization only.
- [ ] Re-run browser tests and `yarn vitest run packages/core/test/taskAnchorMapping.test.ts test/agent-activity-registry.test.ts test/agent-activity-api.test.ts test/agent-activity-decorations.test.ts`.

### 6. Verify a real consumer and release gates [qa · test-generation]

Files: consumer fixture, `docs/extension-api.md`, and compatibility report.

- [ ] Consumer reports file activity, then targets the second of two identical tasks; verify file badge/header and only that checkbox's spinner. Dispose producer; verify immediate clear. Stop heartbeats; verify expiry within 120 seconds plus timer scheduling tolerance.
- [ ] Exercise two producers, split custom tabs, closed/reopened tab, Save As/rename (old target must clear or require re-report), remote commands, source edits and extension reload. Mark untested environments explicitly.
- [ ] Demonstrate one cooperating real agent adapter only if its documented API is available; otherwise report the fixture pass and third-party adoption as an external dependency. Do not claim Codex/Claude/Copilot support based on installation alone.
- [ ] Run `yarn test`, `yarn lint`, `yarn test:browser`, `yarn build:extension`; record results and confirm no proposed APIs enter the published manifest. Review full diff for source-fidelity and lifecycle regressions.

## Acceptance criteria

- [ ] A separate extension reports/clears activity through exports and serializable commands; unsupported API versions fail gracefully.
- [ ] A working static file badge and status/header fallback are verified in custom tabs without overriding user badge settings or dirty indicators.
- [ ] Two producers cannot clear each other's state; cancellation/disposal/lease expiry/reload clear owned activity.
- [ ] An explicit task anchor spins only its matching checkbox; ambiguous/stale/deleted anchors never decorate another task.
- [ ] Activity does not change Markdown, clipboard, dirty state, save output, checkbox semantics, cursor/selection, or undo history.
- [ ] Real browser tests and release gates pass; third-party compatibility claims name tested versions and evidence.

Deferred: MCP transport, optional `lm.registerTool` adapters, durable task statuses, reading arbitrary third-party activity, native animated file decorations, automatic third-party adoption, and executing agents from checkbox clicks. A future MCP/tool adapter calls the same registry and obeys the same leases; it does not replace the extension API.
