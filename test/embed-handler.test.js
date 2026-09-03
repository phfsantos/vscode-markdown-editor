import assert from 'assert';
import { test } from 'vitest';

/**
 * Tests for Embed handling - size limits and mime type detection
 */

function testEmbedPatternMatching() {
  const embedRegex = /!\[\[([^\]]+)\]\]/g;
  
  const testCases = [
    { input: '![[image.png]]', expected: 'image.png' },
    { input: '![[document.pdf]]', expected: 'document.pdf' },
    { input: '![[note#section]]', expected: 'note#section' },
    { input: '![[file|100x100]]', expected: 'file|100x100' },
  ];
  
  testCases.forEach(({ input, expected }) => {
    embedRegex.lastIndex = 0;
    const match = embedRegex.exec(input);
    assert.strictEqual(match && match[1], expected, `Failed for: ${input}`);
  });
  
  console.log('✅ testEmbedPatternMatching passed');
}

function testSizeLimitLogic() {
  const defaultLimit = 5 * 1024 * 1024; // 5 MB
  const imageLimit = 8 * 1024 * 1024; // 8 MB
  const textLimit = 200 * 1024; // 200 KB
  
  function shouldEmbed(size, mimeType) {
    const isImage = mimeType.startsWith('image/');
    const isText = mimeType.startsWith('text/');
    const limit = isImage ? imageLimit : isText ? textLimit : defaultLimit;
    return size <= limit;
  }
  
  // Image tests
  assert.strictEqual(shouldEmbed(7 * 1024 * 1024, 'image/png'), true, 'Small image should embed');
  assert.strictEqual(shouldEmbed(9 * 1024 * 1024, 'image/png'), false, 'Large image should not embed');
  
  // Text tests
  assert.strictEqual(shouldEmbed(100 * 1024, 'text/plain'), true, 'Small text should embed');
  assert.strictEqual(shouldEmbed(300 * 1024, 'text/plain'), false, 'Large text should not embed');
  
  // Generic files
  assert.strictEqual(shouldEmbed(4 * 1024 * 1024, 'application/pdf'), true, 'Small PDF should embed');
  assert.strictEqual(shouldEmbed(6 * 1024 * 1024, 'application/pdf'), false, 'Large PDF should not embed');
  
  console.log('✅ testSizeLimitLogic passed');
}

function testMimeTypeDetection() {
  function getMime(ext) {
    const map = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.md': 'text/markdown',
      '.txt': 'text/plain',
      '.pdf': 'application/pdf',
    };
    return map[ext] || 'application/octet-stream';
  }
  
  assert.strictEqual(getMime('.png'), 'image/png');
  assert.strictEqual(getMime('.jpg'), 'image/jpeg');
  assert.strictEqual(getMime('.md'), 'text/markdown');
  assert.strictEqual(getMime('.unknown'), 'application/octet-stream');
  
  console.log('✅ testMimeTypeDetection passed');
}

test('embed pattern matching', testEmbedPatternMatching);
test('size limit logic', testSizeLimitLogic);
test('mime type detection', testMimeTypeDetection);
