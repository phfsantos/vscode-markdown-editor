import assert from 'assert';
import { afterEach, beforeEach, test, vi } from 'vitest';

// 'vscode' resolves to test/mocks/vscode.ts via the vitest alias.
import { __reset, workspace } from 'vscode';
import { DIFF_RENDER_TIMEOUT_MS, DiffViewController } from '../src/app/DiffViewController';
import { parseHostToWebviewMessage } from '@markdown-editor/core';

/**
 * Characterization tests for the diff-view flow, originally written against
 * EditorPanel's private methods and retargeted 1:1 at DiffViewController when
 * the logic was extracted. The observable behavior they pin is unchanged.
 */

function createFakeHost({ instanceId, fsPath, tab, isDiffView = false, webviewReady = true, renderedReady = true, viewColumn = 1 }) {
  const host = {
    instanceId,
    uri: { fsPath, scheme: 'file', toString: () => `file://${fsPath}` },
    document: {
      uri: { scheme: 'file', fsPath, path: fsPath },
      getText: () => 'current text',
    },
    tab,
    viewColumn,
    webviewReady,
    renderedReady,
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
  host.diff = new DiffViewController(host, diffCoordinator);
  host.diff.isDiffView = isDiffView;
  return host;
}

let diffCalls;
const registered = [];
/** Join a side-by-side session: the left (original) side is a non-writable document. */
function joinDiff(left, right) {
  left.diff.registerExplicitDiffPanel({ uri: `git:${left.uri.fsPath}`, writable: false });
  right.diff.registerExplicitDiffPanel({ uri: right.uri.toString(), writable: true });
  registered.push(left, right);
}
let diffCoordinator;

beforeEach(() => {
  __reset();
  workspace.textDocuments.length = 0;
  for (const host of registered.splice(0)) DiffViewController.sessions.leave(host);
  DiffViewController.calculationInProgress.clear();
  diffCalls = [];
  diffCoordinator = {
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
    handleScrollSync: () => {},
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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

  assert.deepStrictEqual(host.messages, [{ command: 'diff-view-cleared' }]);
  assert.strictEqual(host.diff.diffApplied, false);
  assert.strictEqual(host.eligibilityPosts, 1);
});

test('reactive check applies HTML diff to both panels with swapped html lines and role stats', async () => {
  const tab = {};
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md', tab, isDiffView: true });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md', tab });
  left._irHtml = '<p>left-html</p>';
  right._irHtml = '<p>right-html</p>';
  joinDiff(left, right);

  // Both sides have rendered: the diff is calculated at once, with no fixed sleep.
  await left.diff.checkDiffViewContextReactive();

  assert.strictEqual(diffCalls.length, 1);
  assert.deepStrictEqual(diffCalls[0], ['<p>left-html</p>', '<p>right-html</p>']);

  assert.strictEqual(left.messages.length, 1);
  assert.strictEqual(right.messages.length, 1);
  const leftMsg = left.messages[0];
  const rightMsg = right.messages[0];

  assert.strictEqual(leftMsg.command, 'diff-view-detected');
  assert.strictEqual(leftMsg.diffInfo.mode, 'side-by-side');
  assert.ok(Number.isSafeInteger(leftMsg.diffInfo.version));
  assert.ok(rightMsg.diffInfo.version > leftMsg.diffInfo.version, 'each projection gets a fresh version');
  assert.strictEqual(leftMsg.diffInfo.role, 'left');
  assert.strictEqual(leftMsg.diffInfo.otherUri, 'file:///w/right.md');
  assert.deepStrictEqual(leftMsg.diffInfo.stats, { added: 0, deleted: 0, modified: 1 });

  assert.strictEqual(rightMsg.diffInfo.role, 'right');
  assert.strictEqual(rightMsg.diffInfo.otherUri, 'file:///w/left.md');
  assert.deepStrictEqual(rightMsg.diffInfo.stats, { added: 1, deleted: 0, modified: 1 });

  assert.strictEqual(left.diff.diffApplied, true);
  assert.strictEqual(right.diff.diffApplied, true);
  // Both sides know their role and partner from the session.
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

  assert.deepStrictEqual(host.messages, [{ command: 'diff-view-cleared' }]);
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
  diffCoordinator.calculateDiffFromHTML = calculateDiffFromHTML;

  await host.diff.applyPendingChatDiffVisualization();

  assert.deepStrictEqual(host.requestRenderedMarkdownHtml.mock.calls, [[baselineMarkdown]]);
  assert.deepStrictEqual(calculateDiffFromHTML.mock.calls, [[baselineHtml, currentHtml]]);
  assert.strictEqual(host.messages.length, 1);
  const { version, ...diffInfo } = host.messages[0].diffInfo;
  assert.strictEqual(host.messages[0].command, 'diff-view-detected');
  assert.ok(Number.isSafeInteger(version));
  assert.deepStrictEqual(diffInfo, {
    role: 'right',
    mode: 'inline',
    otherUri: 'chat-editing-text-model:/w/a.md',
    instanceId: 'a',
    changes: alignedChanges,
    stats: { added: 1, deleted: 1, modified: 1 },
  });
  // The payload satisfies the typed host protocol the webview parses.
  assert.strictEqual(parseHostToWebviewMessage(host.messages[0]).kind, 'message');
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
  diffCoordinator.calculateDiffFromHTML = () => ({ changes: [], leftHtmlLines: [], rightHtmlLines: [] });

  await host.diff.applyPendingChatDiffVisualization();

  assert.deepStrictEqual(host.messages, [{ command: 'diff-view-cleared' }]);
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
  joinDiff(left, right);
  left.diff.otherDiffUri = right.uri;
  left.diff.diffApplied = true;
  right.diff.diffApplied = true;

  await left.diff.updateDiffVisualization();
  await left.diff.updateDiffVisualization();
  await vi.advanceTimersByTimeAsync(1700);

  assert.strictEqual(diffCalls.length, 1, 'debounce should collapse rapid calls into one diff calculation');
  assert.strictEqual(left.diff.diffApplied, true);
  assert.strictEqual(right.diff.diffApplied, true);
  assert.strictEqual(left.messages.filter((m) => m.command === 'diff-view-detected').length, 1);
});

