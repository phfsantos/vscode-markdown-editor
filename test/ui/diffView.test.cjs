/**
 * Diff view in real VS Code: Git working-tree diff, file<->file compare and the
 * single-view pending-edit diff, driven through the context-ui driver extension.
 *
 * Each diff side is its own webview. VS Code replaces a webview's inner frame
 * when its HTML is reassigned, so every check re-enters from defaultContent and
 * picks the frame whose document holds a side marker (see enterPane).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const tools = createRequire(path.join(process.env.MARKDOWN_UI_TOOLS ?? __dirname, 'package.json'));
const { describe, it, before, after, afterEach } = tools('mocha');
const { By, Key, VSBrowser } = tools('vscode-extension-tester');
const fixture = require('./diffFixture.cjs');

const workspace = process.env.MARKDOWN_UI_WORKSPACE;
const evidencePath = path.join(process.env.TEST_RESOURCES ?? workspace, 'diff-evidence.json');
const evidence = {};
const record = (key, value) => {
  evidence[key] = value;
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
};
const driver = () => VSBrowser.instance.driver;
const readReport = () => JSON.parse(fs.readFileSync(path.join(workspace, 'diff-report.json'), 'utf8'));
const disk = (...parts) => fs.readFileSync(path.join(workspace, ...parts), 'utf8');

const ORIGINAL = 'Status: original';
const MODIFIED = 'Status: modified';
const PENDING = 'Keep this line.';

async function eventually(check, timeout = 15000) {
  let last;
  try {
    await driver().wait(async () => {
      try { await check(); return true; } catch (error) { last = error; return false; }
    }, timeout, undefined, 100);
  } catch { throw last ?? new Error('eventually() timed out'); }
}

async function command(title) {
  const d = driver();
  await eventually(async () => {
    await d.switchTo().defaultContent();
    await d.findElement(By.css('.monaco-workbench .part.sidebar')).click();
    await d.actions().sendKeys(Key.ESCAPE, Key.F1).perform();
    const input = await d.wait(async () => {
      for (const element of await d.findElements(By.css('.quick-input-widget .quick-input-box input'))) {
        if (await element.isDisplayed()) return element;
      }
      return false;
    }, 2000);
    await input.click();
    await input.sendKeys(Key.chord(Key.META, 'a'), '>' + title);
    await d.wait(async () => {
      for (const row of await d.findElements(By.css('.quick-input-list .monaco-list-row'))) {
        if ((await row.getText()).includes(title)) return true;
      }
      return false;
    }, 2000);
    await input.sendKeys(Key.ENTER);
  });
}

/**
 * Enter the webview whose rendered document contains `marker`, starting from
 * the workbench every time. Returns the outer iframe's rect in workbench
 * coordinates so callers can tell left from right.
 */
async function enterPane(marker) {
  const d = driver();
  const seen = [];
  await d.switchTo().defaultContent();
  const count = (await d.findElements(By.css('iframe'))).length;
  for (let index = 0; index < count; index++) {
    try {
      await d.switchTo().defaultContent();
      const outer = (await d.findElements(By.css('iframe')))[index];
      if (!outer) continue;
      const rect = await outer.getRect();
      await d.switchTo().frame(outer);
      const inner = await d.findElements(By.css('#active-frame'));
      if (!inner.length) continue;
      await d.switchTo().frame(inner[0]);
      // #app hosts the visible editor; the hidden diff renderer has its own pre.vditor-reset.
      const text = await d.executeScript(
        'const root = document.querySelector("#app .vditor-ir pre.vditor-reset"); return root ? root.textContent : null;',
      );
      seen.push(text === null ? '(no editor)' : text.slice(0, 40));
      if (text && text.includes(marker)) return rect;
    } catch (error) { seen.push(`(error: ${error.name})`); }
  }
  await d.switchTo().defaultContent();
  throw new Error(`No Markdown Studio pane shows "${marker}" (frames: ${JSON.stringify(seen)})`);
}

