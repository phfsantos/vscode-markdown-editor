import { describe, expect, it } from 'vitest';
import { parseWebviewToHostMessage } from '../packages/core/src/editorProtocol';
const message = { command: 'editor-context', panelId: 'A', documentVersion: 1, selectionStatus: 'exact', selection: { start: { line: 0, character: 8 }, end: { line: 0, character: 12 } } };
describe('context wire protocol', () => {
  it('parses exact context', () => expect(parseWebviewToHostMessage(message).kind).toBe('message'));
  it.each([NaN, Infinity, -1, 1.5])('rejects invalid source positions %s', character => {
    expect(parseWebviewToHostMessage({ ...message, selection: { ...message.selection, start: { line: 0, character } } }).kind).toBe('malformed');
  });
  it('rejects reversed endpoints', () => {
    expect(parseWebviewToHostMessage({ ...message, selection: { start: message.selection.end, end: message.selection.start } }).kind).toBe('malformed');
  });
});
