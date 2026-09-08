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

/** The only node operations classification needs; adapters keep DOM/Cheerio out of shared rules. */
export interface RenderedLineAdapter<Node> {
  tagName(node: Node): string;
  children(node: Node): Node[];
  isElement(node: Node): boolean;
  isText(node: Node): boolean;
  text(node: Node): string;
  hasAttribute(node: Node, name: string): boolean;
  attribute(node: Node, name: string): string | null | undefined;
}

export function normalizeRenderedLineText(value: string): string {
  return value.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

/** Shared eligibility rules for backend HTML lines and frontend rendered targets. */
export function createRenderedLineRules<Node>(adapter: RenderedLineAdapter<Node>) {
  const { tagName, children, isElement, isText, text, hasAttribute, attribute } = adapter;
  const directText = (node: Node) => normalizeRenderedLineText(
    children(node).filter(isText).map(text).join(''),
  );
  const isCodeBlock = (node: Node) => tagName(node) === 'div' && attribute(node, 'data-type') === 'code-block';
  const isDataBlock = (node: Node) => tagName(node) === 'div' && hasAttribute(node, 'data-block');
  const hasElementChild = (node: Node) => children(node).some(isElement);
  const isExplicitBlankLine = (node: Node) => hasAttribute(node, 'data-empty-line');
  const isStructuralContainer = (node: Node) => STRUCTURAL_CONTAINER_TAGS.has(tagName(node));
  const hasNestedBlocks = (node: Node) => children(node).some(
    child => isElement(child) && !INLINE_TAGS.has(tagName(child)),
  );

  function hasLineText(node: Node): boolean {
    return isExplicitBlankLine(node) || directText(node).length > 0 || children(node).some(
      child => isElement(child) && INLINE_TAGS.has(tagName(child)) && hasLineText(child),
    );
  }

  function isTransparentContainer(node: Node): boolean {
    return !isCodeBlock(node) && isDataBlock(node) && hasElementChild(node) && !directText(node);
  }

  function shouldEmitAsLine(node: Node): boolean {
    if (isExplicitBlankLine(node) || isCodeBlock(node)) return true;
    // A data-block with direct text owns its entire subtree.
    if (isDataBlock(node) && hasElementChild(node) && directText(node)) return true;
    const tag = tagName(node);
    if (STANDALONE_LINE_TAGS.has(tag)) return true;
    if (!hasLineText(node)) return false;
    if (ALWAYS_LINE_TAGS.has(tag)) return true;
    return !hasNestedBlocks(node) && !INLINE_TAGS.has(tag) && !isStructuralContainer(node);
  }

  function shouldDescendIntoChildBlocks(node: Node): boolean {
    const tag = tagName(node);
    // Owning list/definition items have already been emitted. An item with
    // only child blocks must descend so paragraph-only list items aren't lost.
    if (isCodeBlock(node) || INLINE_TAGS.has(tag) || STANDALONE_LINE_TAGS.has(tag)) return false;
    return hasNestedBlocks(node);
  }

  return { isTransparentContainer, shouldEmitAsLine, isStructuralContainer, shouldDescendIntoChildBlocks, isExplicitBlankLine };
}