/** Index (among workbench iframes) of the pane showing `marker`. */
async function paneIndex(marker) {
  let found = -1;
  await eventually(async () => {
    const d = driver();
    await d.switchTo().defaultContent();
    const total = (await d.findElements(By.css('iframe'))).length;
    for (let index = 0; index < total && found < 0; index++) {
      await d.switchTo().defaultContent();
      const outer = (await d.findElements(By.css('iframe')))[index];
      try {
        await d.switchTo().frame(outer);
        const inner = await d.findElements(By.css('#active-frame'));
        if (!inner.length) continue;
        await d.switchTo().frame(inner[0]);
        if (await d.executeScript('const r = document.querySelector("#app .vditor-ir pre.vditor-reset"); return Boolean(r && r.textContent.includes(arguments[0]));', marker)) found = index;
      } catch { /* next */ }
    }
    await d.switchTo().defaultContent();
    assert.ok(found >= 0, `pane "${marker}" not found`);
  });
  return found;
}

/**
 * WebDriver cannot resize the Electron window ("Browser.getWindowForTarget"), so
 * size one pane's webview iframe directly; the page inside reflows to that width.
 */
async function setPaneWidth(marker, width) {
  const index = await paneIndex(marker);
  await driver().executeScript(`
    const frame = document.querySelectorAll('iframe')[arguments[0]];
    if (!frame.hasAttribute('data-ui-test-style')) frame.setAttribute('data-ui-test-style', frame.getAttribute('style') || '');
    if (arguments[1] === null) { frame.setAttribute('style', frame.getAttribute('data-ui-test-style')); frame.removeAttribute('data-ui-test-style'); }
    else { frame.style.width = arguments[1] + 'px'; frame.style.maxWidth = 'none'; }`, index, width);
}

async function inPane(marker, action, timeout = 20000) {
  let rect;
  await eventually(async () => { rect = await enterPane(marker); }, timeout);
  try { return await action(rect); }
  finally { await driver().switchTo().defaultContent(); }
}

/** Observable diff state of the current pane; reads the new status bar or the legacy header. */
const PROBE = `
  const q = (s) => document.querySelector(s);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const bar = q('[data-diff-statusbar]') || q('.diff-view-header');
  let role = bar && bar.dataset && bar.dataset.diffRole || null;
  if (!role && bar) role = /Original/.test(bar.textContent) ? 'original' : /Modified/.test(bar.textContent) ? 'modified' : null;
  const toolbar = q('.vditor-toolbar');
  const toolbarStyle = toolbar && getComputedStyle(toolbar);
  const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('markdown-diff:'))
    .map((m) => ({ name: m.name, at: performance.timeOrigin + m.startTime }));
  return {
    role, statusText: bar ? bar.innerText.replace(/\\s+/g, ' ').trim() : null,
    statusBar: box(bar), toolbar: box(toolbar),
    toolbarUsable: Boolean(toolbar && toolbarStyle.display !== 'none' && toolbarStyle.visibility !== 'hidden' && toolbarStyle.pointerEvents !== 'none'),
    decorated: document.querySelectorAll('[data-diff-type]').length,
    spacers: document.querySelectorAll('.diff-spacer-block').length,
    previousRows: document.querySelectorAll('[data-diff-previous]').length,
    paints: document.querySelectorAll('.md-diff-paint').length,
    // The tint must be the topmost thing at a changed row, not hidden under an opaque theme background.
    paintOnTop: (() => {
      const paint = document.querySelector('.md-diff-paint');
      if (!paint) return null;
      const r = paint.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return 'offscreen';
      paint.style.pointerEvents = 'auto';
      const hit = document.elementFromPoint(r.left + r.width / 2, Math.max(r.top, 0) + Math.min(r.height, 4) / 2);
      paint.style.pointerEvents = '';
      return hit === paint;
    })(),
    errorState: Boolean(q('[data-diff-statusbar][data-diff-state="error"]')),
    viewport: { width: innerWidth, height: innerHeight },
    marks,
  };
`;
const probe = () => driver().executeScript(PROBE);
const intersects = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);

