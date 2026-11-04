// Independent Development Host fixture: depends only on the public VS Code API.
const vscode = require('vscode');

function snapshot(value) {
  if (!value) return undefined;
  return {
    panelId: value.panelId,
    uri: typeof value.uri === 'string' ? value.uri : value.uri.toString(),
    documentVersion: value.documentVersion,
    selectionStatus: value.selectionStatus,
    ...(value.selection ? { selection: {
      start: { line: value.selection.start.line, character: value.selection.start.character },
      end: { line: value.selection.end.line, character: value.selection.end.character },
    } } : {}),
  };
}

exports.activate = async function activate(context) {
  const output = vscode.window.createOutputChannel('Agent Context Consumer');
  context.subscriptions.push(output);
  const observations = [];
  function record(transport, value) {
    const result = snapshot(value);
    const observation = { transport, ...(result ? { context: result } : {}) };
    observations.push(observation);
    output.appendLine(JSON.stringify(observation));
    return result;
  }
  let api;
  async function connectExports() {
    if (api) return api;
    const extension = vscode.extensions.getExtension('phfsantos.markdown-editor');
    const candidate = extension && await extension.activate();
    if (!candidate || candidate.apiVersion !== 1 ||
        typeof candidate.getActiveContext !== 'function' ||
        typeof candidate.onDidChangeActiveContext !== 'function') {
      throw new Error('Markdown Studio API v1 exports unavailable in this extension host. Try readCommand.');
    }
    api = candidate;
    context.subscriptions.push(api.onDidChangeActiveContext(value => record('event', value)));
    return api;
  }
  const register = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(`agent-context-consumer.${id}`, fn));
  const readExports = async () => record('exports', (await connectExports()).getActiveContext());
  register('readExports', readExports);
  const readCommand = async () => record('command', await vscode.commands.executeCommand('markdown-editor.getActiveContext', { uriFormat: 'object' }));
  register('readCommand', readCommand);
  register('getObservations', () => observations.slice());
  register('getHostInfo', () => ({
    remoteName: vscode.env.remoteName, uiKind: vscode.env.uiKind, extensionMode: context.extensionMode,
    nodeRuntime: typeof process !== 'undefined' && Boolean(process.versions?.node),
    extensionKind: vscode.extensions.getExtension('markdown-studio-tests.agent-context-consumer')?.extensionKind,
  }));
  register('assertContext', async (expected = {}) => {
    const value = expected.transport === 'exports'
      ? await readExports()
      : await readCommand();
    if (expected.unavailable === true) {
      if (value !== undefined) throw new Error('Expected no active Markdown Studio context');
      return undefined;
    }
    if (!value) throw new Error('Expected an active Markdown Studio context');
    for (const key of ['panelId', 'uri', 'documentVersion', 'selectionStatus', 'selection']) {
      if (Object.prototype.hasOwnProperty.call(expected, key) &&
          JSON.stringify(value[key]) !== JSON.stringify(expected[key])) {
        throw new Error(`Context mismatch for ${key}: ${JSON.stringify(value[key])}`);
      }
    }
    if (expected.differentPanelId !== undefined && value.panelId === expected.differentPanelId) {
      throw new Error('Expected a different active panel');
    }
    return value;
  });
  // The user explicitly invokes this command; it sends no content to chat.
  register('copyContext', async () => {
    const value = api ? record('exports', api.getActiveContext()) : await readCommand();
    if (!value) throw new Error('No active Markdown Studio context to copy');
    const { uri, documentVersion, selectionStatus, selection } = value;
    const text = JSON.stringify({ uri, documentVersion, selectionStatus,
      ...(selectionStatus === 'exact' && selection ? { selection } : {}),
    }, null, 2);
    await vscode.env.clipboard.writeText(text);
    return text;
  });
};
