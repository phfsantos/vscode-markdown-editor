import assert from 'assert';
import { beforeEach, test } from 'vitest';

// 'vscode' resolves to test/mocks/vscode.ts via the vitest alias.
import { __reset } from 'vscode';
import { parseHTMLToLines } from '../src/diff/HtmlLineParser';
import { MarkdownDiffViewSupport } from '../src/diff/MarkdownDiffViewSupport';

beforeEach(() => {
  __reset();
});

function createSupport() {
  return new MarkdownDiffViewSupport({ subscriptions: [] });
}

function normalizeZeroWidth(html) {
  return html.replace(/&#8203;|\u200b/g, '__ZWSP__');
}

function testParserLineNumberingIsSequential() {
  const lines = parseHTMLToLines('<div data-block=""><p>One</p><p data-empty-line="true">&#8203;</p><pre><code>const x = 1;</code></pre></div>');

  assert.deepStrictEqual(lines.map(line => line.lineNumber), [0, 1, 2]);
  assert.deepStrictEqual(lines.map(line => line.tagName), ['p', 'p', 'pre']);
  assert.ok(lines[1].html.includes('data-empty-line="true"'));

  console.log('✅ testParserLineNumberingIsSequential passed');
}

function testParserRegressionAgainstNestedHtml() {
  const lines = parseHTMLToLines('<div data-block=""><blockquote>Quote<ul><li>A</li><li>B</li></ul></blockquote><p>Tail</p></div>');

  assert.strictEqual(lines.length, 3);
  assert.deepStrictEqual(lines.map(line => line.tagName), ['li', 'li', 'p']);
  assert.deepStrictEqual(lines.map(line => line.textContent), ['A', 'B', 'Tail']);

  console.log('✅ testParserRegressionAgainstNestedHtml passed');
}

function testParserCountsParagraphWithInlineTextChild() {
  const lines = parseHTMLToLines('<p><span>Alpha</span></p><div><p>Beta</p></div>');

  assert.deepStrictEqual(lines.map(line => ({ tagName: line.tagName, html: line.html })), [
    { tagName: 'p', html: '<p><span>Alpha</span></p>' },
    { tagName: 'p', html: '<p>Beta</p>' }
  ]);

  console.log('✅ testParserCountsParagraphWithInlineTextChild passed');
}

function testParserTreatsCodeBlockContainerAsSingleLine() {
  const lines = parseHTMLToLines('<div data-type="code-block"><div><pre><code>line 1\nline 2</code></pre></div></div><p>Tail</p>');

  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual(lines.map(line => line.tagName), ['div', 'p']);
  assert.ok(lines[0].html.includes('data-type="code-block"'));
  assert.strictEqual(lines[0].textContent, 'line 1 line 2');
  assert.strictEqual(lines[1].textContent, 'Tail');

  console.log('✅ testParserTreatsCodeBlockContainerAsSingleLine passed');
}

function testAlignedDiffTracksBlankAndInlineLines() {
  const support = createSupport();
  const diff = support.calculateAlignedDiffFromContent('alpha\n\ngamma', 'alpha\nbeta\ngamma');

  assert.deepStrictEqual(diff.leftHtmlLines.map(normalizeZeroWidth), [
    '<p>alpha</p>',
    '<p data-empty-line="true">__ZWSP__</p>',
    '<p>gamma</p>'
  ]);
  assert.deepStrictEqual(diff.rightHtmlLines.map(normalizeZeroWidth), [
    '<p>alpha</p>',
    '<p>beta</p>',
    '<p>gamma</p>'
  ]);

  assert.strictEqual(diff.changes.length, 1);
  assert.strictEqual(diff.changes[0].type, 'modified');
  assert.strictEqual(diff.changes[0].lineNumber, 1);
  assert.strictEqual(normalizeZeroWidth(diff.changes[0].oldContent), '<p data-empty-line="true">__ZWSP__</p>');
  assert.strictEqual(diff.changes[0].content, '<p>beta</p>');
  assert.strictEqual(diff.changes[0].leftLine, 1);
  assert.strictEqual(diff.changes[0].rightLine, 1);

  console.log('✅ testAlignedDiffTracksBlankAndInlineLines passed');
}

function testHtmlDiffUsesListItemLevelMapping() {
  const support = createSupport();
  const leftHtml = '<ul><li>Test 1</li><li>Test 2</li><li>Test 3</li></ul>';
  const rightHtml = '<ul><li>Test 1</li><li>Test 3</li></ul>';

  const diff = support.calculateDiffFromHTML(leftHtml, rightHtml);

  assert.deepStrictEqual(diff.leftHtmlLines, [
    '<li>Test 1</li>',
    '<li>Test 2</li>',
    '<li>Test 3</li>'
  ]);
  assert.deepStrictEqual(diff.rightHtmlLines, [
    '<li>Test 1</li>',
    '<li>Test 3</li>'
  ]);

  assert.strictEqual(diff.changes.length, 2);
  assert.strictEqual(diff.changes[0].type, 'deleted');
  assert.strictEqual(diff.changes[0].content, '<li>Test 2</li>');
  assert.strictEqual(diff.changes[0].lineNumber, 1);
  assert.strictEqual(diff.changes[0].leftLine, 1);
  assert.strictEqual(diff.changes[1].type, 'spacer');
  assert.strictEqual(diff.changes[1].lineNumber, 1);
  assert.strictEqual(diff.changes[1].side, 'right');

  console.log('✅ testHtmlDiffUsesListItemLevelMapping passed');
}

function testHtmlDiffKeepsDeletedListItemsInOriginalPosition() {
  const support = createSupport();
  const leftHtml = '<ul><li>1</li><li>2</li><li>3</li><li>4</li><li>5</li></ul>';
  const rightHtml = '<ul><li>1</li><li>4</li><li>5</li></ul>';

  const diff = support.calculateDiffFromHTML(leftHtml, rightHtml);
  const leftChanges = diff.changes.filter(change => change.side === 'left');
  const rightChanges = diff.changes.filter(change => change.side === 'right');

  assert.deepStrictEqual(leftChanges.map(change => ({ type: change.type, lineNumber: change.lineNumber, content: change.content })), [
    { type: 'deleted', lineNumber: 1, content: '<li>2</li>' },
    { type: 'deleted', lineNumber: 2, content: '<li>3</li>' }
  ]);
  assert.deepStrictEqual(rightChanges.map(change => ({ type: change.type, lineNumber: change.lineNumber })), [
    { type: 'spacer', lineNumber: 1 },
    { type: 'spacer', lineNumber: 2 }
  ]);

  console.log('✅ testHtmlDiffKeepsDeletedListItemsInOriginalPosition passed');
}

function testHtmlDiffTreatsCodeBlockContainerAsSingleModifiedLine() {
  const support = createSupport();
  const leftHtml = '<div data-type="code-block"><div><pre><code>line 1\nline 2</code></pre></div></div><p>Tail</p>';
  const rightHtml = '<div data-type="code-block"><div><pre><code>line 1\nline 3</code></pre></div></div><p>Tail</p>';

  const diff = support.calculateDiffFromHTML(leftHtml, rightHtml);

  assert.deepStrictEqual(diff.leftHtmlLines, [
    '<div data-type="code-block"><div><pre><code>line 1\nline 2</code></pre></div></div>',
    '<p>Tail</p>'
  ]);
  assert.deepStrictEqual(diff.rightHtmlLines, [
    '<div data-type="code-block"><div><pre><code>line 1\nline 3</code></pre></div></div>',
    '<p>Tail</p>'
  ]);
  assert.strictEqual(diff.changes.length, 1);
  assert.strictEqual(diff.changes[0].type, 'modified');
  assert.strictEqual(diff.changes[0].lineNumber, 0);
  assert.ok(diff.changes[0].content.includes('line 3'));
  assert.ok(diff.changes[0].oldContent.includes('line 2'));

  console.log('✅ testHtmlDiffTreatsCodeBlockContainerAsSingleModifiedLine passed');
}

test('parser line numbering is sequential', testParserLineNumberingIsSequential);
test('parser regression against nested html', testParserRegressionAgainstNestedHtml);
test('parser counts paragraph with inline text child', testParserCountsParagraphWithInlineTextChild);
test('parser treats code block container as single line', testParserTreatsCodeBlockContainerAsSingleLine);
test('aligned diff tracks blank and inline lines', testAlignedDiffTracksBlankAndInlineLines);
test('html diff uses list item level mapping', testHtmlDiffUsesListItemLevelMapping);
test('html diff keeps deleted list items in original position', testHtmlDiffKeepsDeletedListItemsInOriginalPosition);
test('html diff treats code block container as single modified line', testHtmlDiffTreatsCodeBlockContainerAsSingleModifiedLine);
