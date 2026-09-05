import * as cheerio from 'cheerio';

export interface ParsedBlock {
  lineNumber: number;
  html: string;
  textContent: string;
  tagName: string;
}

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'button', 'cite', 'code', 'data', 'dfn',
  'em', 'i', 'kbd', 'label', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'br'
]);

const STANDALONE_LINE_TAGS = new Set([
  'img', 'hr', 'video', 'audio', 'iframe', 'canvas', 'svg', 'math'
]);

const ALWAYS_LINE_TAGS = new Set([
  'li', 'dt', 'dd', 'figcaption', 'caption', 'summary', 'legend'
]);

const STRUCTURAL_CONTAINER_TAGS = new Set([
  'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr'
]);

/**
 * Parse HTML into stable diff lines using DOM traversal instead of regexp.
 *
 * Eligible block rule:
 * - emit only the deepest eligible rendered block for a subtree
 * - if a block contains another block element, do not emit the parent block
 * - when the root exposes loose inline/text content, coalesce it into a synthetic paragraph line
 */
export function parseHTMLToLines(html: string): ParsedBlock[] {
  const source = html ?? '';
  if (source.trim().length === 0) {
    return [];
  }

  const $ = cheerio.load(source);
  const blocks: ParsedBlock[] = [];

  collectParsedBlocks(getRootNodes($), $, blocks, true);

  return blocks;
}

function collectParsedBlocks(nodes: any[], $: any, blocks: ParsedBlock[], emitLooseInline: boolean): void {
  let inlineFragments: string[] = [];
  let inlineTextFragments: string[] = [];

  const flushInlineFragments = () => {
    const fragmentHtml = inlineFragments.join('').trim();
    const textContent = normalizeText(inlineTextFragments.join(''));

    inlineFragments = [];
    inlineTextFragments = [];

    if (!emitLooseInline || textContent.length === 0) {
      return;
    }

    blocks.push({
      lineNumber: blocks.length,
      html: wrapInlineFragment(fragmentHtml),
      textContent,
      tagName: 'p'
    });
  };

  for (const node of nodes) {
    if (!node || node.type === 'comment' || node.type === 'directive') {
      continue;
    }

    if (node.type === 'text') {
      if (!emitLooseInline) {
        continue;
      }

      const value = node.data ?? '';
      if (value.trim().length === 0) {
        if (inlineFragments.length > 0) {
          inlineFragments.push(value);
          inlineTextFragments.push(value);
        }
        continue;
      }

      inlineFragments.push(value);
      inlineTextFragments.push(value);
      continue;
    }

    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') {
      continue;
    }

    if (isTransparentContainer(node, $)) {
      flushInlineFragments();
      collectParsedBlocks($(node).contents().toArray(), $, blocks, emitLooseInline);
      continue;
    }

    const tagName = getTagName(node);
    const nodeHtml = $.html(node) || '';
    if (nodeHtml.trim().length === 0) {
      continue;
    }

    if (shouldEmitAsLine(node, $)) {
      flushInlineFragments();
      blocks.push({
        lineNumber: blocks.length,
        html: nodeHtml,
        textContent: normalizeNodeText(node, $),
        tagName
      });
      continue;
    }

    if (isStructuralContainer(node) || shouldDescendIntoChildBlocks(node, $)) {
      flushInlineFragments();
      collectParsedBlocks($(node).contents().toArray(), $, blocks, false);
      continue;
    }

    if (!emitLooseInline) {
      continue;
    }

    inlineFragments.push(nodeHtml);
    inlineTextFragments.push($(node).text());
  }

  flushInlineFragments();
}

function getRootNodes($: any): any[] {
  const body = $('body');
  if (body.length > 0) {
    return body.contents().toArray();
  }

  return $.root().contents().toArray();
}

function isCodeBlockContainer(node: any): boolean {
  return getTagName(node) === 'div' && node?.attribs?.['data-type'] === 'code-block';
}

function isTransparentContainer(node: any, $: any): boolean {
  if (isCodeBlockContainer(node) || getTagName(node) !== 'div') {
    return false;
  }

  const attribs = node.attribs ?? {};
  if (!Object.prototype.hasOwnProperty.call(attribs, 'data-block')) {
    return false;
  }

  const childNodes = $(node)
    .contents()
    .toArray()
    .filter((child: any) => child && child.type !== 'comment');

  const childElements = childNodes.filter((child: any) => child.type === 'tag');
  if (childElements.length === 0) {
    return false;
  }

  const directText = childNodes
    .filter((child: any) => child.type === 'text')
    .map((child: any) => child.data ?? '')
    .join('');

  return normalizeText(directText).length === 0;
}

