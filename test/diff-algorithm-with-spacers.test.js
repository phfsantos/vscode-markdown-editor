/**
 * Unit tests for the NEW sequential offset-tracked diff algorithm
 * Tests both backend (MarkdownDiffViewSupport) and frontend (diff-visualizer) logic
 * 
 * Requirements tested:
 * 1. Backend produces aligned changes with spacers included
 * 2. Line numbers include offsets (no frontend calculation needed)
 * 3. Spacers are regular changes in the array
 * 4. Frontend just renders based on lineNumber (no content matching)
 * 5. LineToDom map updates correctly when spacers are inserted
 */

import assert from 'assert';
import { test } from 'vitest';

// NOTE (vitest port): this legacy file asserts at module top level, so a
// failing assertion surfaces as a suite-level error at import time. The
// single test below marks the file green once the module loads cleanly.

// ============================================================================
// BACKEND TESTS: MarkdownDiffViewSupport Algorithm
// ============================================================================

/**
 * Simplified implementation of the NEW backend algorithm for testing
 * Mirrors alignChangesWithSpacers() in MarkdownDiffViewSupport.ts
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
  
  return changes.sort((a, b) => a.lineNumber - b.lineNumber);
}

/**
 * NEW ALGORITHM: Align changes with spacers
 * This is the core algorithm being tested
 */
function alignChangesWithSpacers(rawChanges, leftLines, rightLines) {
  const result = [];
  
  // Separate changes by type and sort
  const deletions = rawChanges.filter(c => c.type === 'deleted').sort((a, b) => a.lineNumber - b.lineNumber);
  const additions = rawChanges.filter(c => c.type === 'added').sort((a, b) => a.lineNumber - b.lineNumber);
  
  // Track current position in each document and offset counters
  let leftIndex = 0;
  let rightIndex = 0;
  let leftOffset = 0;  // How many spacers added to left
  let rightOffset = 0; // How many spacers added to right
  
  let delIdx = 0;
  let addIdx = 0;
  
  // Process all lines
  while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
    const currentDeletion = delIdx < deletions.length ? deletions[delIdx] : null;
    const currentAddition = addIdx < additions.length ? additions[addIdx] : null;
    
    const leftHasChange = currentDeletion && currentDeletion.lineNumber === leftIndex;
    const rightHasChange = currentAddition && currentAddition.lineNumber === rightIndex;
    
    if (leftHasChange && rightHasChange) {
      // Both sides have changes at the same position - combine as modified
      result.push({
        type: 'modified',
        lineNumber: leftIndex + leftOffset,
        content: currentAddition.content,
        oldContent: currentDeletion.content,
        side: 'both',
        leftLine: leftIndex,
        rightLine: rightIndex
      });
      
      leftIndex++;
      rightIndex++;
      delIdx++;
      addIdx++;
    } else if (leftHasChange && !rightHasChange) {
      // Left has deletion, right doesn't - add deletion to left and spacer to right
      result.push({
        type: 'deleted',
        lineNumber: leftIndex + leftOffset,
        content: currentDeletion.content,
        side: 'left',
        leftLine: leftIndex,
        rightLine: -1
      });
      
      result.push({
        type: 'spacer',
        lineNumber: rightIndex + rightOffset,
        content: currentDeletion.content,
        side: 'right',
        leftLine: leftIndex,
        rightLine: -1
      });
      
      leftIndex++;
      delIdx++;
      rightOffset++;
    } else if (!leftHasChange && rightHasChange) {
      // Right has addition, left doesn't - add addition to right and spacer to left
      result.push({
        type: 'spacer',
        lineNumber: leftIndex + leftOffset,
        content: currentAddition.content,
        side: 'left',
        leftLine: -1,
        rightLine: rightIndex
      });
      
      result.push({
        type: 'added',
        lineNumber: rightIndex + rightOffset,
        content: currentAddition.content,
        side: 'right',
        leftLine: -1,
        rightLine: rightIndex
      });
      
      rightIndex++;
      addIdx++;
      leftOffset++;
    } else {
      // Neither side has changes - common line, advance both
      leftIndex++;
      rightIndex++;
    }
  }
  
  return result;
}

