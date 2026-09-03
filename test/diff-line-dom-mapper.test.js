import assert from 'assert';
import { test } from 'vitest';

import { getRenderedLineElements, buildRenderedLineMap } from '../packages/media/src/diff-line-dom-mapper';

class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
    this.childNodes = [];
    this.parentElement = null;
  }
}

class FakeElement {
  constructor(tagName, attrs = {}, children = []) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this._attrs = { ...attrs };
    this.childNodes = [];
    this.parentElement = null;
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  get children() {
    return this.childNodes.filter((child) => child.nodeType === 1);
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent || '').join('');
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this._attrs, name);
  }

  getAttribute(name) {
    return this.hasAttribute(name) ? this._attrs[name] : null;
  }
}

function text(value) {
  return new FakeTextNode(value);
}

function el(tagName, attrs, children = []) {
  return new FakeElement(tagName, attrs, children);
}

function testCollectsNestedListItemsAsDisplayLines() {
  const root = el('pre', {}, [
    el('ul', {}, [
      el('li', {}, [text('Test 1')]),
      el('li', {}, [text('Test 2')]),
      el('li', {}, [text('Test 3')]),
    ])
  ]);

  const lines = getRenderedLineElements(root);

  assert.deepStrictEqual(lines.map((line) => line.tagName), ['LI', 'LI', 'LI']);
  assert.strictEqual(lines[1].textContent, 'Test 2');

  console.log('✅ testCollectsNestedListItemsAsDisplayLines passed');
}

function testParagraphCountsAsRenderedLineWhenInlineChildOwnsText() {
  const root = el('pre', {}, [
    el('p', {}, [
      el('span', {}, [text('test')])
    ])
  ]);

  const lines = getRenderedLineElements(root);

  assert.deepStrictEqual(lines.map((line) => line.tagName), ['P']);
  assert.strictEqual(lines[0].textContent, 'test');

  console.log('✅ testParagraphCountsAsRenderedLineWhenInlineChildOwnsText passed');
}

function testSkipsParentBlockWhenNestedBlockExists() {
  const root = el('pre', {}, [
    el('blockquote', {}, [
      text('Quoted'),
      el('ul', {}, [
        el('li', {}, [text('One')]),
        el('li', {}, [text('Two')]),
      ])
    ]),
    el('p', {}, [text('Tail')])
  ]);

  const lines = getRenderedLineElements(root);

  assert.deepStrictEqual(lines.map((line) => line.tagName), ['LI', 'LI', 'P']);
  assert.deepStrictEqual(lines.map((line) => line.textContent), ['One', 'Two', 'Tail']);

  console.log('✅ testSkipsParentBlockWhenNestedBlockExists passed');
}

function testTreatsCodeBlockContainerAsSingleRenderedLine() {
  const root = el('pre', {}, [
    el('div', { 'data-type': 'code-block' }, [
      el('div', {}, [
        el('pre', {}, [
          el('code', {}, [text('line 1\nline 2')])
        ])
      ])
    ]),
    el('p', {}, [text('Tail')])
  ]);

  const lines = getRenderedLineElements(root);

  assert.deepStrictEqual(lines.map((line) => line.tagName), ['DIV', 'P']);
  assert.strictEqual(lines[0].getAttribute('data-type'), 'code-block');
  assert.strictEqual(lines[0].textContent, 'line 1\nline 2');
  assert.strictEqual(lines[1].textContent, 'Tail');

  console.log('✅ testTreatsCodeBlockContainerAsSingleRenderedLine passed');
}

function testBuildRenderedLineMapUsesDeepestEligibleOrder() {
  const root = el('pre', {}, [
    el('ul', {}, [
      el('li', {}, [text('Item 1')]),
      el('li', {}, [text('Item 2')]),
      el('li', {}, [text('Item 3')]),
    ]),
    el('p', {}, [text('Tail')])
  ]);

  const lineMap = buildRenderedLineMap(root);

  assert.strictEqual(lineMap.get(0).textContent, 'Item 1');
  assert.strictEqual(lineMap.get(1).textContent, 'Item 2');
  assert.strictEqual(lineMap.get(2).textContent, 'Item 3');
  assert.strictEqual(lineMap.get(3).textContent, 'Tail');

  console.log('✅ testBuildRenderedLineMapUsesDeepestEligibleOrder passed');
}

function testSkipsInjectedLineNumberElements() {
  const root = el('pre', {}, [
    el('div', { 'data-vditor-line-number-gutter': 'true' }, [
      el('span', { 'data-vditor-line-number': 'true' }, [text('1')])
    ]),
    el('p', {}, [text('Alpha')])
  ]);

  const lines = getRenderedLineElements(root);

  assert.deepStrictEqual(lines.map((line) => line.tagName), ['P']);
  assert.strictEqual(lines[0].textContent, 'Alpha');

  console.log('✅ testSkipsInjectedLineNumberElements passed');
}

test('collects nested list items as display lines', testCollectsNestedListItemsAsDisplayLines);
test('paragraph counts as rendered line when inline child owns text', testParagraphCountsAsRenderedLineWhenInlineChildOwnsText);
test('skips parent block when nested block exists', testSkipsParentBlockWhenNestedBlockExists);
test('treats code block container as single rendered line', testTreatsCodeBlockContainerAsSingleRenderedLine);
test('buildRenderedLineMap uses deepest eligible order', testBuildRenderedLineMapUsesDeepestEligibleOrder);
test('skips injected line number elements', testSkipsInjectedLineNumberElements);
