# Markdown Studio Release Consistency Plan

> Execute with the `executing-plans` skill, task by task. This is a plan, not a record of shipped changes.

**Goal:** Release the existing extension as Markdown Studio with one product label, coherent icons, accurate documentation, and verified existing workflows.
**Architecture:** Change presentation, not extension identity. Reuse the sidebar glyph for the Marketplace artwork; keep the Activity Bar icon monochrome and theme-aware. Treat VS Code's editor-picker composition as a host-owned feasibility gate rather than assuming a manifest rename fixes it.
**Tech Stack:** VS Code custom text editors, TypeScript, SVG/PNG, Vitest, Playwright, Yarn workspaces, Foy, esbuild, VSCE.

## Decisions and scope

- The user selected **Markdown Studio** from Markweave, Markdown Studio, Noteweave, Markflow, and Markdown Atlas. Name availability and trademark clearance have not been checked.
- Suggested description: "Visual Markdown editing and connected notes for VS Code."
- The user requires the editor entry to be **exactly `Markdown Studio`**, not `Markdown Studio - Markdown Studio` or `Visual Markdown - Markdown Studio`.
- Preserve `publisher: phfsantos`, `name: markdown-editor`, `viewType: markdown-editor`, command IDs, settings keys, view IDs, URI authority, workspace storage keys, and package names.
- Preserve current file selectors, editing modes, save behavior, and opt-in AI defaults. Do not combine this presentation change with a file-format expansion.
- This plan does not authorize publishing, tag pushes, a new extension listing, or an arbitrary version bump.
- Strategy: active CEO vision revision 3, goals `g-2026-release` and `g-2026-release-gate`. Reliability and Markdown fidelity remain release requirements.

## Related independent plans

1. [Preserve default-editor associations](./preserve-default-editor-associations.md): confirmed settings-overwrite bug; can ship independently.
2. [Validate release identity and packaging](./release-identity-and-packaging-gates.md): version/tag validation, safer publishing entry points, and repeatable packaging.

Complete those plans before calling the combined release ready. Reconcile the existing ProjectMind slim-down plan `plan-1783416375809-d1rwgm` with current evidence; its old version, test-runner, and size assumptions are not fresh requirements.

## Evidence collected on 2026-10-26

| Observation | Evidence | Treatment |
|---|---|---|
| Both product and custom-editor names are `Markdown Editor` | `package.json:3` and `package.json:249`; user screenshot shows the repeated label | Confirmed input duplication; exact host rendering still needs reproduction |
| Listing and sidebar use different icons | `package.json:4` uses `media/logo.png`; Activity Bar uses `media/sidebar-icon.svg` | Replace listing artwork with a colored rendering of the sidebar glyph |
| Existing listing icon is 128x128 with transparency | `file media/logo.png`; direct image inspection | Produce an opaque, high-resolution branded tile |
| Visible names drift across UI | Command categories/configuration title use `markdown-editor`; sidebar title is `Markdown Tools`; output channel and notifications use `Markdown Editor` | Update presentation surfaces together |
| README is stale and contains invalid CSS instructions | `README.md:142`, `README.md:290`, `README.md:321` | Fix examples and release copy, not just the heading |
| Release documents disagree | Manifest is 0.5.11; changelog starts at 0.5.0 Unreleased; checklist names 0.4.7 | Reconcile against actual release evidence; do not invent history |
| README media are excluded from the VSIX | `.vscodeignore` excludes `demo.gif` and `media/screenshot-main.png` | Verify rewritten URLs in the packaged README before deciding whether exclusions are a bug |
| Default command replaces other associations | `src/extension.ts:174` writes a new two-entry object | Separate corrective plan |

Public VS Code source currently maps custom-editor `displayName` to the editor label and the extension display name to provider detail:

- [Custom-editor registration](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/customEditor/browser/customEditors.ts)
- [Provider display-name derivation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/customEditor/common/contributedCustomEditors.ts)
- [Open With picker](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/editor/browser/openWithEditorPicker.ts)

These moving upstream references explain the constraint, not the exact behavior of the user's installed VS Code build.

## File structure first

