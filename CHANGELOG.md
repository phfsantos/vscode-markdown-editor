# Changelog

All notable changes to the "Markdown Editor" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
