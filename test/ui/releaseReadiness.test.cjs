const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const tools = createRequire(path.join(process.env.MARKDOWN_UI_TOOLS ?? __dirname, 'package.json'));
const { describe, it, before, afterEach } = tools('mocha');
const { VSBrowser, By, Key } = tools('vscode-extension-tester');
const workspace = process.env.MARKDOWN_UI_WORKSPACE, storage = process.env.TEST_RESOURCES;
const driver = () => VSBrowser.instance.driver;
let sequence = 0;
async function eventually(check, timeout = 20000) {
  let last;
  try { return await driver().wait(async () => { try { return await check(); } catch (error) { last = error; return false; } }, timeout, undefined, 100); }
  catch (error) { throw last ?? error; }
}
async function bridge(request) {
  const id = ++sequence;
  fs.writeFileSync(path.join(workspace, 'request.json'), JSON.stringify({ ...request, id }));
  return eventually(() => {
    const response = JSON.parse(fs.readFileSync(path.join(workspace, 'response.json')));
    if (response.id !== id) return false;
    assert.ifError(response.error);
    return response.value;
  }, 30000);
}
async function screenshot(name) {
  await driver().switchTo().defaultContent();
  fs.writeFileSync(path.join(storage, `${name}.png`), await driver().takeScreenshot(), 'base64');
}
async function inWebview(marker, action) {
  await eventually(async () => {
    await driver().switchTo().defaultContent();
    const frames = await driver().findElements(By.css('iframe'));
    for (const frame of frames) {
      try {
        await driver().switchTo().defaultContent(); if (!await frame.isDisplayed()) continue; await driver().switchTo().frame(frame);
        const inner = await driver().findElements(By.css('iframe#active-frame'));
        if (inner.length) await driver().switchTo().frame(inner[0]);
        if ((await driver().findElements(By.css(marker))).length) return true;
      } catch { /* Another visible webview may be replacing its frame. */ }
    }
    return false;
  });
  try { return await action(); } finally { await driver().switchTo().defaultContent(); }
}
async function inEditor(action) { return inWebview('.vditor', action); }
async function waitDirty() { await eventually(async () => (await bridge({ op: 'snapshot' })).tabs.some(tab => tab.isDirty)); }
async function hostCommand(command, args) { return bridge({ op: 'command', command, args }); }

// Vditor normalizes task marker case, table padding and blank lines on save.
// Keep fenced content exact while comparing every nonblank source line outside it.
function canonical(markdown) {
  let fenced = false;
  return markdown.split('\n').map(line => {
    if (line.startsWith('```')) { fenced = !fenced; return line; }
    if (fenced) return line;
    if (/^\|[ |:-]+\|$/.test(line)) return '|separator|';
    if (line.startsWith('|')) return line.split('|').map(cell => cell.trim()).join('|');
    return line.replace(/^- \[x\] +/i, '- [x] ').replace(/^- \[ \] +/, '- [ ] ').trimEnd();
  }).filter(line => line !== '').join('\n');
}

