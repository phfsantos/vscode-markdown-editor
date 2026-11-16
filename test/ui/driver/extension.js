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
  // ---- Diff-view harness -------------------------------------------------
  const fixture = require(process.env.MARKDOWN_UI_DIFF_FIXTURE);
  const file = (...parts) => vscode.Uri.file(path.join(folder, ...parts));
  function describeInput(input) {
    if (!input) return { kind: 'none' };
    // Class names are minified in shipped builds: identify inputs by instanceof.
    const kinds = ['TabInputText', 'TabInputTextDiff', 'TabInputCustom', 'TabInputWebview', 'TabInputNotebook', 'TabInputNotebookDiff', 'TabInputTerminal'];
    const kind = kinds.find((name) => vscode[name] && input instanceof vscode[name]) ?? 'unknown';
    const out = { kind };
    for (const key of ['uri', 'original', 'modified']) if (input[key]) out[key] = input[key].toString();
    if (input.viewType) out.viewType = input.viewType;
    return out;
  }
  async function diffReport(extra = {}) {
    const tabs = vscode.window.tabGroups.all.flatMap((group, groupIndex) => group.tabs.map(tab => ({
      group: groupIndex, label: tab.label, active: tab.isActive, input: describeInput(tab.input),
    })));
    const report = { version: vscode.version, tabs, ...extra };
    fs.writeFileSync(path.join(folder, 'diff-report.json'), JSON.stringify(report, null, 2));
    return report;
  }
  register('diffReport', () => diffReport());
  register('diffCloseAll', async () => {
    // A dirty probe edit would raise a modal "save changes?" dialog that blocks every later click.
    for (const doc of vscode.workspace.textDocuments) if (doc.isDirty && doc.uri.scheme === 'file') await doc.save();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    return diffReport();
  });
  register('diffFileCompare', async () => {
    // Same title shape Explorer's "Compare Selected" produces for two same-named files.
    await vscode.commands.executeCommand('vscode.diff', file('compare', 'left', 'diff.md'), file('compare', 'right', 'diff.md'), 'diff.md ↔ diff.md');
    return diffReport();
  });
  register('diffGit', async () => {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    const api = (await gitExtension.activate()).getAPI(1);
    const deadline = Date.now() + 20000;
    while (!api.repositories.some(repo => repo.state.workingTreeChanges.some(change => change.uri.fsPath === file('diff.md').fsPath))) {
      if (Date.now() > deadline) throw new Error('Git never reported diff.md as a working-tree change');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    await vscode.commands.executeCommand('git.openChange', file('diff.md'));
    return diffReport();
  });
  // Copilot keeps a pending edit's pre-edit text in a chat-editing-text-model document with the target's path.
  let baselineProvider;
  register('diffPending', async () => {
    if (!baselineProvider) {
      baselineProvider = vscode.workspace.registerTextDocumentContentProvider('chat-editing-text-model', {
        provideTextDocumentContent: () => fixture.pendingOriginal,
      });
      context.subscriptions.push(baselineProvider);
    }
    const target = file('pending.md');
    await vscode.workspace.openTextDocument(target.with({ scheme: 'chat-editing-text-model' }));
    await vscode.commands.executeCommand('vscode.openWith', target, 'markdown-editor');
    return diffReport();
  });
  register('diffOpenDefault', async () => {
    // Plain open: whichever editor VS Code picks by priority for a .md file.
    await vscode.commands.executeCommand('vscode.open', file('second.md'));
    return diffReport();
  });
  register('diffSaveAll', async () => {
    await vscode.commands.executeCommand('workbench.action.files.saveAll');
    return diffReport();
  });
  register('diffDocuments', async () => diffReport({
    documents: vscode.workspace.textDocuments
      .filter(doc => doc.uri.path.endsWith('.md'))
      .map(doc => ({ uri: doc.uri.toString(), scheme: doc.uri.scheme, isDirty: doc.isDirty, text: doc.getText() })),
  }));
  register('diffResetFixtures', async () => {
    fs.writeFileSync(file('diff.md').fsPath, fixture.modified);
    fs.writeFileSync(file('compare', 'right', 'diff.md').fsPath, fixture.modified);
    fs.writeFileSync(file('pending.md').fsPath, fixture.pendingModified);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    return diffReport();
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
