# Obsidian-Inspired Sidebar Implementation Plan

## Overview
Add an Obsidian-style sidebar panel to the VS Code Markdown Editor with wiki-link autocomplete and relationship mapping.

## Phase 1: Sidebar Panel Infrastructure ✅

### 1.1 Create Sidebar Provider
**File:** `src/sidebar/MarkdownSidebarProvider.ts`
- Implements `vscode.WebviewViewProvider`
- Manages webview lifecycle
- Handles message passing between webview and extension
- Tracks active markdown file

### 1.2 Create Sidebar Webview
**File:** `sidebar-src/` directory structure:
```
sidebar-src/
├── index.html          # Sidebar webview HTML
├── sidebar.ts          # Main sidebar logic
├── sidebar.css         # Optimized for narrow panels
└── components/
    ├── backlinks.ts    # Backlinks component
    ├── graph-view.ts   # Link graph visualization
    ├── templates.ts    # Template selector
    └── settings.ts     # Extension settings
```

### 1.3 Register Sidebar in package.json
```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "markdown-explorer",
        "title": "Markdown Explorer",
        "icon": "resources/markdown-icon.svg"
      }]
    },
    "views": {
      "markdown-explorer": [{
        "type": "webview",
        "id": "markdown-sidebar",
        "name": "Markdown Tools"
      }]
    }
  }
}
```

## Phase 2: Core Features

### 2.1 File Relationship Analyzer
**File:** `src/services/RelationshipAnalyzer.ts`
- Scans workspace for markdown files
- Parses links in current file
- Finds backlinks (files linking to current)
- Calculates file proximity (directory distance)
- Identifies related files by content/links

**Methods:**
```typescript
class RelationshipAnalyzer {
  async getOutgoingLinks(file: Uri): Promise<Link[]>
  async getBacklinks(file: Uri): Promise<Backlink[]>
  async getRelatedFiles(file: Uri): Promise<RelatedFile[]>
  async calculateProximity(file1: Uri, file2: Uri): number
}
```

### 2.2 Link Graph Generator
**File:** `src/services/LinkGraphGenerator.ts`
- Builds graph data structure from markdown files
- Exports graph for visualization
- Uses lightweight graph format for webview

**Output Format:**
```typescript
interface GraphData {
  nodes: { id: string; label: string; type: string }[]
  edges: { source: string; target: string }[]
}
```

### 2.3 Default Editor Checker
**File:** `src/services/DefaultEditorChecker.ts`
- Checks if extension is default for .md files
- Provides command to set as default
- Shows notification on first use

**Methods:**
```typescript
class DefaultEditorChecker {
  isDefaultEditor(): boolean
  setAsDefault(): Promise<void>
  showSetDefaultPrompt(): Promise<void>
}
```

### 2.4 Template System
**File:** `src/services/TemplateManager.ts`
- Manages note templates
- Creates new files from templates
- Supports variables: {{date}}, {{time}}, {{title}}

**Built-in Templates:**
1. Daily Note
2. Meeting Notes
3. Quick Note
4. Task List
5. Book Notes

## Phase 3: Wiki-Link Autocomplete

### 3.1 Completion Provider
**File:** `src/providers/WikiLinkCompletionProvider.ts`
- Triggers on `[[` input
- Shows markdown files from workspace
- Ranks by proximity and relationships
- Inserts wiki-link format

**Ranking Algorithm:**
```typescript
score = (proximity_score * 0.4) + 
        (backlink_score * 0.3) + 
        (recent_score * 0.2) + 
        (name_similarity * 0.1)
```

### 3.2 Link Formats
- `[[filename]]` → relative link
- `[[filename|alias]]` → link with alias
- `[[filename#heading]]` → link to heading
- `[[#heading]]` → link to heading in current file

### 3.3 Link Resolution
**File:** `src/services/LinkResolver.ts`
- Converts wiki-links to markdown links
- Handles relative paths
- Updates links on file rename/move

