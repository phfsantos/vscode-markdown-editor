const fs = require('fs');
const path = require('path');
const assert = require('assert');

function expectIncludes(source, expected) {
  assert.ok(source.includes(expected), `Expected string to include: ${expected}`);
}

const nativeViewsSource = fs.readFileSync(path.join(__dirname, '../src/sidebar/MarkdownNativeViews.ts'), 'utf-8');
const graphViewPanelSource = fs.readFileSync(path.join(__dirname, '../src/app/GraphViewPanel.ts'), 'utf-8');
const sidebarContextSource = fs.readFileSync(path.join(__dirname, '../src/sidebar/MarkdownSidebarContext.ts'), 'utf-8');
const extensionSource = fs.readFileSync(path.join(__dirname, '../src/extension.ts'), 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));

function runTest(name, testFn) {
  try {
    testFn();
    process.stdout.write(`✔ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✖ ${name}\n`);
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  }
}

runTest('Sidebar view registration includes graph provider and commands', () => {
  expectIncludes(nativeViewsSource, "private static readonly stateKey = 'markdown-editor.sidebar.graph.options';");
  expectIncludes(nativeViewsSource, 'this.extensionContext.workspaceState.get<GraphRequestOptions>(MarkdownMiniGraphViewProvider.stateKey)');
  expectIncludes(nativeViewsSource, 'this.extensionContext.workspaceState.update(MarkdownMiniGraphViewProvider.stateKey, this.graphOptions)');
  expectIncludes(nativeViewsSource, 'localResourceRoots: [this.extensionContext.extensionUri]');
  assert.ok(!nativeViewsSource.includes('retainContextWhenHidden'), 'Mini graph should not retain hidden webview context');
  expectIncludes(nativeViewsSource, 'case \'openFile\':');
  expectIncludes(nativeViewsSource, 'case \'openGraphView\':');
  expectIncludes(nativeViewsSource, 'depth: this.graphOptions.depth');
  expectIncludes(nativeViewsSource, 'maxNodes: this.graphOptions.maxNodes');
  expectIncludes(nativeViewsSource, 'showDirectLinksOnly: this.graphOptions.depth === 1');
});

runTest('GraphViewPanel UI removes node distance controls', () => {
  assert.ok(!graphViewPanelSource.includes('nodeDistance'), 'Full graph view should not reference nodeDistance');
  assert.ok(!graphViewPanelSource.includes('node-distance-value'), 'Full graph view should not include node distance markup');
});

runTest('Mini graph UI removes node distance controls', () => {
  assert.ok(!nativeViewsSource.includes('distanceRange'), 'Mini graph view should not include node distance range input');
  assert.ok(!nativeViewsSource.includes('distanceValue'), 'Mini graph view should not include node distance label');
  assert.ok(!nativeViewsSource.includes('nodeDistance'), 'Mini graph view should not reference nodeDistance state');
});

runTest('Browser view remains wired to sidebar and active document state', () => {
  expectIncludes(graphViewPanelSource, "import { MarkdownSidebarContext } from '../sidebar/MarkdownSidebarContext';");
  expectIncludes(graphViewPanelSource, 'const sidebarDocument = MarkdownSidebarContext.getCurrentActiveDocument();');
  expectIncludes(sidebarContextSource, 'private static currentInstance: MarkdownSidebarContext | undefined;');
  expectIncludes(sidebarContextSource, 'public static getCurrentActiveDocument(): vscode.TextDocument | undefined {');
  expectIncludes(sidebarContextSource, 'MarkdownSidebarContext.currentInstance = this;');
});

runTest('Provider views expose context menu hooks in manifest', () => {
  const menus = packageJson.contributes.menus || {};
  const titleMenus = menus['view/title'] || [];
  const itemMenus = menus['view/item/context'] || [];
  const sidebarMenuEntries = [...titleMenus, ...itemMenus].filter((entry) => {
    const when = String(entry.when || '');
    return when.includes('markdown-sidebar') || when.includes('markdown-tools') || when.includes('viewItem');
  });

  assert.ok(sidebarMenuEntries.length > 0, 'Expected sidebar-specific view/title or view/item/context menu contributions');
  assert.ok(titleMenus.some((entry) => entry.command === 'markdown-editor.toggleInlineSuggestions'), 'Expected status view title toggle command');
  assert.ok(itemMenus.some((entry) => entry.command === 'markdown-editor.toggleInlineSuggestions'), 'Expected status view item toggle command');
});

runTest('Status provider includes inline suggestion toggle item', () => {
  expectIncludes(nativeViewsSource, "inlineSuggestionToggle: { contextValue: 'inlineSuggestionToggle' }");
  expectIncludes(nativeViewsSource, "command: 'markdown-editor.toggleInlineSuggestions'");
  expectIncludes(nativeViewsSource, "AI auto-complete suggestions are enabled");
  expectIncludes(nativeViewsSource, "AI auto-complete suggestions are disabled");
});
