# How to Test the Enhanced Markdown Editor Features

## 🚀 Quick Start Testing Guide

### Step 1: Launch the Extension in Development Mode

1. **Press F5** in VS Code (or use the Debug menu → Start Debugging)
2. This will open a new VS Code window with your extension loaded
3. The watch mode is already running, so changes will be compiled automatically

### Step 2: Set as Default Markdown Editor

In the new VS Code window:

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type: `Markdown Editor: Set as Default Markdown Editor`
3. Press Enter
4. You should see: "Markdown Editor set as default for .md files"

### Step 3: Test Diagnostic Features

1. Open the test file: `test-diagnostics.md`
2. You should see:
   - **Red squiggly lines** under broken links
   - **Blue squiggly lines** under images without alt text
   - **Problems panel** showing all detected issues

**Expected Diagnostics:**

- ⚠️ "Potentially broken link: http://this-does-not-exist-12345.com"
- ⚠️ "Image missing alt text for accessibility"
- ⚠️ "Malformed table row" for the broken table

### Step 4: Test CodeLens Features

With `test-diagnostics.md` open, you should see inline CodeLens information:

- **Above headings**: "H1 • 3 words", "H2 • 4 words", etc.
- **Above images**: "⚠ Missing alt text" or "✓ Alt text"
- **Above tables**: "Table: 3 columns"

### Step 5: Test New Commands

Open Command Palette and try these commands:

1. **`Markdown Editor: Insert Table of Contents`**

   - Should generate a TOC at cursor position
2. **`Markdown Editor: Validate Document Structure`**

   - Should show validation results
3. **`Markdown Editor: Format Table`**

   - Place cursor in a table and run this command

### Step 6: Test Spell Checker Integration

1. **Install a spell checker extension** (if not already installed):

   - "Code Spell Checker" by Street Side Software
   - "SpellChecker" by swyphcosmo
2. **Create a Markdown file with spelling errors**:

   ```markdown
   # This has mispelled words

   This sentance has errros that should be deteceted.
   ```
3. **Open with your Markdown editor** - you should see spell check underlines

### Step 7: Test Text Decorations

In any Markdown file, you should see native VS Code styling for:

- *Italic text* (styled according to your theme)
- **Bold text** (styled according to your theme)
- `inline code` (with background highlighting)
- [Links](http://example.com) (underlined and colored)

### Step 8: Test Performance

1. **Create a large Markdown file** (>1000 lines)
2. **Type quickly** - changes should sync smoothly with <150ms delay
3. **Check memory usage** in VS Code's Developer Tools

## 🐛 Troubleshooting

### If diagnostics don't appear:

1. Check that `markdown-editor.enableDiagnostics` is `true` in settings
2. Look for errors in the Developer Console (Help → Toggle Developer Tools)
3. Check the Output panel (View → Output → select "Log (Extension Host)")

### If CodeLens doesn't show:

1. Verify `markdown-editor.enableCodeLens` is `true`
2. Ensure you're using the custom editor, not VS Code's default Markdown editor
3. Try reloading the window (Ctrl+R / Cmd+R)

### If spell checker doesn't work:

1. Make sure a spell checker extension is installed
2. Check that text sync is working (look for no console errors)
3. Try typing in both the webview and switching to text editor view

### If extension doesn't become default:

1. Check File → Preferences → Settings
2. Search for "workbench.editorAssociations"
3. Manually add: `"*.md": "markdown-editor"`

## 🔍 Debug Information

To see what's happening under the hood:

1. **Open Developer Console**: Help → Toggle Developer Tools
2. **Check Extension Host Logs**: View → Output → "Log (Extension Host)"
3. **Look for debug messages** starting with "[markdown-editor]"

## 📊 Expected Performance Improvements

You should notice:

- **Faster sync**: Changes appear in <150ms (vs 300ms before)
- **Lower memory**: Check Task Manager/Activity Monitor
- **Smoother typing**: Less lag during rapid editing
- **Better responsiveness**: UI doesn't freeze on large documents

## ✅ Success Indicators

Your integration is working correctly if you see:

- ✅ Diagnostic squiggly lines in Markdown files
- ✅ CodeLens information above headings/images/tables
- ✅ Native text decorations (bold, italic, code)
- ✅ Spell checker working in webview content
- ✅ New commands available in Command Palette
- ✅ Smooth performance with large files
- ✅ Extension opens by default for .md files

## 🎯 Next Steps

Once basic features are working:

1. **Test with real content** - open your actual Markdown files
2. **Try different themes** - ensure decorations work with light/dark themes
3. **Test with other extensions** - verify compatibility
4. **Performance test** - try very large files (>10MB)
5. **Accessibility test** - use screen readers if available

---

**Need Help?** Check the console output and look for error messages. The extension should gracefully handle missing features and show helpful error messages.
