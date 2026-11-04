import { describe, expect, it } from 'vitest';
import { mapSourceSelection } from '../src/sourceSelectionMapping';

const endpoint = (text: string, offset: number) => ({ text, offset });
describe('exact rendered selection projection', () => {
  it('maps Ship to the source characters inside checkbox and bold syntax', () => {
    expect(mapSourceSelection('- [ ] **Ship**', endpoint('Ship', 0), endpoint('Ship', 4))).toEqual({
      selectionStatus: 'exact', selection: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } },
    });
  });
});

describe('confidence and source coordinates', () => {
  it.each([
    ['Same\n\nSame', 'Same', 0, 4, undefined],
    ['  - [x] **Nested**', 'Nested', 0, 6, [0, 10, 0, 16]],
    ['Hello 😀\r\n\r\n[Next](https://example.org)', 'Hello 😀', 6, 8, [0, 6, 0, 8]],
    ['[link](https://example.org)', 'link', 0, 4, [0, 1, 0, 5]],
    ['```ts\nconst 😀x = 1;\n```', 'const 😀x = 1;', 6, 9, [1, 6, 1, 9]],
    ['**bold** and *italics*', 'bold and italics', 4, 5, [0, 8, 0, 9]],
    ['**bold** and *italics*', 'bold and italics', 4, 4, undefined],
    ['- [ ] **Ship**', 'toolbar', 0, 7, undefined],
  ])('maps %s conservatively', (source, text, start, end, expected) => {
    const result = mapSourceSelection(source, endpoint(text, start), endpoint(text, end));
    if (!expected) expect(result).toEqual({ selectionStatus: 'unavailable' });
    else expect(result).toEqual({ selectionStatus: 'exact', selection: { start: { line: expected[0], character: expected[1] }, end: { line: expected[2], character: expected[3] } } });
  });
  it('includes intervening Markdown syntax across blocks', () => {
    expect(mapSourceSelection('**First**\r\n\r\n[Last](url)', endpoint('First', 2), endpoint('Last', 3))).toEqual({
      selectionStatus: 'exact', selection: { start: { line: 0, character: 4 }, end: { line: 2, character: 4 } },
    });
  });
  it('does not guess through unsupported projections that could duplicate visible text', () => {
    expect(mapSourceSelection('Ship\n\n<span>Ship</span>', endpoint('Ship', 0), endpoint('Ship', 4))).toEqual({ selectionStatus: 'unavailable' });
  });
});

describe('renderer normalization cannot establish false uniqueness', () => {
  it.each(['` foo `\n\nfoo', '# Foo #\n\nFoo', ' Foo\n\nFoo', 'Foo \n\nFoo'])('refuses normalized duplicate in %s', source => {
    const text = source.includes('foo') ? 'foo' : 'Foo';
    expect(mapSourceSelection(source, endpoint(text, 0), endpoint(text, 3))).toEqual({ selectionStatus: 'unavailable' });
  });
});

describe('Markdown delimiter confidence', () => {
  it.each(['a_b_c', 'foo__bar__baz', 'a*?*b', 'a**?**b', 'a~~?~~b'])('refuses unsupported flanking in %s', literal => {
    const source = `${literal}\n\n\`${literal}\``;
    expect(mapSourceSelection(source, endpoint(literal, 0), endpoint(literal, literal.length))).toEqual({ selectionStatus: 'unavailable' });
  });
});

describe('structural Markdown prefix grammar', () => {
  it.each(['1234567890. foo', '1234567890) foo', '-\u00a0foo', '    - foo', '-    **foo**'])('refuses false uniqueness from %s', literal => {
    const visible = literal.startsWith('    ') ? literal.slice(4) : literal.startsWith('-    ') ? '**foo**' : literal;
    expect(mapSourceSelection(`${literal}\n\n\`${visible}\``, endpoint(visible, 0), endpoint(visible, visible.length))).toEqual({ selectionStatus: 'unavailable' });
  });
});

describe('whole-document render verification', () => {
  it('rejects a list marker that cannot interrupt a preceding paragraph', () => {
    expect(mapSourceSelection('Paragraph\n2. Foo\n\n`2. Foo`', endpoint('2. Foo', 0), endpoint('2. Foo', 6), ['Paragraph\n2. Foo', '2. Foo'])).toEqual({ selectionStatus: 'unavailable' });
  });
  it('requires all rendered blocks to agree in source order', () => {
    expect(mapSourceSelection('First\n\nLast', endpoint('Last', 0), endpoint('Last', 4), ['Last', 'First'])).toEqual({ selectionStatus: 'unavailable' });
  });
});
