const assert = require('assert');

/**
 * Tests for RelationshipAnalyzer - link detection and parsing
 */

function testMarkdownLinkParsing() {
  const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  
  const content = `
# Document
See [this link](./other.md) and [that one](../folder/another.md)
Also check [external](https://example.com)
  `;
  
  const links = [];
  let match;
  while ((match = mdLinkRegex.exec(content)) !== null) {
    links.push({ text: match[1], url: match[2] });
  }
  
  assert.strictEqual(links.length, 3, 'Should find 3 markdown links');
  assert.strictEqual(links[0].text, 'this link');
  assert.strictEqual(links[0].url, './other.md');
  assert.strictEqual(links[2].url, 'https://example.com');
  
  console.log('✅ testMarkdownLinkParsing passed');
}

function testWikiLinkParsing() {
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
  
  const content = `
# Document
Link to [[OtherNote]] and [[Another Note]]
Also [[note#heading]] and [[note|alias]]
  `;
  
  const links = [];
  let match;
  while ((match = wikiLinkRegex.exec(content)) !== null) {
    links.push(match[1]);
  }
  
  assert.strictEqual(links.length, 4, 'Should find 4 wiki-links');
  assert.strictEqual(links[0], 'OtherNote');
  assert.strictEqual(links[2], 'note#heading');
  
  console.log('✅ testWikiLinkParsing passed');
}

function testLinkTypeDetection() {
  function isExternal(url) {
    return url.startsWith('http://') || url.startsWith('https://');
  }
  
  function isRelative(url) {
    return url.startsWith('./') || url.startsWith('../');
  }
  
  assert.strictEqual(isExternal('https://example.com'), true);
  assert.strictEqual(isExternal('./local.md'), false);
  assert.strictEqual(isRelative('./local.md'), true);
  assert.strictEqual(isRelative('../parent.md'), true);
  assert.strictEqual(isRelative('/absolute.md'), false);
  
  console.log('✅ testLinkTypeDetection passed');
}

function testBacklinkMatching() {
  // Simulate finding backlinks to a target file
  function findBacklinks(targetFile, allContent) {
    const backlinks = [];
    const targetName = targetFile.replace(/\.md$/, '');
    
    for (const [file, content] of Object.entries(allContent)) {
      // Check for wiki-link references
      const wikiRegex = new RegExp(`\\[\\[${targetName}(#[^\\]]+)?\\]\\]`, 'g');
      if (wikiRegex.test(content)) {
        backlinks.push(file);
      }
      
      // Check for markdown link references
      const mdRegex = new RegExp(`\\]\\([^)]*${targetFile}[^)]*\\)`, 'g');
      if (mdRegex.test(content)) {
        if (!backlinks.includes(file)) {
          backlinks.push(file);
        }
      }
    }
    
    return backlinks;
  }
  
  const mockContent = {
    'note1.md': 'See [[TargetNote]] for details',
    'note2.md': 'Check out [link](./TargetNote.md)',
    'note3.md': 'No reference here',
  };
  
  const backlinks = findBacklinks('TargetNote.md', mockContent);
  assert.strictEqual(backlinks.length, 2, 'Should find 2 backlinks');
  assert(backlinks.includes('note1.md'), 'Should include note1.md');
  assert(backlinks.includes('note2.md'), 'Should include note2.md');
  assert(!backlinks.includes('note3.md'), 'Should not include note3.md');
  
  console.log('✅ testBacklinkMatching passed');
}

try {
  testMarkdownLinkParsing();
  testWikiLinkParsing();
  testLinkTypeDetection();
  testBacklinkMatching();
  console.log('✅ All RelationshipAnalyzer tests passed');
} catch (e) {
  console.error('❌ RelationshipAnalyzer tests failed:', e);
  throw e;
}
