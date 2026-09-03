import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolbarPath = path.join(__dirname, '..', 'packages', 'media', 'src', 'toolbar.ts');
const handlersPath = path.join(__dirname, '..', 'src', 'app', 'EditorMessageHandlers.ts');
const toolbarSource = fs.readFileSync(toolbarPath, 'utf8');
const handlersSource = fs.readFileSync(handlersPath, 'utf8');

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
  const handlerStart = handlersSource.indexOf('public async handleOpenWithTextEditor(): Promise<void> {');
  assert(handlerStart !== -1, 'Expected EditorMessageHandlers to define handleOpenWithTextEditor');
  const handlerEnd = handlersSource.indexOf('public async handleResolveWikiLink');
  assert(handlerEnd > handlerStart, 'Expected another handler to follow handleOpenWithTextEditor');
  const handlerSection = handlersSource.slice(handlerStart, handlerEnd);

  assert(
    handlerSection.includes('"workbench.action.reopenTextEditor"'),
    'Expected EditorPanel to use workbench.action.reopenTextEditor'
  );
  assert(
    !handlerSection.includes('"vscode.openWith"'),
    'Did not expect EditorPanel to use vscode.openWith for text editor reopen'
  );
});
