import assert from 'assert';
import { afterEach, beforeEach, test, vi } from 'vitest';

// 'vscode' resolves to test/mocks/vscode.ts via the vitest alias.
import { __reset, workspace } from 'vscode';
import { DiffViewController } from '../src/app/DiffViewController';

/**
 * Characterization tests for the diff-view flow, originally written against
 * EditorPanel's private methods and retargeted 1:1 at DiffViewController when
 * the logic was extracted. The observable behavior they pin is unchanged.
 */

function createFakeHost({ instanceId, fsPath, tab, isDiffView = false, webviewReady = true }) {
  const host = {
    instanceId,
    uri: { fsPath, scheme: 'file', toString: () => `file://${fsPath}` },
    document: {
      uri: { scheme: 'file', fsPath, path: fsPath },
      getText: () => 'current text',
    },
    tab,
    webviewReady,
    panelVisible: true,
    panelActive: true,
    messages: [],
    eligibilityPosts: 0,
    postMessage(message) {
      host.messages.push(message);
    },
    postInlineSuggestionEligibility() {
      host.eligibilityPosts++;
    },
    requestIRHtml: async () => host._irHtml ?? '<p>ir</p>',
    requestRenderedMarkdownHtml: async (markdown) => `<p>${markdown}</p>`,
  };
  host.diff = new DiffViewController(host);
  host.diff.isDiffView = isDiffView;
  return host;
}

let diffCalls;

beforeEach(() => {
  __reset();
  workspace.textDocuments.length = 0;
  DiffViewController.panelTracking.clear();
  DiffViewController.calculationInProgress.clear();
  diffCalls = [];
  global.markdownDiffViewSupport = {
    calculateDiffFromHTML: (left, right) => {
      diffCalls.push([left, right]);
      return {
        changes: [
          { type: 'modified', side: 'both', lineNumber: 0 },
          { type: 'added', side: 'right', lineNumber: 1 },
        ],
        leftHtmlLines: ['<p>L0</p>'],
        rightHtmlLines: ['<p>R0</p>'],
      };
    },
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete global.markdownDiffViewSupport;
});

test('reactive check skips when diff already applied and panel still visible', async () => {
  const tab = {};
  const host = createFakeHost({ instanceId: 'a', fsPath: '/w/a.md', tab, isDiffView: true });
  host.diff.diffApplied = true;

  await host.diff.checkDiffViewContextReactive();

  assert.deepStrictEqual(host.messages, []);
  assert.strictEqual(diffCalls.length, 0);
});

test('reactive check clears a previously applied diff when no longer in diff context', async () => {
  const tab = {};
  const host = createFakeHost({ instanceId: 'a', fsPath: '/w/a.md', tab, isDiffView: false });
  host.diff.diffApplied = true;
  host.panelVisible = false;

  await host.diff.checkDiffViewContextReactive();

  assert.deepStrictEqual(host.messages, [{ type: 'diff-view-cleared' }]);
  assert.strictEqual(host.diff.diffApplied, false);
  assert.strictEqual(host.eligibilityPosts, 1);
});

test('reactive check applies HTML diff to both panels with swapped html lines and role stats', async () => {
  const tab = {};
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md', tab, isDiffView: true });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md', tab });
  left._irHtml = '<p>left-html</p>';
  right._irHtml = '<p>right-html</p>';
  DiffViewController.panelTracking.set(tab, { left, right });

  const pending = left.diff.checkDiffViewContextReactive();
  await vi.advanceTimersByTimeAsync(1100);
  await pending;

  assert.strictEqual(diffCalls.length, 1);
  assert.deepStrictEqual(diffCalls[0], ['<p>left-html</p>', '<p>right-html</p>']);

  assert.strictEqual(left.messages.length, 1);
  assert.strictEqual(right.messages.length, 1);
  const leftMsg = left.messages[0];
  const rightMsg = right.messages[0];

  assert.strictEqual(leftMsg.type, 'diff-view-detected');
  assert.strictEqual(leftMsg.diffInfo.role, 'left');
  assert.strictEqual(leftMsg.diffInfo.otherUri, 'file:///w/right.md');
  // Left panel receives the RIGHT side's html lines for spacer rendering.
  assert.deepStrictEqual(leftMsg.diffInfo.htmlLines, ['<p>R0</p>']);
  assert.deepStrictEqual(leftMsg.diffInfo.stats, { added: 0, deleted: 0, modified: 1 });

  assert.strictEqual(rightMsg.diffInfo.role, 'right');
  assert.strictEqual(rightMsg.diffInfo.otherUri, 'file:///w/left.md');
  assert.deepStrictEqual(rightMsg.diffInfo.htmlLines, ['<p>L0</p>']);
  assert.deepStrictEqual(rightMsg.diffInfo.stats, { added: 1, deleted: 0, modified: 1 });

  assert.strictEqual(left.diff.diffApplied, true);
  assert.strictEqual(right.diff.diffApplied, true);
  // Initiator updates its own diff-view state from the tracking map.
  assert.strictEqual(left.diff.isDiffView, true);
  assert.strictEqual(left.diff.otherDiffUri, right.uri);
  assert.strictEqual(left.diff.diffRole, 'left');
  // In-progress tracking cleaned up after completion.
  assert.strictEqual(DiffViewController.calculationInProgress.size, 0);
});

