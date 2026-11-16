import { describe, expect, it } from 'vitest';
import { collectPendingEdits } from '../src/app/pendingEdits';
import type { PendingEditSource } from '../src/app/pendingEditSource';

type Doc = { uri: { scheme: string; path: string; fsPath: string }; getText(): string };
const doc = (scheme: string, text: string): Doc => ({ uri: { scheme, path: '/w/plan.md', fsPath: '/w/plan.md' }, getText: () => text });
const source = (label: string, compare: Doc | undefined): PendingEditSource<Doc> => ({
  id: label === 'Copilot' ? 'copilot-chat-editing' : 'claude-code-diff', label,
  isRelevantDocument: () => true,
  findPendingEdit: () => compare && ({ sourceId: label === 'Copilot' ? 'copilot-chat-editing' : 'claude-code-diff', sourceLabel: label, documentRole: 'proposed', compareDocument: compare }),
});

describe('pending edits sent to the webview', () => {
  const note = doc('file', '- [x] A');

  it('lists every source that has a pending edit, with the text to compare against', () => {
    const edits = collectPendingEdits(note, [source('Copilot', doc('chat-editing-text-model', '- [ ] A')), source('Claude Code', undefined)]);

    expect(edits).toEqual([{ sourceLabel: 'Copilot', compareContent: '- [ ] A' }]);
  });

  it('skips a source whose compare document cannot be read', () => {
    const unreadable = { uri: note.uri } as unknown as Doc;

    expect(collectPendingEdits(note, [source('Claude Code', unreadable)])).toEqual([]);
  });

  it('skips a source that throws, so one broken host shape cannot hide the others', () => {
    const broken: PendingEditSource<Doc> = { ...source('Claude Code', undefined), findPendingEdit: () => { throw new Error('private shape changed'); } };

    expect(collectPendingEdits(note, [broken, source('Copilot', doc('chat-editing-text-model', 'x'))]).map(e => e.sourceLabel)).toEqual(['Copilot']);
  });
});
