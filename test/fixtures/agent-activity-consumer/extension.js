// Independent producer: only the public extension export and commands are used.
const vscode = require('vscode');
exports.activate = function (context) {
  const sessions = new Map();
  async function clear(options = {}) {
    for (const [id, { session, timer, producer }] of sessions) {
      if (options.producer && options.producer !== producer) continue;
      clearInterval(timer); await session.dispose(); sessions.delete(id);
    }
  }
  context.subscriptions.push({ dispose: clear });
  const register = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand('agent-activity-consumer.' + id, fn));
  register('clear', clear);
  register('stopHeartbeat', () => { for (const item of sessions.values()) clearInterval(item.timer); });
  register('report', async (options = {}) => {
    const value = await vscode.commands.executeCommand('markdown-editor.getActiveContext');
    const uri = options.uri ? vscode.Uri.parse(options.uri) : value && vscode.Uri.parse(value.uri);
    if (!uri) throw new Error('Open a Markdown Studio document or provide uri');
    const producer = { id: options.producer || 'fixture', label: options.label || 'Fixture Agent' };
    let session;
    if (options.transport === 'commands') {
      const credentials = await vscode.commands.executeCommand('markdown-editor.agentActivity.startSession', producer);
      const call = (name, extra = {}) => vscode.commands.executeCommand('markdown-editor.agentActivity.' + name, { ...credentials, ...extra });
      session = { setActivity: activity => call('update', { activity: { ...activity, uri: activity.uri.toString() } }), heartbeat: () => call('heartbeat'), dispose: () => call('endSession') };
    } else {
      const extension = vscode.extensions.getExtension('phfsantos.markdown-editor');
      const api = extension && await extension.activate();
      if (!api || api.apiVersion !== 1 || !api.activity) throw new Error('Markdown Studio activity API v1 unavailable');
      session = api.activity.createSession(producer);
    }
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      await session.setActivity({ id: 'work', uri, state: options.state || 'working', label: 'Fixture work',
        ...(options.line === undefined ? {} : { task: { documentVersion: doc.version, line: options.line, expectedLineText: doc.lineAt(options.line).text } }) });
      const timer = setInterval(() => Promise.resolve(session.heartbeat()).catch(() => clearInterval(timer)), 30000);
      sessions.set(String(Date.now()) + Math.random(), { session, timer, producer: producer.id });
      return { uri: uri.toString(), version: doc.version, dirty: doc.isDirty };
    } catch (error) { await session.dispose(); throw error; }
  });
};