test('pending chat diff posts diff-view-cleared when there is no baseline document', async () => {
  const tab = {};
  const host = createFakeHost({ instanceId: 'a', fsPath: '/w/a.md', tab });
  host.diff.singleViewDiffApplied = true;

  await host.diff.applyPendingChatDiffVisualization();

  assert.deepStrictEqual(host.messages, [{ type: 'diff-view-cleared' }]);
  assert.strictEqual(host.diff.singleViewDiffApplied, false);
});

test('pending chat diff applies a single-view diff when baseline differs', async () => {
  const tab = {};
  const host = createFakeHost({ instanceId: 'a', fsPath: '/w/a.md', tab });
  const baselineMarkdown = '# Baseline\n\nOriginal body';
  const baselineHtml = '<h1>Rendered baseline</h1><p>Original body</p>';
  const currentHtml = '<h1>Current IR</h1><p>Changed body</p>';
  const leftHtmlLines = ['<h1>Rendered baseline</h1>', '<p>Original body</p>'];
  const alignedChanges = [
    { type: 'modified', side: 'both', lineNumber: 1, content: '<p>Changed body</p>', leftLine: 1, rightLine: 1 },
    { type: 'added', side: 'right', lineNumber: 2, content: '<p>New right line</p>', leftLine: -1, rightLine: 2 },
    { type: 'spacer', side: 'right', lineNumber: 3, content: '', leftLine: 2, rightLine: -1 },
  ];
  const baseline = {
    uri: { scheme: 'chat-editing-text-model', path: '/w/a.md', toString: () => 'chat-editing-text-model:/w/a.md' },
    getText: () => baselineMarkdown,
  };
  host.diff.refreshPendingChatEditState = () => {
    host.diff.pendingChatBaselineDocument = baseline;
  };
  host.requestRenderedMarkdownHtml = vi.fn().mockResolvedValue(baselineHtml);
  host.requestIRHtml = vi.fn().mockResolvedValue(currentHtml);
  const calculateDiffFromHTML = vi.fn().mockReturnValue({
    changes: alignedChanges,
    leftHtmlLines,
    rightHtmlLines: ['<h1>Current IR</h1>', '<p>Changed body</p>', '<p>New right line</p>'],
  });
  global.markdownDiffViewSupport.calculateDiffFromHTML = calculateDiffFromHTML;

  await host.diff.applyPendingChatDiffVisualization();

  assert.deepStrictEqual(host.requestRenderedMarkdownHtml.mock.calls, [[baselineMarkdown]]);
  assert.deepStrictEqual(calculateDiffFromHTML.mock.calls, [[baselineHtml, currentHtml]]);
  assert.deepStrictEqual(host.messages, [{
    type: 'diff-view-detected',
    diffInfo: {
      role: 'right',
      otherUri: 'chat-editing-text-model:/w/a.md',
      instanceId: 'a',
      changes: alignedChanges,
      stats: { added: 1, deleted: 1, modified: 1 },
      htmlLines: leftHtmlLines,
      isHtmlBased: true,
    },
  }]);
  assert.strictEqual(host.diff.singleViewDiffApplied, true);
});

