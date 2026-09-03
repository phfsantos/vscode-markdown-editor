import assert from 'assert';
import { test } from 'vitest';

// Lightweight local implementation of the tag extractor for unit testing
function extractTagsFromText(content) {
  const tagRegex = /(^|\s)#([a-zA-Z0-9_\-\/]+)\b/gm;
  const tags = [];
  let m;
  while ((m = tagRegex.exec(content)) !== null) {
    tags.push(m[2]);
  }
  return Array.from(new Set(tags));
}

test('extractTagsFromText finds plain, nested, and numeric tags', () => {
  const text = `This is a test #todo and #meeting.\nAnother line with #todo and #project/subproject and #123tag.`;
  const tags = extractTagsFromText(text);
  assert(tags.includes('todo'));
  assert(tags.includes('meeting'));
  assert(tags.includes('project/subproject'));
  assert(tags.includes('123tag'));
});
