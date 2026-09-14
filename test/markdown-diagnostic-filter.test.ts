import { describe, expect, test } from 'vitest';
import {
  filterDiagnosticsOutsideFencedCodeBlocks,
  getFencedCodeBlockRanges,
} from '../src/diagnostics/markdown-diagnostic-filter';

interface TestDiagnostic {
  message: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

function diagnostic(
  message: string,
  startLine: number,
  startCharacter: number,
  endLine = startLine,
  endCharacter = startCharacter + 1,
): TestDiagnostic {
  return {
    message,
    range: {
      start: { line: startLine, character: startCharacter },
      end: { line: endLine, character: endCharacter },
    },
  };
}

describe('getFencedCodeBlockRanges', () => {
  test.each([
    {
      name: 'backtick fences',
      markdown: ['before', '```mermaid', 'graph TD', '```', 'after'].join('\n'),
      expected: [{ startLine: 1, endLine: 3 }],
    },
    {
      name: 'tilde fences',
      markdown: ['before', '~~~js', 'const value = 1;', '~~~', 'after'].join('\n'),
      expected: [{ startLine: 1, endLine: 3 }],
    },
    {
      name: 'three-space-indented fences',
      markdown: ['before', '   ```text', 'content', '   ```', 'after'].join('\n'),
      expected: [{ startLine: 1, endLine: 3 }],
    },
    {
      name: 'CRLF input',
      markdown: ['before', '```', 'content', '```', 'after'].join('\r\n'),
      expected: [{ startLine: 1, endLine: 3 }],
    },
  ])('includes both delimiter lines for $name', ({ markdown, expected }) => {
    expect(getFencedCodeBlockRanges(markdown)).toEqual(expected);
  });

  test('requires a closing fence to use the same character and at least the opening length', () => {
    const markdown = [
      'before',
      '````lang',
      'inside one',
      '~~~',
      'inside two',
      '```',
      'inside three',
      '`````',
      'after',
    ].join('\n');

    expect(getFencedCodeBlockRanges(markdown)).toEqual([{ startLine: 1, endLine: 7 }]);
  });

  test('recognizes separate fences with different valid delimiter lengths', () => {
    const markdown = [
      '```',
      'first',
      '`````',
      'prose',
      '~~~~~',
      'second',
      '~~~~~~',
    ].join('\n');

    expect(getFencedCodeBlockRanges(markdown)).toEqual([
      { startLine: 0, endLine: 2 },
      { startLine: 4, endLine: 6 },
    ]);
  });

  test('does not treat a fence indented by four spaces as a fenced code block', () => {
    const markdown = ['    ```', 'indented code', '    ```'].join('\n');

    expect(getFencedCodeBlockRanges(markdown)).toEqual([]);
  });

  test('extends an unclosed fence through the final source line', () => {
    const markdown = ['before', '~~~text', 'content', 'last line'].join('\n');

    expect(getFencedCodeBlockRanges(markdown)).toEqual([{ startLine: 1, endLine: 3 }]);
  });
});

describe('filterDiagnosticsOutsideFencedCodeBlocks', () => {
  const markdown = [
    'prose wrng',
    '```mermaid',
    'graph TD',
    '  A[wrng] --> B',
    '```',
    'ending wrng',
  ].join('\n');

  test('removes a single-line diagnostic inside a fence', () => {
    const inside = diagnostic('inside', 3, 4, 3, 8);

    expect(filterDiagnosticsOutsideFencedCodeBlocks([inside], markdown)).toEqual([]);
  });

  test('removes diagnostics on opening and closing delimiter lines', () => {
    const opening = diagnostic('opening', 1, 0, 1, 3);
    const closing = diagnostic('closing', 4, 0, 4, 3);

    expect(filterDiagnosticsOutsideFencedCodeBlocks([opening, closing], markdown)).toEqual([]);
  });

  test('removes a zero-length diagnostic positioned on a fence line', () => {
    const cursorDiagnostic = diagnostic('point on opening fence', 1, 0, 1, 0);

    expect(filterDiagnosticsOutsideFencedCodeBlocks([cursorDiagnostic], markdown)).toEqual([]);
  });

  test('removes a multi-line range that crosses from prose into a fence', () => {
    const crossing = diagnostic('crossing', 0, 6, 1, 1);

    expect(filterDiagnosticsOutsideFencedCodeBlocks([crossing], markdown)).toEqual([]);
  });

  test('does not count an end-exclusive position at character zero as touching that line', () => {
    const proseOnly = diagnostic('ends before opening fence', 0, 0, 1, 0);

    expect(filterDiagnosticsOutsideFencedCodeBlocks([proseOnly], markdown)).toEqual([proseOnly]);
  });

  test('preserves prose diagnostics and their original objects', () => {
    const before = diagnostic('before', 0, 6, 0, 10);
    const after = diagnostic('after', 5, 7, 5, 11);
    const inside = diagnostic('inside', 2, 0, 2, 5);

    const filtered = filterDiagnosticsOutsideFencedCodeBlocks([before, inside, after], markdown);

    expect(filtered).toEqual([before, after]);
    expect(filtered[0]).toBe(before);
    expect(filtered[1]).toBe(after);
  });

  test('removes diagnostics through EOF for an unclosed fence', () => {
    const unclosed = ['prose', '~~~', 'code', 'last line'].join('\r\n');
    const prose = diagnostic('prose', 0, 0, 0, 5);
    const atEof = diagnostic('at EOF', 3, 0, 3, 4);

    expect(filterDiagnosticsOutsideFencedCodeBlocks([prose, atEof], unclosed)).toEqual([prose]);
  });
});
