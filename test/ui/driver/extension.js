const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
exports.activate = function(context) {
  const folder = process.env.MARKDOWN_UI_WORKSPACE;
  if (!folder) return;
  let sequence = 0;
  async function snapshot() {
    const consumer = vscode.extensions.getExtension('markdown-studio-tests.agent-context-consumer');
    await consumer.activate();
    const value = await vscode.commands.executeCommand('agent-context-consumer.readCommand');
    const report = { sequence: ++sequence, version: vscode.version, context: value ?? null,
      nativeEditors: vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString()),
      activeNativeEditor: vscode.window.activeTextEditor?.document.uri.toString() ?? null,
      badges: vscode.workspace.getConfiguration('workbench.editor.decorations').get('badges') };
    fs.writeFileSync(path.join(folder, 'context.json'), JSON.stringify(report, null, 2));
    return report;
  }
  const register = (id, action) => context.subscriptions.push(vscode.commands.registerCommand(`context-ui.${id}`, action));
  const provider = vscode.extensions.getExtension('phfsantos.markdown-editor');
  void provider.activate().then(api => {
    context.subscriptions.push(api.onDidChangeActiveContext(() => { void snapshot(); }));
    void snapshot();
  });
  register('snapshot', snapshot);
  for (const [name, enabled] of [['badgesOff', false], ['badgesOn', true]]) {
    register(name, async () => {
      await vscode.workspace.getConfiguration('workbench.editor.decorations').update('badges', enabled, vscode.ConfigurationTarget.Global);
      return snapshot();
    });
  }
  register('chat', async () => {
    const commands = await vscode.commands.getCommands();
    if (!commands.includes('workbench.action.chat.open')) throw new Error('Built-in chat focus command unavailable');
    await vscode.commands.executeCommand('workbench.action.chat.open');
    return snapshot();
  });
  for (const [id, filename] of [['open','tasks.md'], ['other','other.md'], ['clear','unrelated.txt']]) {
    register(id, async () => {
      const uri = vscode.Uri.file(path.join(folder, filename));
      if (filename.endsWith('.md')) await vscode.commands.executeCommand('vscode.openWith', uri, 'markdown-editor');
      else await vscode.window.showTextDocument(uri);
      return snapshot();
    });
  }
};
