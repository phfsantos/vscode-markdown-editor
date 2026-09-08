import { expect, test } from 'vitest';
import { buildRenderedLineMap } from '../packages/media/src/diff-line-dom-mapper';
import { renderedLineFixtures } from './fixtures/rendered-lines';

test.each(renderedLineFixtures)('browser rendered lines: $name', ({ html, lines }) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  const map = buildRenderedLineMap(root);
  expect([...map.values()].map((element) => [
    element.tagName.toLowerCase(),
    element.hasAttribute('data-empty-line') ? '' :
      (element.textContent ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim(),
  ])).toEqual(lines);
  expect([...map.keys()]).toEqual(lines.map((_, index) => index));
});
