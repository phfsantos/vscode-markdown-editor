# Changelog

All notable changes to the "Markdown Studio" extension (formerly "Markdown Editor") will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Diff view

- Markdown Studio opens on both sides of Git and file compare diffs again on
  VS Code 1.133 and later. The custom editor now declares a per-mode priority
  (`textEditor`/`diffEditor`), which VS Code 1.95 also accepts.
- Original/modified sides come from document writability, not the tab label.
  Same-named files compare correctly, and closing or reopening one side no
  longer breaks the pairing.
- A single-view pending agent edit shows the previous text of each changed or
  removed line as a read-only, labelled row above it. Previously this text was
  only a raw-HTML tooltip.
- Changed rows are highlighted across the full editor width, including
  checkboxes and list markers, without moving the text.
- **Fixed data loss:** saving with a diff open could write deleted content from
  the other side (nested list items, table rows, code blocks) into the file.
  Save cleaning now removes diff artifacts from a copy of the document
  structure, and diff decorations never enter the editable content.
- Scroll sync works again. It was disconnected; it now aligns to the same diff
  row in about 25 ms and does not echo.
- A compact status bar replaces the header that covered the toolbar. On a
  read-only side the toolbar is disabled.
- Diffs appear as soon as both sides render (about 300 ms on a 340-line
  document) instead of after fixed 1-second waits. A failure shows its reason
  in the status bar.
- Large documents diff in time proportional to the size of the change.
- Read-only now follows file-system writability, so chat snapshots and review
  schemes no longer open editable.
- The previous version's HTML is sanitised before it is shown.
- New native UI suite (`yarn test:ui --grep "Diff view"`), also run by the
  release gate. See `docs/testing/diff-view-findings.md` and
  `docs/adr/0001-diff-view-architecture.md`.


### Branding

- Renamed the extension's display name from "Markdown Editor" to **Markdown Studio**.
  The extension ID (`phfsantos.markdown-editor`), commands, `markdown-editor.*`
  settings, and existing editor associations are unchanged.
- New colored Marketplace/Extensions icon built from the sidebar glyph
  (`media/marketplace-icon.svg` → `media/logo.png`, regenerate with `yarn icon:render`).
- The sidebar icon now draws its plus signs as vector paths instead of text.
- Command categories, titles, the Output channel, and status messages use the new name.

### AI

- AI auto-complete suggestions are now opt-in via `markdown-editor.ai.enableInlineSuggestions`.
- The Markdown Tools Status view now exposes a one-click toggle for AI auto-complete suggestions.
- README configuration docs now describe the inline suggestion opt-in flow.

### Fixed

- Keep the link graph's source note when the graph itself receives focus; still clear it when switching to an unrelated editor.
- "Set Markdown Studio as Default" now writes `*.md` and `*.markdown` to user
  settings only, keeps unrelated `workbench.editorAssociations` entries, no
  longer copies workspace associations into user settings, and reports
  failures instead of claiming success.
- Corrected typo'd model ids in the `markdown-editor.ai.modelName` setting
  (`gtp-4o-mini` → `gpt-4o-mini`, `gtp-4o` → `gpt-4o`). Previously saved typo
  values are normalized automatically at read time.

### Changed

- The publish workflow runs on `v*` tags and fails if the tag does not match the
  `package.json` version. The `pub` script, which bumped the version twice, was removed.
- Minimum supported VS Code version raised from 1.47 to **1.95** — required by
  the Language Model API (`vscode.lm`, including `lm.tools`) that powers inline
  AI suggestions and the chat-agent tool selector.
- `yarn test` now runs the typecheck and the full unit-test suite (previously a
  no-op), and the publish workflow fails if it fails.
- Publish workflow fixed: the Open VSX step now runs before the Marketplace
  step that reuses its packaged VSIX; CI upgraded to Node 20 and current
  GitHub Actions.
- Cleaned up stray duplicate files from the repository and excluded sourcemaps
  and unused images from the packaged extension (VSIX 8.9 MB → 6.8 MB).

## [0.4.15] - 2026-06-25

### Changed

- Refactored the webview entry layer: removed legacy `main.ts`, `preload.ts`,
  `toolbar.ts`, `types.ts`, and `utils.ts` from the extension root in favor of
  the `packages/media` implementation.
- Added the Markdown Tools sidebar icon.
- Clipboard markdown handling implemented with dedicated tests.

## [0.4.8 – 0.4.14] - 2025-11 → 2026-05

> Note: these versions were developed without individual release commits or
> tags (history was consolidated in the "LLM Release" squash), so they are
> documented here as one combined entry.

### Added - AI & LLM Workflows

- AI markdown workflows for `.agent.md`, `.prompt.md`, and `SKILL.md` files:
  context packages (copy/insert), templates, validation, and chat handoff
  (`markdown-editor.ai.*` commands and settings).
- Inline AI auto-complete suggestions via the VS Code Language Model API, with
  configurable model (`markdown-editor.ai.modelName`) and provider settings.
- Tool selector modal for chat-agent frontmatter (`tools:` selection UI).
- Diff view support inside the editor (chat-editing diff, role-specific stats,
  line/DOM mapping).
- Dev Commands widget and widget-system registration updates.
- Calendar integrations (Google and Outlook OAuth) with events, month, and
  detail widgets.

## [0.4.7] - 2025-11-03

