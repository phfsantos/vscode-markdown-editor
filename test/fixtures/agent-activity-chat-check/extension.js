// Manual fixture: public command API only; never edits/saves source or settings.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

exports.activate = context => {
  const output = vscode.window.createOutputChannel('Markdown Activity Check');
  context.subscriptions.push(output);
  let active;
  let report;
  let busy = false;
  const hash = value => createHash('sha256').update(value).digest('hex');
  const bounded = async operation => {
    let timer;
    try {
      return await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Host API timed out after 15 seconds')), 15000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const call = (name, args) => bounded(() => vscode.commands.executeCommand('markdown-editor.agentActivity.' + name, args));
  const snapshot = async doc => ({
    textSha256: hash(doc.getText()), version: doc.version, dirty: doc.isDirty,
    diskSha256: hash(await bounded(() => vscode.workspace.fs.readFile(doc.uri))),
    settings: Object.fromEntries([
      'workbench.editor.decorations.badges', 'workbench.editor.decorations.colors',
      'workbench.editor.tabSizing', 'explorer.decorations.badges',
      'git.decorations.enabled', 'markdown-editor.ai.enable',
      'markdown-editor.ai.showEditorActionBar', 'markdown-editor.ai.enableInlineSuggestions',
    ].map(key => [key, vscode.workspace.getConfiguration(undefined, doc.uri).inspect(key)])),
  });
  const save = async () => {
    output.appendLine(JSON.stringify(report, null, 2));
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(context.globalStorageUri, 'report.json'), Buffer.from(JSON.stringify(report, null, 2)));
  };
  const clear = async () => {
    const current = active;
    if (!current) return;
    active = undefined;
    clearInterval(current.heartbeat); clearTimeout(current.expiry);
    const before = await snapshot(current.doc);
    await call('endSession', current.credentials);
    const after = await snapshot(current.doc);
    report.clear = { before, after, preserved: false };
    assert.deepEqual(after, before, 'Clearing activity changed document or settings');
    report.clear.preserved = true;
    await save();
  };
  const register = (id, operation) => context.subscriptions.push(vscode.commands.registerCommand('markdown-activity-check.' + id, async () => {
    // Commands can overlap while host RPC/file reads are pending. Do not let a
    // second Start/Clear replace the first operation's report halfway through.
    const mutates = id !== 'report';
    if (mutates && busy) {
      void vscode.window.showInformationMessage('An activity check is already running. Wait for its result.');
      return;
    }
    if (mutates) busy = true;
    try { return await operation(); }
    catch (error) {
      report = { ...report, error: String(error.stack || error) };
      output.appendLine(JSON.stringify(report, null, 2)); output.show(true);
      void vscode.window.showErrorMessage('Activity check failed: ' + error.message);
    } finally { if (mutates) busy = false; }
  }));
  register('start', async () => {
    if (active) throw new Error('Clear the previous test activity first');
    let doc = vscode.window.activeTextEditor?.document;
    if (!doc || !doc.uri.path.endsWith('/tasks.md')) {
      const current = await bounded(() => vscode.commands.executeCommand('markdown-editor.getActiveContext', { uriFormat: 'object' }));
      if (current?.uri) doc = await bounded(() => vscode.workspace.openTextDocument(current.uri));
    }
    if (!doc || !doc.uri.path.endsWith('/tasks.md')) throw new Error('Focus tasks.md in the disposable test workspace first');
    const lines = doc.getText().split(/\r?\n/);
    const line = lines.findIndex(text => /^\s*[-+*]\s+\[[ xX]\]/.test(text));
    if (line < 0) throw new Error('tasks.md has no Markdown checkbox task');
    const before = await snapshot(doc);
    report = { timestamp: new Date().toISOString(), vscode: vscode.version, uri: doc.uri.toString(),
      markdownStudioVersion: vscode.extensions.getExtension('phfsantos.markdown-editor')?.packageJSON.version,
      copilotChatVersion: vscode.extensions.getExtension('GitHub.copilot-chat')?.packageJSON.version,
      nativeChatCompetition: 'Requires screenshots of actual pending native Chat edits; this probe cannot certify that session.',
      taskLineZeroBased: line, before, reported: false };
    const credentials = await call('startSession', { id: 'manual-chat-check', label: 'Cooperating Test' });
    try {
      await call('update', { ...credentials, activity: { id: 'task', uri: doc.uri, state: 'working', label: 'Native chat competition check',
        task: { documentVersion: doc.version, line, expectedLineText: lines[line] } } });
      const after = await snapshot(doc);
      report.after = after;
      assert.deepEqual(after, before, 'Reporting activity changed document or settings');
      report.reported = true; report.preserved = true;
      active = { doc, credentials, heartbeat: setInterval(() => {
        call('heartbeat', credentials).catch(error => output.appendLine('Heartbeat failed: ' + String(error)));
      }, 30000), expiry: setTimeout(() => { void clear().catch(error => output.appendLine('Automatic cleanup failed: ' + String(error))); }, 600000) };
      await save();
      void vscode.window.showInformationMessage('Activity reported; preservation passed. Inspect tabs, task indicator and fallbacks, then Clear Activity.');
      return report;
    } catch (error) {
      if (active?.credentials === credentials) {
        clearInterval(active.heartbeat); clearTimeout(active.expiry); active = undefined;
      }
      await call('endSession', credentials).catch(() => {}); throw error;
    }
  });
  register('clear', async () => { await clear(); void vscode.window.showInformationMessage('Test activity cleared.'); return report; });
  register('report', () => { output.show(true); return report; });
  context.subscriptions.push({ dispose: () => {
    if (!active) return;
    clearInterval(active.heartbeat); clearTimeout(active.expiry);
    void call('endSession', active.credentials).catch(() => {}); active = undefined;
  } });
};
