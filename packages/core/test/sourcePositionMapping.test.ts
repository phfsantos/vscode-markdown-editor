import { describe, expect, test } from 'vitest';
import {
  mapSourcePosition,
  normalizeSourcePosition,
} from '../src/sourcePositionMapping';

describe('source position mapping', () => {
  test('clamps zero-based source positions using UTF-16 offsets and CRLF lines', () => {
    const markdown = 'alpha\r\nA😀B\r\nomega';

    expect(normalizeSourcePosition(markdown, { line: 1, character: 3 })).toEqual({ line: 1, character: 3 });
    expect(normalizeSourcePosition(markdown, { line: 99, character: 99 })).toEqual({ line: 2, character: 5 });
    expect(normalizeSourcePosition(markdown, { line: -2, character: -4 })).toEqual({ line: 0, character: 0 });
  });

  test('maps one-to-one prose and projects its exact character', () => {
    expect(mapSourcePosition('alpha\nbeta', ['alpha', 'beta'], { line: 1, character: 2 })).toMatchObject({
      renderedLine: 1,
      renderedCharacter: 2,
      confidence: 'exact',
      reason: 'visible-character',
    });
  });

  test('projects heading, list, and quote characters after hidden prefixes', () => {
    const markdown = '# Heading\n- item\n> quote';
    const rendered = ['Heading', 'item', 'quote'];

    expect(mapSourcePosition(markdown, rendered, { line: 0, character: 4 })).toMatchObject({ renderedLine: 0, renderedCharacter: 2 });
    expect(mapSourcePosition(markdown, rendered, { line: 1, character: 4 })).toMatchObject({ renderedLine: 1, renderedCharacter: 2 });
    expect(mapSourcePosition(markdown, rendered, { line: 2, character: 4 })).toMatchObject({ renderedLine: 2, renderedCharacter: 2 });
  });

  test('maps every physical line of a multi-line paragraph to its rendered owner', () => {
    const markdown = 'first line\nsecond line\n\nnext';
    const rendered = ['first line second line', 'next'];

    expect(mapSourcePosition(markdown, rendered, { line: 1, character: 3 })).toMatchObject({
      renderedLine: 0,
      renderedCharacter: 14,
      confidence: 'context',
    });
  });

  test('uses next-visible then previous-at-EOF fallback for blank and frontmatter lines', () => {
    const markdown = '---\ntitle: Demo\n---\n\n# Start\n\n';
    const rendered = ['Start'];

    expect(mapSourcePosition(markdown, rendered, { line: 1, character: 2 })).toMatchObject({
      renderedLine: 0,
      renderedCharacter: 0,
      confidence: 'nearest',
      reason: 'next-visible-line',
    });
    expect(mapSourcePosition(markdown, rendered, { line: 5, character: 0 })).toMatchObject({
      renderedLine: 0,
      renderedCharacter: 5,
      confidence: 'nearest',
      reason: 'previous-visible-line',
    });
  });

  test('maps table delimiter to the following row and table cells to their owning rows', () => {
    const markdown = '| Name | Value |\n| --- | --- |\n| A | 1 |';
    const rendered = ['NameValue', 'A1'];

    expect(mapSourcePosition(markdown, rendered, { line: 1, character: 3 })).toMatchObject({
      renderedLine: 1,
      renderedCharacter: 0,
      confidence: 'nearest',
      reason: 'next-visible-line',
    });
    expect(mapSourcePosition(markdown, rendered, { line: 2, character: 6 })).toMatchObject({
      renderedLine: 1,
      renderedCharacter: 1,
      confidence: 'exact',
    });
  });

  test('maps fence markers and code lines to the single rendered code block', () => {
    const markdown = 'before\n```ts\nconst value = 1;\n```\nafter';
    const rendered = ['before', 'const value = 1;', 'after'];

    expect(mapSourcePosition(markdown, rendered, { line: 1, character: 0 })).toMatchObject({ renderedLine: 1, renderedCharacter: 0 });
    expect(mapSourcePosition(markdown, rendered, { line: 2, character: 6 })).toMatchObject({ renderedLine: 1, renderedCharacter: 6 });
    expect(mapSourcePosition(markdown, rendered, { line: 3, character: 3 })).toMatchObject({ renderedLine: 1, renderedCharacter: 16 });
  });

  test('aligns repeated text monotonically instead of jumping to the first match', () => {
    const markdown = 'same\nleft\nsame\nright';
    const rendered = ['same', 'left', 'same', 'right'];

    expect(mapSourcePosition(markdown, rendered, { line: 2, character: 2 })).toMatchObject({
      renderedLine: 2,
      renderedCharacter: 2,
    });
  });

  test('maps adjacent duplicate lines to successive offsets in one rendered paragraph', () => {
    expect(mapSourcePosition('same\nsame', ['same same'], { line: 1, character: 2 })).toMatchObject({
      renderedLine: 0,
      renderedCharacter: 7,
      confidence: 'context',
    });
  });

  test('maps blank-separated duplicate paragraphs to successive rendered blocks', () => {
    expect(mapSourcePosition('same\n\nsame', ['same', 'same'], { line: 2, character: 2 })).toMatchObject({
      renderedLine: 1,
      renderedCharacter: 2,
      confidence: 'exact',
    });
  });

  test('never maps a later source line behind an established rendered anchor', () => {
    const markdown = 'anchor\norphan\nneedle';
    const rendered = ['orphan', 'anchor', 'needle'];

    expect(mapSourcePosition(markdown, rendered, { line: 1, character: 0 })).toMatchObject({
      renderedLine: 2,
      renderedCharacter: 0,
      confidence: 'nearest',
      reason: 'next-visible-line',
    });
  });

  test('clamps hidden Markdown syntax to the nearest visible character', () => {
    expect(mapSourcePosition('**bold**', ['bold'], { line: 0, character: 1 })).toMatchObject({
      renderedLine: 0,
      renderedCharacter: 0,
      confidence: 'nearest',
      reason: 'hidden-syntax',
    });
  });
});