// ============================================================================
// TEST CASE 1: Simple addition (right has one extra line)
// ============================================================================

console.log('\n=== TEST 1: Simple Addition ===');
const test1_left = ['<p>Line 1</p>', '<p>Line 2</p>'];
const test1_right = ['<p>Line 1</p>', '<p>Line 2</p>', '<p>Line 3</p>'];

const test1_rawChanges = computeLCSDiff(test1_left, test1_right);
const test1_aligned = alignChangesWithSpacers(test1_rawChanges, test1_left, test1_right);

console.log('Raw changes:', JSON.stringify(test1_rawChanges, null, 2));
console.log('Aligned changes:', JSON.stringify(test1_aligned, null, 2));

// Verify: Should have 1 addition on right (line 2) and 1 spacer on left (line 2)
const test1_leftChanges = test1_aligned.filter(c => c.side === 'left');
const test1_rightChanges = test1_aligned.filter(c => c.side === 'right');

assert.strictEqual(test1_leftChanges.length, 1, 'Left should have 1 spacer');
assert.strictEqual(test1_leftChanges[0].type, 'spacer', 'Left change should be spacer');
assert.strictEqual(test1_leftChanges[0].lineNumber, 2, 'Left spacer should be at line 2');

assert.strictEqual(test1_rightChanges.length, 1, 'Right should have 1 addition');
assert.strictEqual(test1_rightChanges[0].type, 'added', 'Right change should be added');
assert.strictEqual(test1_rightChanges[0].lineNumber, 2, 'Right addition should be at line 2');

console.log('✅ Test 1 passed');

// ============================================================================
// TEST CASE 2: Simple deletion (left has one line removed)
// ============================================================================

console.log('\n=== TEST 2: Simple Deletion ===');
const test2_left = ['<p>Line 1</p>', '<p>Line 2</p>', '<p>Line 3</p>'];
const test2_right = ['<p>Line 1</p>', '<p>Line 3</p>'];

const test2_rawChanges = computeLCSDiff(test2_left, test2_right);
const test2_aligned = alignChangesWithSpacers(test2_rawChanges, test2_left, test2_right);

console.log('Aligned changes:', JSON.stringify(test2_aligned, null, 2));

// Verify: Should have 1 deletion on left (line 1) and 1 spacer on right (line 1)
const test2_leftChanges = test2_aligned.filter(c => c.side === 'left');
const test2_rightChanges = test2_aligned.filter(c => c.side === 'right');

assert.strictEqual(test2_leftChanges.length, 1, 'Left should have 1 deletion');
assert.strictEqual(test2_leftChanges[0].type, 'deleted', 'Left change should be deleted');
assert.strictEqual(test2_leftChanges[0].lineNumber, 1, 'Left deletion should be at line 1');

assert.strictEqual(test2_rightChanges.length, 1, 'Right should have 1 spacer');
assert.strictEqual(test2_rightChanges[0].type, 'spacer', 'Right change should be spacer');
assert.strictEqual(test2_rightChanges[0].lineNumber, 1, 'Right spacer should be at line 1');

console.log('✅ Test 2 passed');

// ============================================================================
// TEST CASE 3: Modification (both sides change at same position)
// ============================================================================

console.log('\n=== TEST 3: Modification ===');
const test3_left = ['<p>Line 1</p>', '<p>Old content</p>', '<p>Line 3</p>'];
const test3_right = ['<p>Line 1</p>', '<p>New content</p>', '<p>Line 3</p>'];

const test3_rawChanges = computeLCSDiff(test3_left, test3_right);
const test3_aligned = alignChangesWithSpacers(test3_rawChanges, test3_left, test3_right);

console.log('Aligned changes:', JSON.stringify(test3_aligned, null, 2));

// Verify: Should have 1 modified change for both sides at line 1
const test3_bothChanges = test3_aligned.filter(c => c.side === 'both');

assert.strictEqual(test3_bothChanges.length, 1, 'Should have 1 modified change');
assert.strictEqual(test3_bothChanges[0].type, 'modified', 'Change should be modified');
assert.strictEqual(test3_bothChanges[0].lineNumber, 1, 'Modified should be at line 1');
assert.strictEqual(test3_bothChanges[0].content, '<p>New content</p>', 'Should have new content');
assert.strictEqual(test3_bothChanges[0].oldContent, '<p>Old content</p>', 'Should have old content');

