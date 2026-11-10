const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireTools = createRequire(path.join(process.env.MARKDOWN_UI_TOOLS ?? __dirname, 'package.json'));
const { describe, it, afterEach } = requireTools('mocha');
const { VSBrowser, By, Key, WebView } = requireTools('vscode-extension-tester');
const workspace = process.env.MARKDOWN_BASELINE195_WORKSPACE;
const artifact = name => path.join(process.env.MARKDOWN_BASELINE195_ARTIFACTS, (process.env.MARKDOWN_BASELINE195_PREFIX ?? 'isolation195-ui') + '-' + name);
const report = () => JSON.parse(fs.readFileSync(path.join(workspace, 'baseline-ui.json'), 'utf8'));
const driver = () => VSBrowser.instance.driver;
const states = globalThis.baseline195States = [];
async function eventually(check, timeout = 20000) {
  let last;
  try { await driver().wait(async () => { try { await check(); return true; } catch (e) { last = e; return false; } }, timeout, undefined, 150); }
  catch { throw last; }
}
async function command(title, operation) {
  let previous = 0;
  try { previous = report().sequence; } catch {}
  await driver().switchTo().defaultContent();
  await driver().actions().sendKeys(Key.ESCAPE, Key.F1).perform();
  const input = await driver().wait(async () => {
    for (const e of await driver().findElements(By.css('.quick-input-widget .quick-input-box input'))) if (await e.isDisplayed()) return e;
    return false;
  }, 5000);
  await input.sendKeys(Key.chord(Key.META, 'a'), '>Baseline Activity: ' + title);
  await driver().wait(async () => {
    for (const row of await driver().findElements(By.css('.quick-input-list .monaco-list-row'))) if ((await row.getText()).includes('Baseline Activity: ' + title)) return true;
    return false;
  }, 5000);
  await input.sendKeys(Key.ENTER);
  await eventually(() => {
    assert.ok(report().sequence > previous);
    assert.equal(report().operation, operation);
    assert.equal(report().error, undefined);
  });
  assert.equal(report().version, '1.95.0');
  return report();
}
async function editorState() {
  const view = new WebView();
  try {
    await view.switchToFrame(10000);
    return await driver().executeScript(`
      const root=document.querySelector('.vditor-ir .vditor-reset');
      const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,height:r.height};};
      return {markers:[...document.querySelectorAll('.md-agent-task-indicator')].map(e=>({line:Number(e.dataset.taskLine),state:e.dataset.state,rect:rect(e)})),
        boxes:[...(root?.querySelectorAll('input[type=checkbox]')??[])].map(rect),
        header:document.querySelector('.md-agent-activity-header')?.textContent,
        status:document.querySelector('.md-agent-activity-status')?.textContent,
        inside:!!root?.querySelector('.md-agent-task-indicator')};
    `);
  } finally { await view.switchBack(); }
}
async function badgeCount() {
  await driver().switchTo().defaultContent();
  return driver().executeScript(`return [...document.querySelectorAll('.tabs-container .tab')].filter(tab=>[...tab.querySelectorAll('*')].some(e=>['::before','::after'].some(p=>getComputedStyle(e,p).content.replaceAll('"','').trim()==='A'))).length;`);
}
async function statusVisible() {
  await driver().switchTo().defaultContent();
  for (const item of await driver().findElements(By.css('.statusbar-item'))) if ((await item.getText()).includes('Agent working') && await item.isDisplayed()) return true;
  return false;
}
function preservation(r) { return { document: r.document, diskSha256: r.diskSha256, settings: r.settings }; }
function settingsBytes() { return fs.readFileSync(path.join(process.env.TEST_RESOURCES, 'settings/User/settings.json'), 'utf8'); }
function remember(label, r) { states.push({ label, ...r }); }
async function screenshot(name) {
  await driver().switchTo().defaultContent();
  fs.writeFileSync(artifact(name + '.png'), await driver().takeScreenshot(), 'base64');
}
async function assertWorking(label, badges) {
  await eventually(async () => {
    const s = await editorState();
    assert.equal(s.boxes.length, 2);
    assert.equal(s.markers.length, 1);
    assert.equal(s.markers[0].line, Number(process.env.MARKDOWN_BASELINE195_EXPECT_TASK_LINE ?? 1));
    assert.equal(s.markers[0].state, 'working');
    assert.ok(Math.abs((s.markers[0].rect.top + s.markers[0].rect.height / 2) - (s.boxes[1].top + s.boxes[1].height / 2)) < 6);
    assert.equal(s.inside, false);
    assert.match(s.header, /working/);
    assert.ok(s.status.includes(label));
    assert.equal(await statusVisible(), true);
    assert.equal(await badgeCount(), badges ? 2 : 0);
  });
}
async function assertClear() {
  await eventually(async () => {
    const s = await editorState();
    assert.equal(s.markers.length, 0);
    assert.equal(await badgeCount(), 0);
    assert.equal(await statusVisible(), false);
    assert.ok(!s.header || !s.header.includes('working'));
    assert.ok(!s.status || !s.status.includes('working'));
  });
}
describe('VS Code1.95 baseline activity visuals', function () {
  this.timeout(50000);
  afterEach(async function () { if (this.currentTest.state === 'failed') await screenshot('failure-' + this.currentTest.title.replace(/[^a-z0-9]+/gi, '-')); });
  it('opens the same source in native and custom editor tabs', async () => {
    const r = await command('Open Both Editors', 'open');
    await eventually(async () => assert.equal((await editorState()).boxes.length, 2));
    assert.ok(r.tabs.some(t => !t.custom && t.uri === r.uri));
    assert.ok(r.tabs.some(t => t.custom && t.viewType === 'markdown-editor' && t.uri === r.uri));
    assert.ok(r.nativeEditors.includes(r.uri));
    assert.equal(r.document.text, '- [ ] Same\n- [ ] Same\n');
    assert.equal(r.document.version, 1);
    assert.equal(r.document.dirty, false);
    assert.equal(r.document.textSha256, r.diskSha256);
    remember('opened', r);
  });
  for (const [transport, title, label] of [['exports', 'Report Exports', 'Baseline Export Agent'], ['commands', 'Report Commands', 'Baseline Command Agent']]) {
    it(`${transport} producer preserves source while both tabs and the exact task show activity`, async () => {
      const before = await command('Snapshot', 'snapshot');
      const settings = settingsBytes();
      await command(title, transport);
      await assertWorking(label, true);
      const after = await command('Snapshot', 'snapshot');
      assert.deepEqual(preservation(after), preservation(before));
      assert.equal(settingsBytes(), settings);
      assert.equal(fs.readFileSync(path.join(workspace, 'tasks.md'), 'utf8'), before.document.text);
      remember(transport + '-working', after);
      await screenshot(transport + '-working');
      const clear = await command('Clear', 'clear');
      await assertClear();
      assert.deepEqual(preservation(clear), preservation(before));
      assert.equal(settingsBytes(), settings);
      remember(transport + '-cleared', clear);
    });
  }
  it('retains task and header/status fallbacks with tab badges disabled', async () => {
    await command('Disable Badges', 'badgesOff');
    try {
      const before = await command('Snapshot', 'snapshot');
      const settings = settingsBytes();
      assert.equal(JSON.parse(settings)['workbench.editor.decorations.badges'], false);
      await command('Report Exports', 'exports');
      await assertWorking('Baseline Export Agent', false);
      const after = await command('Snapshot', 'snapshot');
      assert.deepEqual(preservation(after), preservation(before));
      assert.equal(settingsBytes(), settings);
      remember('badges-disabled-working', after);
      await screenshot('badges-disabled-fallback');
      const clear = await command('Clear', 'clear');
      await assertClear();
      assert.deepEqual(preservation(clear), preservation(before));
      assert.equal(settingsBytes(), settings);
      remember('badges-disabled-cleared', clear);
      await screenshot('cleared');
    } finally { await command('Enable Badges', 'badgesOn'); }
  });
});
