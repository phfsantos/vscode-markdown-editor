import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_DIFF_RIGHT_SCHEME,
  createClaudeCodePendingEditSource,
} from '../src/app/claudeCodePendingEditSource';

// A stand-in for vscode.TabInputTextDiff, so detection is pinned to the class
// check rather than to whatever shape an input object happens to have.
class FakeTabInputTextDiff {
  constructor(public readonly original: FakeUri, public readonly modified: FakeUri) {}
}

interface FakeUri { scheme: string; path: string; fsPath: string; query: string }
const uri = (scheme: string, path: string, query = ''): FakeUri => ({ scheme, path, fsPath: path, query });
const doc = (u: FakeUri, text: string) => ({ uri: u, getText: () => text });

const note = doc(uri('file', '/w/plan.md'), '- [ ] Step one\n');
// Claude Code 2.1.323 opens `vscode.diff(file:<path>, _claude_vscode_fs_right:<path>)`.
const proposedUri = uri(CLAUDE_CODE_DIFF_RIGHT_SCHEME, '/w/plan.md');
const proposed = doc(proposedUri, '- [x] Step one\n');

function setup(tabs: Array<{ input: unknown }>, documents = [note, proposed]) {
  const tabGroups = { all: [{ tabs }] };
  const source = createClaudeCodePendingEditSource({
    tabGroups,
    TabInputTextDiff: FakeTabInputTextDiff,
    textDocuments: () => documents,
  });
  return { source, tabGroups };
}

describe('Claude Code pending edit source', () => {
  it('detects a Claude Code proposed diff for this document', () => {
    const { source } = setup([{ input: new FakeTabInputTextDiff(note.uri, proposedUri) }]);

    expect(source.findPendingEdit(note)).toEqual({
      sourceId: 'claude-code-diff',
      sourceLabel: 'Claude Code',
      documentRole: 'original',
      compareDocument: proposed,
    });
  });

  it('ignores a Claude Code diff for another path', () => {
    const otherUri = uri(CLAUDE_CODE_DIFF_RIGHT_SCHEME, '/w/other.md');
    const { source } = setup(
      [{ input: new FakeTabInputTextDiff(uri('file', '/w/other.md'), otherUri) }],
      [note, doc(otherUri, 'other')],
    );

    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('ignores the edited-text-only fallback, whose right side is a fragment at a renamed path', () => {
    const fragmentUri = uri(CLAUDE_CODE_DIFF_RIGHT_SCHEME, '/w/plan (edited text only).md', 'abc');
    const { source } = setup(
      [{ input: new FakeTabInputTextDiff(uri('_claude_vscode_fs_left', '/w/plan (edited text only).md', 'abc'), fragmentUri) }],
      [note, doc(fragmentUri, 'fragment')],
    );

    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('fails closed when the modified side does not use the private scheme', () => {
    const { source } = setup([
      { input: new FakeTabInputTextDiff(uri('git', '/w/plan.md'), uri('file', '/w/plan.md')) },
    ], [note]);

    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('fails closed for a diff-shaped input that is not a TabInputTextDiff', () => {
    const { source } = setup([{ input: { original: note.uri, modified: proposedUri } }]);

    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('fails closed when the proposed document is not open', () => {
    const { source } = setup([{ input: new FakeTabInputTextDiff(note.uri, proposedUri) }], [note]);

    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('fails closed when the host has no TabInputTextDiff class', () => {
    const source = createClaudeCodePendingEditSource({
      tabGroups: { all: [{ tabs: [{ input: new FakeTabInputTextDiff(note.uri, proposedUri) }] }] },
      TabInputTextDiff: undefined,
      textDocuments: () => [note, proposed],
    });

    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('clears once the diff tab is closed', () => {
    const tab = { input: new FakeTabInputTextDiff(note.uri, proposedUri) };
    const { source, tabGroups } = setup([tab]);
    expect(source.findPendingEdit(note)).toBeDefined();

    tabGroups.all[0].tabs.splice(0, 1);

    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('treats only the proposed document for this path as relevant', () => {
    const { source } = setup([]);

    expect(source.isRelevantDocument(note, proposed)).toBe(true);
    expect(source.isRelevantDocument(note, doc(uri(CLAUDE_CODE_DIFF_RIGHT_SCHEME, '/w/other.md'), ''))).toBe(false);
    expect(source.isRelevantDocument(note, doc(uri('chat-editing-text-model', '/w/plan.md'), ''))).toBe(false);
  });
});

// Terminal/IDE-MCP proposals use a distinct private scheme.
describe('Claude Code terminal pending edit source', () => {
  const terminalUri = uri('_claude_fs_right', '/w/plan.md');
  const terminalProposal = doc(terminalUri, '- [x] Step one\n');

  it('detects a terminal-integration proposed diff for this document', () => {
    const { source } = setup(
      [{ input: new FakeTabInputTextDiff(note.uri, terminalUri) }],
      [note, terminalProposal],
    );

    expect(source.findPendingEdit(note)).toEqual({
      sourceId: 'claude-code-diff',
      sourceLabel: 'Claude Code',
      documentRole: 'original',
      compareDocument: terminalProposal,
    });
  });

  it('ignores a terminal-integration diff for another path', () => {
    const otherUri = uri('_claude_fs_right', '/w/other.md');
    const { source } = setup(
      [{ input: new FakeTabInputTextDiff(uri('file', '/w/other.md'), otherUri) }],
      [note, doc(otherUri, 'other')],
    );
    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it.each(['', 'file', '_claude_fs_left', '_claude_fs_right_unknown'])(
    'fails closed when a terminal diff uses the unrecognised scheme %j', (scheme) => {
      const otherUri = uri(scheme, '/w/plan.md');
      const { source } = setup(
        [{ input: new FakeTabInputTextDiff(note.uri, otherUri) }],
        [note, doc(otherUri, 'other')],
      );
      expect(source.findPendingEdit(note)).toBeUndefined();
    },
  );

  it('clears when the terminal-integration diff tab closes', () => {
    const { source, tabGroups } = setup(
      [{ input: new FakeTabInputTextDiff(note.uri, terminalUri) }],
      [note, terminalProposal],
    );
    expect(source.findPendingEdit(note)).toBeDefined();
    tabGroups.all[0].tabs.splice(0, 1);
    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('fails closed when the terminal proposal is not open', () => {
    const { source } = setup([{ input: new FakeTabInputTextDiff(note.uri, terminalUri) }], [note]);
    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('does not substitute another query for the terminal proposal in the tab', () => {
    const tabUri = uri('_claude_fs_right', '/w/plan.md', 'session-one');
    const staleUri = uri('_claude_fs_right', '/w/plan.md', 'session-two');
    const { source } = setup(
      [{ input: new FakeTabInputTextDiff(note.uri, tabUri) }],
      [note, doc(staleUri, 'stale')],
    );
    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('ignores the terminal edited-text-only fallback', () => {
    const fragmentUri = uri('_claude_fs_right', '/w/plan (edited text only).md', 'abc');
    const { source } = setup(
      [{ input: new FakeTabInputTextDiff(uri('_claude_fs_left', fragmentUri.path, 'abc'), fragmentUri) }],
      [note, doc(fragmentUri, 'fragment')],
    );
    expect(source.findPendingEdit(note)).toBeUndefined();
  });

  it('recognises terminal proposal changes for this path', () => {
    const { source } = setup([]);
    expect(source.isRelevantDocument(note, terminalProposal)).toBe(true);
    expect(source.isRelevantDocument(note, doc(uri('_claude_fs_right', '/w/other.md'), ''))).toBe(false);
  });

});