| File | Responsibility |
|---|---|
| `package.json` | Visible extension name, description, editor contribution, command categories/titles, sidebar title, settings title, icon path |
| `src/utils/Logger.ts` | Output channel name and troubleshooting consistency |
| `src/app/EditorPanel.ts` | Fallback webview title |
| `src/app/PreviewCustomEditorProvider.ts` | Recreated webview title |
| `src/app/NativeNotificationService.ts` | Product-name fallback only; preserve explicit widget titles |
| `src/sidebar/MarkdownNativeViews.ts` | Default-editor warning/action labels |
| `src/services/DefaultEditorChecker.ts` | Default-editor prompts and status tooltips |
| `src/navigation/MarkdownEditorNavigation.ts` | User-facing navigation error wording only |
| `src/extension.ts` | Activation/success messages; association logic belongs to the independent fix |
| `media/sidebar-icon.svg` | Existing monochrome source glyph |
| `media/marketplace-icon.svg` (new) | Colored composition of the same glyph with an opaque background |
| `media/logo.png` | Rasterized listing icon, retaining the existing manifest path |
| `media/screenshot-main.png` | Current, accurately branded workspace screenshot |
| `README.md`, `CHANGELOG.md`, `PUBLISHING_CHECKLIST.md` | User-facing product and release truth |
| `test/package-layout.test.js` | Manifest branding and stable-identity regression checks |
| `test/branding-assets.test.ts` (new) | PNG dimensions/opacity and glyph consistency |
| `test/native-sidebar-views.test.ts` | Sidebar presentation regression checks |

Do not introduce a branding service or a broad codebase replacement. Keep presentation edits scoped to the identified surfaces; retain technical identifiers and historical release names.

## Task 1: Prove the exact editor-label requirement is supported

**Owner:** debug/researcher. **Skill:** debugging. **Exception:** investigation only.
**Files:** inspect `package.json` and the matching VS Code source; record evidence in this plan.

- [ ] Reproduce the screenshot's dropdown in a clean profile with only this extension enabled. Record the precise VS Code version, extension version, and which picker/menu produces the composed text.
- [ ] Inspect the supported contribution schema and label construction for that host version, plus current Stable and Insiders. Distinguish an actual duplicate registration from a provider suffix.
- [ ] Establish a supported configuration that renders exactly `Markdown Studio` in the reported picker while preserving one custom-editor registration and its existing view type.
- [ ] If no supported configuration achieves this, mark this task blocked with source/UI evidence and request a scope decision. Do not use empty names, invisible characters, workbench DOM patching, a second registration, or a silently substituted two-part label.
- [ ] Capture before/after UI evidence for the exact reported dropdown and for Reopen Editor With. A manifest assertion alone cannot pass this gate.

**Dependency:** Task 2's editor-contribution change and final branding approval depend on this gate. Icon work, documentation cleanup, and independent bug fixes can proceed if it is blocked.

## Task 2: Apply consistent visible branding without migration

**Owner:** code. **Skill:** tdd; pure copy/manifest edits are non-behavioral exceptions.
**Files:** manifest and presentation files listed above; `test/package-layout.test.js`, `test/native-sidebar-views.test.ts`.

- [ ] Add the following regression to `test/package-layout.test.js`, run it, and confirm it fails before editing production copy:

```js
test('Markdown Studio preserves the installed extension identity', () => {
  assert.strictEqual(packageJson.displayName, 'Markdown Studio');
  assert.strictEqual(packageJson.name, 'markdown-editor');
  assert.strictEqual(packageJson.publisher, 'phfsantos');
  assert.strictEqual(packageJson.contributes.customEditors.length, 1);
  assert.strictEqual(
    packageJson.contributes.customEditors[0].viewType,
    'markdown-editor'
  );
  assert.strictEqual(
    packageJson.contributes.viewsContainers.activitybar[0].title,
    'Markdown Studio'
  );
  for (const command of packageJson.contributes.commands) {
    assert.strictEqual(command.category, 'Markdown Studio');
  }
  assert.strictEqual(packageJson.contributes.configuration.title, 'Markdown Studio');
});
```

