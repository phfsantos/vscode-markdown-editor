import assert from 'assert';
import { test } from 'vitest';

import {
  calculateRoleSpecificDiffStats,
} from '../src/diff/roleSpecificStats';

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

test('counts spacers on original as added', testCountsSpacersOnOriginalAsAdded);
test('counts spacers on modified as deleted', testCountsSpacersOnModifiedAsDeleted);