async function shot(name) {
  await driver().switchTo().defaultContent();
  await VSBrowser.instance.takeScreenshot(`diff-${name}`);
}

async function openFresh(commandTitle) {
  await command('Diff UI: Close All');
  await command('Diff UI: Reset Fixtures');
  await command(commandTitle);
}

describe('Diff view in real VS Code', function () {
  this.timeout(120000);
  before(async () => { await command('Diff UI: Close All'); });
  afterEach(async function () {
    await driver().switchTo().defaultContent();
    if (this.currentTest.state === 'failed') await VSBrowser.instance.takeScreenshot(this.currentTest.title);
  });
  after(async () => { await command('Diff UI: Close All'); await command('Diff UI: Reset Fixtures'); });

  it('opens a .md file in Markdown Studio by default', async () => {
    await command('Diff UI: Close All');
    await command('Diff UI: Open Default Editor');
    await eventually(async () => {
      await command('Diff UI: Record Report');
      const active = readReport().tabs.find((tab) => tab.active && tab.label.includes('second.md'));
      record('defaultEditor', { version: readReport().version, active });
      assert.equal(active?.input.kind, 'TabInputCustom');
      assert.equal(active?.input.viewType, 'markdown-editor');
    }, 20000);
  });

  describe('Git working-tree diff', () => {
    before(async () => { await openFresh('Diff UI: Open Git Working Tree Diff'); });

    it('opens Markdown Studio on both sides', async () => {
      const started = Date.now();
      const left = await inPane(ORIGINAL, async (rect) => rect, 30000);
      const right = await inPane(MODIFIED, async (rect) => rect, 30000);
      await command('Diff UI: Record Report');
      record('gitDiff.tabs', { ...readReport(), openedMs: Date.now() - started });
      await shot('git-diff-opened');
      assert.ok(left.x < right.x, `original pane (x=${left.x}) must be left of modified pane (x=${right.x})`);
    });

    it('labels original left and modified right', async () => {
      await eventually(async () => {
        const left = await inPane(ORIGINAL, probe);
        const right = await inPane(MODIFIED, probe);
        record('gitDiff.roles', { left: left.role, right: right.role, leftStatus: left.statusText, rightStatus: right.statusText });
        assert.equal(left.role, 'original');
        assert.equal(right.role, 'modified');
      }, 20000);
    });

    it('decorates both panes within 500 ms of both rendering', async () => {
      let left; let right;
      await eventually(async () => {
        left = await inPane(ORIGINAL, probe);
        right = await inPane(MODIFIED, probe);
        assert.ok(left.decorated > 0 && right.decorated > 0, 'both panes decorated');
        assert.ok(left.paints > 0 && right.paints > 0, 'both panes paint their changed rows');
        assert.equal(left.paintOnTop, true, 'original pane tint is hidden under the content');
        assert.equal(right.paintOnTop, true, 'modified pane tint is hidden under the content');
      }, 20000);
      const at = (state, name) => state.marks.find((m) => m.name === name)?.at;
      const rendered = Math.max(at(left, 'markdown-diff:rendered') ?? NaN, at(right, 'markdown-diff:rendered') ?? NaN);
      const applied = Math.max(at(left, 'markdown-diff:applied') ?? NaN, at(right, 'markdown-diff:applied') ?? NaN);
      record('gitDiff.timing', { rendered, applied, latencyMs: applied - rendered, leftMarks: left.marks, rightMarks: right.marks });
      assert.ok(Number.isFinite(applied - rendered), 'panes must publish markdown-diff:rendered and markdown-diff:applied marks');
      assert.ok(applied - rendered < 500, `decorations took ${applied - rendered} ms after both panes rendered`);
    });

    for (const width of [1280, 600]) {
      it(`keeps the status bar clear of the toolbar at ${width}px`, async () => {
        try {
          for (const marker of [ORIGINAL, MODIFIED]) {
            await setPaneWidth(marker, width);
            await eventually(async () => {
              const state = await inPane(marker, probe);
              record(`gitDiff.layout.${width}.${marker === ORIGINAL ? 'left' : 'right'}`, state);
              assert.equal(state.viewport.width, width, 'pane resized');
              assert.ok(state.statusBar, 'status bar present');
              assert.ok(state.statusBar.height <= 28, `status bar is ${state.statusBar.height}px tall`);
              assert.ok(!state.toolbarUsable || !intersects(state.statusBar, state.toolbar), 'status bar overlaps the toolbar');
            });
          }
          await shot(`git-diff-layout-${width}`);
        } finally {
          for (const marker of [ORIGINAL, MODIFIED]) await setPaneWidth(marker, null).catch(() => undefined);
        }
      });
    }

    it('leaves the toolbar inoperable on the read-only original side and usable on the modified side', async () => {
      const hitTest = `
        const button = document.querySelector('.vditor-toolbar [data-type="save"]');
        if (!button) return { button: false };
        const r = button.getBoundingClientRect();
        const hit = r.width && r.height ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
        return { button: true, hitIsButton: Boolean(hit && button.contains(hit)), width: r.width };`;
      const original = await inPane(ORIGINAL, async () => ({ ...(await probe()), ...(await driver().executeScript(hitTest)) }));
      const modified = await inPane(MODIFIED, async () => ({ ...(await probe()), ...(await driver().executeScript(hitTest)) }));
      record('gitDiff.toolbarScope', { original, modified });
      // N3: the read-only side must be inoperable by design, not because something covers it.
      assert.equal(original.toolbarUsable, false, 'read-only side shows an operable toolbar');
      assert.ok(!original.hitIsButton, 'read-only toolbar button is reachable');
      assert.equal(modified.toolbarUsable, true, 'editable side lost its toolbar');
      assert.ok(modified.hitIsButton, 'editable toolbar button is covered');
      // Disabled, not hidden: both panes keep the toolbar row, so aligned rows sit level.
      assert.ok(Math.abs(original.statusBar.top - modified.statusBar.top) <= 1, `status bars at ${original.statusBar.top} vs ${modified.statusBar.top}`);
    });

    it('saves exactly the editor markdown with the diff active', async () => {
      await inPane(MODIFIED, async () => {
        await driver().executeScript(`
          const root = document.querySelector('#app .vditor-ir pre.vditor-reset');
          const target = [...root.querySelectorAll('p')].find((p) => p.textContent.includes('Tail paragraph.'));
          target.scrollIntoView({ block: 'center' });
          const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
          let last = null; while (walker.nextNode()) last = walker.currentNode;
          const range = document.createRange(); range.setStart(last, last.textContent.length); range.collapse(true);
          root.focus(); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
        `);
        await driver().switchTo().activeElement().sendKeys(' SAVE-PROBE');
      });
      await eventually(async () => {
        await command('Diff UI: Record Documents');
        const doc = readReport().documents.find((d) => d.scheme === 'file' && d.uri.endsWith('/diff.md') && !d.uri.includes('/compare/'));
        assert.ok(doc?.isDirty && doc.text.includes('SAVE-PROBE'), 'edit reached the document');
      });
      await inPane(MODIFIED, async () => {
        const button = await driver().findElement(By.css('.vditor-toolbar [data-type="save"]'));
        await button.click();
      });
      let editorMarkdown;
      await eventually(async () => {
        assert.ok(disk('diff.md').includes('SAVE-PROBE'), 'toolbar save wrote the file');
        editorMarkdown = await inPane(MODIFIED, () => driver().executeScript('return window.vditor.getValue();'));
      });
      const saved = disk('diff.md');
      record('gitDiff.save', { savedLength: saved.length, editorLength: editorMarkdown.length, equal: saved === editorMarkdown });
      for (const deletedOnly of ['Child two is deleted', 'Deleted row', 'const answer = 41', 'will be deleted from the working tree', 'Status: original']) {
        assert.ok(!saved.includes(deletedOnly), `deleted content "${deletedOnly}" leaked into the saved file`);
      }
      assert.equal(saved, editorMarkdown, 'saved file differs from the editor markdown');
      assert.equal(disk('second.md'), '# Second file\n\nUnchanged.\n');
    });

    it('scrolls the other pane to the aligned row within 100 ms without echo', async () => {
      const install = `
        const scroller = document.querySelector('#app .vditor-ir pre.vditor-reset');
        window.__scrollLog = [];
        window.__posted = [];
        window.__received = [];
        scroller.addEventListener('scroll', () => window.__scrollLog.push({ t: Date.now(), top: scroller.scrollTop }), { passive: true });
        const post = window.vscode.postMessage.bind(window.vscode);
        window.vscode.postMessage = (message) => { if (message && message.command === 'diff-scroll-sync') window.__posted.push({ t: Date.now(), anchor: message.anchor }); return post(message); };
        window.addEventListener('message', (event) => { if (event.data && event.data.command === 'diff-scroll-sync') window.__received.push({ t: Date.now(), anchor: event.data.anchor }); });
        return true;`;
      await inPane(ORIGINAL, () => driver().executeScript(install));
      await inPane(MODIFIED, () => driver().executeScript(install));
      let source;
      await inPane(ORIGINAL, async () => {
        const target = await driver().executeScript(`
          return [...document.querySelectorAll('#app .vditor-ir pre.vditor-reset p')].find((p) => p.textContent.includes('ROW-100'));`);
        source = { at: Date.now() };
        await driver().actions().scroll(0, 0, 0, 2400, target).perform();
      });
      await driver().sleep(600);
      const position = `
        const scroller = document.querySelector('#app .vditor-ir pre.vditor-reset');
        const top = scroller.getBoundingClientRect().top;
        const rows = [...scroller.querySelectorAll('p')].filter((p) => /ROW-\\d{3}/.test(p.textContent));
        const first = rows.find((p) => p.getBoundingClientRect().bottom > top + 1);
        const hostEl = scroller.parentElement;
        const bar = document.querySelector('[data-diff-statusbar]');
        return { owner: hostEl.dataset.diffScrollOwner, posts: hostEl.dataset.diffScrollPosts, state: bar && bar.dataset.diffState, log: window.__scrollLog, posted: window.__posted, received: window.__received, firstRow: first && first.textContent.match(/ROW-\\d{3}/)[0], offset: first && first.getBoundingClientRect().top - top, rowHeight: first && first.getBoundingClientRect().height };`;
      const left = await inPane(ORIGINAL, () => driver().executeScript(position));
      const right = await inPane(MODIFIED, () => driver().executeScript(position));
      const leftLast = left.log.at(-1)?.t ?? NaN;
      const rightFirst = right.log[0]?.t ?? NaN;
      const rightLast = right.log.at(-1)?.t ?? NaN;
      const rightOffset = await inPane(MODIFIED, () => driver().executeScript(`
        const scroller = document.querySelector('#app .vditor-ir pre.vditor-reset');
        const row = [...scroller.querySelectorAll('p')].find((p) => p.textContent.includes(arguments[0]));
        return row ? row.getBoundingClientRect().top - scroller.getBoundingClientRect().top : null;`, left.firstRow));
      const result = {
        sourceStartedAt: source.at, leftEvents: left.log.length, rightEvents: right.log.length,
        followerLagMs: rightLast - leftLast, followerStartMs: rightFirst - (left.log[0]?.t ?? NaN),
        leftFirstRow: left.firstRow, leftOffset: left.offset, rightOffsetOfSameRow: rightOffset, rowHeight: left.rowHeight,
        leftEchoAfter300ms: left.log.filter((e) => e.t > rightLast + 300).length,
        leftPosted: left.posted.length, rightReceived: right.received.length, rightPosted: right.posted.length, leftReceived: left.received.length,
        leftOwner: left.owner, rightOwner: right.owner, leftPosts: left.posts, rightPosts: right.posts, leftState: left.state, rightState: right.state,
      };
      record('gitDiff.scroll', result);
      await shot('git-diff-scrolled');
      assert.ok(right.log.length > 0, 'the other pane never scrolled');
      assert.ok(result.followerLagMs <= 100, `follower settled ${result.followerLagMs} ms after the source`);
      assert.ok(rightOffset !== null && Math.abs(rightOffset - left.offset) <= left.rowHeight, `aligned row ${left.firstRow} is ${rightOffset - left.offset}px apart`);
      assert.equal(result.leftEchoAfter300ms, 0, 'source pane received echoed scroll events');
    });
  });

  describe('transport spike (ADR)', () => {
    before(async () => { await openFresh('Diff UI: Open Git Working Tree Diff'); });

    it('measures BroadcastChannel and host-relay delivery between the two panes', async () => {
      const listen = `
        window.__spike = { bc: [], relay: [] };
        const channel = new BroadcastChannel('markdown-diff-spike');
        channel.onmessage = (event) => window.__spike.bc.push({ id: event.data, t: Date.now() });
        window.addEventListener('message', (event) => {
          const data = event.data || {};
          if (data.command === 'diff-scroll-sync' && data.anchor) window.__spike.relay.push({ id: data.anchor.row, t: Date.now() });
        });
        return location.origin;`;
      const rightOrigin = await inPane(MODIFIED, () => driver().executeScript(listen), 30000);
      const sent = await inPane(ORIGINAL, () => driver().executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        const channel = new BroadcastChannel('markdown-diff-spike');
        const sent = [];
        let i = 0;
        const timer = setInterval(() => {
          i++;
          sent.push({ id: i, t: Date.now() });
          channel.postMessage(i);
          window.vscode.postMessage({ command: 'diff-scroll-sync', anchor: { row: i, offset: 0 } });
          if (i === 20) { clearInterval(timer); setTimeout(() => done({ origin: location.origin, sent }), 500); }
        }, 50);`));
      const received = await inPane(MODIFIED, () => driver().executeScript('return window.__spike;'));
      const latencies = (log) => log.map((r) => r.t - (sent.sent.find((s) => s.id === r.id)?.t ?? NaN)).filter(Number.isFinite).sort((a, b) => a - b);
      const stats = (values) => values.length ? { n: values.length, min: values[0], p50: values[Math.floor(values.length / 2)], p95: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))], max: values.at(-1) } : { n: 0 };
      const result = {
        leftOrigin: sent.origin, rightOrigin, sameOrigin: sent.origin === rightOrigin,
        broadcastChannel: stats(latencies(received.bc)), hostRelay: stats(latencies(received.relay)),
      };
      record('spike.transports', result);
      assert.equal(result.hostRelay.n, 20, 'host relay must deliver every sample');
    });
  });

  describe('File compare of same-named files', () => {
    before(async () => { await openFresh('Diff UI: Open File Compare'); });

    it('assigns original left and modified right without reading the label', async () => {
      await eventually(async () => {
        const left = await inPane(ORIGINAL, async (rect) => ({ rect, ...(await probe()) }));
        const right = await inPane(MODIFIED, async (rect) => ({ rect, ...(await probe()) }));
        await command('Diff UI: Record Report');
        record('fileCompare.roles', { left: left.role, right: right.role, leftX: left.rect.x, rightX: right.rect.x, tabs: readReport().tabs });
        assert.ok(left.rect.x < right.rect.x, 'original file renders in the left pane');
        assert.equal(left.role, 'original');
        assert.equal(right.role, 'modified');
        assert.ok(left.decorated > 0 && right.decorated > 0, 'both panes decorated');
      }, 30000);
      await shot('file-compare');
    });

    it('toolbar save in one pane writes only that pane\'s file', async () => {
      await inPane(MODIFIED, async () => {
        await driver().executeScript(`
          const root = document.querySelector('#app .vditor-ir pre.vditor-reset');
          const target = [...root.querySelectorAll('p')].find((p) => p.textContent.includes('Tail paragraph.'));
          target.scrollIntoView({ block: 'center' });
          const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
          let last = null; while (walker.nextNode()) last = walker.currentNode;
          const range = document.createRange(); range.setStart(last, last.textContent.length); range.collapse(true);
          root.focus(); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);`);
        await driver().switchTo().activeElement().sendKeys(' RIGHT-PROBE');
      });
      await eventually(async () => {
        await command('Diff UI: Record Documents');
        const doc = readReport().documents.find((d) => d.uri.endsWith('/compare/right/diff.md'));
        assert.ok(doc?.text.includes('RIGHT-PROBE'));
      });
      await inPane(MODIFIED, async () => { await driver().findElement(By.css('.vditor-toolbar [data-type="save"]')).click(); });
      await eventually(async () => assert.ok(disk('compare', 'right', 'diff.md').includes('RIGHT-PROBE'), 'right file saved'));
      assert.equal(disk('compare', 'left', 'diff.md'), fixture.original, 'left file must be untouched');
    });
  });

  describe('Single-view pending edit', () => {
    before(async () => { await openFresh('Diff UI: Open Pending Edit'); });

    it('renders the previous text as a read-only row above each changed line', async () => {
      let state;
      await eventually(async () => {
        state = await inPane(PENDING, () => driver().executeScript(`
          const root = document.querySelector('#app .vditor-ir pre.vditor-reset');
          const rows = [...document.querySelectorAll('[data-diff-previous]')];
          const box = (el) => el && el.getBoundingClientRect();
          const row = (text) => rows.find((r) => r.textContent.includes(text));
          const current = [...root.querySelectorAll('p')].find((p) => p.textContent.includes('New wording here.'));
          const tail = [...root.querySelectorAll('p')].find((p) => p.textContent.includes('Tail line.'));
          const old = row('Old wording here.'); const removed = row('This line is removed.');
          return {
            rows: rows.length,
            oldAboveCurrent: Boolean(old && current && box(old).bottom <= box(current).top + 1 && box(current).top - box(old).bottom < 12),
            removedAboveTail: Boolean(removed && tail && box(removed).bottom <= box(tail).top + 1),
            oldEditable: old ? old.isContentEditable : null,
            labelled: Boolean(old && (old.getAttribute('aria-label') || old.getAttribute('role'))),
            legacySpacers: document.querySelectorAll('.diff-spacer-block').length,
            decorated: document.querySelectorAll('[data-diff-type]').length,
            tooltip: (root.querySelector('[data-diff-type="modified"]') || {}).title || null,
          };`));
        record('pending.rows', state);
        assert.ok(state.oldAboveCurrent, 'previous text row is not directly above the modified line');
        assert.ok(state.removedAboveTail, 'deleted line has no previous-version row');
        assert.equal(state.oldEditable, false, 'previous-version row is editable');
        assert.ok(state.labelled, 'previous-version row has no accessible label');
      }, 30000);
      await shot('pending-single-view');
    });

    it('cannot type into a previous-version row and saves byte-identical markdown', async () => {
      await inPane(PENDING, async () => {
        const old = await driver().findElement(By.css('[data-diff-previous]'));
        await old.click();
        await driver().switchTo().activeElement().sendKeys('TYPED');
      });
      await command('Diff UI: Save All');
      const editorMarkdown = await inPane(PENDING, () => driver().executeScript('return window.vditor.getValue();'));
      const saved = disk('pending.md');
      record('pending.save', { saved, editorMarkdown });
      assert.ok(!saved.includes('TYPED') && !saved.includes('Old wording here.') && !saved.includes('This line is removed.'), 'previous-version text reached disk');
      assert.equal(saved, editorMarkdown);
    });
  });
});
