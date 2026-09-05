import assert from 'assert';
import { test } from 'vitest';

import { parseHTMLToLines } from '../src/diff/HtmlLineParser';

function testSkipsParentBlocksWhenNestedBlocksOwnRenderedLines() {
  const result = parseHTMLToLines('<blockquote>Quoted<ul><li>One</li><li>Two</li></ul></blockquote>');

  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result.map(block => block.tagName), ['li', 'li']);
  assert.deepStrictEqual(result.map(block => block.textContent), ['One', 'Two']);

  console.log('✅ testSkipsParentBlocksWhenNestedBlocksOwnRenderedLines passed');
}

function testUnwrapsTransparentDataBlockContainers() {
  const result = parseHTMLToLines('<div data-block=""><p>Alpha</p><p>Beta</p></div>');

  assert.deepStrictEqual(
    result.map(block => ({ lineNumber: block.lineNumber, html: block.html, text: block.textContent, tagName: block.tagName })),
    [
      { lineNumber: 0, html: '<p>Alpha</p>', text: 'Alpha', tagName: 'p' },
      { lineNumber: 1, html: '<p>Beta</p>', text: 'Beta', tagName: 'p' }
    ]
  );

  console.log('✅ testUnwrapsTransparentDataBlockContainers passed');
}

function testKeepsMixedDataBlockContainersAsOneRenderedLine() {
  const result = parseHTMLToLines('<div data-block="">Lead <p>Child</p></div><p>Tail</p>');

  assert.deepStrictEqual(
    result.map(block => ({ lineNumber: block.lineNumber, text: block.textContent, tagName: block.tagName })),
    [
      { lineNumber: 0, text: 'Lead Child', tagName: 'div' },
      { lineNumber: 1, text: 'Tail', tagName: 'p' }
    ]
  );
}

function testTreatsCodeBlockContainerAsSingleRenderedLine() {
  const result = parseHTMLToLines('<div data-type="code-block"><div><pre><code>line 1\nline 2</code></pre></div></div><p>Tail</p>');

  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result.map(block => block.tagName), ['div', 'p']);
  assert.ok(result[0].html.includes('data-type="code-block"'));
  assert.strictEqual(result[0].textContent, 'line 1 line 2');
  assert.strictEqual(result[1].textContent, 'Tail');

  console.log('✅ testTreatsCodeBlockContainerAsSingleRenderedLine passed');
}

function testEmitsListItemsAsRenderedLines() {
  const result = parseHTMLToLines('<ul><li>Item 1</li><li>Item 2<ul><li>Nested</li></ul></li></ul>');

  assert.strictEqual(result.length, 2);
  assert.deepStrictEqual(result.map(block => block.tagName), ['li', 'li']);
  assert.strictEqual(result[0].html, '<li>Item 1</li>');
  assert.ok(result[1].html.includes('<li>Nested</li>'));

  console.log('✅ testEmitsListItemsAsRenderedLines passed');
}

function testDetectsSingleMissingListItem() {
  const result = parseHTMLToLines('<ul><li>Test 1</li><li>Test 2</li><li>Test 3</li></ul>');

  assert.deepStrictEqual(result.map(block => block.html), [
    '<li>Test 1</li>',
    '<li>Test 2</li>',
    '<li>Test 3</li>'
  ]);

  console.log('✅ testDetectsSingleMissingListItem passed');
}

function testParagraphCountsAsLineWhenInlineChildOwnsText() {
  const result = parseHTMLToLines('<p><span>test</span></p>');

  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].tagName, 'p');
  assert.strictEqual(result[0].html, '<p><span>test</span></p>');
  assert.strictEqual(result[0].textContent, 'test');

  console.log('✅ testParagraphCountsAsLineWhenInlineChildOwnsText passed');
}

function testNestedBlockPromotesLastRenderedBlockAsLine() {
  const result = parseHTMLToLines('<div><p><span>Alpha</span></p><div><p>Beta</p></div></div>');

  assert.deepStrictEqual(result.map(block => ({ tagName: block.tagName, html: block.html })), [
    { tagName: 'p', html: '<p><span>Alpha</span></p>' },
    { tagName: 'p', html: '<p>Beta</p>' }
  ]);

  console.log('✅ testNestedBlockPromotesLastRenderedBlockAsLine passed');
}

function testPreservesCodeBlocksAndBlankLines() {
  const result = parseHTMLToLines('<p>Alpha</p><p data-empty-line="true">&#8203;</p><pre><code>line 1\nline 2\nline 3</code></pre>');

  assert.strictEqual(result.length, 3);
  assert.deepStrictEqual(result.map(block => block.lineNumber), [0, 1, 2]);
  assert.ok(result[1].html.includes('data-empty-line="true"'));
  assert.strictEqual(result[1].textContent, '');
  assert.strictEqual(result[2].tagName, 'pre');
  assert.ok(result[2].html.includes('line 2'));

  console.log('✅ testPreservesCodeBlocksAndBlankLines passed');
}

function testCoalescesInlineOnlyAndMixedContent() {
  const result = parseHTMLToLines('intro <strong>inline</strong><p>Paragraph</p><img src="/x.png" alt="img">tail');

  assert.strictEqual(result.length, 4);
  assert.strictEqual(result[0].html, '<p>intro <strong>inline</strong></p>');
  assert.strictEqual(result[1].html, '<p>Paragraph</p>');
  assert.strictEqual(result[2].tagName, 'img');
  assert.strictEqual(result[3].html, '<p>tail</p>');

  console.log('✅ testCoalescesInlineOnlyAndMixedContent passed');
}

function testIgnoresStructuralContainersWithoutOwnText() {
  const result = parseHTMLToLines('<table><tbody><tr><td>Alpha</td></tr><tr><td>Beta</td></tr></tbody></table>');

  assert.deepStrictEqual(result.map(block => block.tagName), ['td', 'td']);
  assert.deepStrictEqual(result.map(block => block.textContent), ['Alpha', 'Beta']);

  console.log('✅ testIgnoresStructuralContainersWithoutOwnText passed');
}

function testToleratesMalformedHtml() {
  const result = parseHTMLToLines('<p>Alpha<div data-block=""><p>Beta</p>');

  assert.ok(result.length >= 2);
  assert.strictEqual(result[0].lineNumber, 0);
  assert.strictEqual(result[result.length - 1].textContent, 'Beta');

  console.log('✅ testToleratesMalformedHtml passed');
}

test('skips parent blocks when nested blocks own rendered lines', testSkipsParentBlocksWhenNestedBlocksOwnRenderedLines);
test('unwraps transparent data block containers', testUnwrapsTransparentDataBlockContainers);
test('keeps mixed data block containers as one rendered line', testKeepsMixedDataBlockContainersAsOneRenderedLine);
test('treats code block container as single rendered line', testTreatsCodeBlockContainerAsSingleRenderedLine);
test('emits list items as rendered lines', testEmitsListItemsAsRenderedLines);
test('detects single missing list item', testDetectsSingleMissingListItem);
test('paragraph counts as line when inline child owns text', testParagraphCountsAsLineWhenInlineChildOwnsText);
test('nested block promotes last rendered block as line', testNestedBlockPromotesLastRenderedBlockAsLine);
test('preserves code blocks and blank lines', testPreservesCodeBlocksAndBlankLines);
test('coalesces inline-only and mixed content', testCoalescesInlineOnlyAndMixedContent);
test('ignores structural containers without own text', testIgnoresStructuralContainersWithoutOwnText);
test('tolerates malformed html', testToleratesMalformedHtml);