test('registerExplicitDiffPanel pairs both sides in one session with writability-based roles', () => {
  const left = createFakeHost({ instanceId: 'l', fsPath: '/w/left.md' });
  const right = createFakeHost({ instanceId: 'r', fsPath: '/w/right.md' });

  joinDiff(left, right);

  assert.strictEqual(left.diff.isDiffView, true);
  assert.strictEqual(right.diff.isDiffView, true);
  assert.strictEqual(DiffViewController.sessions.roleOf(left), 'left');
  assert.strictEqual(DiffViewController.sessions.roleOf(right), 'right');
  assert.strictEqual(DiffViewController.sessions.partnerOf(left), right);
});

test('disposing a diff controller ends its handoff and cancels pending coordination', async () => {
  const tab = { label: 'left.md ↔ right.md' };
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md', tab });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md', tab });

  joinDiff(left, right);
  await left.diff.updateDiffVisualization();
  left.diff.dispose();

  await vi.advanceTimersByTimeAsync(1000);

  assert.strictEqual(DiffViewController.sessions.sessionOf(left), undefined);
  assert.strictEqual(DiffViewController.sessions.partnerOf(right), undefined);
  assert.deepStrictEqual(left.messages, []);
  assert.deepStrictEqual(right.messages, []);
});

test('the diff waits for both sides to render, then applies without any fixed delay', async () => {
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md', renderedReady: false });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md', renderedReady: false });
  joinDiff(left, right);

  await left.diff.checkDiffViewContextReactive();
  assert.strictEqual(diffCalls.length, 0, 'nothing is calculated before both sides rendered');

  left.renderedReady = true;
  left.diff.onRendered();
  await vi.advanceTimersByTimeAsync(0);
  assert.strictEqual(diffCalls.length, 0, 'one side alone is not enough');

  right.renderedReady = true;
  right.diff.onRendered();
  // Flush promise jobs only: no timer needs to elapse.
  await vi.advanceTimersByTimeAsync(0);
  assert.strictEqual(diffCalls.length, 1);
  assert.ok(left.messages.some((m) => m.command === 'diff-view-detected'));
  assert.ok(right.messages.some((m) => m.command === 'diff-view-detected'));
  assert.strictEqual(vi.getTimerCount(), 0, 'the render timeout is cleared once the diff is applied');
});

