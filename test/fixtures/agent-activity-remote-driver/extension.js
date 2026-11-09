// Browser-worker producer exercises command RPC with real URI arguments to a separate Node host.
const vscode = require('vscode');
exports.activate = context => {
  let current;
  context.subscriptions.push(vscode.commands.registerCommand('markdown-studio-activity-remote.run', async () => {
    const folder = vscode.workspace.workspaceFolders[0].uri;
    const report = { vscodeVersion: vscode.version, checks: [], host: { nodeRuntime: typeof process !== 'undefined' && Boolean(process.versions?.node), remoteName: vscode.env.remoteName, uiKind: vscode.env.uiKind }, expectedUri: vscode.Uri.joinPath(folder, 'tasks.md').toString() };
    const write = () => vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, 'remote-context-report.json'), new TextEncoder().encode(JSON.stringify(report, null, 2)));
    const ensure = (value, message) => { if (!value) throw new Error(message); };
    let credentials;
    try {
      ensure(folder.scheme === 'vscode-remote' && !report.host.nodeRuntime, 'Require remote workspace and browser worker');
      const provider = vscode.extensions.getExtension('phfsantos.markdown-editor');
      report.providerInBrowser = { exportsApiVersion: provider?.exports?.apiVersion, main: provider?.packageJSON.main, browser: provider?.packageJSON.browser };
      ensure(!provider?.exports?.apiVersion && !provider?.packageJSON.browser, 'Provider must be outside browser host');
      const resource = vscode.Uri.parse(report.expectedUri);
      await vscode.commands.executeCommand('vscode.openWith', resource, 'markdown-editor');
      const document = await vscode.workspace.openTextDocument(resource);
      const before = { text: document.getText(), version: document.version, dirty: document.isDirty };
      report.before = before;
      report.badgesBefore = vscode.workspace.getConfiguration('workbench.editor.decorations').get('badges');
      credentials = await vscode.commands.executeCommand('markdown-editor.agentActivity.startSession', { id: 'remote-browser', label: 'Remote Browser Agent' });
      const call = (name, extra = {}) => vscode.commands.executeCommand('markdown-editor.agentActivity.' + name, { ...credentials, ...extra });
      report.checks.push('browser worker starts remote Node session through command RPC'); await write();
      report.attemptedActivity = { id: 'remote', uri: report.expectedUri, state: 'working', label: 'Remote work', task: { documentVersion: document.version, line: 0, expectedLineText: document.lineAt(0).text } };
      const objectContext = await vscode.commands.executeCommand('markdown-editor.getActiveContext', { uriFormat: 'object' });
      report.objectContextUri = objectContext?.uri?.toString();
      ensure(report.objectContextUri === report.expectedUri, 'Context must retain exact consumer remote URI authority');
      await call('update', { activity: { ...report.attemptedActivity, uri: resource } });
      await call('heartbeat');
      report.after = { text: document.getText(), version: document.version, dirty: document.isDirty };
      ensure(JSON.stringify(before) === JSON.stringify(report.after), 'Reporting must preserve source/version/dirty');
      report.checks.push('remote full-URI task update accepted without changing document');
      current = { call, resource, report, write, document };
      report.status = 'reported'; await write();
    } catch (error) { report.status = 'failed'; report.error = String(error.stack || error); await write(); }
  }));
  for (const [name, state] of [['update', 'review'], ['clear'], ['expire', 'working']]) {
    context.subscriptions.push(vscode.commands.registerCommand('markdown-studio-activity-remote.' + name, async () => {
      const { call, resource, report, write, document } = current;
      try {
        if (name === 'clear') await call('clear', { id: 'remote' });
        else await call('update', { activity: { ...report.attemptedActivity, uri: resource, state } });
        report.after = { text: document.getText(), version: document.version, dirty: document.isDirty };
        report.badgesAfter = vscode.workspace.getConfiguration('workbench.editor.decorations').get('badges');
        if (JSON.stringify(report.before) !== JSON.stringify(report.after) || report.badgesBefore !== report.badgesAfter) throw new Error('Activity mutated document or badge settings');
        report.status = name; await write();
      } catch (error) { report.status = 'failed'; report.error = String(error.stack || error); await write(); }
    }));
  }
};
