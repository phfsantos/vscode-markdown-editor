// Document control: only stable host APIs, no activity or model requests.
const vscode = require('vscode');
const fs = require('node:fs');
const assert = require('node:assert/strict');

exports.run = async () => {
  const output = process.env.MARKDOWN_STUDIO_DIAGNOSTIC_OUTPUT;
  const report = { version: vscode.version, checks: [], hostProbe: [], notes: [], editorRuntime: 'blocked' };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
  const bounded = async (label, operation) => {
    const start = Date.now();
    const item = { label, status: 'pending' };
    report.hostProbe.push(item); save();
    let timer;
    try {
      await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out after 15s: ' + label)), 15000);
      })]);
      item.status = 'passed';
    } catch (error) { item.status = 'failed'; item.error = String(error); }
    finally { clearTimeout(timer); item.elapsedMs = Date.now() - start; save(); }
  };
  try {
    assert.equal(vscode.version, '1.95.0');
    const provider = vscode.extensions.getExtension('phfsantos.markdown-editor');
    assert.equal(Boolean(provider), process.env.MARKDOWN_BASELINE_PROVIDER === 'present');
    report.checks.push(provider ? 'Markdown Studio present; no activity calls' : 'Markdown Studio absent from extension registry'); save();
    if (provider) await bounded('provider.activate (no activity calls)', async () => {
      await provider.activate();
      assert.equal(provider.isActive, true);
    });
    const folder = vscode.workspace.workspaceFolders[0].uri;
    for (const name of ['control.txt', 'control.md']) {
      const uri = vscode.Uri.joinPath(folder, name);
      const content = name.endsWith('.md') ? '- [ ] Same\n- [ ] Same\n' : 'Host control.\n';
      fs.writeFileSync(uri.fsPath, content);
      await bounded('workspace.fs.readFile ' + name, async () => {
        assert.equal(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString(), content);
      });
      await bounded('openTextDocument ' + name, async () => {
        const doc = await vscode.workspace.openTextDocument(uri);
        assert.equal(doc.getText(), content);
        assert.equal(doc.isDirty, false);
      });
    }
    await bounded('openTextDocument untitled', async () => {
      const doc = await vscode.workspace.openTextDocument({ content: 'Untitled control.\n', language: 'plaintext' });
      assert.equal(doc.getText(), 'Untitled control.\n');
    });
    report.providerActive = provider?.isActive;
    if (report.hostProbe.every(item => item.status === 'passed')) report.editorRuntime = 'document-control-passed';
    save();
  } catch (error) { report.failure = String(error.stack || error); save(); throw error; }
};