test('a side that never renders produces an error state instead of a silent missing diff', async () => {
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md' });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md', renderedReady: false });
  joinDiff(left, right);
  await left.diff.checkDiffViewContextReactive();

  await vi.advanceTimersByTimeAsync(DIFF_RENDER_TIMEOUT_MS - 1);
  assert.ok(!left.messages.some((m) => m.command === 'diff-view-failed'));
  await vi.advanceTimersByTimeAsync(1);

  for (const host of [left, right]) {
    const failure = host.messages.find((m) => m.command === 'diff-view-failed');
    assert.ok(failure, `${host.instanceId} shows the failure`);
    assert.match(failure.message, /did not finish rendering/);
    assert.strictEqual(parseHostToWebviewMessage(failure).kind, 'message');
  }
  assert.strictEqual(diffCalls.length, 0);
});

test('an editor that cannot return its HTML yields an error state, not a silent return', async () => {
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md' });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md' });
  right.requestIRHtml = async () => null;
  joinDiff(left, right);

  await left.diff.checkDiffViewContextReactive();

  assert.ok(left.messages.some((m) => m.command === 'diff-view-failed'));
  assert.ok(right.messages.some((m) => m.command === 'diff-view-failed'));
  assert.strictEqual(diffCalls.length, 0);
});

test('a scroll anchor from one side is relayed to its partner only, never echoed to the source', async () => {
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md' });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md' });
  joinDiff(left, right);
  await left.diff.checkDiffViewContextReactive();
  left.messages.length = 0;
  right.messages.length = 0;

  await left.diff.routes()['diff-scroll-sync']({ command: 'diff-scroll-sync', anchor: { row: 42, offset: 0.25 } });

  assert.deepStrictEqual(right.messages, [{ command: 'diff-scroll-sync', anchor: { row: 42, offset: 0.25 } }]);
  assert.deepStrictEqual(left.messages, []);
  assert.strictEqual(parseHostToWebviewMessage(right.messages[0]).kind, 'message');
});

test('a scroll anchor before the partner has its diff is dropped, not retried', async () => {
  const left = createFakeHost({ instanceId: 'left', fsPath: '/w/left.md' });
  const right = createFakeHost({ instanceId: 'right', fsPath: '/w/right.md', renderedReady: false });
  joinDiff(left, right);

  left.diff.handleScrollSync({ row: 3, offset: 0 });
  await vi.advanceTimersByTimeAsync(1000);

  assert.deepStrictEqual(right.messages.filter((m) => m.command === 'diff-scroll-sync'), []);
});

test('A1: a side that never finds a partner quietly becomes a plain editor, with no error state', async () => {
  const lonely = createFakeHost({ instanceId: 'lonely', fsPath: '/w/diff.md' });
  lonely.diff.registerExplicitDiffPanel({ uri: lonely.uri.toString(), writable: true });
  registered.push(lonely);
  await lonely.diff.checkDiffViewContextReactive();

  await vi.advanceTimersByTimeAsync(DIFF_RENDER_TIMEOUT_MS + 1);

  assert.deepStrictEqual(lonely.messages.filter((m) => m.command === 'diff-view-failed'), []);
  assert.strictEqual(lonely.diff.isDiffView, false);
  assert.strictEqual(DiffViewController.sessions.sessionOf(lonely), undefined, 'it no longer waits for a partner');
});
