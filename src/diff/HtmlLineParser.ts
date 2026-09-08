import * as cheerio from 'cheerio';
import { createRenderedLineRules, normalizeRenderedLineText as normalizeText } from './renderedLineRules';

const rules = createRenderedLineRules<any>({
  tagName: getTagName,
  children: node => node?.children ?? [],
  isElement: node => ['tag', 'script', 'style'].includes(node?.type),
  isText: node => node?.type === 'text',
  text: node => node?.data ?? '',
  hasAttribute: (node, name) => Object.prototype.hasOwnProperty.call(node?.attribs ?? {}, name),
  attribute: (node, name) => node?.attribs?.[name],
});

export interface ParsedBlock {
  lineNumber: number;
  html: string;
  textContent: string;
  tagName: string;
}

/**
 * Parse HTML into stable diff lines using DOM traversal instead of regexp.
 *
 * Eligible block rule:
 * - emit the deepest eligible block unless a list item, mixed data block or
 *   code container owns the subtree (see renderedLineRules)
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

    if (rules.isTransparentContainer(node)) {
      flushInlineFragments();
      collectParsedBlocks($(node).contents().toArray(), $, blocks, emitLooseInline);
      continue;
    }

    const tagName = getTagName(node);
    const nodeHtml = $.html(node) || '';
    if (nodeHtml.trim().length === 0) {
      continue;
    }

    if (rules.shouldEmitAsLine(node)) {
      flushInlineFragments();
      blocks.push({
        lineNumber: blocks.length,
        html: nodeHtml,
        textContent: normalizeNodeText(node, $),
        tagName
      });
      continue;
    }

    if (rules.isStructuralContainer(node) || rules.shouldDescendIntoChildBlocks(node)) {
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

function normalizeNodeText(node: any, $: any): string {
  if (rules.isExplicitBlankLine(node)) {
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
