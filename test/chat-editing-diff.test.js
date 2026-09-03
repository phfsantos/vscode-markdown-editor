import assert from 'assert';
import { test } from 'vitest';

import {
  findChatEditingStateForDocument,
  CHAT_EDITING_TEXT_MODEL_SCHEME,
  CHAT_EDITING_SNAPSHOT_TEXT_MODEL_SCHEME,
} from '../src/app/chatEditingDiff';

function doc(scheme, path, fsPath = path) {
  return {
    uri: {
      scheme,
      path,
      fsPath,
    },
    text: '',
    getText() {
      return this.text;
    },
  };
}

function docWithText(scheme, path, text, fsPath = path) {
  const document = doc(scheme, path, fsPath);
  document.text = text;
  return document;
}

function testFindsMatchingChatEditingBaseline() {
  const current = docWithText('file', '/repo/note.md', 'current');
  const documents = [
    current,
    docWithText(CHAT_EDITING_TEXT_MODEL_SCHEME, '/repo/note.md', 'before'),
    docWithText(CHAT_EDITING_SNAPSHOT_TEXT_MODEL_SCHEME, '/repo/note.md', 'after'),
    docWithText(CHAT_EDITING_SNAPSHOT_TEXT_MODEL_SCHEME, '/repo/other.md', 'other'),
  ];

  const state = findChatEditingStateForDocument(current, documents);

  assert.ok(state, 'Expected to find chat editing state');
  assert.strictEqual(state.hasPendingEdits, true);
  assert.strictEqual(state.targetPath, '/repo/note.md');
  assert.strictEqual(state.snapshotDocuments.length, 1);

  console.log('✅ testFindsMatchingChatEditingBaseline passed');
}

function testMarksNoPendingEditsWhenBaselineMatchesLatestSnapshot() {
  const current = docWithText('file', '/repo/note.md', 'current');
  const documents = [
    current,
    docWithText(CHAT_EDITING_TEXT_MODEL_SCHEME, '/repo/note.md', ''),
    docWithText(CHAT_EDITING_SNAPSHOT_TEXT_MODEL_SCHEME, '/repo/note.md', 'older'),
    docWithText(CHAT_EDITING_SNAPSHOT_TEXT_MODEL_SCHEME, '/repo/note.md', ''),
  ];

  const state = findChatEditingStateForDocument(current, documents);

  assert.ok(state, 'Expected to find chat editing state');
  assert.strictEqual(state.hasPendingEdits, false);

  console.log('✅ testMarksNoPendingEditsWhenBaselineMatchesLatestSnapshot passed');
}

function testReturnsUndefinedWithoutBaseline() {
  const current = docWithText('file', '/repo/note.md', 'current');
  const documents = [
    current,
    docWithText(CHAT_EDITING_SNAPSHOT_TEXT_MODEL_SCHEME, '/repo/note.md', 'snapshot'),
  ];

  const state = findChatEditingStateForDocument(current, documents);

  assert.strictEqual(state, undefined);

  console.log('✅ testReturnsUndefinedWithoutBaseline passed');
}

function testUsesComparablePaths() {
  const current = docWithText('file', '/repo/path-note.md', 'current', '/repo/path-note.md');
  const documents = [
    current,
    docWithText(
      CHAT_EDITING_TEXT_MODEL_SCHEME,
      '/repo/path-note.md',
      'baseline',
      '/different-fs-path-that-should-not-matter.md'
    ),
  ];

  const state = findChatEditingStateForDocument(current, documents);

  assert.ok(state, 'Expected file document matching to use comparable paths');

  console.log('✅ testUsesComparablePaths passed');
}

test('finds matching chat editing baseline', testFindsMatchingChatEditingBaseline);
test('marks no pending edits when baseline matches latest snapshot', testMarksNoPendingEditsWhenBaselineMatchesLatestSnapshot);
test('returns undefined without baseline', testReturnsUndefinedWithoutBaseline);
test('uses comparable paths', testUsesComparablePaths);