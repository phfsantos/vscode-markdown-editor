# Preserve Default-Editor Associations Implementation Plan

> Execute with the `executing-plans` skill, task by task.

**Goal:** Setting Markdown Studio as default must not erase unrelated editor choices.
**Architecture:** Route the existing command through `DefaultEditorChecker` instead of maintaining a second writer in extension activation. Merge associations at the requested configuration scope and report success only after the write succeeds.
**Tech Stack:** VS Code configuration API, TypeScript, Vitest.

## Confirmed problem

`src/extension.ts:174` replaces `workbench.editorAssociations` with only `*.md` and `*.markdown`. This discards existing JSON, image, notebook, or other associations in that settings scope. `src/services/DefaultEditorChecker.ts:58` already has merge logic, but activation does not call it.

The checker currently reads effective settings before a global write. Reusing it unchanged could copy workspace overrides into global settings. Fix that scope issue along with the command duplication.

## Scope and file structure

| File | Change |
|---|---|
| `src/services/DefaultEditorChecker.ts` | Scope-aware merge, explicit patterns, scoped reset behavior |
| `src/extension.ts` | Delegate command, await it, handle failures and refresh after success |
| `test/default-editor-checker.test.ts` (new) | Mocked scope-specific configuration tests |
| `test/default-editor-command.test.ts` (new) | Command registration seam and notification/error tests |
| `README.md` | Document the default command's pattern/scope behavior |

Keep the existing command ID and view type. This standalone correction preserves the command's current global scope and its two patterns, `*.md` and `*.markdown`. Do not silently opt users into all seven manifest selectors. The other checker's call sites may retain its existing five-pattern default.

## Task 1: Add failing association regression tests

**Owner:** qa. **Skill:** tdd.

- [ ] Create a file-local `vi.mock('vscode')` with `ConfigurationTarget`, `getConfiguration().inspect()`, `update`, information/error notifications, and configuration listeners. Use the existing `test/mocks/vscode.ts` reset pattern; avoid expanding unrelated shared mock behavior.
- [ ] Import the checker after mocks are installed; use `vi.resetModules()` between singleton instances.
- [ ] Add this assertion to a test whose scope inspection returns the given global associations:

```ts
expect(update).toHaveBeenCalledWith(
  'editorAssociations',
  {
    '*.json': 'custom.jsonEditor',
    '*.svg': 'custom.svgEditor',
    '*.md': 'markdown-editor',
    '*.markdown': 'markdown-editor',
  },
  vscode.ConfigurationTarget.Global,
);
```

- [ ] Add cases for missing scoped settings; an existing conflicting `*.md` association; an existing identical association; and update rejection.
- [ ] Add a scope-isolation case: global `*.json = global.jsonEditor`, workspace `*.json = workspace.jsonEditor`. A global update must preserve the global value and must not copy the workspace value.
- [ ] Cover Workspace and WorkspaceFolder inspection fields separately; reject a workspace-folder write without a resource before any update.
- [ ] Cover reset: only remove associations owned by this view type, preserving patterns currently assigned to another editor and unrelated entries.
- [ ] Run `yarn vitest run test/default-editor-checker.test.ts`; confirm failures demonstrate missing scope/pattern behavior, not broken mocks.

## Task 2: Make the existing service safe at the target scope

**Owner:** code. **Skill:** tdd.
**Files:** `src/services/DefaultEditorChecker.ts`.

- [ ] Extend the existing method to accept explicit patterns while keeping old defaults:

```ts
public async setAsDefaultEditor(
  scope: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
  patterns: readonly string[] = this.MARKDOWN_PATTERNS,
  resource?: vscode.Uri,
): Promise<void>
```

- [ ] Read `getConfiguration('workbench', resource).inspect<Record<string, string>>('editorAssociations')`. Merge only `globalValue`, `workspaceValue`, or `workspaceFolderValue`, according to the requested target. An absent scoped value means an empty object, not effective workspace defaults.
- [ ] Reject WorkspaceFolder without a resource with an explicit error; do not silently redirect it to global scope.
- [ ] Keep effective reads for status display. Do not reuse an effective-status helper for a scope-specific write.
- [ ] Await the settings update before showing any success message. Let rejection propagate to the command's standard logger/error notification.
- [ ] Extend `resetToDefault(scope = vscode.ConfigurationTarget.Global, resource?: vscode.Uri)` with the same target-scope read and resource guard; delete only keys assigned to `markdown-editor`, not keys now owned by another editor.
- [ ] Run `yarn vitest run test/default-editor-checker.test.ts`.

## Task 3: Use the service from the contributed command

**Owner:** code. **Skill:** tdd.
**Files:** `src/extension.ts`, `test/default-editor-command.test.ts`.

- [ ] Capture the registered `markdown-editor.setAsDefaultEditor` handler with a file-local command mock, stub unrelated activation dependencies, and spy on `DefaultEditorChecker`.
- [ ] Assert the handler calls the checker with `ConfigurationTarget.Global` and `['*.md', '*.markdown']`; it must not independently write configuration.
- [ ] Assert sidebar refresh happens once after successful resolution, not before it; success is reported once by the service.
- [ ] Reject the service promise and assert `logger.error` plus `showErrorMessage` are called; no success message or success refresh is emitted.
- [ ] Run `yarn vitest run test/default-editor-command.test.ts` and observe failure before replacing the activation handler.
- [ ] Delegate to the service, await completion, refresh afterward, and catch failures using the existing explicit logger plus user-visible error pattern.
- [ ] Run `yarn vitest run test/default-editor-checker.test.ts test/default-editor-command.test.ts test/native-sidebar-views.test.ts`.

## Task 4: Document and verify the real setting

**Owner:** qa/code. **Skill:** test-generation; README edits are non-behavioral.

- [ ] Document that the command updates global `*.md` and `*.markdown` associations without changing unrelated choices; users may configure additional patterns themselves.
- [ ] Run `yarn lint` and `yarn check-types`.
- [ ] In a temporary profile, seed an unrelated global association plus a conflicting workspace override, invoke the real command, and inspect both settings files.
- [ ] Verify only intended global Markdown entries changed, workspace settings were not copied, the sidebar refreshes, and `.md`/`.markdown` still open in the original view type.

## Acceptance criteria

- [ ] Unrelated associations survive command execution.
- [ ] A global write never copies workspace or folder overrides.
- [ ] The command retains its two-pattern scope; existing IDs and settings remain valid.
- [ ] Reset preserves associations owned by other editors.
- [ ] Failed writes report errors and never claim success.
- [ ] Focused tests, lint/type checks, and actual settings-file smoke verification pass.

**Dependencies:** None for the correctness fix. Coordinate shared presentation files with [the branding plan](./markdown-studio-release-consistency.md); do not edit those files concurrently.

**Planning completion:** Confirmed the overwrite and duplicate writers from source; specified regressions and a scope-safe correction. No settings or implementation were changed and these new tests have not been authored or executed.
