import { createRenderedLineRules } from '../../../src/diff/renderedLineRules';

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

const rules = createRenderedLineRules<DomLikeNode>({
  tagName: node => getTagName(node as DomLikeElement),
  children: getChildNodes,
  isElement: node => node?.nodeType === ELEMENT_NODE,
  isText: node => node?.nodeType === TEXT_NODE,
  text: node => node.textContent ?? '',
  hasAttribute: (node, name) => Boolean((node as DomLikeElement).hasAttribute?.(name)),
  attribute: (node, name) => (node as DomLikeElement).getAttribute?.(name),
});

/**
 * Uses shared HtmlLineParser eligibility rules so frontend line targeting stays aligned with diff parsing.
 * Input is rendered block HTML. Loose root text has no element to target;
 * normalize it to the paragraph HTML emitted by parseHTMLToLines first.
 * Owning list items, mixed data blocks and code containers keep their subtree.
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

    if (rules.isTransparentContainer(element)) {
      collectRenderedLineElements(getChildNodes(element), blocks, emitLooseInline);
      continue;
    }

    if (rules.shouldEmitAsLine(element)) {
      blocks.push(element);
      continue;
    }

    if (rules.isStructuralContainer(element) || rules.shouldDescendIntoChildBlocks(element)) {
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

function getChildNodes(node: DomLikeNode): DomLikeNode[] {
  return Array.from(node.childNodes ?? []);
}

function getTagName(node: DomLikeElement): string {
  return typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
}
