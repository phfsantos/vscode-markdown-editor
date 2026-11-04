# Agent activity real-window verification

This suite uses an independently installed producer extension and freshly packaged
Markdown Studio assets in an isolated VS Code profile and disposable workspace.
It sends no messages to an AI provider and needs no agent account.

Run with the optional ExTester dependencies installed under `test/ui`:

```sh
node scripts/activityUiTest.mjs
```

Existing tool dependencies, supported VS Code and matching ChromeDriver can be
selected with `MARKDOWN_UI_TOOLS`, `MARKDOWN_UI_CODE`, and
`MARKDOWN_UI_DRIVER`. `--skip-setup` is appropriate only when production assets
have not changed. The runner refreshes independent test fixtures on every run.

The suite checks a real static A tab badge and status/header fallback; targeting
the second of duplicate checkboxes; source bytes, document version and clean
state; exports and JSON commands; multiple producers; disabled badge settings;
split and closed/reopened custom tabs; source anchor remapping and invalidation;
reload cleanup; and expiry after a real 120-second lease without heartbeat.
It uses public Tabs API observations from the independent driver and rendered
workbench/webview DOM assertions. It does not inspect the registry internals.

Results and screenshots are written under `.extest/activity/`. The driver
writes per-checkpoint document/context/tab metadata to `activity.json` inside
the temporary workspace recorded in `result.json`.

## Execution evidence

Pending the fresh production run during implementation. No third-party agent
compatibility is claimed by this test fixture. Baseline 1.95, native AI badge
competition, remote cross-host command transport, and other OS platforms require
separate version-specific evidence.