test('pending chat diff clears once changes are empty after having been applied', async () => {
  const tab = {};
  const host = createFakeHost({ instanceId: 'a', fsPath: '/w/a.md', tab });
  const baseline = {
    uri: { scheme: 'chat-editing-text-model', path: '/w/a.md', toString: () => 'chat-editing-text-model:/w/a.md' },
    getText: () => 'same',
  };
  host.diff.refreshPendingChatEditState = () => {
    host.diff.pendingChatBaselineDocument = baseline;
  };
  host.diff.singleViewDiffApplied = true;
  global.markdownDiffViewSupport.calculateDiffFromHTML = () => ({ changes: [], leftHtmlLines: [], rightHtmlLines: [] });

  await host.diff.applyPendingChatDiffVisualization();

  assert.deepStrictEqual(host.messages, [{ type: 'diff-view-cleared' }]);
  assert.strictEqual(host.diff.singleViewDiffApplied, false);
});

test('pending chat diff is skipped entirely in a two-panel diff view', async () => {
  const tab = {};
  const host = createFakeHost({ instanceId: 'a', fsPath: '/w/a.md', tab, isDiffView: true });

  await host.diff.applyPendingChatDiffVisualization();

  assert.deepStrictEqual(host.messages, []);
});

test('isRelevantChatEditingDocument requires same path and chat-editing scheme', () => {
  const tab = {};
  const host = createFakeHost({ instanceId: 'a', fsPath: '/w/a.md', tab });

  const chatDoc = { uri: { scheme: 'chat-editing-text-model', path: '/w/a.md', fsPath: '' } };
  const otherPathDoc = { uri: { scheme: 'chat-editing-text-model', path: '/w/b.md', fsPath: '' } };
  const plainDoc = { uri: { scheme: 'file', path: '/w/a.md', fsPath: '/w/a.md' } };

  assert.strictEqual(host.diff.isRelevantChatEditingDocument(chatDoc), true);
  assert.strictEqual(host.diff.isRelevantChatEditingDocument(otherPathDoc), false);
  assert.strictEqual(host.diff.isRelevantChatEditingDocument(plainDoc), false);
});

test('update diff visualization no-ops when not in a diff view', async () => {
  const tab = {};
  const host = createFakeHost({ instanceId: 'a', fsPath: '/w/a.md', tab });

  await host.diff.updateDiffVisualization();
  await vi.advanceTimersByTimeAsync(2000);

  assert.strictEqual(diffCalls.length, 0);
  assert.deepStrictEqual(host.messages, []);
});

test('update diff visualization debounces rapid calls into one recalculation', async () => {
  const tab = {};
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md', tab, isDiffView: true });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md', tab });
  left.diff.otherDiffUri = right.uri;
  left.diff.diffApplied = true;
  right.diff.diffApplied = true;
  DiffViewController.panelTracking.set(tab, { left, right });

  await left.diff.updateDiffVisualization();
  await left.diff.updateDiffVisualization();
  await vi.advanceTimersByTimeAsync(1700);

  assert.strictEqual(diffCalls.length, 1, 'debounce should collapse rapid calls into one diff calculation');
  assert.strictEqual(left.diff.diffApplied, true);
  assert.strictEqual(right.diff.diffApplied, true);
  assert.strictEqual(left.messages.filter((m) => m.type === 'diff-view-detected').length, 1);
});

test('registerExplicitDiffPanel assigns left/right sides from the tab label', () => {
  const tab = { label: 'left.md ↔ right.md' };
  const left = createFakeHost({ instanceId: 'l', fsPath: '/w/left.md', tab });
  const right = createFakeHost({ instanceId: 'r', fsPath: '/w/right.md', tab });

  left.diff.registerExplicitDiffPanel(false);
  right.diff.registerExplicitDiffPanel(false);

  const pair = DiffViewController.panelTracking.get(tab);
  assert.ok(pair, 'tracking entry created');
  assert.strictEqual(left.diff.isDiffView, true);
  assert.strictEqual(right.diff.isDiffView, true);
  // One host on each side, no side left empty.
  assert.ok(pair.left && pair.right, 'both sides registered');
  assert.notStrictEqual(pair.left, pair.right);
});
