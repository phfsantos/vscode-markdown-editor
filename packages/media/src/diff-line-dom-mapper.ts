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

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

interface DomLikeNode {
  nodeType?: number;
  childNodes?: ArrayLike<DomLikeNode>;
  textContent?: string | null;
}

export interface DomLikeElement extends DomLikeNode {
  tagName?: string;
  children?: ArrayLike<DomLikeElement>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/**
 * Mirrors HtmlLineParser traversal so frontend line targeting stays aligned with diff parsing.
 * Eligible block rule:
 * - only deepest eligible block elements are emitted
 * - parent blocks with nested block children are skipped
 */
export function getRenderedLineElements<T extends DomLikeElement>(contentElement: T): T[] {
  const blocks: T[] = [];
  collectRenderedLineElements(getChildNodes(contentElement), blocks, true);
  return blocks;
}

export function buildRenderedLineMap<T extends DomLikeElement>(contentElement: T): Map<number, T> {
  const lineToDom = new Map<number, T>();
  getRenderedLineElements(contentElement).forEach((element, index) => {
    lineToDom.set(index, element);
  });
  return lineToDom;
}

function collectRenderedLineElements<T extends DomLikeElement>(nodes: DomLikeNode[], blocks: T[], emitLooseInline: boolean): void {
  for (const node of nodes) {
    if (!node) {
      continue;
    }

    if (node.nodeType === TEXT_NODE) {
      continue;
    }

    if (node.nodeType !== ELEMENT_NODE) {
      continue;
    }

    const element = node as T;
    if (shouldSkipMeasurementElement(element)) {
      continue;
    }

    if (isTransparentContainer(element)) {
      collectRenderedLineElements(getChildNodes(element), blocks, emitLooseInline);
      continue;
    }

    if (shouldEmitAsLine(element)) {
      blocks.push(element);
      continue;
    }

    if (isStructuralContainer(element) || shouldDescendIntoChildBlocks(element)) {
      collectRenderedLineElements(getChildNodes(element), blocks, false);
      continue;
    }

    if (!emitLooseInline) {
      continue;
    }
  }
}

function shouldSkipMeasurementElement(node: DomLikeElement): boolean {
  return Boolean(
    node.hasAttribute?.('data-temp-measurement') ||
    node.hasAttribute?.('data-diff-spacer') ||
    node.hasAttribute?.('data-vditor-line-number-gutter') ||
    node.hasAttribute?.('data-vditor-line-number')
  );
}

function shouldEmitAsLine(node: DomLikeElement): boolean {
  if (isExplicitBlankLine(node)) {
    return true;
  }

  if (isCodeBlockContainer(node)) {
    return true;
  }

  const tagName = getTagName(node);
  if (STANDALONE_LINE_TAGS.has(tagName)) {
    return true;
  }

  if (!hasLineTextContent(node)) {
    return false;
  }

  if (ALWAYS_LINE_TAGS.has(tagName)) {
    return true;
  }

  if (hasNestedRenderableBlocks(node)) {
    return false;
  }

  return !INLINE_TAGS.has(tagName) && !isStructuralContainer(node);
}

function isCodeBlockContainer(node: DomLikeElement): boolean {
  return getTagName(node) === 'div' && node.getAttribute?.('data-type') === 'code-block';
}

function isTransparentContainer(node: DomLikeElement): boolean {
  if (isCodeBlockContainer(node) || getTagName(node) !== 'div' || !node.hasAttribute?.('data-block')) {
    return false;
  }

  const childNodes = getChildNodes(node).filter((child) => child);
  const childElements = childNodes.filter((child) => child.nodeType === ELEMENT_NODE);
  if (childElements.length === 0) {
    return false;
  }

  const directText = childNodes
    .filter((child) => child.nodeType === TEXT_NODE)
    .map((child) => child.textContent ?? '')
    .join('');

  return normalizeText(directText).length === 0;
}

function isStructuralContainer(node: DomLikeElement): boolean {
  return STRUCTURAL_CONTAINER_TAGS.has(getTagName(node));
}

function shouldDescendIntoChildBlocks(node: DomLikeElement): boolean {
  if (isCodeBlockContainer(node)) {
    return false;
  }

  const tagName = getTagName(node);
  if (INLINE_TAGS.has(tagName) || STANDALONE_LINE_TAGS.has(tagName) || ALWAYS_LINE_TAGS.has(tagName)) {
    return false;
  }

  return hasNestedRenderableBlocks(node);
}

function hasNestedRenderableBlocks(node: DomLikeElement): boolean {
  return getChildNodes(node).some((child) => {
    if (!child || child.nodeType !== ELEMENT_NODE) {
      return false;
    }

    return !INLINE_TAGS.has(getTagName(child as DomLikeElement));
  });
}

function isExplicitBlankLine(node: DomLikeElement): boolean {
  return Boolean(node.hasAttribute?.('data-empty-line'));
}

function hasLineTextContent(node: DomLikeElement): boolean {
  if (isExplicitBlankLine(node)) {
    return true;
  }

  const directText = getDirectTextContent(node);
  if (normalizeText(directText).length > 0) {
    return true;
  }

  return hasInlineDescendantText(node);
}

function hasInlineDescendantText(node: DomLikeElement): boolean {
  for (const child of getChildNodes(node)) {
    if (!child) {
      continue;
    }

    if (child.nodeType === TEXT_NODE && normalizeText(child.textContent ?? '').length > 0) {
      return true;
    }

    if (child.nodeType !== ELEMENT_NODE) {
      continue;
    }

    const childElement = child as DomLikeElement;
    if (!INLINE_TAGS.has(getTagName(childElement))) {
      continue;
    }

    if (hasLineTextContent(childElement)) {
      return true;
    }
  }

  return false;
}

function getDirectTextContent(node: DomLikeElement): string {
  return getChildNodes(node)
    .filter((child) => child.nodeType === TEXT_NODE)
    .map((child) => child.textContent ?? '')
    .join('');
}

function getChildNodes(node: DomLikeNode): DomLikeNode[] {
  return Array.from(node.childNodes ?? []);
}

function getTagName(node: DomLikeElement): string {
  return typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
}

function normalizeText(value: string): string {
  return value
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
