const assert = require('assert');
const {
  getMarkdownClipboardText,
  replaceSelectionText,
} = require('../packages/media/src/clipboard-selection.js');

function createVditor(convert) {
  return {
    vditor: {
      lute: {
        VditorIRDOM2Md: convert,
      },
    },
  };
}

function createSelectionRange(html) {
  return {
    collapsed: false,
    cloneContents() {
      return { innerHTML: html };
    },
  };
}

function createSelection(range) {
  return {
    rangeCount: 1,
    getRangeAt() {
      return range;
    },
  };
}

function createElement({ selector, outerHTML = '', textContent = '', children = {}, parentElement = null }) {
  return {
    nodeType: 1,
    outerHTML,
    parentElement,
    textContent,
    matches(candidate) {
      return candidate === selector;
    },
    querySelector(candidate) {
      return children[candidate] || null;
    },
  };
}

function run() {
  console.log('\n=== Running clipboard selection tests ===\n');

  const headingRange = createSelectionRange('<h2>My heading</h2>');
  const headingVditor = createVditor((html) => {
    assert.strictEqual(html, '<h2>My heading</h2>');
    return '## My heading';
  });
  const headingText = getMarkdownClipboardText({
    fallbackText: 'My heading',
    selection: createSelection(headingRange),
    vditor: headingVditor,
  });
  assert.strictEqual(headingText, '## My heading');

  const listRange = createSelectionRange('<ul><li>one</li><li>two</li></ul>');
  const listVditor = createVditor(() => '- one\n- two');
  const listText = getMarkdownClipboardText({
    fallbackText: 'one\ntwo',
    range: listRange,
    vditor: listVditor,
  });
  assert.strictEqual(listText, '- one\n- two');

  const plainText = getMarkdownClipboardText({ fallbackText: 'Some text' });
  assert.strictEqual(plainText, 'Some text');

  const code = createElement({
    selector: 'code',
    textContent: "console.log('hello');",
  });
  const marker = createElement({
    selector: '.vditor-ir__marker--pre',
    outerHTML: '<pre class="vditor-ir__marker--pre"><code class="language-playground">console.log(\'hello\');</code></pre>',
    children: { code },
  });
  const previewCode = createElement({
    selector: 'code[class*="language-"]',
    outerHTML: '<code class="language-playground"></code>',
  });
  const preview = createElement({
    selector: '.vditor-ir__preview',
    children: { 'code[class*="language-"]': previewCode },
  });
  const irNode = createElement({
    selector: '.vditor-ir__node',
    children: {
      '.vditor-ir__marker--pre': marker,
      '.vditor-ir__preview code[class*="language-"]': previewCode,
    },
  });
  marker.parentElement = irNode;
  preview.parentElement = irNode;
  const customContainer = createElement({ selector: '.playground-container', parentElement: preview });
  const customText = { nodeType: 3, parentElement: customContainer };
  const customRange = {
    collapsed: false,
    startContainer: customText,
    endContainer: customText,
    commonAncestorContainer: customText,
  };
  const customVditor = createVditor((html) => {
    assert.strictEqual(html, marker.outerHTML);
    return "```playground\nconsole.log('hello');\n```";
  });
  const customMarkdown = getMarkdownClipboardText({
    fallbackText: 'hello',
    range: customRange,
    vditor: customVditor,
  });
  assert.strictEqual(customMarkdown, "```playground\nconsole.log('hello');\n```");

  const replaced = replaceSelectionText('Alpha beta gamma', { start: 6, end: 10 }, 'NEW');
  assert.strictEqual(replaced, 'Alpha NEW gamma');

  console.log('✓ selected IR DOM is converted through Vditor markdown APIs');
  console.log('✓ selected lists preserve markdown syntax');
  console.log('✓ custom render selections copy source markdown');
  console.log('✓ plain text fallback stays plain text');
  console.log('✓ paste replacement swaps the selected range');
  console.log('\n=== clipboard selection tests passed ===');
}

run();