### Added - Performance & Polish

- **Incremental Sidebar Loading**: 4-stage loading pipeline for instant UI feedback
  - Stage 1: Immediate shell with loading states
  - Stage 2: Fast data (templates, tags, embeds) - loads in ~10-50ms
  - Stage 3: Medium-cost data (links, backlinks, related files) - parallel execution
  - Stage 4: Expensive data (graph generation) - deferred, non-blocking
- **Visual Loading States**: Animated skeleton loaders for all sidebar sections
- **Cache Status Display**: Real-time cache monitoring in sidebar header
  - Shows cache size and TTL (10 minutes)
  - Visual progress indicator during cache rebuild
  - One-click manual cache rebuild button
- **Enhanced Caching**:
  - Increased cache TTL from 1 minute to 10 minutes
  - Smart cache invalidation on file changes/renames/deletions
  - File-specific invalidation (only affected entries cleared)
- **Embed Previews**: Preview images and files directly in sidebar with size limits
- **Related Files Section**: Smart recommendations based on:
  - Directory proximity (40% weight)
  - Backlink connections (30% weight)
  - Recent access (20% weight)
  - Content similarity (10% weight)
- **Graph Controls**: 
  - Adjustable node distance for force-directed layout
  - Direct links only mode for simpler visualization
  - Zoom controls and interactive pan/zoom
- **Rebuild Cache Command**: `markdown-editor.rebuildCache` for manual cache refresh

### Changed

- Cache TTL increased from 5 minutes to 10 minutes for better performance
- Sidebar sections now load independently and progressively
- Graph generation no longer blocks other sidebar sections
- Improved message protocol with `updateSection` for incremental updates
- Better error handling with graceful degradation

### Performance Improvements

- **Before**: 2-5 seconds blank screen on large workspaces
- **After**: <100ms for initial UI, sections populate progressively
- Parallel execution of independent operations (links, backlinks, related files)
- Reduced redundant file scans through improved caching
- Smart cache invalidation prevents stale data while minimizing rescans

### Fixed

- Sidebar no longer freezes during graph generation
- Loading states provide clear visual feedback
- Cache properly invalidates on file operations
- Related files section only shown when relevant files exist

## [0.4.2] - 2025-10-28

### Added

- **Obsidian-style Sidebar**: New activity bar panel showing markdown links, backlinks, tags, and notes
  - Interactive graph view for visualizing note connections
  - Quick note navigation with fuzzy search
  - Tag browsing and filtering
  - Backlink tracking for bidirectional linking
- **Wiki-Link Support**: Full support for `[[wiki-style]]` links with autocomplete
- **Daily Notes**: Quick command to create/open daily notes with configurable folder
- **Enhanced Commands**:
  - Show Heading Statistics
  - Add Alt Text to Images
  - Format Tables
  - Insert Table of Contents
  - Validate Document Structure
  - Open Link Graph View
  - Quick Open Note (Fuzzy Search)
  - Open Daily Note
- **Diagnostics**: Real-time error detection for markdown issues
- **CodeLens**: Inline information for headings, images, and tables
- **Decorations**: Visual enhancements for markdown elements in text editor
- **Performance Optimization**: Auto-detection and optimization for large workspaces
- **Diff Support**: Enhanced diff viewing for markdown files
- **Production-safe Logging**: Configurable debug logging via settings

### Changed

- Debug logs are now gated behind `markdown-editor.enableDebugLogging` setting (default: false)
- Improved extension activation performance
- Better memory management for large workspaces

### Fixed

- Removed debug code from production builds
- Improved error handling in webview context
- Fixed wiki-link resolution edge cases
- Better handling of external file changes

### Configuration

New settings available:
- `markdown-editor.enableDebugLogging`: Enable debug logging (default: false)
- `markdown-editor.enableDiagnostics`: Enable inline error detection (default: true)
- `markdown-editor.enableCodeLens`: Show CodeLens information (default: true)
- `markdown-editor.enableDecorations`: Apply text decorations (default: true)
- `markdown-editor.performanceMode`: Performance optimization level (default: auto)
- `markdown-editor.dailyNotesFolder`: Folder for daily notes (default: "daily")
- `markdown-editor.enableTagSupport`: Enable #tag parsing (default: true)
- `markdown-editor.previewEmbedSizeLimit`: Max size for generic embeds (default: 5 MB)
- `markdown-editor.previewEmbedImageLimit`: Max size for image embeds (default: 8 MB)
- `markdown-editor.previewEmbedTextLimit`: Max size for text embeds (default: 200 KB)

### Security

- All dependencies audited with 0 vulnerabilities
- Proper input sanitization for wiki-links and embeds

## [0.4.1] - Previous Release

### Features from previous versions

- WYSIWYG markdown editing
- Auto-sync between editor and webview
- Image upload/paste/drag-drop with auto-save
- Multi-theme support
- Multiple editing modes (instant rendering, WYSIWYG, split screen)
- Markdown extensions support
- Graph support (KaTeX, Mermaid, Graphviz, ECharts, abc.js)
- Custom CSS support

---

## Upgrading

No breaking changes. All existing functionality is preserved.

## Testing

This release includes comprehensive test coverage:
- TagManager tests
- LinkResolver tests
- Embed handler tests
- RelationshipAnalyzer tests

All tests passing: 4/4 (100% success rate)