describe('Markdown Studio packaged release readiness', function() {
  before(async () => {
    await eventually(() => fs.existsSync(path.join(workspace, 'ready.json')));
  });
  afterEach(async function() {
    await driver().switchTo().defaultContent();
    if (this.currentTest.state === 'failed') await screenshot(`failure-${this.currentTest.title.replace(/\W+/g, '-')}`);
  });
  it('upgrades the local predecessor while retaining settings and workspace notes', async function() {
    if (!process.env.MARKDOWN_RELEASE_PREVIOUS_VSIX) this.skip();
    const prior = await bridge({ op: 'open' });
    assert.equal(prior.extension.version, process.env.MARKDOWN_RELEASE_PREVIOUS_VERSION ?? '0.5.11');
    const css = '.vditor-reset { max-width: 900px; }';
    await bridge({ op: 'setting', section: 'markdown-editor', key: 'customCss', value: css });
    const note = fs.readFileSync(path.join(workspace, 'Release Notes.md'), 'utf8');
    const code = process.env.MARKDOWN_UI_CODE;
    const cli = path.resolve(path.dirname(code), '../Resources/app/out/cli.js');
    const installed = spawnSync(code, [cli, '--user-data-dir', path.join(storage,'settings'), '--extensions-dir', path.join(storage,'extensions'), '--install-extension', process.env.MARKDOWN_UI_VSIX, '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000 });
    fs.writeFileSync(path.join(storage,'upgrade-install.log'), `${installed.stdout ?? ''}\n${installed.stderr ?? ''}`);
    assert.equal(installed.status, 0);
    fs.unlinkSync(path.join(workspace,'ready.json'));
    fs.writeFileSync(path.join(workspace,'request.json'), JSON.stringify({ id: ++sequence, op: 'command', command: 'workbench.action.reloadWindow' }));
    await eventually(() => fs.existsSync(path.join(workspace,'ready.json')), 30000);
    const state = await bridge({ op: 'snapshot' });
    assert.equal(state.extension.version, '0.5.14'); assert.equal(state.customCss, css);
    assert.deepEqual(state.global, { '*.json': 'global.jsonEditor' });
    assert.equal(fs.readFileSync(path.join(workspace,'Release Notes.md'),'utf8'), note);
    fs.writeFileSync(path.join(storage,'upgrade-state.json'), JSON.stringify({ previous: prior.extension.version, current: state.extension.version, customCss: state.customCss, associations: state.global, workspaceNotePreserved: true }, null, 2));
  });

  it('loads the installed VSIX with its stable identity and renders the editor', async () => {
    const state = await bridge({ op: 'open' });
    assert.equal(state.extension.displayName, process.env.MARKDOWN_RELEASE_EXPECT_NAME ?? 'Markdown Studio');
    assert.equal(`${state.extension.publisher}.${state.extension.name}`, 'phfsantos.markdown-editor');
    assert.equal(state.extension.contributes.customEditors.length, 1);
    assert.equal(state.extension.contributes.customEditors[0].viewType, 'markdown-editor');
    assert.equal(state.inlineAI, false);
    await inEditor(async () => { await eventually(async () => assert.match(await driver().findElement(By.css('.vditor')).getText(), /Markdown Studio/) || true); });
    await screenshot('editor');
  });
  it('shows the installed name, version and colored icon in native details', async () => {
    const state = await hostCommand('extension.open', ['phfsantos.markdown-editor']);
    await eventually(async () => {
      const text = await driver().findElement(By.css('.extension-editor')).getText();
      assert.match(text, /Markdown Studio/); assert.ok(text.includes(state.extension.version)); return true;
    });
    const icons = await driver().findElements(By.css('.extension-editor img.icon, .extension-editor .icon img'));
    assert.ok(icons.length, 'Installed details must render the extension icon');
    const src = await icons[0].getAttribute('src'); assert.match(src, /logo\.png/);
    await screenshot('installed-details');
  });
  it('retains native settings keys and shows the Markdown Studio Output channel', async () => {
    await bridge({ op: 'open' });
    await hostCommand('workbench.action.openSettings', ['@ext:phfsantos.markdown-editor']);
    const state = await bridge({ op: 'snapshot' }); assert.equal(state.extension.contributes.configuration.title, 'Markdown Studio');
    await eventually(async () => { assert.match(await driver().findElement(By.css('.settings-editor')).getText(), /Markdown-editor/i); return true; });
    await screenshot('native-settings');
    await hostCommand('workbench.action.output.toggleOutput');
    await eventually(async () => { const labels = await driver().executeScript("return Array.from(document.querySelectorAll('.part.panel select option')).map(option => option.textContent).join('\\n')"); assert.match(labels, /Markdown Studio/); return true; });
    await screenshot('native-output');
    await hostCommand('workbench.action.closePanel');
  });

  it('renders the native sidebar and theme-aware icon in dark, light and contrast themes', async () => {
    await bridge({ op: 'open' }); await hostCommand('workbench.view.extension.markdown-tools');
    await eventually(async () => { assert.match(await driver().findElement(By.css('.part.sidebar')).getText(), /Markdown Studio/i); return true; });
    for (const [theme, css, name] of [['Default Dark Modern','vscode-dark','dark'], ['Default Light Modern','vscode-light','light'], ['Default High Contrast','vscode-high-contrast','contrast']]) {
      await bridge({ op: 'theme', theme });
      await inEditor(async () => { await eventually(async () => { assert.ok((await driver().findElement(By.css('body')).getAttribute('class')).includes(css)); return true; }); });
      const glyph = await driver().findElements(By.css('.activitybar [aria-label*="Markdown Studio"], .activitybar [title*="Markdown Studio"]'));
      assert.ok(glyph.length, 'Expected native Activity Bar contribution');
      await screenshot(`theme-${name}`);
    }
    await bridge({ op: 'theme', theme: 'Default Dark Modern' });
  });
  it('persists checkbox edits, undo and redo without changing custom fenced blocks', async () => {
    await bridge({ op: 'open' });
    const file = path.join(workspace, 'Markdown Studio.md');
    const original = fs.readFileSync(file, 'utf8');
    await inEditor(async () => { const checkbox = await driver().findElement(By.css('.vditor-ir input[type=checkbox], .vditor-wysiwyg input[type=checkbox]')); await checkbox.click(); assert.equal(await checkbox.isSelected(), true); });
    await waitDirty(); await hostCommand('workbench.action.files.save');
    await eventually(() => { assert.match(fs.readFileSync(file,'utf8'), /- \[x\] +Review the release/i); return true; });
    await hostCommand('undo'); await waitDirty(); await hostCommand('workbench.action.files.save');
    await eventually(() => { assert.match(fs.readFileSync(file,'utf8'), /- \[ \] +Review the release/); return true; });
    await hostCommand('redo'); await waitDirty(); await hostCommand('workbench.action.files.save');
    await eventually(() => { const saved = fs.readFileSync(file,'utf8'); assert.match(saved, /- \[x\] +Review the release/i); assert.equal(canonical(saved), canonical(original.replace('- [ ] Review the release', '- [x] Review the release'))); assert.deepEqual([...saved.matchAll(/```[\s\S]*?```/g)].map(match => match[0]), [...original.matchAll(/```[\s\S]*?```/g)].map(match => match[0])); return true; });
    await hostCommand('workbench.action.closeActiveEditor'); await bridge({ op: 'open' });
    await inEditor(async () => { assert.equal(await driver().findElement(By.css('.vditor-ir input[type=checkbox], .vditor-wysiwyg input[type=checkbox]')).isSelected(), true); });
    await screenshot('saved-reopened');
  });
  it('preserves unrelated real settings when the contributed default command runs', async () => {
    const state = await hostCommand('markdown-editor.setAsDefaultEditor');
    assert.deepEqual(state.global, { '*.json': 'global.jsonEditor', '*.md': 'markdown-editor', '*.markdown': 'markdown-editor' });
    assert.deepEqual(state.workspace, { '*.json': 'workspace.jsonEditor' });
    const settings = JSON.parse(fs.readFileSync(path.join(storage, 'settings/User/settings.json')));
    assert.deepEqual(settings['workbench.editorAssociations'], state.global);
    fs.writeFileSync(path.join(storage, 'association-state.json'), JSON.stringify(state, null, 2));
  });
  it('shows connected notes and opens the real graph alongside the editor', async () => {
    await bridge({ op: 'open' }); await hostCommand('workbench.view.extension.markdown-tools');
    await hostCommand('markdown-editor.openGraphView', [{ docUri: `file://${path.join(workspace, 'Markdown Studio.md')}` }]);
    await eventually(async () => { const tabs = await driver().findElements(By.css('.tab')); const text = (await Promise.all(tabs.map(tab => tab.getText()))).join(' '); assert.match(text, /Graph/i); return true; });
    await inWebview('#graph', async () => {
      try {
        await eventually(async () => {
          const state = await driver().executeScript(`return {
            labels: Array.from(document.querySelectorAll('#graph .node-label'), label => label.textContent).sort(),
            edges: document.querySelectorAll('#graph .edges line').length,
            stats: document.querySelector('#stats').textContent,
            loadingHidden: getComputedStyle(document.querySelector('#loading')).display === 'none',
          };`);
          assert.deepEqual(state.labels, ['Markdown Studio', 'Release Notes'], state.stats);
          assert.ok(state.edges > 0, 'Expected a link between the two graph nodes');
          assert.ok(state.loadingHidden, 'Expected the graph loading overlay to be hidden');
          return true;
        });
      } catch (error) {
        try {
          const html = await driver().executeScript('return document.documentElement.outerHTML');
          fs.writeFileSync(path.join(storage, 'graph-dom.html'), html);
        } catch (captureError) {
          console.warn('Could not capture the graph webview DOM:', captureError.message);
        }
        throw error;
      }
    });
    await screenshot('connected-notes-graph');
    await hostCommand('workbench.action.focusFirstEditorGroup');
    await hostCommand('notifications.clearAll');
    for (const name of ['QUICK NOTES','TAGS','OUTGOING LINKS','BACKLINKS']) {
      const headers = await driver().findElements(By.css('.part.sidebar .pane-header'));
      for (const header of headers) { if ((await header.getText()).includes(name)) { const expanded = await header.getAttribute('aria-expanded'); if ((name === 'QUICK NOTES' && expanded === 'true') || (name !== 'QUICK NOTES' && expanded === 'false')) await header.click(); } }
    }
    await screenshot('connected-notes-sidebar');
  });
  it('records the native editor-type picker and its provider suffix', async () => {
    await bridge({ op: 'open' });
    const tabs = await driver().findElements(By.css('.part.editor .tab.active'));
    await driver().actions().contextClick(tabs[tabs.length - 1]).perform();
    await eventually(async () => { assert.ok((await driver().findElements(By.css('.context-view'))).length); return true; });
    const menu = await driver().findElement(By.css('.context-view')).getText();
    fs.writeFileSync(path.join(storage, 'editor-tab-menu.txt'), menu);
    await screenshot('editor-tab-menu'); await driver().actions().sendKeys(Key.ESCAPE).perform();
    fs.writeFileSync(path.join(storage, 'picker-dom.html'), await driver().findElement(By.css('.part.editor')).getAttribute('outerHTML'));
    // The toolbar dropdown is host-owned. Record its actual supported label when present.
    const pickers = await driver().findElements(By.css('.part.editor .breadcrumbs-editor-type'));
    assert.ok(pickers.length, 'Expected the native editor-type picker on the supported host');
    if (pickers.length) {
      let picker; for (const candidate of pickers) if (await candidate.isDisplayed()) picker = candidate; assert.ok(picker, 'Expected a visible native editor-type picker'); await driver().executeScript('arguments[0].click()', picker);
      const text = await eventually(async () => { const views = await driver().findElements(By.css('.context-view, .monaco-menu-container')); const text = (await Promise.all(views.map(async view => await view.isDisplayed() ? await view.getText() : ''))).join('\n'); assert.match(text,/Markdown Studio/); return text; });
      assert.match(text, /Markdown Studio - Markdown Studio/); fs.writeFileSync(path.join(storage, 'editor-type-picker.txt'), text); await screenshot('editor-type-picker'); await driver().actions().sendKeys(Key.ESCAPE).perform();
    } else fs.writeFileSync(path.join(storage, 'editor-type-picker.txt'), 'Toolbar picker not exposed by this host; see native tab menu screenshot.');
  });
});
