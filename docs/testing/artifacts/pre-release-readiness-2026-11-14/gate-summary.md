# Final source verification — 2026-11-14

Source includes GraphViewPanel graph-focus retention and deactivation reconciliation, with three added regression tests (8 graph tests total).

| Gate | Exit | Fresh result | Log |
|---|---:|---|---|
| yarn lint | 0 | Passed, 3.30s | final-lint.log |
| yarn test | 0 | All type checks; 106 core tests (7 files), 680 unit tests (76 files), 35 widget tests (4 files); 35.00s | final-test.log |
| yarn test:browser | 0 | 155 tests (14 files), 16.63s Vitest / 17.84s Yarn; approved loopback escalation | final-browser.log |

Packaging is owned by the orchestrator: final-vsce-package.log records its direct VSCE package prepublish build passing in 28.17s; that build is authoritative for the final source. final-package.log is an earlier successful standalone build and predates the graph deactivation reconciliation.

Review: Graph focus guard and deactivation reconciliation approved. Regression red/green evidence retained in graph-red.log, graph-green.log, graph-deactivation-red.log and graph-deactivation-green.log. Native harness requires a visible picker, asserts graph node labels, records local artifact continuity, waits for dirty state and compares canonical document content. Canonical comparison intentionally permits formatting normalization; its empty-line filtering also ignores blank lines inside fences (current fixture has no fenced blank lines). Visual image load and theme legibility still rely on inspecting the captured screenshots.

No source edits made by QA. No publication, tag push or registry mutations performed.
