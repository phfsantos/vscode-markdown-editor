// Browser-only consumer driver. A Node provider must be reached through real host RPC.
const vscode = require('vscode');

exports.activate = function activate(context) {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const reportUri = folder && vscode.Uri.joinPath(folder, 'remote-context-report.json');
  const report = { vscodeVersion: vscode.version, checks: [], commandTransport: {
    command: 'markdown-editor.getActiveContext', uriFormat: 'object',
    canonicalization: 'consumer serializes the URI after stable VS Code command RPC',
  } };
  let resource;
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const write = async () => vscode.workspace.fs.writeFile(reportUri,
    new TextEncoder().encode(JSON.stringify(report, null, 2)));
  const poll = async (fn, label) => {
    const deadline = Date.now() + 15000;
    let value;
    do {
      value = await fn();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    throw new Error(`Timed out: ${label}`);
  };
  const register = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand(
    `markdown-studio-remote-test.${name}`, async () => {
      try { await fn(); } catch (error) {
        report.status = 'failed'; report.error = String(error.stack || error);
        await write(); throw error;
      }
    }));
  const readCommand = () => vscode.commands.executeCommand('agent-context-consumer.readCommand');
  register('open', async () => {
    ensure(folder?.scheme === 'vscode-remote', `Expected remote workspace; got ${folder?.toString()}`);
    report.driverHost = { remoteName: vscode.env.remoteName, uiKind: vscode.env.uiKind,
      extensionMode: context.extensionMode, nodeRuntime: typeof process !== 'undefined' && Boolean(process.versions?.node),
      extensionUri: context.extensionUri.toString() };
    ensure(!report.driverHost.nodeRuntime, 'Remote test driver must run in the browser worker');
    ensure(Boolean(vscode.env.remoteName), 'Expected an actual remote authority');
    report.consumerHost = await vscode.commands.executeCommand('agent-context-consumer.getHostInfo');
    ensure(report.consumerHost && !report.consumerHost.nodeRuntime, 'Consumer must run in the browser worker');
    const provider = vscode.extensions.getExtension('phfsantos.markdown-editor');
    report.providerInBrowser = provider ? { isActive: provider.isActive, extensionKind: provider.extensionKind,
      main: provider.packageJSON.main, browser: provider.packageJSON.browser,
      extensionUri: provider.extensionUri.toString(), exportsApiVersion: provider.exports?.apiVersion } : { visible: false };
    resource = vscode.Uri.joinPath(folder, 'tasks.md');
    report.expectedUri = resource.toString();
    await vscode.commands.executeCommand('vscode.openWith', resource, 'markdown-editor');
    const value = await poll(async () => await readCommand(), 'active custom context');
    const objectContext = await vscode.commands.executeCommand('markdown-editor.getActiveContext', { uriFormat: 'object' });
    report.objectCommandUri = objectContext?.uri?.toString();
    ensure(objectContext?.uri instanceof vscode.Uri, 'Object URI command mode must use VS Code URI revival across hosts');
    ensure(objectContext.uri.toString() === resource.toString(), 'Object command URI must preserve the remote authority');
    const defaultContext = await vscode.commands.executeCommand('markdown-editor.getActiveContext');
    report.defaultCommandUri = defaultContext?.uri;
    report.initialContext = value;
    // Persist diagnostics before enforcing URI identity so transport regressions are reviewable.
    await write();
    ensure(value.uri === resource.toString(), `Remote URI was not preserved: ${value.uri} !== ${resource}`);
    ensure(vscode.window.activeTextEditor === undefined, 'Custom context must not open a native source editor');
    report.checks.push('browser consumer reached remote Node provider command with exact remote URI');
    report.status = 'opened';
    await write();
  });
  register('verify', async () => {
    ensure(resource, 'Open the fixture before verifying');
    const value = await poll(async () => {
      const candidate = await readCommand();
      return candidate?.selectionStatus === 'exact' ? candidate : undefined;
    }, 'exact remote source selection');
    report.selectedContext = value;
    const expectedSelection = { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } };
    ensure(value.uri === resource.toString(), 'Selected context lost remote URI authority');
    ensure(JSON.stringify(value.selection) === JSON.stringify(expectedSelection), `Unexpected source range: ${JSON.stringify(value.selection)}`);
    await vscode.commands.executeCommand('agent-context-consumer.assertContext', {
      transport: 'command', uri: resource.toString(), selectionStatus: 'exact', selection: expectedSelection,
    });
    report.checks.push('real Vditor selection Ship serialized as UTF-16 source 0:8–0:12 across hosts');
    const unrelated = vscode.Uri.joinPath(folder, 'unrelated.txt');
    await vscode.window.showTextDocument(unrelated);
    await poll(async () => (await readCommand()) === undefined, 'unrelated tab clears context');
    report.checks.push('unrelated remote source tab clears command context');
    report.status = 'passed';
    await write();
  });
};
