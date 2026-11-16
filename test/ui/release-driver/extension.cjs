// Test-only mailbox: calls public VS Code APIs in an isolated native host.
const vscode = require('vscode'), fs = require('node:fs'), path = require('node:path');
exports.activate = async context => {
  const folder = process.env.MARKDOWN_UI_WORKSPACE;
  const requestPath = path.join(folder, 'request.json'), responsePath = path.join(folder, 'response.json');
  let last, busy = false;
  const snapshot = () => {
    const extension = vscode.extensions.getExtension('phfsantos.markdown-editor');
    return { hostVersion: vscode.version, extension: extension?.packageJSON, active: extension?.isActive, tabs: vscode.window.tabGroups.all.flatMap(group => group.tabs.map(tab => ({ label: tab.label, isDirty: tab.isDirty, viewType: tab.input?.viewType, uri: tab.input?.uri?.toString() }))), global: vscode.workspace.getConfiguration('workbench').inspect('editorAssociations')?.globalValue, workspace: vscode.workspace.getConfiguration('workbench').inspect('editorAssociations')?.workspaceValue, customCss: vscode.workspace.getConfiguration('markdown-editor').get('customCss'), inlineAI: vscode.workspace.getConfiguration('markdown-editor.ai').get('enableInlineSuggestions') };
  };
  const tick = async () => {
    if (busy || !fs.existsSync(requestPath)) return;
    let request; try { request = JSON.parse(fs.readFileSync(requestPath)); } catch { return; }
    if (request.id === last) return;
    last = request.id; busy = true; fs.unlinkSync(requestPath);
    try {
      let value;
      if (request.op === 'open') { await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(folder, request.file ?? 'Markdown Studio.md')), 'markdown-editor'); value = snapshot(); }
      else if (request.op === 'command') { await vscode.commands.executeCommand(request.command, ...(request.args ?? [])); value = snapshot(); }
      else if (request.op === 'theme') { await vscode.workspace.getConfiguration('workbench').update('colorTheme', request.theme, vscode.ConfigurationTarget.Global); value = snapshot(); }
      else if (request.op === 'setting') { await vscode.workspace.getConfiguration(request.section).update(request.key, request.value, vscode.ConfigurationTarget.Global); value = snapshot(); }
      else if (request.op === 'snapshot') value = snapshot();
      else throw new Error(`Unknown fixture operation: ${request.op}`);
      fs.writeFileSync(responsePath, JSON.stringify({ id: request.id, value }));
    } catch (error) { fs.writeFileSync(responsePath, JSON.stringify({ id: request.id, error: error.stack ?? String(error) })); }
    finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, 100);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  fs.writeFileSync(path.join(folder, 'ready.json'), JSON.stringify(snapshot()));
};
