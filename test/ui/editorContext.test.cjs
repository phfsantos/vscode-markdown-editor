const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const tools = createRequire(path.join(process.env.MARKDOWN_UI_TOOLS ?? __dirname, 'package.json'));
const { describe, it, afterEach } = tools('mocha');
const { By, Key, VSBrowser, WebView } = tools('vscode-extension-tester');
const reportPath = path.join(process.env.MARKDOWN_UI_WORKSPACE, 'context.json');
const report = () => JSON.parse(fs.readFileSync(reportPath, 'utf8'));
async function eventually(check) {
  let last;
  try { await VSBrowser.instance.driver.wait(async () => { try { await check(); return true; } catch (error) { last = error; return false; } }, 15000, undefined, 100); }
  catch { throw last; }
}
async function command(title) {
  const driver = VSBrowser.instance.driver;
  await eventually(async () => {
    await driver.switchTo().defaultContent();
    await driver.findElement(By.css('.monaco-workbench .part.sidebar')).click();
    await driver.actions().sendKeys(Key.ESCAPE, Key.F1).perform();
    const input = await driver.wait(async () => {
      for (const element of await driver.findElements(By.css('.quick-input-widget .quick-input-box input'))) {
        if (await element.isDisplayed()) return element;
      }
      return false;
    }, 2000);
    await input.click(); await input.sendKeys(Key.chord(Key.META, 'a'), '>' + title);
    await driver.wait(async () => {
      const rows = await driver.findElements(By.css('.quick-input-list .monaco-list-row'));
      for (const row of rows) if ((await row.getText()).includes(title)) return true;
      return false;
    }, 2000);
    await input.sendKeys(Key.ENTER);
  });
}

async function inEditor(action) {
  const view = new WebView();
  try { await view.switchToFrame(15000); return await action(view); }
  finally { await view.switchBack(); }
}
describe('Markdown Studio context API in real VS Code', function() {
  afterEach(async function() {
    if (this.currentTest.state === 'failed') await VSBrowser.instance.takeScreenshot(this.currentTest.title);
  });
  it('independent consumer reads exact source selection without a native editor', async () => {
    await command('Context UI: Open Test Document');
    await inEditor(async view => {
      await VSBrowser.instance.driver.wait(async () => (await view.findWebElements(By.css('strong'))).length > 0, 20000);
      await eventually(async () => {
        await VSBrowser.instance.driver.executeScript(`
          const editor = document.querySelector('.vditor-ir .vditor-reset'); editor.focus();
          const walker = document.createTreeWalker(editor.querySelector('strong'), NodeFilter.SHOW_TEXT);
          let node;
          while (walker.nextNode()) if (walker.currentNode.textContent.includes('Ship')) { node = walker.currentNode; break; }
          if (!node) throw new Error('Waiting for rendered Ship text');
          const start = node.textContent.indexOf('Ship');
          const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 4);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          return window.getSelection().toString();
        `);
        const value = report();
        assert.equal(value.context.selectionStatus, 'exact');
        assert.deepEqual(value.context.selection, { start: { line: 0, character: 8 }, end: { line: 0, character: Number(process.env.MARKDOWN_UI_EXPECT_END ?? 12) } });
        assert.equal(value.activeNativeEditor, null);
        assert.deepEqual(value.nativeEditors, []);
        assert.equal(fs.readFileSync(path.join(process.env.MARKDOWN_UI_WORKSPACE, 'tasks.md'), 'utf8'), '- [ ] **Ship**\n');
      });
    });
  });
  it('clears source range while toolbar UI has focus', async () => {
    await inEditor(async () => {
      await VSBrowser.instance.driver.executeScript(`
        const button = document.querySelector('.vditor-toolbar button, .vditor-toolbar [data-type]');
        if (!button) throw new Error('Expected real Vditor toolbar');
        button.setAttribute('tabindex', '0'); button.focus();
      `);
    });
    await eventually(async () => assert.equal(report().context.selectionStatus, 'unavailable'));
  });
  it('switches documents and clears for an unrelated native editor', async () => {
    const first = report().context;
    await command('Context UI: Open Other Document');
    await eventually(async () => { const value = report(); assert.match(value.context.uri, /other\.md$/); assert.notEqual(value.context.panelId, first.panelId); });
    await command('Context UI: Open Unrelated Document');
    await eventually(async () => assert.equal(report().context, null));
  });
  it('retains context with native tab badges disabled and enabled', async () => {
    await command('Context UI: Open Test Document');
    await command('Context UI: Disable Badges');
    await eventually(() => {
      assert.equal(report().badges, false);
      const settings = JSON.parse(fs.readFileSync(path.join(process.env.TEST_RESOURCES, 'settings/User/settings.json'), 'utf8'));
      assert.equal(settings['workbench.editor.decorations.badges'], false);
      assert.match(report().context.uri, /tasks\.md$/);
    });
    await command('Context UI: Enable Badges');
    await eventually(() => assert.equal(report().badges, true));
  });
  it('retains context while focus moves to built-in chat without submitting content', async () => {
    await command('Context UI: Focus Chat');
    await eventually(() => assert.match(report().context.uri, /tasks\.md$/));
    const chat = await VSBrowser.instance.driver.findElements(By.css('.interactive-session'));
    assert.ok(chat.length > 0, 'Expected actual built-in chat UI');
  });
  it('reconciles a restored custom tab after reloading the isolated window', async () => {
    const previous = report().context;
    await command('Developer: Reload Window');
    await VSBrowser.instance.waitForWorkbench();
    await eventually(() => {
      const value = report(); assert.match(value.context.uri, /tasks\.md$/);
      assert.notEqual(value.context.panelId, previous.panelId);
      assert.deepEqual(value.nativeEditors, []);
    });
  });

});
