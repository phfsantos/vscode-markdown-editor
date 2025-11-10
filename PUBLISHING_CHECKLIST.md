# Publishing Checklist for VS Code Marketplace

## Pre-Publishing Steps

### 1. Documentation ✅
- [x] README.md updated with latest features
- [x] CHANGELOG.md updated with version 0.4.7
- [x] Screenshots section added with note about screenshot placement
- [x] All features documented with clear descriptions
- [x] Configuration options documented
- [x] Commands list included

### 2. Package Configuration ✅
- [x] Version bumped to 0.4.7 in package.json
- [x] Description updated with key features
- [x] Keywords optimized for marketplace discovery
- [x] Categories set appropriately
- [x] Repository URL configured
- [x] Icon file present (media/logo.png)

### 3. Screenshot & Media
- [ ] **ACTION REQUIRED**: Save workspace screenshot to `./media/screenshot-main.png`
  - Should show: WYSIWYG editor, sidebar panel, and graph view
  - Recommended size: 1280x720 or higher
  - Format: PNG
  - Current screenshot reference is visible in VS Code
- [x] Demo GIF present (demo.gif)
- [x] Logo present (media/logo.png)

### 4. Code Quality ✅
- [x] Build completes without errors: `yarn foy build`
- [x] No TypeScript compilation errors
- [x] All tests passing
- [x] No security vulnerabilities (0 found)

### 5. Testing
- [x] Extension builds successfully
- [x] Core features tested:
  - [x] WYSIWYG editor opens
  - [x] Sidebar panel loads
  - [x] Graph view displays
  - [x] Wiki-links autocomplete works
  - [x] Cache status displays
  - [x] Commands accessible

### 6. Marketplace Requirements
- [x] README.md has clear description
- [x] README.md has screenshots/demo
- [x] CHANGELOG.md is up to date
- [x] License file present (MIT)
- [x] Repository linked
- [x] Publisher configured (phfsantos)

## Publishing Commands

### Package the Extension
```bash
# Install vsce if not already installed
npm install -g @vscode/vsce

# Package the extension
vsce package
```

This will create a `.vsix` file (e.g., `markdown-editor-0.4.7.vsix`)

### Publish to Marketplace
```bash
# First time: Get your Personal Access Token from:
# https://dev.azure.com/ (Visual Studio Marketplace)

# Login (only needed once)
vsce login phfsantos

# Publish
vsce publish
```

### Alternative: Manual Upload
1. Go to https://marketplace.visualstudio.com/manage/publishers/phfsantos
2. Click "New Extension" → "Visual Studio Code"
3. Upload the `.vsix` file
4. Fill in any additional marketplace information

## Post-Publishing

### 1. Verify Publication
- [ ] Check marketplace listing: https://marketplace.visualstudio.com/items?itemName=phfsantos.markdown-editor
- [ ] Verify version number is 0.4.7
- [ ] Confirm all screenshots display correctly
- [ ] Test installation from marketplace

### 2. Git Tag
```bash
git tag -a v0.4.7 -m "Release version 0.4.7 - Performance improvements and cache management"
git push origin v0.4.7
```

### 3. GitHub Release
1. Go to: https://github.com/phfsantos/vscode-markdown-editor/releases
2. Click "Draft a new release"
3. Tag: v0.4.7
4. Title: "v0.4.7 - Performance & Cache Management"
5. Copy content from CHANGELOG.md for v0.4.7
6. Attach the `.vsix` file
7. Publish release

### 4. Announce
- [ ] Update repository README if needed
- [ ] Share on social media (optional)
- [ ] Notify users of major improvements

## Key Features to Highlight in Marketplace

1. **Obsidian-Style Knowledge Management** - Wiki-links, backlinks, graph view
2. **WYSIWYG Editing** - Real-time markdown rendering
3. **Performance Optimized** - Smart caching, incremental loading
4. **Large Workspace Support** - Tested with 1000+ files
5. **Rich Tooling** - Diagnostics, CodeLens, commands
6. **Daily Notes** - Quick note-taking workflow
7. **Interactive Graph** - Visualize note relationships
8. **Tag Management** - Organize with #tags

## Troubleshooting

### If screenshot is missing
Save the current VS Code workspace view to `./media/screenshot-main.png` showing:
- Left: Sidebar panel with all sections visible
- Center: Markdown editor with content
- Right: Graph view panel (if using multiple columns)

### If build fails
```bash
cd /var/www/vscode-markdown-editor
yarn install
yarn foy build
```

### If tests fail
```bash
cd /var/www/vscode-markdown-editor/test
node run-all.js
```

## Important Notes

- Ensure the screenshot at `./media/screenshot-main.png` exists before packaging
- The marketplace uses the first image in README as the main screenshot
- Version in package.json must match CHANGELOG.md
- All links in README should work (no broken links)
- Description should be compelling and clear for marketplace listing

## Final Check Before Publishing

Run these commands to ensure everything is ready:

```bash
# 1. Check version consistency
grep '"version"' package.json
grep '## \[' CHANGELOG.md | head -1

# 2. Verify screenshot exists
ls -lh ./media/screenshot-main.png

# 3. Final build
yarn foy build

# 4. Check for errors
echo "Build exit code: $?"

# 5. Package
vsce package

# If all above succeeds, you're ready to publish!
```
