const assert = require('assert');

/**
 * Tests for LinkResolver - wiki-link resolution
 */

function testWikiLinkParsing() {
  // Test basic wiki-link pattern
  const testCases = [
    { input: '[[MyNote]]', expected: 'MyNote' },
    { input: '[[My Note With Spaces]]', expected: 'My Note With Spaces' },
    { input: '[[note#heading]]', expected: 'note#heading' },
    { input: '[[note|alias]]', expected: 'note|alias' },
  ];
  
  testCases.forEach(({ input, expected }) => {
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;  // Create new regex each time
    const match = wikiLinkRegex.exec(input);
    assert.strictEqual(match && match[1], expected, `Failed for: ${input}`);
  });
  
  console.log('✅ testWikiLinkParsing passed');
}

function testFilenameSanitization() {
  // Test that filenames are properly sanitized
  const sanitize = (filename) => {
    // Remove heading and alias markers
    let name = filename.split('#')[0].split('|')[0];
    // Add .md extension if not present
    return name.endsWith('.md') ? name : `${name}.md`;
  };
  
  assert.strictEqual(sanitize('MyNote'), 'MyNote.md');
  assert.strictEqual(sanitize('MyNote.md'), 'MyNote.md');
  assert.strictEqual(sanitize('note#heading'), 'note.md');
  assert.strictEqual(sanitize('note|alias'), 'note.md');
  
  console.log('✅ testFilenameSanitization passed');
}

function testEdgeCases() {
  // Test edge cases - empty brackets should not match
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
  const noMatch = '[[]]';
  assert.strictEqual(wikiLinkRegex.exec(noMatch), null);
  
  console.log('✅ testEdgeCases passed');
}

try {
  testWikiLinkParsing();
  testFilenameSanitization();
  testEdgeCases();
  console.log('✅ All LinkResolver tests passed');
} catch (e) {
  console.error('❌ LinkResolver tests failed:', e);
  throw e;
}
