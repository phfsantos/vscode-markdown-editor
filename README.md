# Markdown Editor — A Full-Featured WYSIWYG Editor for Markdown

[![Version](https://img.shields.io/visual-studio-marketplace/v/phfsantos.markdown-editor)](https://marketplace.visualstudio.com/items?itemName=phfsantos.markdown-editor)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/phfsantos.markdown-editor)](https://marketplace.visualstudio.com/items?itemName=phfsantos.markdown-editor)

A powerful markdown editor with Obsidian-style features, bringing WYSIWYG editing, wiki-links, graph views, and advanced markdown tooling to VS Code.

## Demo

![demo](./demo.gif)

### Obsidian-Style Sidebar & Graph View

![Sidebar and Graph View](./media/screenshot-sidebar-graph.png)

*Featuring: Interactive graph visualization, wiki-links, tags, backlinks, and file navigation*

## ✨ Key Features

### WYSIWYG Editing
- **What You See Is What You Get** — Real-time rendering as you type
- **Multiple Editing Modes**: Instant Rendering (Recommended) / WYSIWYG / Split Screen
- **Auto-sync** between VS Code editor and webview
- **Multi-theme Support** — Adapts to your VS Code theme

### 🔗 Obsidian-Style Features (NEW in 0.4.2)

- **Wiki-Link Support**: Use `[[filename]]` syntax with intelligent autocomplete
- **Sidebar Panel**: Dedicated activity bar with:
  - 📊 **Link Graph View** — Visual representation of note connections
  - 🔍 **Quick Note Search** — Fuzzy find any note instantly
  - 🏷️ **Tag Browser** — Browse and filter by #tags
  - ↩️ **Backlinks** — See which notes link to the current file
- **Daily Notes**: Quick command to create/open today's note
- **Relationship Tracking**: Automatic bidirectional link detection

### 🛠️ Advanced Markdown Tools

- **Diagnostics**: Real-time validation and error detection
- **CodeLens**: Inline stats for headings, images, and tables
- **Commands**:
  - Show Heading Statistics
  - Add Alt Text to Images
  - Format Tables
  - Insert Table of Contents
  - Validate Document Structure
  - Open Link Graph View
  - Quick Open Note (Fuzzy Search)
  - Open Daily Note

### 📝 Rich Markdown Support

- **Image Handling**: Upload/paste/drag-drop with auto-save to configurable folder
- **Copy**: Export as markdown or HTML
- **Markdown Extensions** via [vditor](https://github.com/Vanessa219/vditor)
- **Rich Diagrams**: KaTeX, Mermaid, Graphviz, ECharts, abc.js (music notation)
- **Custom CSS**: Personalize layout and styling

### ⚡ Performance

- **Smart Optimization**: Auto-detects workspace size and optimizes accordingly
- **Configurable Performance Modes**: Auto / Performance / Compatibility
- **Large Workspace Support**: Tested with 1000+ markdown files

## Install

[https://marketplace.visualstudio.com/items?itemName=phfsantos.markdown-editor](https://marketplace.visualstudio.com/items?itemName=phfsantos.markdown-editor)

## Supported syntax

[demo article](https://ld246.com/guide/markdown)

## Usage

### 1. Command mode in markdown file

- open a markdown file
- type `cmd-shift-p` to enter command mode
- type `markdown-editor: Open with markdown editor`

### 2. Key bindings

- open a markdown file
- type `ctrl+shift+alt+m` for win or `cmd+shift+alt+m` for mac

### 3. Explorer Context menu

- right click on markdown file
- then click `Open with markdown editor`

### 4. Editor title context menu

- right click on a opened markdown file's tab title
- then click `Open with markdown editor`

### Custom CSS (custom layout and vditor personalization)

Edit your settings.json and add:

```json
{
  "markdown-editor.customCss": "my custom css rules"
}
```

**Example:**

```json
{
  "markdown-editor.customCss": ".vditor-ir pre.vditor-reset {line-height: 32px; padding-right: calc(100% - 800px) !important; margin-left: 100px; font-family: system-ui !important;}"
}
```

## ⚙️ Configuration

The extension provides many settings to customize your experience:

### Editor Settings

```json
{
  // Image save folder (relative to markdown file or use ${projectRoot}/assets for workspace root)
  "markdown-editor.imageSaveFolder": "assets",
  
  // Use VS Code theme colors in the editor
  "markdown-editor.useVscodeThemeColor": true,
  
  // Custom CSS rules for editor styling
  "markdown-editor.customCss": ""
}
```

### Feature Toggles

```json
{
  // Enable real-time diagnostics and error detection
  "markdown-editor.enableDiagnostics": true,
  
  // Show CodeLens for headings, images, and tables
  "markdown-editor.enableCodeLens": true,
  
  // Apply visual decorations to markdown elements
  "markdown-editor.enableDecorations": true,
  
  // Enable #tag support in sidebar
  "markdown-editor.enableTagSupport": true,
  
  // Enable debug logging (useful for troubleshooting)
  "markdown-editor.enableDebugLogging": false
}
```

### Performance Settings

```json
{
  // Performance mode: "auto", "performance", or "compatibility"
  "markdown-editor.performanceMode": "auto"
}
```

### Obsidian-Style Features

```json
{
  // Folder for daily notes (relative to workspace root)
  "markdown-editor.dailyNotesFolder": "daily",
  
  // Maximum file sizes for embed previews
  "markdown-editor.previewEmbedSizeLimit": 5242880,      // 5 MB (generic files)
  "markdown-editor.previewEmbedImageLimit": 8388608,     // 8 MB (images)
  "markdown-editor.previewEmbedTextLimit": 204800        // 200 KB (text files)
}
```

## 🔧 Troubleshooting

### Enable Debug Logging

If you encounter issues, enable debug logging to see detailed information:

1. Open Settings (JSON): `Ctrl+Shift+P` → "Preferences: Open Settings (JSON)"
2. Add: `"markdown-editor.enableDebugLogging": true`
3. Open the Output panel: View → Output
4. Select "Markdown Editor" from the dropdown
5. Reproduce the issue and check the logs

### Performance with Large Workspaces

For workspaces with many markdown files (500+):

1. Set performance mode to "performance": `"markdown-editor.performanceMode": "performance"`
2. Consider disabling features you don't use:
   ```json
   {
     "markdown-editor.enableDiagnostics": false,
     "markdown-editor.enableCodeLens": false
   }
   ```

### Wiki-Links Not Working

Ensure you're using the correct syntax:
- `[[filename]]` — Links to filename.md
- `[[folder/filename]]` — Links to file in subfolder
- File extensions are optional

## 📚 Supported Syntax

For complete markdown syntax guide, see: [demo article](https://ld246.com/guide/markdown)

## � What's New in 0.4.2

See [CHANGELOG.md](./CHANGELOG.md) for detailed release notes.

Highlights:
- 🆕 Obsidian-style sidebar with graph view
- 🆕 Wiki-link support with autocomplete
- 🆕 Daily notes functionality
- 🆕 Enhanced diagnostics and CodeLens
- ✨ Production-ready logging system
- 🔒 Security audit clean (0 vulnerabilities)
- ✅ Comprehensive test coverage

## �🙏 Acknowledgement

- [vscode](https://github.com/microsoft/vscode)
- [vditor](https://github.com/Vanessa219/vditor)
- [phfsantos](https://github.com/phfsantos)

## 📝 Todo

- [ ] Using [Custom Text Editor](https://code.visualstudio.com/api/extension-guides/custom-editors#custom-text-editor) ([demo](https://github.com/gera2ld/markmap-vscode))
- [ ] Code splitting for main.js bundle size optimization
- [ ] Multi-root workspace support

## License

MIT

## Support

If you like this extension make sure to star the repo. I am always looking for new ideas and feedback. In addition, it is possible to [donate via paypal](https://www.paypal.me/phfsantos).
