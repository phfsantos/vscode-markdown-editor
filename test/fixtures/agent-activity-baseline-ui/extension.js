// Independent baseline observer: only stable VS Code APIs and public commands.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
exports.activate = context => {
  const folder = process.env.MARKDOWN_BASELINE195_WORKSPACE;
  if (!folder) throw new Error('Missing disposable baseline workspace');
  const uri = vscode.Uri.file(path.join(folder, 'tasks.md'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  let sequence = 0;
  const snapshot = async (operation, error) => {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const report = {
      version: vscode.version, sequence: ++sequence, operation, error,
      uri: uri.toString(), context: await vscode.commands.executeCommand('markdown-editor.getActiveContext'),
      document: doc && { text: doc.getText(), textSha256: hash(doc.getText()), version: doc.version, dirty: doc.isDirty },
      diskSha256: hash(fs.readFileSync(uri.fsPath)),
      settings: Object.fromEntries(['workbench.editor.decorations.badges', 'workbench.editor.decorations.colors', 'explorer.decorations.badges', 'git.decorations.enabled', 'markdown-editor.ai.enable', 'markdown-editor.ai.enableInlineSuggestions'].map(key => [key, vscode.workspace.getConfiguration().get(key)])),
      tabs: vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => ({
        uri: tab.input?.uri?.toString(), custom: tab.input instanceof vscode.TabInputCustom,
        viewType: tab.input?.viewType, active: tab.isActive, groupActive: group.isActive,
      }))),
      nativeEditors: vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString()),
    };
    fs.writeFileSync(path.join(folder, 'baseline-ui.json'), JSON.stringify(report, null, 2));
  };
  const register = (operation, fn) => context.subscriptions.push(vscode.commands.registerCommand('baseline195.' + operation, async () => {
    let error;
    try { await fn(); } catch (e) { error = String(e.stack || e); }
    await snapshot(operation, error);
  }));
  const consumer = async (command, options) => {
    await vscode.extensions.getExtension('markdown-studio-tests.agent-activity-consumer').activate();
    await vscode.commands.executeCommand('agent-activity-consumer.' + command, options);
  };
  register('open', async () => {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
    await vscode.commands.executeCommand('vscode.openWith', uri, 'markdown-editor', { viewColumn: vscode.ViewColumn.Two, preview: false });
  });
  register('snapshot', () => {});
  for (const transport of ['exports', 'commands']) register(transport, () => consumer('report', {
    uri: uri.toString(), line: 1, transport, producer: 'baseline-' + transport,
    label: transport === 'exports' ? 'Baseline Export Agent' : 'Baseline Command Agent',
  }));
  register('clear', () => consumer('clear'));
  for (const [name, value] of [['badgesOff', false], ['badgesOn', true]]) register(name, () => vscode.workspace.getConfiguration('workbench.editor.decorations').update('badges', value, vscode.ConfigurationTarget.Global));
};
