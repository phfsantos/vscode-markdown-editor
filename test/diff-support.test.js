/**
 * Test suite for Diff Algorithm
 * Verifies that the LCS-based diff correctly detects added, deleted, and modified lines
 */

const assert = require('assert');

/**
 * Simplified implementation of the diff algorithm for testing
 * This mirrors the logic in MarkdownDiffViewSupport
 */

function buildLCSTable(leftLines, rightLines) {
  const m = leftLines.length;
  const n = rightLines.length;
  const lcs = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }
  
  return lcs;
}

function calculateSimilarity(text1, text2) {
  const longer = text1.length > text2.length ? text1 : text2;
  const shorter = text1.length > text2.length ? text2 : text1;
  
  if (longer.length === 0) return 1.0;
  
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer[i] === shorter[i]) {
      matches++;
    }
  }
  
  return matches / longer.length;
}

function mergeModifiedLines(changes) {
  const result = [];
  const deletions = changes.filter(c => c.type === 'deleted' && c.side === 'left');
  const additions = changes.filter(c => c.type === 'added' && c.side === 'right');
  const usedAdditions = new Set();
  const usedDeletions = new Set();

  for (let i = 0; i < deletions.length; i++) {
    const deletion = deletions[i];
    
    const previousAdditions = additions.filter(a => a.lineNumber < deletion.lineNumber).length;
    const previousDeletions = deletions.filter(d => d.lineNumber < deletion.lineNumber).length;
    const offset = previousAdditions - previousDeletions;
    const expectedRightLine = deletion.lineNumber + offset;
    
    const nearbyAdditions = additions.filter((a, idx) => {
      if (usedAdditions.has(idx)) return false;
      return Math.abs(a.lineNumber - expectedRightLine) <= 3;
    });
    
    if (nearbyAdditions.length > 0) {
      let bestMatch = null;
      let bestScore = 0;
      let bestMatchIdx = -1;
      
      for (const addition of nearbyAdditions) {
        const additionIdx = additions.indexOf(addition);
        const similarity = calculateSimilarity(deletion.content, addition.content);
        const positionScore = 1 - Math.abs(addition.lineNumber - expectedRightLine) / 4;
        const score = similarity * 0.7 + positionScore * 0.3;
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = addition;
          bestMatchIdx = additionIdx;
        }
      }
      
      if (bestMatch) {
        const similarity = calculateSimilarity(deletion.content, bestMatch.content);
        const positionDiff = Math.abs(bestMatch.lineNumber - expectedRightLine);
        
        if (similarity > 0.3 || positionDiff <= 1) {
          result.push({
            type: 'modified',
            lineNumber: bestMatch.lineNumber,
            content: bestMatch.content,
            oldContent: deletion.content,
            side: 'both'
          });
          
          usedDeletions.add(i);
          usedAdditions.add(bestMatchIdx);
          continue;
        }
      }
    }
  }
  
  for (let i = 0; i < deletions.length; i++) {
    if (!usedDeletions.has(i)) {
      result.push(deletions[i]);
    }
  }
  
  for (let i = 0; i < additions.length; i++) {
    if (!usedAdditions.has(i)) {
      result.push(additions[i]);
    }
  }
  
  return result.sort((a, b) => a.lineNumber - b.lineNumber);
}

function computeLCSDiff(leftLines, rightLines) {
  const changes = [];
  const lcs = buildLCSTable(leftLines, rightLines);
  
  let i = leftLines.length;
  let j = rightLines.length;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      changes.unshift({
        type: 'added',
        lineNumber: j - 1,
        content: rightLines[j - 1],
        side: 'right'
      });
      j--;
    } else if (i > 0 && (j === 0 || lcs[i][j - 1] < lcs[i - 1][j])) {
      changes.unshift({
        type: 'deleted',
        lineNumber: i - 1,
        content: leftLines[i - 1],
        side: 'left'
      });
      i--;
    }
  }
  
  return mergeModifiedLines(changes);
}

function calculateDiffFromContent(originalContent, modifiedContent) {
  const originalLines = originalContent.split('\n');
  const modifiedLines = modifiedContent.split('\n');
  return computeLCSDiff(originalLines, modifiedLines);
}

// Test cases
function testModifiedLineDetection() {
  const original = 'Hello World\nThis is line 2\nLine 3';
  const modified = 'Hello World\nThis is modified line 2\nLine 3';
  
  const changes = calculateDiffFromContent(original, modified);
  const modifiedChanges = changes.filter(c => c.type === 'modified');
  
  assert.strictEqual(modifiedChanges.length, 1, 'Should detect 1 modified line');
  assert.strictEqual(modifiedChanges[0].content, 'This is modified line 2');
  assert.strictEqual(modifiedChanges[0].oldContent, 'This is line 2');
  assert.strictEqual(modifiedChanges[0].side, 'both');
  
  console.log('✅ testModifiedLineDetection passed');
}

function testMultipleModifications() {
  const original = 'Line 1\nLine 2\nLine 3\nLine 4';
  const modified = 'Changed 1\nLine 2\nChanged 3\nLine 4';
  
  const changes = calculateDiffFromContent(original, modified);
  const modifiedChanges = changes.filter(c => c.type === 'modified');
  
  assert.strictEqual(modifiedChanges.length, 2, 'Should detect 2 modified lines');
  assert.ok(modifiedChanges.some(c => c.content === 'Changed 1'));
  assert.ok(modifiedChanges.some(c => c.content === 'Changed 3'));
  
  console.log('✅ testMultipleModifications passed');
}

function testPureAdditions() {
  const original = 'Line 1\nLine 2';
  const modified = 'Line 1\nLine 2\nLine 3\nLine 4';
  
  const changes = calculateDiffFromContent(original, modified);
  
  assert.strictEqual(changes.filter(c => c.type === 'added').length, 2);
  assert.strictEqual(changes.filter(c => c.type === 'deleted').length, 0);
  assert.strictEqual(changes.filter(c => c.type === 'modified').length, 0);
  
  console.log('✅ testPureAdditions passed');
}

function testPureDeletions() {
  const original = 'Line 1\nLine 2\nLine 3\nLine 4';
  const modified = 'Line 1\nLine 2';
  
  const changes = calculateDiffFromContent(original, modified);
  
  assert.strictEqual(changes.filter(c => c.type === 'deleted').length, 2);
  assert.strictEqual(changes.filter(c => c.type === 'added').length, 0);
  assert.strictEqual(changes.filter(c => c.type === 'modified').length, 0);
  
  console.log('✅ testPureDeletions passed');
}

function testEmptyDiff() {
  const original = 'Line 1\nLine 2\nLine 3';
  const modified = 'Line 1\nLine 2\nLine 3';
  
  const changes = calculateDiffFromContent(original, modified);
  
  assert.strictEqual(changes.length, 0, 'Should detect no changes');
  
  console.log('✅ testEmptyDiff passed');
}

function testMixedChanges() {
  const original = 'Line 1\nLine 2\nLine 3';
  const modified = 'Line 1\nModified 2\nLine 3\nLine 4';
  
  const changes = calculateDiffFromContent(original, modified);
  
  // Should have at least 1 modified and 1 added
  assert.ok(changes.some(c => c.type === 'modified'));
  assert.ok(changes.some(c => c.type === 'added'));
  
  console.log('✅ testMixedChanges passed');
}

// Run all tests
try {
  console.log('Running Diff Algorithm Tests...\n');
  testModifiedLineDetection();
  testMultipleModifications();
  testPureAdditions();
  testPureDeletions();
  testEmptyDiff();
  testMixedChanges();
  console.log('\n✅ All diff algorithm tests passed!');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
