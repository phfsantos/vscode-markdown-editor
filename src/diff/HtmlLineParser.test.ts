import * as assert from 'assert';
import { parseHTMLToLines } from './HtmlLineParser';

declare function describe(description: string, callback: () => void): void;
declare function it(description: string, callback: () => void): void;

describe('HtmlLineParser', () => {
  it('skips parent blocks when nested block elements own the rendered lines', () => {
    const result = parseHTMLToLines('<blockquote>Quoted<ul><li>One</li><li>Two</li></ul></blockquote>');

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result.map(block => block.tagName), ['li', 'li']);
    assert.deepStrictEqual(result.map(block => block.textContent), ['One', 'Two']);
  });

  it('unwraps transparent data-block containers into child lines', () => {
    const result = parseHTMLToLines('<div data-block=""><p>Alpha</p><p>Beta</p></div>');

    assert.deepStrictEqual(
      result.map(block => ({ lineNumber: block.lineNumber, html: block.html, text: block.textContent, tagName: block.tagName })),
      [
        { lineNumber: 0, html: '<p>Alpha</p>', text: 'Alpha', tagName: 'p' },
        { lineNumber: 1, html: '<p>Beta</p>', text: 'Beta', tagName: 'p' }
      ]
    );
  });

  it('treats code block containers as a single rendered line', () => {
    const result = parseHTMLToLines('<div data-type="code-block"><div><pre><code>line 1\nline 2</code></pre></div></div><p>Tail</p>');

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result.map(block => block.tagName), ['div', 'p']);
    assert.ok(result[0].html.includes('data-type="code-block"'));
    assert.strictEqual(result[0].textContent, 'line 1 line 2');
    assert.strictEqual(result[1].textContent, 'Tail');
  });

  it('emits list items as lines instead of the whole list container', () => {
    const result = parseHTMLToLines('<ul><li>Item 1</li><li>Item 2<ul><li>Nested</li></ul></li></ul>');

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(result.map(block => block.tagName), ['li', 'li']);
    assert.strictEqual(result[0].html, '<li>Item 1</li>');
    assert.ok(result[1].html.includes('<li>Nested</li>'));
    assert.strictEqual(result[1].textContent, 'Item 2 Nested');
  });

  it('detects a missing list item as a single line change input', () => {
    const result = parseHTMLToLines('<ul><li>Test 1</li><li>Test 2</li><li>Test 3</li></ul>');

    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result.map(block => block.html), [
      '<li>Test 1</li>',
      '<li>Test 2</li>',
      '<li>Test 3</li>'
    ]);
  });

  it('counts a block as a line when an inline child owns the text', () => {
    const result = parseHTMLToLines('<p><span>test</span></p>');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].tagName, 'p');
    assert.strictEqual(result[0].html, '<p><span>test</span></p>');
    assert.strictEqual(result[0].textContent, 'test');
  });

  it('descends into nested block wrappers and emits the deepest rendered child blocks', () => {
    const result = parseHTMLToLines('<div><p><span>Alpha</span></p><div><p>Beta</p></div></div>');

    assert.deepStrictEqual(result.map(block => ({ tagName: block.tagName, html: block.html })), [
      { tagName: 'p', html: '<p><span>Alpha</span></p>' },
      { tagName: 'p', html: '<p>Beta</p>' }
    ]);
  });

  it('preserves pre blocks including newline content', () => {
    const result = parseHTMLToLines('<pre><code>line 1\nline 2\nline 3</code></pre>');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].tagName, 'pre');
    assert.ok(result[0].html.includes('line 2'));
    assert.strictEqual(result[0].textContent, 'line 1 line 2 line 3');
  });

  it('preserves explicit blank lines from data-empty-line markers', () => {
    const result = parseHTMLToLines('<p>Alpha</p><p data-empty-line="true">&#8203;</p><p>Gamma</p>');

    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[1].tagName, 'p');
    assert.ok(result[1].html.includes('data-empty-line="true"'));
    assert.strictEqual(result[1].lineNumber, 1);
    assert.strictEqual(result[1].textContent, '');
  });

  it('coalesces inline-only root content into a synthetic paragraph line', () => {
    const result = parseHTMLToLines('before <em>middle</em> after');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].tagName, 'p');
    assert.strictEqual(result[0].html, '<p>before <em>middle</em> after</p>');
    assert.strictEqual(result[0].textContent, 'before middle after');
  });

  it('handles mixed text and block content in stable order', () => {
    const result = parseHTMLToLines('intro <strong>inline</strong><p>Paragraph</p><img src="/x.png" alt="img">tail');

    assert.strictEqual(result.length, 4);
    assert.deepStrictEqual(result.map(block => block.lineNumber), [0, 1, 2, 3]);
    assert.strictEqual(result[0].html, '<p>intro <strong>inline</strong></p>');
    assert.strictEqual(result[1].html, '<p>Paragraph</p>');
    assert.strictEqual(result[2].tagName, 'img');
    assert.strictEqual(result[3].html, '<p>tail</p>');
  });

  it('ignores structural containers that do not own visible text', () => {
    const result = parseHTMLToLines('<table><tbody><tr><td>Alpha</td></tr><tr><td>Beta</td></tr></tbody></table>');

    assert.deepStrictEqual(result.map(block => block.tagName), ['td', 'td']);
    assert.deepStrictEqual(result.map(block => block.textContent), ['Alpha', 'Beta']);
  });

  it('tolerates malformed html by using cheerio recovery', () => {
    const result = parseHTMLToLines('<p>Alpha<div data-block=""><p>Beta</p>');

    assert.ok(result.length >= 2);
    assert.strictEqual(result[0].lineNumber, 0);
    assert.strictEqual(result[result.length - 1].textContent, 'Beta');
  });

  it('avoids emitting list containers when only child items render lines', () => {
    const result = parseHTMLToLines('<div data-block=""><ul><li>One</li><li>Two</li></ul><p>Tail</p></div>');

    assert.strictEqual(result.length, 3);
    assert.deepStrictEqual(result.map(block => block.tagName), ['li', 'li', 'p']);
  });
});