## Phase 4: UI Components ✅

### 4.1 Sidebar Layout (Narrow Optimized)
```
┌─────────────────────────┐
│  📝 New Note [+]        │ ← Template dropdown
├─────────────────────────┤
│  ⚙️ Settings            │ ← Check default editor
├─────────────────────────┤
│  🔗 Outgoing Links (3)  │
│  • [[Note 1]]           │
│  • [[Note 2]]           │
│  • [[Note 3]]           │
├─────────────────────────┤
│  ↩️ Backlinks (2)        │
│  • File A → this        │
│  • File B → this        │
├─────────────────────────┤
│  📊 Graph View          │
│  [Mini graph visual]    │
├─────────────────────────┤
│  📁 Related Files (5)   │
│  • Similar note 1       │
│  • Similar note 2       │
└─────────────────────────┘
```

### 4.2 Graph View Options ✅
- **Mini View**: ✅ Compact graph in sidebar
- **Full View**: ✅ Command to open full graph in editor
- **Interactive**: ✅ Click node to open file
- **Filters**: ✅ Show only direct links, or N-levels deep (1-5)

## Phase 5: Additional Obsidian Features

### 5.1 Quick Switcher
- Command: "Markdown: Quick Open Note"
- Fuzzy search all markdown files
- Keyboard shortcut: `Ctrl+O` (customizable)

### 5.2 Tag Support
- Parse `#tags` from markdown
- Show tag cloud in sidebar
- Filter files by tag

### 5.3 Daily Notes
- Command: "Markdown: Open Daily Note"
- Auto-creates note with date template
- Customizable daily note location

### 5.4 Embed Support
- Render `![[filename]]` as embed preview
- Show embedded content inline

## Implementation Order

1. ✅ **Week 1**: Sidebar infrastructure + basic UI
2. ✅ **Week 2**: Relationship analyzer + backlinks
3. ✅ **Week 3**: Wiki-link autocomplete
4. ✅ **Week 4**: Graph visualization
5. ✅ **Week 5**: Templates + default editor checker
6. ✅ **Week 6**: Polish + additional features

## Technical Considerations

### Performance
- Cache relationship analysis results
- Incremental updates on file changes
- Limit graph to N nodes (configurable)
- Debounce file system watchers

### Compatibility
- Support both wiki-links and standard markdown links
- Allow disabling Obsidian features
- Respect VS Code markdown extension settings

### Configuration
```json
{
  "markdown-editor.obsidian.enableWikiLinks": true,
  "markdown-editor.obsidian.wikiLinkFormat": "shortest",
  "markdown-editor.obsidian.graphMaxNodes": 100,
  "markdown-editor.obsidian.dailyNotesFolder": "daily",
  "markdown-editor.obsidian.templatesFolder": "templates"
}
```

## File Structure
```
src/
├── sidebar/
│   └── MarkdownSidebarProvider.ts
├── services/
│   ├── RelationshipAnalyzer.ts
│   ├── LinkGraphGenerator.ts
│   ├── TemplateManager.ts
│   ├── DefaultEditorChecker.ts
│   └── LinkResolver.ts
├── providers/
│   └── WikiLinkCompletionProvider.ts
└── commands/
    ├── QuickOpenNote.ts
    ├── OpenDailyNote.ts
    └── OpenGraphView.ts

sidebar-src/
├── index.html
├── sidebar.ts
├── sidebar.css
└── components/
    ├── backlinks.ts
    ├── graph-view.ts
    ├── templates.ts
    └── settings.ts
```

## Dependencies
- No new npm dependencies required
- Use VS Code's built-in webview APIs
- Use existing file system APIs
- Lightweight graph visualization (custom SVG)

## Testing Strategy
1. Unit tests for relationship analyzer
2. Integration tests for link resolution
3. Manual testing for UI/UX
4. Performance benchmarks for large workspaces

---

This plan provides a complete Obsidian-inspired experience while staying native to VS Code and maintaining performance.
