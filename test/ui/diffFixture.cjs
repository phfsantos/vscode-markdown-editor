/**
 * Deterministic Markdown fixtures for the diff-view UI suite.
 *
 * `original` is committed to Git; `modified` is the working tree. Every kind of
 * block the diff view must handle changes once: a heading, a task-list item, a
 * nested list item (deleted), a table row (modified) and a table row (deleted),
 * a code block, a deleted paragraph, added paragraphs near the top (so aligned
 * rows differ from scroll percentages), and 300+ filler lines carrying
 * `ROW-nnn` markers the scroll tests can target.
 *
 * Side markers: "Status: original" only exists on the left, "Status: modified"
 * only on the right. They are a modified pair, so neither side shows the other's
 * text as a spacer.
 */
const pad = (n) => String(n).padStart(3, '0');

function filler(from, to, edit) {
  const lines = [];
  for (let n = from; n <= to; n++) {
    const text = edit?.(n) ?? `Filler paragraph ROW-${pad(n)} keeps the document long enough to scroll.`;
    if (text !== null) lines.push(text, '');
  }
  return lines;
}

const head = [
  '# Diff fixture',
  '',
  'Status: original',
  '',
  '## Tasks',
  '',
  '- [ ] Draft the plan',
  '- [ ] Review the plan',
  '',
  '## Nested list',
  '',
  '- Parent item',
  '  - Child one',
  '  - Child two is deleted',
  '- Sibling item',
  '',
  '## Table',
  '',
  '| Check | Result |',
  '| --- | --- |',
  '| Source fidelity | Preserved |',
  '| Deleted row | Gone |',
  '| Layout | Stable |',
  '',
  '## Code',
  '',
  '```js',
  'const answer = 41;',
  'console.log(answer);',
  '```',
  '',
  'This paragraph will be deleted from the working tree.',
  '',
];

const headModified = [
  '# Diff fixture revised',
  '',
  'Status: modified',
  '',
  '## Tasks',
  '',
  '- [x] Draft the plan',
  '- [ ] Review the plan',
  '',
  '## Nested list',
  '',
  '- Parent item',
  '  - Child one',
  '- Sibling item',
  '',
  '## Table',
  '',
  '| Check | Result |',
  '| --- | --- |',
  '| Source fidelity | Preserved and verified |',
  '| Layout | Stable |',
  '',
  '## Code',
  '',
  '```js',
  'const answer = 42;',
  'console.log(answer);',
  '```',
  '',
  ...Array.from({ length: 10 }, (_, i) => [`Added paragraph ADDED-${pad(i + 1)} only exists in the working tree.`, '']).flat(),
];

const tail = ['## End', '', 'Tail paragraph.', ''];

const original = [...head, ...filler(1, 160), ...tail].join('\n');
const modified = [
  ...headModified,
  ...filler(1, 160, (n) => (n === 120 ? `Filler paragraph ROW-120 was edited in the working tree.` : n === 140 ? null : undefined)),
  ...tail,
].join('\n');

/** Single-view pending edit: exactly one modified and one deleted line. */
const pendingOriginal = '# Pending edit\n\nKeep this line.\n\nOld wording here.\n\nThis line is removed.\n\nTail line.\n';
const pendingModified = '# Pending edit\n\nKeep this line.\n\nNew wording here.\n\nTail line.\n';

module.exports = { original, modified, pendingOriginal, pendingModified };
