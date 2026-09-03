import assert from 'assert';
import { test } from 'vitest';

import {
  normalizeModelName,
  PREFERRED_MODEL_ORDER,
} from '../src/services/modelNameNormalizer';

function testNormalizesLegacyTypoValues() {
  assert.strictEqual(normalizeModelName('gtp-4o-mini'), 'gpt-4o-mini');
  assert.strictEqual(normalizeModelName('gtp-4o'), 'gpt-4o');

  console.log('✅ testNormalizesLegacyTypoValues passed');
}

function testPassesThroughValidValues() {
  assert.strictEqual(normalizeModelName('auto'), 'auto');
  assert.strictEqual(normalizeModelName('gpt-4o'), 'gpt-4o');
  assert.strictEqual(normalizeModelName('gpt-4o-mini'), 'gpt-4o-mini');
  assert.strictEqual(normalizeModelName('gpt-4.1'), 'gpt-4.1');
  assert.strictEqual(normalizeModelName('copilot-fast'), 'copilot-fast');
  assert.strictEqual(normalizeModelName('oswe-vscode-prime'), 'oswe-vscode-prime');

  console.log('✅ testPassesThroughValidValues passed');
}

function testHandlesEmptyAndUnknownValues() {
  assert.strictEqual(normalizeModelName(''), 'auto');
  assert.strictEqual(normalizeModelName(undefined), 'auto');
  assert.strictEqual(normalizeModelName('some-future-model'), 'some-future-model');

  console.log('✅ testHandlesEmptyAndUnknownValues passed');
}

function testPreferredOrderHasNoTypos() {
  for (const id of PREFERRED_MODEL_ORDER) {
    assert.ok(!id.includes('gtp'), `preferred order contains typo id: ${id}`);
  }

  console.log('✅ testPreferredOrderHasNoTypos passed');
}

test('normalizes legacy typo values', testNormalizesLegacyTypoValues);
test('passes through valid values', testPassesThroughValidValues);
test('handles empty and unknown values', testHandlesEmptyAndUnknownValues);
test('preferred order has no typos', testPreferredOrderHasNoTypos);
