import assert from 'assert';
import path from 'path';
import { test } from 'vitest';

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
  assert.strictEqual(sanitize('folder/note'), 'folder/note.md');
  assert.strictEqual(sanitize('folder/note.md'), 'folder/note.md');
  assert.strictEqual(sanitize('folder/sub/note#heading'), 'folder/sub/note.md');
  assert.strictEqual(sanitize('./folder/note'), './folder/note.md');
  assert.strictEqual(sanitize('../folder/note'), '../folder/note.md');
  
  console.log('✅ testFilenameSanitization passed');
}

function testEdgeCases() {
  // Test edge cases - empty brackets should not match
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
  const noMatch = '[[]]';
  assert.strictEqual(wikiLinkRegex.exec(noMatch), null);
  
  console.log('✅ testEdgeCases passed');
}

function testMissingTargetResolutionStrategy() {
  const resolveMissingTarget = (filename, currentFilePath, workspaceRoot) => {
    const normalized = String(filename || '').trim();
    if (!normalized) return null;

    const ext = path.extname(normalized).toLowerCase();
    const hasExplicitExt = ext.length > 0;

    if (hasExplicitExt && ext !== '.md' && ext !== '.markdown') {
      return null;
    }

    const targetWithExt = hasExplicitExt ? normalized : `${normalized}.md`;

    if (path.isAbsolute(targetWithExt)) {
      return targetWithExt;
    }

    const currentDir = path.dirname(currentFilePath);
    if (targetWithExt.startsWith('./') || targetWithExt.startsWith('../')) {
      return path.resolve(currentDir, targetWithExt);
    }

    if (/[\\/]/.test(targetWithExt)) {
      return path.resolve(workspaceRoot, targetWithExt);
    }

    return path.resolve(currentDir, targetWithExt);
  };

  const current = '/repo/daily/today.md';
  const root = '/repo';

  assert.strictEqual(
    resolveMissingTarget('new-note', current, root),
    '/repo/daily/new-note.md'
  );
  assert.strictEqual(
    resolveMissingTarget('./next-note', current, root),
    '/repo/daily/next-note.md'
  );
  assert.strictEqual(
    resolveMissingTarget('../weekly/plan', current, root),
    '/repo/weekly/plan.md'
  );
  assert.strictEqual(
    resolveMissingTarget('projects/roadmap.md', current, root),
    '/repo/projects/roadmap.md'
  );
  assert.strictEqual(
    resolveMissingTarget('assets/image.png', current, root),
    null
  );

  console.log('✅ testMissingTargetResolutionStrategy passed');
}

test('wiki link parsing', testWikiLinkParsing);
test('filename sanitization', testFilenameSanitization);
test('edge cases', testEdgeCases);
test('missing target resolution strategy', testMissingTargetResolutionStrategy);
