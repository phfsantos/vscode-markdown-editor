const assert = require('assert');

const {
  calculateRoleSpecificDiffStats,
} = require('../out/diff/roleSpecificStats.js');

function testCountsSpacersOnOriginalAsAdded() {
  const changes = [
    { type: 'spacer', side: 'left' },
    { type: 'added', side: 'right' },
    { type: 'modified', side: 'both' },
  ];

  const stats = calculateRoleSpecificDiffStats(changes, 'left');

  assert.deepStrictEqual(stats, {
    added: 1,
    deleted: 0,
    modified: 1,
  });

  console.log('✅ testCountsSpacersOnOriginalAsAdded passed');
}

function testCountsSpacersOnModifiedAsDeleted() {
  const changes = [
    { type: 'deleted', side: 'left' },
    { type: 'spacer', side: 'right' },
    { type: 'modified', side: 'both' },
  ];

  const stats = calculateRoleSpecificDiffStats(changes, 'right');

  assert.deepStrictEqual(stats, {
    added: 0,
    deleted: 1,
    modified: 1,
  });

  console.log('✅ testCountsSpacersOnModifiedAsDeleted passed');
}

try {
  testCountsSpacersOnOriginalAsAdded();
  testCountsSpacersOnModifiedAsDeleted();
  console.log('✅ All diff role stats tests passed');
} catch (error) {
  console.error('❌ diff role stats tests failed');
  throw error;
}