function shouldEmitAsLine(node: any, $: any): boolean {
  if (isExplicitBlankLine(node)) {
    return true;
  }

  if (isCodeBlockContainer(node)) {
    return true;
  }

  // A data-block with its own text is content, not a transparent wrapper.
  // Keep the whole container as one line so its direct text is not discarded
  // while descending into child blocks.
  if (isMixedContentDataBlock(node, $)) {
    return true;
  }

  const tagName = getTagName(node);
  if (STANDALONE_LINE_TAGS.has(tagName)) {
    return true;
  }

  if (!hasLineTextContent(node, $)) {
    return false;
  }

  if (ALWAYS_LINE_TAGS.has(tagName)) {
    return true;
  }

  if (hasNestedRenderableBlocks(node, $)) {
    return false;
  }

  return !INLINE_TAGS.has(tagName) && !isStructuralContainer(node);
}

function isMixedContentDataBlock(node: any, $: any): boolean {
  if (getTagName(node) !== 'div' || !Object.prototype.hasOwnProperty.call(node.attribs ?? {}, 'data-block')) {
    return false;
  }

  const childNodes = $(node).contents().toArray();
  const hasChildElement = childNodes.some((child: any) => child?.type === 'tag');
  const directText = childNodes
    .filter((child: any) => child?.type === 'text')
    .map((child: any) => child.data ?? '')
    .join('');

  return hasChildElement && normalizeText(directText).length > 0;
}

function isStructuralContainer(node: any): boolean {
  return STRUCTURAL_CONTAINER_TAGS.has(getTagName(node));
}

function shouldDescendIntoChildBlocks(node: any, $: any): boolean {
  if (isCodeBlockContainer(node)) {
    return false;
  }

  const tagName = getTagName(node);
  if (INLINE_TAGS.has(tagName) || STANDALONE_LINE_TAGS.has(tagName) || ALWAYS_LINE_TAGS.has(tagName)) {
    return false;
  }

  return hasNestedRenderableBlocks(node, $);
}

function hasNestedRenderableBlocks(node: any, $: any): boolean {
  return $(node)
    .contents()
    .toArray()
    .some((child: any) => {
      if (!child || (child.type !== 'tag' && child.type !== 'script' && child.type !== 'style')) {
        return false;
      }

      return !INLINE_TAGS.has(getTagName(child));
    });
}

function isExplicitBlankLine(node: any): boolean {
  return Boolean(node?.attribs && Object.prototype.hasOwnProperty.call(node.attribs, 'data-empty-line'));
}

function hasLineTextContent(node: any, $: any): boolean {
  if (isExplicitBlankLine(node)) {
    return true;
  }

  const directText = getDirectTextContent(node, $);
  if (normalizeText(directText).length > 0) {
    return true;
  }

  return hasInlineDescendantText(node, $);
}

function hasInlineDescendantText(node: any, $: any): boolean {
  for (const child of $(node).contents().toArray()) {
    if (!child || child.type === 'comment') {
      continue;
    }

    if (child.type === 'text' && normalizeText(child.data ?? '').length > 0) {
      return true;
    }

    if (child.type !== 'tag' && child.type !== 'script' && child.type !== 'style') {
      continue;
    }

    const childTag = getTagName(child);
    if (!INLINE_TAGS.has(childTag)) {
      continue;
    }

    if (hasLineTextContent(child, $)) {
      return true;
    }
  }

  return false;
}

function getDirectTextContent(node: any, $: any): string {
  return $(node)
    .contents()
    .toArray()
    .filter((child: any) => child?.type === 'text')
    .map((child: any) => child.data ?? '')
    .join('');
}

function normalizeNodeText(node: any, $: any): string {
  if (isExplicitBlankLine(node)) {
    return '';
  }

  return normalizeText($(node).text());
}

function getTagName(node: any): string {
  return typeof node?.name === 'string' ? node.name.toLowerCase() : 'div';
}

function wrapInlineFragment(fragmentHtml: string): string {
  const trimmed = fragmentHtml.trim();
  if (trimmed.length === 0) {
    return '<p data-empty-line="true">&#8203;</p>';
  }

  return `<p>${trimmed}</p>`;
}

function normalizeText(value: string): string {
  return value
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
