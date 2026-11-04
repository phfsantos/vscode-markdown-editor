// VS Code --extensionTestsPath entry point; run only in an isolated Development Host.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

async function run() {
  const outputPath = process.env.MARKDOWN_STUDIO_DIAGNOSTIC_OUTPUT;
  if (!outputPath) throw new Error('Set MARKDOWN_STUDIO_DIAGNOSTIC_OUTPUT to an absolute report path');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-studio-context-baseline-'));
  const resource = vscode.Uri.file(path.join(temp, 'tasks.md'));
  const secondResource = vscode.Uri.file(path.join(temp, 'other.md'));
  const unrelatedResource = vscode.Uri.file(path.join(temp, 'unrelated.txt'));
  fs.writeFileSync(resource.fsPath, '- [ ] **Ship**\n\nAnother paragraph.\n');
  fs.writeFileSync(secondResource.fsPath, 'Another Markdown document.\n');
  fs.writeFileSync(unrelatedResource.fsPath, 'An unrelated source editor.\n');
  let diagnostic;
  let failure;
  let providerWasActiveBeforeProbe;
  let coldCommandActivation;
  let api;
  let eventListener;
  let consumerObservations;
  const contextChecks = [];
  const contextEvents = [];
  const settle = () => new Promise(resolve => setTimeout(resolve, 500));
  const serializable = value => value && ({ ...value, uri: value.uri.toString(),
    ...(value.selection ? { selection: {
      start: { line: value.selection.start.line, character: value.selection.start.character },
      end: { line: value.selection.end.line, character: value.selection.end.character },
    } } : {}),
  });
  const matches = (value, expected) => expected.unavailable ? value === undefined
    : Boolean(value && value.uri.toString() === expected.uri &&
      (!expected.panelId || value.panelId === expected.panelId) &&
      (!expected.differentPanelId || value.panelId !== expected.differentPanelId));
  async function checkContext(label, expected) {
    const deadline = Date.now() + 5000;
    while (!matches(api.getActiveContext(), expected) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const direct = api.getActiveContext();
    assert.ok(matches(direct, expected), `${label}: unexpected provider context ${JSON.stringify(serializable(direct))}`);
    if (direct) {
      assert.ok(typeof direct.panelId === 'string' && direct.panelId.length > 0);
      assert.strictEqual(direct.documentVersion, 1);
      assert.ok(direct.uri instanceof vscode.Uri);
    }
    const command = await vscode.commands.executeCommand('markdown-editor.getActiveContext');
    assert.deepStrictEqual(command, serializable(direct), `${label}: provider command differs from exports`);
    for (const transport of ['exports', 'command']) {
      const consumer = await vscode.commands.executeCommand('agent-context-consumer.assertContext', { ...expected, transport });
      assert.deepStrictEqual(consumer, serializable(direct), `${label}: independent consumer ${transport} differs`);
    }
    contextChecks.push({ label, expected, ...(direct ? { actual: serializable(direct) } : {}) });
    return direct;
  }
  try {
    diagnostic = await vscode.extensions.getExtension('markdown-studio-tests.markdown-studio-context-diagnostic').activate();
    await vscode.extensions.getExtension('markdown-studio-tests.agent-context-consumer').activate();
    const provider = vscode.extensions.getExtension('phfsantos.markdown-editor');
    providerWasActiveBeforeProbe = provider.isActive;
    if (!providerWasActiveBeforeProbe) {
      const initialCommand = await vscode.commands.executeCommand('markdown-editor.getActiveContext');
      assert.strictEqual(initialCommand, undefined, 'Cold context command should return unavailable before any editor is opened');
      assert.strictEqual(provider.isActive, true, 'Cold context command should activate the provider');
      coldCommandActivation = { tested: true, initialContextUnavailable: true, providerActivated: true };
    } else {
      coldCommandActivation = { tested: false, reason: 'Provider was already active before the probe' };
    }
    api = await provider.activate();
    assert.strictEqual(api.apiVersion, 1);
    eventListener = api.onDidChangeActiveContext(value => contextEvents.push(serializable(value)));
    // Connect the independent consumer's event listener before opening any tabs.
    await vscode.commands.executeCommand('agent-context-consumer.readExports');
    await vscode.window.showTextDocument(resource);
    await settle();
    diagnostic.snapshot('probe-source');
    await checkContext('source-clears', { unavailable: true });
    await vscode.commands.executeCommand('vscode.openWith', resource, 'markdown-editor', vscode.ViewColumn.One);
    await settle();
    const custom = diagnostic.snapshot('probe-custom');
    assert.strictEqual(custom.activeTab?.viewType, 'markdown-editor');
    assert.strictEqual(custom.activeTab?.uri, resource.toString());
    const firstPanel = await checkContext('first-custom', { uri: resource.toString() });
    await vscode.commands.executeCommand('vscode.openWith', resource, 'markdown-editor', vscode.ViewColumn.Two);
    await settle();
    diagnostic.snapshot('probe-duplicate');
    const secondPanel = await checkContext('duplicate-custom', { uri: resource.toString(), differentPanelId: firstPanel.panelId });
    const inactive = vscode.window.tabGroups.all.find(group => !group.isActive);
    const duplicate = inactive?.tabs.find(tab => tab.input instanceof vscode.TabInputCustom && tab.input.uri.toString() === resource.toString());
    assert.ok(duplicate, 'Expected an inactive duplicate custom tab');
    await vscode.window.tabGroups.close(duplicate);
    await settle();
    diagnostic.snapshot('probe-close-inactive-duplicate');
    await checkContext('inactive-duplicate-closed', { uri: resource.toString(), panelId: secondPanel.panelId });
    await vscode.commands.executeCommand('workbench.view.explorer');
    await settle();
    diagnostic.snapshot('probe-sidebar-focus');
    await checkContext('explorer-focus-retains', { uri: resource.toString(), panelId: secondPanel.panelId });
    await vscode.commands.executeCommand('vscode.openWith', secondResource, 'markdown-editor', vscode.ViewColumn.Two);
    const otherPanel = await checkContext('different-custom-file', { uri: secondResource.toString(), differentPanelId: secondPanel.panelId });
    diagnostic.snapshot('probe-second-custom-file');
    await vscode.window.showTextDocument(unrelatedResource, { viewColumn: vscode.ViewColumn.Two });
    await checkContext('unrelated-source-clears', { unavailable: true });
    diagnostic.snapshot('probe-unrelated-source');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await settle();
    diagnostic.snapshot('probe-close-all');
    await checkContext('last-close-clears', { unavailable: true });
    consumerObservations = await vscode.commands.executeCommand('agent-context-consumer.getObservations');
    for (const panelId of [firstPanel.panelId, secondPanel.panelId, otherPanel.panelId]) {
      assert.ok(contextEvents.some(value => value?.panelId === panelId), `Missing provider event for ${panelId}`);
      assert.ok(consumerObservations.some(value => value.transport === 'event' && value.context?.panelId === panelId), `Missing independent consumer event for ${panelId}`);
    }
    assert.ok(contextEvents.some(value => value === undefined), 'Missing provider context-clear event');
    assert.ok(consumerObservations.some(value => value.transport === 'event' && !value.context), 'Missing consumer context-clear event');
  } catch (error) {
    failure = error && (error.stack || String(error));
  } finally {
    eventListener?.dispose();
    fs.writeFileSync(outputPath, JSON.stringify({ vscodeVersion: vscode.version, failure,
      providerWasActiveBeforeProbe, coldCommandActivation, contextChecks, contextEvents, consumerObservations,
      notes: 'Local metadata and same-host API consumer probe only: no native badge, real agent, remote, restored-tab, or DOM-selection verification. See coldCommandActivation for whether startup allowed a genuine cold-command test.',
      entries: diagnostic?.getEntries() || [] }, null, 2));
  }
  if (failure) throw new Error(failure);
}

module.exports = { run };
