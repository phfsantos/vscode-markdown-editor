# Diff and diagnostic hardening verification

Plans: `plan-1777652826721-hi7yd7`, `plan-1777654443317-p3eb9l`,
`plan-1783469483239-j49qxq`.

## Implementation

- `src/diff/renderedLineRules.ts` owns rendered-block eligibility. Cheerio and
  browser adapters use the same predicates; paired fixtures run in both runtimes.
  Paragraph-only list items now descend to their rendered paragraphs.
- Diff scrollbar positions use coordinates relative to the content scroll area,
  including nested positioned containers. Chromium tests cover nested spacers,
  repeated input, DOM replacement, marker position and click navigation.
- `DiagnosticVisualizer` retains focus, selection and update scheduling.
  `DiagnosticMatcher` owns anchor/fallback matching and overlap tracking.
  `DiagnosticDecorations` owns spans, tooltips and quick-fix UI. Browser
  characterization tests cover all three through the existing public API.
- The dictionary moved unchanged from `packages/media/src/words.en.txt` to
  `packages/media/assets/words.en.txt`. All files under `src/` and
  `packages/media/src/` are below 1,500 lines.

The raw-text diff fallback approximates source lines; it is not a rendered HTML
counter. The diagnostic fallback similarly searches overlapping block candidates
and must not be reused as a diff line map. Loose root text must be normalized to
the paragraph HTML produced by the backend before DOM-element targeting.

## Automated gates

Run from the repository root:

```sh
yarn lint
yarn test
yarn test:browser
yarn eslint src/app/EditorPanel.ts packages/media/src/main.ts packages/media/src/diagnostic-visualizer.ts packages/media/src/diagnostic-matcher.ts packages/media/src/diagnostic-decorations.ts packages/media/src/diff-line-dom-mapper.ts packages/media/src/diff-visualizer.ts
yarn build:extension
yarn --cwd packages/media build
npm --prefix packages/widgets run type-check
npm --prefix packages/widgets run build
```

`yarn test` includes both extension and media typechecks. The existing CI runs it
and the browser suite. The 50% core coverage floor remains: browser UI coverage
is separate, and the measured unit coverage does not justify raising it to 60%.
The existing EditorPanel message switch remains greppable and delegates to
handlers; no router conversion was needed. `find-replace.ts` remains below the
size limit.

## Installed VSIX smoke test

Verified on 2026-09-05: 252 unit tests, 30 Chromium tests, extension/media/widget
typechecks and builds, root/touched-media lint, and the source-file size inventory
pass. The VSIX archive passes its CRC check, and its main runtime assets match
the built files byte for byte. Installation into an isolated profile succeeded
at `/tmp/markdown-editor-smoke-lqyysv82`.

**Status: pending interactive verification.** Automated Chromium tests do not
prove installed-extension behavior. Keep the hardening plan active until every
row below has a recorded result. Use VS Code 1.95 or newer and the locally built
`markdown-editor-0.5.1-hardening.vsix`.

Create an isolated profile and workspace on macOS:

```sh
smoke_root=$(mktemp -d /tmp/markdown-editor-smoke.XXXXXX)
mkdir -p "$smoke_root/workspace"
cp test/fixtures/custom-block-save.md "$smoke_root/workspace/smoke.md"
env -u VSCODE_IPC_HOOK_CLI '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' \
  --user-data-dir "$smoke_root/user-data" --extensions-dir "$smoke_root/extensions" \
  --install-extension "$PWD/markdown-editor-0.5.1-hardening.vsix" --force
env -u VSCODE_IPC_HOOK_CLI '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' \
  --user-data-dir "$smoke_root/user-data" --extensions-dir "$smoke_root/extensions" \
  --new-window "$smoke_root/workspace"
```

Record the VS Code version, OS, VSIX SHA-256, profile directory, and observations.
For the fixture's board/table references, create data using the editor's insert
actions; the repository fixture intentionally does not include their JSON files.

| Flow | Procedure and expected result | Result |
| --- | --- | --- |
| Editor | Open Markdown in the custom editor; edit, save, close and reopen. Text and layout survive without extension-host errors. | Pending |
| Two-panel diff | Compare Markdown versions containing lists, a table, a quote and blank lines. Spacers align, changes decorate the intended lines, and marker clicks reveal them after edits. | Pending |
| Pending chat diff | With a chat provider available, propose a Markdown edit. Check the single-view pending diff and accept/reject controls; save and verify the resulting text. | Pending |
| Context menu | Select text and cut/copy/paste; insert a widget. Selection and content stay correct. | Pending |
| Read-only | Open the read-only side of a diff; attempt editing and use disabled-action tooltips. Content does not change. | Pending |
| Kanban and renderer | Insert a board and a table/renderer, change their data, save, reopen, and confirm both Markdown references and JSON data survive. | Pending |
| Calendar | Insert the calendar widget and exercise local UI. If provider access is configured, verify connection and calendar loading with the operator's test account. | Pending |
| AI actions | Open an `.agent.md` or `.prompt.md`, invoke context actions and chat handoff. Check provider-unavailable fallback in the clean profile, then provider-backed behavior if configured. | Pending |
| Inline suggestions | Enable suggestions, type, accept and dismiss suggestions with a configured provider. Disable them and confirm typing remains normal. | Pending |
| Diagnostics | With a diagnostic provider, check repeated-word placement, hover/quick-fix UI, typing selection, save and reopen. Diagnostic UI must not enter saved content. | Pending |

Account-dependent checks require a configured provider; absence of a provider is
a blocked result, not a pass. Capture extension-host logs for failures.

Packaging in this session uses VSCE's `pack` function against a temporary staging
directory containing the manifest, documentation and built runtime assets, after
the individual build gates. This avoids rerunning `Foyfile.ts`'s build task, which ends with
`git add -A`. No files need to be staged to create or test the VSIX.