- [ ] Set the product name, sidebar title, configuration title, and command categories to `Markdown Studio`. Use `Open in Markdown Studio` and `Set Markdown Studio as Default` for opening/default actions. Set the custom-editor contribution only to the configuration proven in Task 1.
- [ ] Update output channel, fallback panel titles, default-editor messages, notification fallbacks, navigation errors, and activation copy. Preserve generic references to the Markdown editor as a component and preserve all IDs.
- [ ] Extend sidebar tests to assert the new default-editor prompt/title while its command ID remains `markdown-editor.setAsDefaultEditor`.
- [ ] Run `yarn vitest run test/package-layout.test.js test/native-sidebar-views.test.ts test/extension-runtime.test.ts test/source-navigation.test.ts`.
- [ ] Run `yarn lint` and `yarn check-types`. Review the diff for accidental identifier, selector, or default-setting changes.

## Task 3: Create the shared icon family

**Owner:** designer/media. **Skill:** design. **Exception:** authored asset files.
**Files:** `media/sidebar-icon.svg`, new `media/marketplace-icon.svg`, `media/logo.png`, new `test/branding-assets.test.ts`.

- [ ] Keep the current sidebar silhouette: Markdown M, down arrow, and three plus marks. Keep its Activity Bar version `currentColor`, without a tile background, so VS Code themes it.
- [ ] Create a 512x512 listing tile: opaque deep-navy `#13243A` background, cyan `#38BDF8` M/arrow, warm-gold `#FBBF24` plus marks, and at least 48px internal padding. No product-name text in the tile.
- [ ] Reuse the source path geometry/transforms. Convert the existing font-based plus marks to vector paths for deterministic SVG/PNG rendering; preserve the visible silhouette.
- [ ] Produce the colored SVG and rasterize `media/logo.png` from it. Use a locally available SVG renderer; if none exists, choose and declare a minimal dev-only dependency before installation, not a runtime dependency.
- [ ] Add asset tests: manifest icon resolves to the PNG; PNG signature is valid; IHDR dimensions are 512x512; decoded pixels are fully opaque; normalized glyph paths match between sidebar and tile sources. Select the decoder after checking installed tooling; do not approximate opacity with PNG color type alone.
- [ ] Run `yarn vitest run test/branding-assets.test.ts test/package-layout.test.js`.
- [ ] Inspect both assets at 16, 24, 48, and 128 CSS pixels on light/dark backgrounds. Inspect the Activity Bar in light, dark, and high-contrast themes. If visual legibility fails, revise the asset before packaging.

**Acceptance:** Marketplace and installed-extension details show the same colored PNG; the sidebar uses its matching monochrome glyph. Do not replace the Activity Bar asset with the colored tile.

## Task 4: Make README and release copy accurate

**Owner:** code/documentation. **Skill:** documentation. **Exception:** non-behavioral edits.
**Files:** `README.md`, `CHANGELOG.md`, `PUBLISHING_CHECKLIST.md`, `media/screenshot-main.png`.

- [ ] Update README title, intro, hero icon, screenshot alt text, command names, sidebar name, and Output-channel instructions. Explain that Markdown Studio is the renamed Markdown Editor and existing settings/associations remain valid.
- [ ] Preserve Marketplace badges, install URL, URI handler examples, and configuration keys using `phfsantos.markdown-editor` / `markdown-editor.*`.
- [ ] Replace the broken Custom CSS section with this valid Settings JSON example:

```json
{
  "markdown-editor.customCss": ".vditor-reset { max-width: 900px; margin: 0 auto; }"
}
```

- [ ] Replace the stale "What's New in 0.4.7" promotion with an accurate current overview and a changelog link. Remove the completed Custom Text Editor item: `PreviewCustomEditorProvider` already implements `CustomTextEditorProvider`.
- [ ] Remove screenshot-placement instructions from the public README. Replace the screenshot with the actual branded build, containing no private workspace data. Retain historical changelog names rather than rewriting history.
- [ ] Remove unsupported blanket "0 vulnerabilities", "all tests passing", and release-readiness claims. Keep performance scale claims only where current reproducible evidence exists; otherwise describe the behavior without claiming measured certification.
- [ ] Reconcile changelog entries with tags/release evidence. Add branding and the independent association fix under Unreleased; only assign a release version/date during the release process.
- [ ] Rewrite the checklist as an unchecked, repeatable checklist that reads the version from the manifest, references the release-gates plan, and requires fresh results instead of prechecked old claims.
- [ ] Verify README links and media both from repository preview and from the packaged README. VSCE may rewrite repository-relative image URLs: inspect the result before changing `.vscodeignore`. Ensure the new icon works before and after publication, not only on a development branch.

