import { describe, expect, test } from 'vitest';
import { createRenderedLineRules, normalizeRenderedLineText } from '../src/renderedLineRules';

interface TestNode {
  tag: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: TestNode[];
  kind?: 'element' | 'text';
}

const element = (tag: string, options: Omit<TestNode, 'tag' | 'kind'> = {}): TestNode => ({
  kind: 'element',
  tag,
  ...options,
});

const text = (value: string): TestNode => ({ kind: 'text', tag: '', text: value });

function makeRules() {
  return createRenderedLineRules<TestNode>({
    tagName: node => node.tag,
    children: node => node.children ?? [],
    isElement: node => node.kind !== 'text',
    isText: node => node.kind === 'text',
    text: node => node.text ?? '',
    hasAttribute: (node, name) => Object.prototype.hasOwnProperty.call(node.attributes ?? {}, name),
    attribute: (node, name) => node.attributes?.[name],
  });
}

describe('rendered line rules', () => {
  test('normalizes zero-width and repeated whitespace', () => {
    expect(normalizeRenderedLineText('  one\u200b   two  ')).toBe('one two');
  });

  test('treats code blocks and standalone media as lines', () => {
    const rules = makeRules();

    expect(rules.shouldEmitAsLine(element('div', { attributes: { 'data-type': 'code-block' } }))).toBe(true);
    expect(rules.shouldEmitAsLine(element('img'))).toBe(true);
  });

  test('does not emit structural containers that contain block children', () => {
    const rules = makeRules();
    const list = element('ul', { children: [element('li', { children: [text('item')] })] });

    expect(rules.shouldEmitAsLine(list)).toBe(false);
    expect(rules.shouldDescendIntoChildBlocks(list)).toBe(true);
    expect(rules.shouldEmitAsLine(list.children![0])).toBe(true);
  });

  test('recognizes transparent data blocks and explicit blank lines', () => {
    const rules = makeRules();
    const transparent = element('div', {
      attributes: { 'data-block': 'true' },
      children: [element('p', { children: [text('line')] })],
    });
    const blank = element('p', { attributes: { 'data-empty-line': 'true' } });

    expect(rules.isTransparentContainer(transparent)).toBe(true);
    expect(rules.isExplicitBlankLine(blank)).toBe(true);
    expect(rules.shouldEmitAsLine(blank)).toBe(true);
  });
});
