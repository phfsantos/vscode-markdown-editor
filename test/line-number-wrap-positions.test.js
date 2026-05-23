const assert = require('assert');
require('ts-node/register/transpile-only');

const {
  computeLineNumberPositions,
} = require('../packages/media/src/line-number-renderer.ts');

function input(top, height, fallbackLineHeight = 20) {
  return { rect: { top, height }, fallbackLineHeight };
}

function testNormalSequenceIsPassedThrough() {
  const positions = computeLineNumberPositions(
    [input(0, 20), input(20, 20), input(40, 20)],
    0,
    0,
  );

  assert.deepStrictEqual(positions, [
    { top: 0, height: 20 },
    { top: 20, height: 20 },
    { top: 40, height: 20 },
  ]);

  console.log('✅ testNormalSequenceIsPassedThrough passed');
}

function testWrappedElementKeepsItsMeasuredHeight() {
  const positions = computeLineNumberPositions(
    [input(0, 40), input(40, 20)],
    0,
    0,
  );

  assert.strictEqual(positions[0].height, 40, 'wrapped element should keep its 40px height');
  assert.strictEqual(positions[1].top, 40, 'next item should start at previous bottom');

  console.log('✅ testWrappedElementKeepsItsMeasuredHeight passed');
}

function testNextLineNeverOverlapsPreviousWrappedLine() {
  // Reproduces the bug: a wrapped element has measured height 40, but the
  // next sibling's measured top says 20 (e.g. inline-flow continuation,
  // stale measurement, or layout quirk). The gutter must not place the
  // next number visually inside the wrap continuation row.
  const positions = computeLineNumberPositions(
    [input(0, 40), input(20, 20)],
    0,
    0,
  );

  const firstBottom = positions[0].top + positions[0].height;
  assert.ok(
    positions[1].top >= firstBottom,
    `expected line 2 top (${positions[1].top}) to be at or after line 1 bottom (${firstBottom})`,
  );

  console.log('✅ testNextLineNeverOverlapsPreviousWrappedLine passed');
}

function testTwoConsecutiveWrappedLinesCascade() {
  // Two wrapped lines in a row. Both should keep their measured heights
  // and the second should sit immediately below the first.
  const positions = computeLineNumberPositions(
    [input(0, 40), input(40, 40), input(80, 20)],
    0,
    0,
  );

  assert.deepStrictEqual(positions, [
    { top: 0, height: 40 },
    { top: 40, height: 40 },
    { top: 80, height: 20 },
  ]);

  console.log('✅ testTwoConsecutiveWrappedLinesCascade passed');
}

function testRootOffsetAndScrollTopAreApplied() {
  // rootRect.top = 100, scrollTop = 50 → element at viewport top 120
  // should map to top = 120 - 100 + 50 = 70.
  const positions = computeLineNumberPositions(
    [input(120, 20), input(140, 20)],
    100,
    50,
  );

  assert.deepStrictEqual(positions, [
    { top: 70, height: 20 },
    { top: 90, height: 20 },
  ]);

  console.log('✅ testRootOffsetAndScrollTopAreApplied passed');
}

function testFallbackLineHeightUsedWhenRectHeightTooSmall() {
  // A zero-height measurement (e.g. element hidden during measurement)
  // should fall back to the line-height so the gutter item is still visible.
  const positions = computeLineNumberPositions(
    [input(0, 0, 24), input(0, 20, 20)],
    0,
    0,
  );

  assert.strictEqual(positions[0].height, 24);
  // Second item's measured top (0) must be clamped to first bottom (24).
  assert.strictEqual(positions[1].top, 24);

  console.log('✅ testFallbackLineHeightUsedWhenRectHeightTooSmall passed');
}

function testTopClampedToZero() {
  // Element above the root (negative offset) should clamp at 0, not go negative.
  const positions = computeLineNumberPositions(
    [input(-10, 20), input(10, 20)],
    0,
    0,
  );

  assert.strictEqual(positions[0].top, 0);
  // The second one's measured top of 10 would overlap; clamp to 20.
  assert.strictEqual(positions[1].top, 20);

  console.log('✅ testTopClampedToZero passed');
}

try {
  testNormalSequenceIsPassedThrough();
  testWrappedElementKeepsItsMeasuredHeight();
  testNextLineNeverOverlapsPreviousWrappedLine();
  testTwoConsecutiveWrappedLinesCascade();
  testRootOffsetAndScrollTopAreApplied();
  testFallbackLineHeightUsedWhenRectHeightTooSmall();
  testTopClampedToZero();
  console.log('✅ All line number wrap-position tests passed');
} catch (error) {
  console.error('❌ line number wrap-position tests failed');
  throw error;
}
