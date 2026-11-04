---
name: vscode-ui-testing
description: Use when a change must be proven in a real VS Code window rather than the vscode mock — a webview panel, a command, configuration writes, the native Settings editor, tree views. Drives ProjectMind's packaged VSIX with vscode-extension-tester (ExTester) through `npm run test:ui`, including the traps that make it fail when run from an agent inside VS Code.
tags: ["testing", "vscode", "e2e", "webview", "extester", "selenium"]
---
# Driving a real VS Code with vscode-extension-tester

Vitest (`npm test`) runs against `test/mocks/vscode.ts`. It proves what code
*asks* the host to do, never what the host *does*: whether `update()` wrote the
file you think, whether `onDidChangeConfiguration` reached a panel, whether the
native Settings editor agrees. For those, run a UI test.

## What is installed


| Piece                                                                                     | Where                                                                               |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `vscode-extension-tester` 8.28.1 (supports VS Code 1.138–1.140), `mocha`, `@types/mocha` | devDependencies                                                                     |
| Runner                                                                                    | `scripts/uiTest.mjs` → `npm run test:ui`                                           |
| Tests                                                                                     | `test/ui/*.test.ts` (Mocha, CommonJS via `tsconfig.ui-test.json` → `out/ui-test/`) |
| Test-instance user settings                                                               | `test/ui/codeSettings.json` (MCP, hooks, auto-registration, schedulers OFF)         |
| Downloads, installed VSIX, screenshots,`chromedriver.log`                                 | `.extest/` (gitignored, vscodeignored, ~550 MB)                                     |

## Running

```bash
export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH"
npm run test:ui                                   # compile, download, package+install VSIX, run (~3 min first time)
npm run test:ui -- --skip-setup                   # reuse the installed VSIX (~40 s) — ONLY when src/ is unchanged
npm run test:ui -- --skip-setup --grep "native"   # one test
```

`--skip-setup` keeps the **old VSIX**. After any change under `src/` or
`package.json`, run without it, or you are testing the previous build.

On failure, read the screenshot first: `.extest/screenshots/<timestamp>/<test title>.png`
(the Read tool shows images). It answers "which editor was focused / what was on
screen" faster than any log.

## What the runner does for you (do not undo it)

1. **Strips `ELECTRON_RUN_AS_NODE` and every `VSCODE_*` variable.** An agent in
   the Claude Code / Codex extension (or the integrated terminal) inherits
   `ELECTRON_RUN_AS_NODE=1`; the downloaded Code binary then boots as plain
   Node and ChromeDriver says only `SessionNotCreatedError: Chrome instance exited`. Diagnose with `".extest/Visual Studio Code.app/Contents/MacOS/Code" --version`
   — a Node version (`v24.x`) instead of a VS Code version means this.
2. **Runs `run-tests` with `HOME` set to a temp dir** and opens a temp workspace
   via `-r`. ProjectMind activates on startup and writes `.claude/`, `.codex/`,
   `.projectmind/`, `AGENTS.md` into the workspace and user-level config under
   HOME. Setup (`setup-tests`) keeps the real HOME because vsce needs the npm cache.
3. Passes paths to tests via env: `PM_UI_WORKSPACE` (the workspace folder) and
   `TEST_RESOURCES` (set by ExTester; User settings live at
   `$TEST_RESOURCES/settings/User/settings.json`).

## Writing a test

Copy the shape of `test/ui/settingsPage.test.ts`:

- Import `describe/it/before/after` **from `'mocha'`**, not globals — the file is
  also typechecked by `npm run typecheck:tests` alongside vitest.
- Open things through the command palette by **title**:
  `new Workbench().executeCommand('ProjectMind: Open Settings')`.
- **Webviews:** `await new EditorView().openEditor('<panel title>')`, then
  `const view = new WebView(); await view.switchToFrame(10_000)`, query with
  `view.findWebElement(By.id(...))`, and **always** `switchBack()` in a
  `finally` — a test that leaves the driver inside the iframe breaks every
  later workbench call.
- **Re-find elements after every host round-trip.** A panel that re-renders on
  each `state` message (ours does) makes held `WebElement`s stale.
- Inputs that write on `change` need a blur: `sendKeys(text, Key.TAB)`.
- **Keyboard inside a webview:** `driver.actions().sendKeys(Key.TAB)` never
  reaches the nested frame (focus stays put). Use
  `driver.switchTo().activeElement().sendKeys(Key.TAB)`. When
  `document.activeElement` becomes `<body>`, Tab has left the webview.
- **Themes:** write `workbench.colorTheme` to the User settings.json, then wait
  for the webview's `<body>` class (`vscode-dark`, `vscode-light`,
  `vscode-high-contrast`, `vscode-high-contrast-light`) before measuring.
  `test/ui/settingsPageA11y.test.ts` computes WCAG contrast in-page.
  Select an `<option>` by clicking `By.css('#sel option[value="x"]')`.
- **Poll, never sleep.** Wrap assertions in an `eventually()` built on
  `driver.wait(fn, timeout, undefined, 250)` and rethrow the last assertion
  error on timeout, so a failure prints the real diff instead of "Wait timed out".
- **Assert ground truth from disk** (settings.json files), not only from the UI.
- Pick inert keys/commands: anything that triggers network, model calls, or
  installers will flake or touch real accounts.
- Clean up in `after()` what you wrote to settings files.

## Page-object traps (ExTester 8.28.1 on VS Code 1.140)

- `SettingsEditor.switchToPerspective()` is **broken**: it looks for
  `a[@title='User']`, and 1.140's tabs have no title. Click
  `.settings-tabs-widget .action-label` whose text is `User`/`Workspace`
  (see `switchPerspective` in the settings test).
- `findSettingByID('projectmind.x').getValue()` returns a **string** for number
  settings — compare `String(expected)`.
- `-c max` pins the newest supported VS Code (1.140). A newer `vscode-extension-tester`
  moves that, and locators may break; re-run before trusting a bump.

## Proving a UI test is not vacuous

A green UI test proves nothing until you have seen it go red for the right
reason. Flip one expectation (e.g. swap the User/Workspace expected values) and
run with `--skip-setup --grep`: it must fail with an assertion diff, not a
locator error. Restore the file afterwards.

## Where this is NOT the right tool

- Pure logic, message shapes, render-path of a webview → vitest + jsdom
  (`test/unit/views/`), seconds instead of minutes.
- CI: no workflow runs `test:ui` yet (it needs a display; Linux would need
  `xvfb-run`). It is a local/agent verification tool today.
