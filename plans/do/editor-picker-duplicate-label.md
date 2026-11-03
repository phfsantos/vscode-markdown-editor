# Editor Picker Duplicate Label Follow-up Plan

> Execute with the `executing-plans` skill, task by task.

**Goal:** Stop VS Code's editor-type picker from showing "Markdown Studio - Markdown Studio".
**Architecture:** Two separate levers:
- **Upstream (VS Code):** the "{editor name} - {extension name}" format is VS Code's. Only VS Code can make it show "Markdown Studio" once (Tasks 1-3).
- **Extension-side workaround:** the extension controls the editor name. Giving it a name different from "Markdown Studio" removes the repeat today, but the entry then shows two different names (see "Extension-side workaround").
**Tech Stack:** VS Code workbench (TypeScript), GitHub issues/PRs, `package.json` contributions.

## Confirmed problem

- `src/vs/workbench/browser/parts/editor/editorTypePicker.ts` (`labelWithSource`) renders `"{editor label} - {extension displayName}"` for every extension-provided editor. It only skips the suffix for built-in editors.
- No `package.json` setting can make the entry read just "Markdown Studio": an empty extension `displayName` falls back to the extension ID (`contributedCustomEditors.ts`). Making the two names different is the only extension-side option, and it removes the repeat rather than the suffix.
- Other extensions are affected the same way, for example Microsoft's Hex Editor ("Hex Editor - Hex Editor") and Excalidraw ("Excalidraw - Excalidraw").
- The picker landed in VS Code in October 2026 and is still changing (latest commit 2026-10-27), so an upstream fix has a good chance of landing before it reaches more users.
- Decision on 2026-10-26: keep both names as "Markdown Studio" and accept the duplicate until upstream fixes it.

## Task 1: File the upstream issue

**Owner:** maintainer.

- [ ] Search `microsoft/vscode` once more for an existing report (`editorTypePicker`, "editor type picker duplicate", "Reopen Editor With label"). If one exists, add a 👍 and the Markdown Studio/Hex Editor/Excalidraw examples instead of filing a new issue.
- [ ] Otherwise, file the issue using the session draft (title: "Editor type picker repeats the name when a custom editor's label equals its extension's display name").
- [ ] Link the issue in `README.md` → "Known issues".

## Task 2 (optional): Contribute the fix upstream

**Owner:** maintainer. **Skill:** tdd.

- [ ] In a `microsoft/vscode` fork, add a failing unit test for the picker label: a custom editor whose label equals its source shows the label once; a different source still shows "{label} - {source}".
- [ ] Change `labelWithSource` to skip the suffix when `editor.detail === label`.
- [ ] Open a PR that references the issue from Task 1.

## Task 3: Re-check after VS Code updates

**Owner:** maintainer.

- [ ] When an Insiders/stable build includes the fix, open a Markdown file → editor-type dropdown and confirm it shows "Markdown Studio" once.
- [ ] Remove the README "Known issues" entry and mark the ProjectMind release plan's exact-label criterion as done.

## Extension-side workaround (available now, or if upstream declines)

- This fixes the duplicate without waiting for VS Code, at the cost of the single-name branding chosen on 2026-10-26.
- Rename only the custom editor (`contributes.customEditors[0].displayName`) to something that reads well as the first half of the label, for example "Visual Editor", which shows "Visual Editor - Markdown Studio" (similar to Draw.io's "Draw.io - Draw.io Integration"). Update the label test in `test/package-layout.test.js` and the README if this is chosen. This needs the maintainer's approval because it reverses the 2026-10-26 decision.

## Acceptance criteria

- [ ] An upstream issue (new or existing) is linked from the README.
- [ ] The picker no longer repeats the name: either a released VS Code build shows "Markdown Studio" once (upstream fix), or the maintainer has adopted the extension-side editor rename.
