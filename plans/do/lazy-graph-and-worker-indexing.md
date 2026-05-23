# Plan: Lazy graph rendering + worker-based indexing

## 1. Intake

**Goal**
Make the graph view and link/backlink index scale to 5,000+ note workspaces without freezing the UI thread or the extension host.

**User outcome**
Opening the graph view on a large vault remains responsive (under ~500ms to first paint), pan/zoom is smooth, and indexing during file changes does not block typing or rendering.

**Core framing**
- **Lazy/incremental rendering** in the graph webview: viewport-aware node loading, level-of-detail, and adaptive simulation.
- **Worker-based indexing** in the extension host: move parsing/link extraction off the main thread.
- **Adaptive cache eviction** keyed by access recency + node degree, not just insertion order.

---

## 2. Scope

**Scope:** Project — touches the graph panel, link index, and cache layer. Performance work needs measurement infrastructure.

---

## 3. Repo touchpoints

- [src/app/GraphViewPanel.ts](src/app/GraphViewPanel.ts) — graph webview host (461 lines)
- [src/services/LinkGraphGenerator.ts](src/services/LinkGraphGenerator.ts) — current graph data assembly
- [src/services/RelationshipAnalyzer.ts](src/services/RelationshipAnalyzer.ts) — relationship computations
- [src/services/LinkResolver.ts](src/services/LinkResolver.ts) — link parsing
- [src/sidebar/MarkdownSidebarContext.ts](src/sidebar/MarkdownSidebarContext.ts) — invalidation/refresh entry points
- [src/performance/PerformanceOptimizer.ts](src/performance/PerformanceOptimizer.ts) — existing perf hooks

---

## 4. Product definition

### Graph rendering (webview)
1. **Viewport-aware rendering:** only nodes within the visible viewport + 1 hop are rendered as DOM/canvas elements; offscreen nodes are stub data.
2. **Level-of-detail (LOD):** at low zoom, render clusters; at high zoom, render labels + edges.
3. **Force-sim throttling:** halt simulation after `n` iterations or when kinetic energy falls below threshold; pause when tab hidden.
4. **Initial subset:** open with neighborhood-of-active-file (depth 2) first, expand to full graph on demand.

### Worker-based indexing (extension host)
1. Move file parsing, frontmatter extraction, and link extraction into a `Worker` (Node `worker_threads`).
2. Main thread keeps the in-memory index; worker returns deltas via `postMessage`.
3. Debounced re-indexing on `onDidChangeTextDocument`; full re-scan only on workspace change.

### Cache eviction
1. Replace insertion-ordered cache with a scored eviction policy: `score = α·recency + β·degree + γ·incomingEdges`.
2. Configurable max size with sensible default (~10k entries).
3. Persist warm subset across reloads (workspaceState).

### Telemetry (local only)
1. Time-to-first-paint for graph open.
2. Index throughput (files/sec).
3. Cache hit rate.
Surfaced via output channel only, no network reporting.

---

## 5. Execution plan

| Step | What | Depends on | Done when |
|------|------|------------|-----------|
| 1 | Add perf instrumentation: timings for graph open, index build, cache lookup | None | Output channel shows numbers on a 5k vault |
| 2 | Establish baseline: 500/2k/5k synthetic vaults; record numbers | Step 1 | Baseline table committed to plan |
| 3 | Worker-based indexer: extract parsing into `worker_threads`; same public API | Steps 1-2 | Index build time drops; main thread responsive during scan |
| 4 | Adaptive cache eviction with scored policy | Steps 1-2 | Hit rate ≥ current at half the memory |
| 5 | Graph: initial neighborhood-only render + "expand" affordance | Steps 1-2 | First paint < 500ms on 5k vault |
| 6 | Graph: viewport culling + LOD + simulation throttling | Step 5 | Smooth pan/zoom on 5k vault |
| 7 | Re-run benchmark; verify improvements; document numbers | All | New numbers ≥ 5× better on the targeted metric |

---

## 6. Acceptance criteria
- Graph view first paint < 500ms on a 5,000-node vault (measured via Step 1 instrumentation).
- Indexing a 5,000-file vault does not block typing in the active editor.
- Cache hit rate is no worse than today at ≤ 50% of current memory footprint.
- No regression for sub-500-note vaults (must not slow down small cases).

---

## 7. Risks
| Risk | Mitigation |
|------|------------|
| Worker overhead exceeds benefit on small vaults | Auto-disable worker path under `n` files (e.g. < 200) |
| Lazy graph confuses users ("where are my nodes?") | Show node count + "expand to full graph" affordance with depth slider |
| Force simulation glitches at LOD transitions | Pin simulation seed; clamp LOD transitions with hysteresis |
| Worker serialization cost dominates | Send deltas, not full snapshots; use structured clone wisely |

---

## 8. Open questions
- Use D3-force vs. lighter custom simulation? Current implementation TBD — check [GraphViewPanel.ts](src/app/GraphViewPanel.ts) before Step 5.
- Persist warm cache to workspaceState or to `.vscode/markdown-editor.cache.json`? Latter survives reloads but pollutes workspace; default to workspaceState.
