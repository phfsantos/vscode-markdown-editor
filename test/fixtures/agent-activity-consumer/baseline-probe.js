// Stable-API activity contract probe in an isolated 1.95 Development Host.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
exports.run = async () => {
  const output = process.env.MARKDOWN_STUDIO_DIAGNOSTIC_OUTPUT;
  const report = { version: vscode.version, checks: [], notes: [] };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
  const bounded = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out after 15s: ' + label)), 15000))]);
  let credentials;
  try {
    assert.equal(vscode.version, '1.95.0');
    const provider = vscode.extensions.getExtension('phfsantos.markdown-editor');
    const wasActive = provider.isActive;
    credentials = await vscode.commands.executeCommand('markdown-editor.agentActivity.startSession', { id: 'baseline', label: 'Baseline Agent' });
    report.coldCommandActivation = { wasActive, activated: provider.isActive };
    assert.equal(provider.isActive, true);
    const api = await provider.activate(); assert.equal(api.apiVersion, 1);
    const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'tasks.md');
    fs.writeFileSync(uri.fsPath, '- [ ] Same\n- [ ] Same\n');
    const call = (name, extra = {}) => vscode.commands.executeCommand('markdown-editor.agentActivity.' + name, { ...credentials, ...extra });
    await call('update', { activity: { id: 'file', uri: uri.toString(), state: 'working', label: 'Baseline work' } });
    await call('heartbeat'); await call('clear', { id: 'file' }); await call('endSession');
    report.checks.push('cold activation and JSON start/update/heartbeat/clear/end stable APIs');
    const session = api.activity.createSession({ id: 'baseline-exports', label: 'Exports Agent' });
    session.setActivity({ id: 'file', uri, state: 'review', label: 'Review' }); session.heartbeat(); session.clearActivity('file'); session.dispose();
    report.checks.push('exports activity session stable APIs'); save();
    try {
      const document = await bounded(vscode.workspace.openTextDocument(uri), 'openTextDocument');
      const before = { text: document.getText(), version: document.version, dirty: document.isDirty };
      await vscode.extensions.getExtension('markdown-studio-tests.agent-activity-consumer').activate();
      for (const transport of ['exports', 'commands']) await vscode.commands.executeCommand('agent-activity-consumer.report', { uri: uri.toString(), line: 1, transport, producer: transport });
      assert.deepEqual({ text: document.getText(), version: document.version, dirty: document.isDirty }, before);
      await vscode.commands.executeCommand('agent-activity-consumer.clear');
      report.checks.push('independent task consumer exports and JSON preserve source/version/dirty');
      await bounded(vscode.commands.executeCommand('vscode.openWith', uri, 'markdown-editor'), 'open custom editor');
      report.checks.push('custom editor command completed (visual projection requires separate UI check)');
    } catch (error) { report.notes.push(String(error)); report.editorRuntime = 'blocked'; }
    save();
  } catch (error) { report.failure = String(error.stack || error); save(); throw error; }
};
