const assert = require('assert');
const fs = require('fs');
const path = require('path');

const toolbarPath = path.join(__dirname, '..', 'packages', 'media', 'src', 'toolbar.ts');
const editorPanelPath = path.join(__dirname, '..', 'src', 'app', 'EditorPanel.ts');
const toolbarSource = fs.readFileSync(toolbarPath, 'utf8');
const editorPanelSource = fs.readFileSync(editorPanelPath, 'utf8');

function test(description, fn) {
  try {
    fn();
    console.log(`✓ ${description}`);
  } catch (error) {
    console.error(`✗ ${description}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('\n=== Running toolbar open text editor tests ===\n');

test('adds an open text editor toolbar item', () => {
  assert(toolbarSource.includes('name: "open-text-editor"'), 'Expected open-text-editor toolbar item');
  assert(toolbarSource.includes('className: "open-text-editor"'), 'Expected open-text-editor className');
  assert(toolbarSource.includes('tip: "Open in Text Editor"'), 'Expected toolbar tip for text editor reopen button');
});

test('posts the reopen command from the toolbar item', () => {
  const toolbarSection = toolbarSource.slice(
    toolbarSource.indexOf('name: "open-text-editor"'),
    toolbarSource.indexOf('"emoji"')
  );

  assert(toolbarSection.includes('command: "openWithTextEditor"'), 'Expected toolbar item to post openWithTextEditor');
});

test('reopens the active editor with VS Code\'s built-in text editor command', () => {
  const handlerSection = editorPanelSource.slice(
    editorPanelSource.indexOf('private async handleOpenWithTextEditor(): Promise<void> {'),
    editorPanelSource.indexOf('private async handleKanbanSaveData')
  );

  assert(
    handlerSection.includes('"workbench.action.reopenTextEditor"'),
    'Expected EditorPanel to use workbench.action.reopenTextEditor'
  );
  assert(
    !handlerSection.includes('"vscode.openWith"'),
    'Did not expect EditorPanel to use vscode.openWith for text editor reopen'
  );
});

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('\n=== Toolbar open text editor tests passed ===\n');