console.log('✅ Test 3 passed');

// ============================================================================
// TEST CASE 4: Complex scenario with multiple changes
// ============================================================================

console.log('\n=== TEST 4: Complex Multiple Changes ===');
const test4_left = [
  '<p>Line 1</p>',
  '<p>Line 2 deleted</p>',
  '<p>Line 3</p>',
  '<p>Line 4 modified old</p>',
  '<p>Line 5</p>'
];
const test4_right = [
  '<p>Line 1</p>',
  '<p>Line 3</p>',
  '<p>Line 4 modified new</p>',
  '<p>Line 5</p>',
  '<p>Line 6 added</p>'
];

const test4_rawChanges = computeLCSDiff(test4_left, test4_right);
const test4_aligned = alignChangesWithSpacers(test4_rawChanges, test4_left, test4_right);

console.log('Aligned changes:', JSON.stringify(test4_aligned, null, 2));

// Verify alignment
const test4_leftChanges = test4_aligned.filter(c => c.side === 'left');
const test4_rightChanges = test4_aligned.filter(c => c.side === 'right');
const test4_bothChanges = test4_aligned.filter(c => c.side === 'both');

assert.strictEqual(test4_leftChanges.length, 2, 'Left should have 2 changes (1 deletion + 1 spacer)');
assert.strictEqual(test4_rightChanges.length, 2, 'Right should have 2 changes (1 spacer + 1 addition)');
assert.strictEqual(test4_bothChanges.length, 1, 'Should have 1 modified change');

console.log('✅ Test 4 passed');

// ============================================================================
// FRONTEND TESTS: LineToDom Map Updates
// ============================================================================

console.log('\n=== FRONTEND TEST: LineToDom Map Updates ===');

/**
 * Simulate frontend lineToDom map behavior when inserting spacers
 */
function simulateLineToDomInsertion(initialLines, spacerLineNumber) {
  // Build initial map
  const lineToDom = new Map();
  initialLines.forEach((line, index) => {
    lineToDom.set(index, { content: line, element: `<div>${line}</div>` });
  });
  
  console.log('\nBefore spacer insertion at line', spacerLineNumber, ':');
  for (const [lineNum, data] of lineToDom.entries()) {
    console.log(`  ${lineNum}: ${data.content}`);
  }
  
  // Insert spacer - SHIFT all lines >= spacerLineNumber down by 1
  const linesToShift = [];
  for (const [lineNum, element] of lineToDom.entries()) {
    if (lineNum >= spacerLineNumber) {
      linesToShift.push([lineNum, element]);
    }
  }
  
  // Remove old entries
  for (const [lineNum] of linesToShift) {
    lineToDom.delete(lineNum);
  }
  
  // Re-add with incremented line numbers
  for (const [lineNum, element] of linesToShift) {
    lineToDom.set(lineNum + 1, element);
  }
  
  // Add spacer at the correct position
  lineToDom.set(spacerLineNumber, { content: 'SPACER', element: '<div class="spacer"></div>' });
  
  console.log('After spacer insertion:');
  const sortedEntries = Array.from(lineToDom.entries()).sort((a, b) => a[0] - b[0]);
  for (const [lineNum, data] of sortedEntries) {
    console.log(`  ${lineNum}: ${data.content}`);
  }
  
  return lineToDom;
}

// Test: Insert spacer at line 2
const frontendTest_initial = ['test', 'tested', 'testing'];
const frontendTest_result = simulateLineToDomInsertion(frontendTest_initial, 2);

// Verify map structure
assert.strictEqual(frontendTest_result.get(0).content, 'test', 'Line 0 should be test');
assert.strictEqual(frontendTest_result.get(1).content, 'tested', 'Line 1 should be tested');
assert.strictEqual(frontendTest_result.get(2).content, 'SPACER', 'Line 2 should be SPACER');
assert.strictEqual(frontendTest_result.get(3).content, 'testing', 'Line 3 should be testing');

test('diff algorithm with spacers (module-level assertions ran at import)', () => {
  // All assertions above executed during module evaluation; reaching this
  // test means every one of them passed.
});