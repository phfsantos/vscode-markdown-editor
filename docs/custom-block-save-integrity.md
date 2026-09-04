# Custom-block save integrity

This editor treats the Markdown string supplied to Vditor's `input` callback as
the authoritative document snapshot. It does not re-read Vditor's mutable IR DOM
or call `setValue` from that callback.

## Why this is necessary

Vditor renders fenced custom blocks in IR mode by maintaining source markers and
mutable preview DOM. During an input callback, that DOM can be between render
states. Serializing it at that moment can return only a prefix of a large block.
The previous input path discarded the callback value, read `getValue()`, posted
the result as a whole-document edit, and sometimes called `setValue()` again to
refresh renderers. Concurrent whole-document edits in the extension host had no
revision ordering or save barrier, so a partial or stale snapshot could become
the saved document and the baseline for later edits.

## Synchronization contract

- Local input and programmatic custom-block changes update one authoritative
  webview snapshot and emit a monotonically increasing revision.
- Toolbar Save sends that exact snapshot and revision. The extension host waits
  until the revision has been applied before calling `TextDocument.save()`.
- Document replacements run serially. Pending local revisions coalesce to the
  newest accepted revision, and older or duplicate revisions are ignored.
- Synchronized write origins compare LF and CRLF as equivalent so VS Code's
  document EOL normalization does not turn an internal replacement into an
  external update. This comparison does not rewrite the authoritative snapshot,
  replacement content, or saved Markdown.
- An external VS Code document update advances the generation. Webview messages
  from an earlier generation are rejected instead of overwriting the update.
- Input-time renderer maintenance targets affected custom-block preview nodes;
  it does not replace the whole Vditor value.

The supported editor parser is pinned to Vditor `3.11.2`, whose bundled Lute
version is `1.7.6`. The compatibility tests exercise the real Lute
Markdown-to-IR-to-Markdown conversion before and after SVG replaces rendered
preview contents. They also verify 20 edit/save cycles preserve exact fixture
bytes, fence count and order, Unicode, blank lines, and surrounding prose.

Run the focused checks with:

```sh
yarn vitest run test/content-sync.test.ts test/document-sync-controller.test.ts test/custom-render-target.test.ts test/vditor-custom-block-roundtrip.test.ts --coverage=false
yarn check-types
```

## Recovery limitation

Synchronization prevents new partial snapshots from being accepted; it cannot
reconstruct source text that was already truncated and saved. Recover an affected
file from VS Code undo history if it is still available, source control, editor
timeline/local history, or another backup. Do not use a damaged file as an
expected round-trip fixture.
