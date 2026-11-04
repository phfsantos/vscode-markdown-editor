// Disposable Development Host fixture. Records metadata only; never document text.
const vscode = require('vscode');

function activate(context) {
  const output = vscode.window.createOutputChannel('Markdown Studio Context Diagnostic');
  const entries = [];
  const documentState = document => document && ({
    uri: document.uri.toString(), version: document.version,
    languageId: document.languageId, dirty: document.isDirty,
  });
  const tabState = tab => {
    if (!tab) return undefined;
    const input = tab.input;
    return {
      label: tab.label, active: tab.isActive, dirty: tab.isDirty,
      kind: input && input.constructor.name,
      uri: input && input.uri && input.uri.toString(),
      viewType: input && input.viewType,
    };
  };
  const record = reason => {
    const entry = {
      time: new Date().toISOString(), reason, vscodeVersion: vscode.version,
      remoteName: vscode.env.remoteName,
      activeTextEditor: documentState(vscode.window.activeTextEditor?.document),
      visibleTextEditors: vscode.window.visibleTextEditors.map(editor => documentState(editor.document)),
      activeTab: tabState(vscode.window.tabGroups.activeTabGroup.activeTab),
      groups: vscode.window.tabGroups.all.map(group => ({
        column: group.viewColumn, active: group.isActive, tabs: group.tabs.map(tabState),
      })),
      documents: vscode.workspace.textDocuments.map(documentState),
      settings: {
        badges: vscode.workspace.getConfiguration('workbench.editor').get('decorations.badges'),
        tabSizing: vscode.workspace.getConfiguration('workbench.editor').get('tabSizing'),
      },
    };
    entries.push(entry);
    if (entries.length > 2000) entries.shift();
    output.appendLine(JSON.stringify(entry));
    return entry;
  };
  const observe = (event, reason) => event(() => record(reason));
  context.subscriptions.push(
    output,
    observe(vscode.window.onDidChangeActiveTextEditor, 'active-text-editor'),
    observe(vscode.window.onDidChangeVisibleTextEditors, 'visible-text-editors'),
    observe(vscode.window.onDidChangeTextEditorSelection, 'native-selection'),
    observe(vscode.window.tabGroups.onDidChangeTabs, 'tabs'),
    observe(vscode.window.tabGroups.onDidChangeTabGroups, 'tab-groups'),
    observe(vscode.workspace.onDidOpenTextDocument, 'document-open'),
    observe(vscode.workspace.onDidChangeTextDocument, 'document-change'),
    observe(vscode.workspace.onDidCloseTextDocument, 'document-close'),
    vscode.commands.registerCommand('markdown-studio-diagnostics.snapshot', () => record('manual-snapshot')),
    vscode.commands.registerCommand('markdown-studio-diagnostics.copyLog', async () => {
      record('manual-copy-log');
      await vscode.env.clipboard.writeText(JSON.stringify(entries, null, 2));
      vscode.window.showInformationMessage('Diagnostic metadata copied. Review URIs before sharing.');
    }),
    vscode.commands.registerCommand('markdown-studio-diagnostics.clearLog', () => { entries.length = 0; output.clear(); }),
  );
  record('activation');
  output.appendLine(JSON.stringify({ agentsInstalledInThisHost: vscode.extensions.all
    .filter(extension => /copilot|openai|anthropic|claude/i.test(extension.id))
    .map(extension => ({ id: extension.id, version: extension.packageJSON.version, active: extension.isActive })) }));
  return { snapshot: record, getEntries: () => entries.slice() };
}

module.exports = { activate };
