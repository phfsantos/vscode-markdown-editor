const CUSTOM_RENDER_SELECTOR = [
  '.dashboard-container',
  '.interactive-table-container',
  '.kanban-board-container',
  '.playground-container',
  '.widget-container',
].join(', ');

function getRange(selectionOrRange) {
  if (!selectionOrRange) return null;
  if (typeof selectionOrRange.rangeCount === 'number') {
    return selectionOrRange.rangeCount > 0 ? selectionOrRange.getRangeAt(0) : null;
  }
  if (selectionOrRange.startContainer || selectionOrRange.cloneContents) {
    return selectionOrRange;
  }
  return null;
}

function toElement(node) {
  if (!node) return null;
  if (node.nodeType === 1) return node;
  return node.parentElement || null;
}

function closest(node, selector) {
  let element = toElement(node);
  while (element) {
    if (typeof element.matches === 'function' && element.matches(selector)) {
      return element;
    }
    element = element.parentElement || null;
  }
  return null;
}

function getDocumentForRange(range) {
  return range?.commonAncestorContainer?.ownerDocument ||
    range?.startContainer?.ownerDocument ||
    (typeof document !== 'undefined' ? document : null);
}

function convertIRDomToMarkdown(vditor, html) {
  const lute = vditor?.lute || vditor?.vditor?.lute;
  const converter = lute?.VditorIRDOM2Md;
  if (typeof converter !== 'function' || typeof html !== 'string' || html.length === 0) {
    return '';
  }

  try {
    return converter.call(lute, html).trim();
  } catch {
    return '';
  }
}

function getLanguageFromCode(codeElement) {
  if (!codeElement) return '';
  const className = typeof codeElement.className === 'string' ? codeElement.className : '';
  const match = className.match(/(?:^|\s)language-([^\s]+)/);
  return match ? match[1] : '';
}

function getSourceMarkdownFromIRNode(irNode, vditor) {
  if (!irNode || typeof irNode.querySelector !== 'function') return '';

  const marker = irNode.querySelector('.vditor-ir__marker--pre');
  if (!marker) return '';

  const converted = convertIRDomToMarkdown(vditor, marker.outerHTML || '');
  if (converted) return converted;

  const codeElement = marker.querySelector('code');
  const content = codeElement?.textContent || marker.textContent || '';
  if (!content.trim()) return '';

  const previewCode = irNode.querySelector('.vditor-ir__preview code[class*="language-"]');
  const language = getLanguageFromCode(codeElement) || getLanguageFromCode(previewCode);
  if (!language) return content.trim();

  return `\`\`\`${language}\n${content.trimEnd()}\n\`\`\``;
}

function getSelectedSourceBlockMarkdown(range, vditor) {
  const markdownBlocks = [];
  const seen = new Set();
  const candidates = [
    range.startContainer,
    range.endContainer,
    range.commonAncestorContainer,
  ];

  for (const candidate of candidates) {
    const customRender = closest(candidate, CUSTOM_RENDER_SELECTOR);
    const preview = closest(candidate, '.vditor-ir__preview');
    const node = closest(customRender || preview || candidate, '.vditor-ir__node');
    if (!node || seen.has(node)) continue;

    const markdown = getSourceMarkdownFromIRNode(node, vditor);
    if (markdown) {
      seen.add(node);
      markdownBlocks.push(markdown);
    }
  }

  return markdownBlocks.join('\n\n');
}

function getMarkdownFromRange(range, vditor) {
  const sourceMarkdown = getSelectedSourceBlockMarkdown(range, vditor);
  if (sourceMarkdown) return sourceMarkdown;

  if (typeof range.cloneContents !== 'function') {
    return '';
  }

  const fragment = range.cloneContents();
  if (fragment && typeof fragment.innerHTML === 'string') {
    return convertIRDomToMarkdown(vditor, fragment.innerHTML);
  }

  const ownerDocument = getDocumentForRange(range);
  if (!ownerDocument || typeof ownerDocument.createElement !== 'function') {
    return '';
  }

  const tempElement = ownerDocument.createElement('div');
  tempElement.appendChild(fragment);
  return convertIRDomToMarkdown(vditor, tempElement.innerHTML || '');
}

function getMarkdownClipboardText(options) {
  const range = getRange(options?.selection || options?.range);
  const fallbackText = options?.fallbackText || '';

  if (!range || range.collapsed) {
    return fallbackText;
  }

  const markdown = getMarkdownFromRange(range, options?.vditor);
  return markdown || fallbackText;
}

function buildClipboardText(text, context) {
  const markdown = getMarkdownClipboardText({
    fallbackText: text,
    range: context?.range,
    selection: context?.selection,
    vditor: context?.vditor,
  });

  return markdown || (typeof text === 'string' ? text : '');
}

function replaceSelectionText(text, selectionRange, replacement) {
  if (typeof text !== 'string' || !selectionRange) {
    return text;
  }

  const start = selectionRange.start;
  const end = selectionRange.end;
  if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end < start) {
    return text;
  }

  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

module.exports = {
  buildClipboardText,
  getMarkdownClipboardText,
  replaceSelectionText,
};