## Task 5: Verify the installed artifact, not just source

**Owner:** qa. **Skill:** test-generation.
**Files:** targeted regression tests and `PUBLISHING_CHECKLIST.md` evidence.
**Dependency:** Tasks 1-4 and the independent release/association plans.

- [ ] Run fresh `yarn lint`, `yarn test`, `yarn test:browser`, and `yarn package`. Fix failures within their owning task; record unrelated blockers rather than masking them.
- [ ] Build a VSIX with the verified local VSCE tooling from the release-gates plan. Inspect the packaged manifest, logo, README, runtime bundles, and asset references.
- [ ] Install that VSIX into a clean test profile. Verify installed-details name/icon, Activity Bar name/glyph, command categories, settings title, Output channel, and the exact single-label requirement.
- [ ] Run an upgrade check from the preceding published version: saved settings, editor associations, workspace data, and URI navigation must still work without migration.
- [ ] Smoke-test opening via command/menu/association; edit/save/reopen including custom fenced blocks; undo/redo; multiple tabs/diff; wiki-links/backlinks/tags/graph; image paste; daily notes; and opt-in AI remaining off until enabled.
- [ ] Record OS, VS Code build, package version, VSIX filename, commands/results, and screenshots. Browser Vitest tests do not prove VS Code chrome behavior.
- [ ] Verify Marketplace and Open VSX artwork/media only after an explicitly authorized publication. Keep this verification pending until the actual listings are inspected.

## Acceptance criteria

- [ ] Exactly `Markdown Studio` is shown in the reported picker, with one registration and no unsupported workaround. An unresolved host limitation blocks this criterion.
- [ ] Visible product names agree across installed details, sidebar, commands, settings, Output, notifications, and README; technical identifiers remain unchanged.
- [ ] The installed page and Marketplace use the opaque 512x512 colored sidebar-derived icon; the Activity Bar remains theme-aware.
- [ ] README examples parse, command names match contributions, media resolve, and release documents no longer contradict the manifest.
- [ ] Both independent corrective plans pass their regression checks; fresh lint/type/unit/widget/browser/build checks and installed-artifact smoke checks are recorded.

## Broader findings: explicitly not verified fixes

- The manifest selects `.md`, `.markdown`, `.mdown`, `.mkdn`, `.mkd`, `.rmd`, and `.qmd`, but positioned navigation accepts only `.md` and `.markdown`; the default-checker list also differs. Decide the supported format policy before widening navigation or automatic defaults, especially for R/Quarto files.
- `Logger.error` currently emits only when debug logging is enabled (`src/utils/Logger.ts`). Investigate always-visible error reporting separately; do not mix a logging behavior change into the rename.
- Existing accessibility, multi-root, typed-message, and widget-protocol plans remain separate. This focused review is not a full application, accessibility, or security audit.
- Do not assume the second `Markdown Editor` entry in the screenshot belongs to this installation. Identify its provider in a clean profile before changing registrations.

## Planning verification and handoff

Baseline command on 2026-10-26:

```sh
yarn vitest run test/package-layout.test.js test/native-sidebar-views.test.ts test/extension-runtime.test.ts test/source-navigation.test.ts
```

Result: **4 files, 29 tests passed**. No full release suite or installed-host smoke run was performed for this planning task.

The local `node_modules/.bin/vsce` path was absent; do not silently install packages during planning. Concurrent unrelated widget/protocol work appeared during inspection, including changes to `package.json` and `README.md`; none was modified by this planning task. Re-read shared files before execution rather than applying this snapshot over newer work.

**Planning completion:** Source and public-host behavior were inspected; the user chose the name and strict label requirement; implementation and validation tasks are defined. No extension behavior, assets, public README, release metadata, commits, tags, or listings were changed.
