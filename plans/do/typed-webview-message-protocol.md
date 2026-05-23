# Plan: Type-safe webview ↔ extension message protocol

## 1. Intake

**Goal**
Make every message between the extension host and the webview type-checked at compile time, with a single source-of-truth schema and generated TypeScript types for both sides.

**User outcome (for contributors)**
Adding a new message becomes: edit one schema file → both sides get types automatically. Renaming a command surfaces a compile error on every call site rather than a silent runtime failure. Reviewers can see at a glance what messages exist.

**Core framing**
- **One schema, two consumers.** A single source of truth (Zod / TypeBox / discriminated union TS) generates types used by both extension host and webview.
- **Typed `postMessage` / `onDidReceiveMessage` wrappers** that narrow on `command`.
- **No runtime dependency added on the webview side** — types only.

---

## 2. Scope

**Scope:** Project — touches every `postMessage` and `onDidReceiveMessage` call. Migration is incremental.

---

## 3. Repo touchpoints

Today the protocol is implicit. Roughly:

- [src/app/EditorPanel.ts](src/app/EditorPanel.ts) — 20+ `postMessage` / `onDidReceiveMessage` sites (e.g. [src/app/EditorPanel.ts:301](src/app/EditorPanel.ts#L301), [src/app/EditorPanel.ts:606](src/app/EditorPanel.ts#L606), [src/app/EditorPanel.ts:1451](src/app/EditorPanel.ts#L1451))
- [src/app/GraphViewPanel.ts](src/app/GraphViewPanel.ts) — graph panel messaging
- [packages/media/src/main.ts](packages/media/src/main.ts), [packages/media/src/vscode-integrator.ts](packages/media/src/vscode-integrator.ts) — webview-side handlers
- [packages/media/src/widget-integration.ts](packages/media/src/widget-integration.ts) — widget messages
- [packages/media/src/ai-markdown-bridge.ts](packages/media/src/ai-markdown-bridge.ts) — AI markdown round-trips

Search `command: "..."` in extension code and `case "..."` in webview to enumerate the full set.

---

## 4. Product definition

### Schema choice

Two reasonable options:

**(A) Discriminated TS union (recommended starting point)**
- Pure types in `packages/protocol/src/index.ts`.
- Zero runtime dependency; fastest to ship.
- Drawback: no runtime validation at the boundary.

**(B) Zod-defined messages**
- Same types, plus runtime validation at the extension-host boundary (where webview is untrusted in principle).
- Adds ~12KB to the extension bundle; webview can still consume types only.

Recommend **A** for the migration, **B** later for hardening if needed.

### Shape

```ts
// packages/protocol/src/index.ts
export type FromWebview =
  | { command: 'ready' }
  | { command: 'save'; content: string }
  | { command: 'requestEmbed'; filename: string; currentDocument: string }
  | { command: 'aiMarkdownAction'; action: string; payload?: unknown }
  // ...exhaustive list

export type FromExtension =
  | { command: 'init'; documentPath: string; cdnBaseUri: string; options: VditorOptions; theme: 'dark' | 'light'; isReadOnly: boolean }
  | { command: 'update'; content: string }
  | { command: 'aiMarkdownActionResult'; ok: boolean; data?: unknown }
  // ...exhaustive list
```

### Typed wrappers

```ts
// extension host
panel.postMessage(msg: FromExtension): Thenable<boolean>
panel.onMessage(handler: (msg: FromWebview) => void | Promise<void>): Disposable

// webview
vscode.postMessage(msg: FromWebview): void
onMessage((msg: FromExtension) => { switch (msg.command) {...} })
```

A `dispatch(msg, handlers)` helper enforces exhaustive `switch` via `assertNever`.

---

## 5. Execution plan

| Step | What | Depends on | Done when |
|------|------|------------|-----------|
| 1 | Inventory all messages (grep `command:` and `case "`); produce checklist | None | Checklist committed; ~50+ entries expected |
| 2 | Create `packages/protocol/` with `FromWebview` / `FromExtension` unions for inventoried messages | Step 1 | Both packages can import the types |
| 3 | Typed wrappers `TypedPanel.postMessage` and `dispatch` helper | Step 2 | At least one panel migrated end-to-end |
| 4 | Migrate [EditorPanel](src/app/EditorPanel.ts) call sites; fix surfaced type errors | Step 3 | EditorPanel compiles with no `any`/`as any` on messages |
| 5 | Migrate webview handlers in [main.ts](packages/media/src/main.ts) and bridges | Step 4 | Webview uses `dispatch()` with exhaustive switch |
| 6 | Migrate GraphViewPanel + widget integration | Step 4 | All panels typed |
| 7 | Lint rule (or grep CI check) banning raw `postMessage`/`onDidReceiveMessage` outside wrappers | All | CI fails on regression |

---

## 6. Acceptance criteria
- One source-of-truth file lists every message; both sides import from it.
- Adding a message requires editing exactly one schema file.
- `tsc` catches: typos in `command`, missing payload fields, wrong field types, unhandled cases in webview switches.
- No remaining `any` types on `postMessage`/`onDidReceiveMessage` paths.

---

## 7. Risks
| Risk | Mitigation |
|------|------------|
| Big-bang migration is too disruptive | Migrate per-panel; keep raw API working until last call site moved |
| Some payloads are inherently `unknown` (third-party widget data) | Allow `payload: unknown` with explicit comment; narrow at the handler |
| Schema drifts from runtime as fields are added in haste | Add the CI grep check in Step 7 the day the first panel migrates |

---

## 8. Why not codegen from a separate IDL?
A pure TS discriminated union is already cross-package via the `protocol` package. JSON Schema or `.proto` codegen adds build complexity without buying us anything until we need cross-language consumers — which we don't.
