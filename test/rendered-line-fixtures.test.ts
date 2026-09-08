import { expect, test } from 'vitest';
import { parseHTMLToLines } from '../src/diff/HtmlLineParser';
import { renderedLineFixtures } from './fixtures/rendered-lines';

test.each(renderedLineFixtures)('backend rendered lines: $name', ({ html, lines }) => {
  const parsed = parseHTMLToLines(html);
  expect(parsed.map((line) => [line.tagName, line.textContent])).toEqual(lines);
  expect(parsed.map((line) => line.lineNumber)).toEqual(lines.map((_, index) => index));
});
