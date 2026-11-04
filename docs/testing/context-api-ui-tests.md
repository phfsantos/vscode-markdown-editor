# Context API real-host verification

Verified 2026-11-04. These tests exercise built extension assets and VS Code itself;
unit mocks are not used for the host assertions.

## Desktop ExTester

Install the optional isolated test dependencies (Node 22+):

```sh
npm --prefix test/ui install
npm run test:ui
```

The runner downloads the ExTester-supported maximum VS Code and matching
ChromeDriver if absent. It builds production extension/webview assets, packages
a runtime-only staging directory into `.extest/markdown-studio.vsix`, installs
that package plus independent consumer/test-driver extensions into a private
extensions directory, and opens a disposable workspace and HOME. It strips
`ELECTRON_RUN_AS_NODE` and `VSCODE_*` variables. It never opens the developer's
profile or workspace and sends nothing to chat.

Existing matching tools/binaries can be reused without a download:

```sh
MARKDOWN_UI_TOOLS=/path/to/installed-tools-project \
MARKDOWN_UI_CODE='/path/to/Visual Studio Code.app/Contents/MacOS/Code' \
MARKDOWN_UI_DRIVER=/path/to/matching/chromedriver \
  npm run test:ui
```

`MARKDOWN_UI_TOOLS` points to a directory whose `node_modules` contains
`vscode-extension-tester` 8.28.1 and Mocha 11.8.0. It is optional when dependencies
were installed in `test/ui`. The tested platform is macOS x64 with VS Code
1.140.0 / Chromium 150.0.7871.250. Other platform executable layouts have not
been verified.

Use `-- --skip-setup` only when production source/package metadata are unchanged;
it reuses the installed provider VSIX. Test-only fixtures are refreshed on every
run. Fresh setup removes prior runner-owned extraction and installation folders,
so deleted assets cannot survive from an earlier package.

Six assertions passed:

- Independent consumer reports real Vditor selection `Ship` as UTF-16 range
  `0:8–0:12`, without an active or visible native editor; source bytes stay intact.
- Toolbar focus reports unavailable selection.
- Switching custom documents changes panel/resource identity; unrelated native
  text editor clears context.
- Disabling/enabling native tab badges writes the isolated User settings file
  and leaves active document context intact.
- Focusing the actual built-in chat UI retains document context without
  submitting content or invoking a model.
- Reloading the isolated window restores the custom tab with a new panel ID and
  no hidden source editor. The observer subscribes and reads initial context.

The negative check is reproducible:

```sh
MARKDOWN_UI_EXPECT_END=13 npm run test:ui -- --skip-setup --grep independent
```

It failed with an assertion diff showing actual end character `12`, expected
`13`. Restoring the default expectation yielded all six passing tests. Earlier
locator/initialization failures were harness failures and were not counted as
this negative proof. The command-palette helper polls/retries around rendering;
selection code re-finds text nodes after focus rather than selecting Vditor's
caret elements. Webview frame entry always exits in `finally`.

Results/screenshots/ChromeDriver logs live under `.extest/` (gitignored). The
workspace and host traces are private temporary artifacts for diagnosis.

## Real remote transport

Obtain a matching official VS Code **server-web** distribution. A plain desktop
or SSH server distribution may omit the web workbench. The executed distribution
was stable VS Code 1.115.0, commit
`41dd792b5e652393e7787322889ed5fdc58bd75b`.

For example, VS Code's installed CLI can acquire the pinned web build using a
loopback-only disposable service; no account login or public tunnel is needed:

```sh
code-tunnel --cli-data-dir=/private/tmp/context-cli \
  serve-web --host 127.0.0.1 --port 0 \
  --server-data-dir=/private/tmp/context-server \
  --commit-id 41dd792b5e652393e7787322889ed5fdc58bd75b
```

Stop the acquisition service after locating the extracted distribution. The
reusable test runner starts and stops its own authenticated loopback service:

```sh
VSCODE_WEB_SERVER_ROOT=/path/to/extracted/server-web \
  node scripts/uiRemoteTest.mjs
```

Build the VSIX with `npm run test:ui` first, or provide
`VSCODE_PROVIDER_VSIX=/path/to/fresh/provider.vsix`. The remote runner extracts
that exact package, installs only the independent consumer and browser driver,
and sets provider placement to workspace **in the disposable installation**.
It binds `127.0.0.1`, creates a private token file, redacts its token from logs,
and closes browser/server connections in `finally`.

Actual host placement and assertions:

- Consumer and driver ran in a browser worker (`nodeRuntime: false`, `uiKind: 2`,
  consumer `extensionKind: UI`); provider exports were absent in that host.
- Remote server logs recorded the separate Node extension-host process and
  provider activation. Provider has a Node entry point and no browser entry.
- `markdown-editor.getActiveContext` with `{ uriFormat: 'object' }` returned a
  revived `vscode.Uri` bearing the exact browser `vscode-remote://127.0.0.1:…/…`
  authority. The consumer serialized it after command RPC.
- Real rendered `Ship` selection crossed those hosts as range `0:8–0:12` with
  the same remote URI. Opening an unrelated remote text tab cleared context.

This test first failed against the original implementation: remote Node's
`TextDocument.uri` was host-local `file://`, and early string serialization
bypassed VS Code's URI transformation. That reproduced bug and the corrected
run prove this is actual command routing, not a fake remote URI in a mock.
The default no-argument JSON command still intentionally returns its host's
identity; use object mode for cross-host canonicalization.

Successful artifacts from this run:
`/private/tmp/markdown-studio-remote-ui-7zI62a/result.json`,
`workspace/remote-context-report.json`, `remoteexthost.log`, `browser-log.json`,
and screenshots. Ports were confirmed closed after cleanup. A delayed Vditor
icon resource warning and shutdown tree cancellations are recorded in the logs;
they did not prevent the range/URI/clearing assertions. This does not establish
every SSH/WSL/Dev Container placement or adoption by any AI agent.

## VS Code 1.95 baseline outcome

The official 1.95.0 macOS x64 build launched and verified cold command activation,
API version 1, provider activation, and independent consumer exports. Native
file opening stalled before a document-open event across `showTextDocument`,
explicit `openTextDocument`, and `vscode.openWith(..., 'default')`. No provider
activation error was logged; the isolated test was bounded and terminated.
Consequently full 1.95 editor/panel/selection runtime behavior is **unverified**,
not a passing result. The plan required unavailable environments to be recorded
explicitly. No API minimum-version claim is inferred from newer-host UI tests.

Reproduce with an official 1.95.0 binary using:

```sh
node scripts/uiBaselineTest.mjs '/path/to/Visual Studio Code.app/Contents/MacOS/Electron'
```

It uses private HOME/profile/extensions/workspace, strips inherited Code
variables, verifies binary metadata, and bounds execution to 180 seconds.
Evidence is under `/private/tmp/markdown-studio-ui-baseline195-ewafUB/` and
`/private/tmp/markdown-studio-ui-baseline195-WKSgaX/`. Native agent-edit badge
appearance and automatic Codex/Claude/Copilot adoption remain unverified; badge
settings and chat focus tests must not be presented as agent compatibility.
