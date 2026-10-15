import { describe, expect, test } from 'vitest';
import {
  createMessageRejection,
  parseHostToWebviewMessage,
  parseWebviewToHostMessage,
} from '../src/editorProtocol';

describe('webview to host protocol', () => {
  test('parses a document revision into its discriminated variant', () => {
    const result = parseWebviewToHostMessage({ command: 'edit', content: '# Title', generation: 2, revision: 7 });

    expect(result).toEqual({
      kind: 'message',
      message: { command: 'edit', content: '# Title', generation: 2, revision: 7 },
    });
  });

  test('drops undeclared fields so handlers only see the contract', () => {
    const result = parseWebviewToHostMessage({ command: 'requestAiAction', action: 'validate', injected: true });

    expect(result).toEqual({ kind: 'message', message: { command: 'requestAiAction', action: 'validate' } });
  });

  test('accepts commands whose payload is empty', () => {
    expect(parseWebviewToHostMessage({ command: 'ready' })).toEqual({ kind: 'message', message: { command: 'ready' } });
    expect(parseWebviewToHostMessage({ command: 'insertKanbanWidget' })).toEqual({
      kind: 'message',
      message: { command: 'insertKanbanWidget' },
    });
  });

  test('keeps optional fields absent rather than undefined', () => {
    const result = parseWebviewToHostMessage({ command: 'openFile', filename: 'Note' });

    expect(result).toEqual({ kind: 'message', message: { command: 'openFile', filename: 'Note' } });
    expect(Object.keys((result as { message: object }).message)).toEqual(['command', 'filename']);
  });

  test.each([
    ['missing revision', { command: 'save', content: 'x', generation: 0 }, 'revision'],
    ['non-numeric generation', { command: 'edit', content: 'x', generation: '1', revision: 1 }, 'generation'],
    ['non-string action', { command: 'requestAiAction', action: 4 }, 'action'],
    ['malformed upload entry', { command: 'upload', files: [{ name: 'a.png' }] }, 'files'],
    ['non-string tool list', { command: 'openNativeToolSelector', selectedTools: ['a', 1] }, 'selectedTools'],
    ['non-finite scroll', { command: 'diff-scroll-sync', scrollPercentage: Number.NaN }, 'scrollPercentage'],
  ])('rejects a known command with a %s', (_name, input, field) => {
    const result = parseWebviewToHostMessage(input);

    expect(result.kind).toBe('malformed');
    if (result.kind !== 'malformed') return;
    expect(result.command).toBe((input as { command: string }).command);
    expect(result.issues.join('\n')).toContain(field);
  });

  test('accepts widget actions whose widget id comes from arbitrary widget config', () => {
    const result = parseWebviewToHostMessage({ command: 'widget-action', actionType: 'value', widgetId: 7, value: 1 });

    expect(result).toEqual({
      kind: 'message',
      message: { command: 'widget-action', actionType: 'value', widgetId: 7, value: 1 },
    });
  });

  test('reports unknown commands without treating them as malformed', () => {
    expect(parseWebviewToHostMessage({ command: 'kanban-save-data' })).toEqual({
      kind: 'unknown',
      command: 'kanban-save-data',
    });
  });

  test.each([null, undefined, 'edit', 42, [], {}, { command: 5 }])('reports %j as unknown input', (input) => {
    expect(parseWebviewToHostMessage(input)).toEqual({ kind: 'unknown', command: undefined });
  });

  test('does not treat inherited object keys as commands', () => {
    expect(parseWebviewToHostMessage({ command: 'toString' })).toEqual({ kind: 'unknown', command: 'toString' });
  });

  test('creates a rejection notice that names the command and issues', () => {
    expect(createMessageRejection('save', ['revision must be a number'])).toEqual({
      command: 'messageRejected',
      rejectedCommand: 'save',
      issues: ['revision must be a number'],
    });
  });
});

describe('host to webview protocol', () => {
  test('parses an update with the fields the editor needs', () => {
    const result = parseHostToWebviewMessage({
      command: 'update',
      type: 'init',
      content: 'body',
      generation: 3,
      documentFilename: 'notes',
      cdnBaseUri: 'vscode-resource://media',
      theme: 'dark',
      options: { mode: 'ir' },
      isReadOnly: false,
      isDiffView: false,
      aiMarkdown: { isAIMarkdown: true },
    });

    expect(result).toEqual({
      kind: 'message',
      message: {
        command: 'update',
        type: 'init',
        content: 'body',
        generation: 3,
        documentFilename: 'notes',
        cdnBaseUri: 'vscode-resource://media',
        theme: 'dark',
        options: { mode: 'ir' },
        isReadOnly: false,
        isDiffView: false,
        aiMarkdown: { isAIMarkdown: true },
      },
    });
  });

  test('rejects an update whose type is not init or update', () => {
    const result = parseHostToWebviewMessage({ command: 'update', content: '', type: 'replace' });

    expect(result.kind).toBe('malformed');
  });

  test('rejects an AI result without a message', () => {
    expect(parseHostToWebviewMessage({ command: 'aiMarkdownActionResult', level: 'info' }).kind).toBe('malformed');
  });

  test('parses diagnostics and requires an array', () => {
    expect(parseHostToWebviewMessage({ command: 'diagnostics', diagnostics: [], documentLines: 1 })).toEqual({
      kind: 'message',
      message: { command: 'diagnostics', diagnostics: [], documentLines: 1 },
    });
    expect(parseHostToWebviewMessage({ command: 'diagnostics', diagnostics: 'none' }).kind).toBe('malformed');
  });

  test('validates a source navigation target', () => {
    const target = { position: { line: 3, character: 1 }, reveal: 'center', highlight: true, origin: 'markdown-link' };

    expect(parseHostToWebviewMessage({ command: 'revealSourcePosition', target })).toEqual({
      kind: 'message',
      message: { command: 'revealSourcePosition', target },
    });
    expect(parseHostToWebviewMessage({
      command: 'revealSourcePosition',
      target: { ...target, position: { line: '3', character: 1 } },
    }).kind).toBe('malformed');
    expect(parseHostToWebviewMessage({
      command: 'revealSourcePosition',
      target: { ...target, origin: 'elsewhere' },
    }).kind).toBe('malformed');
  });

  test('knows the rejection notice the host sends back', () => {
    const notice = createMessageRejection('edit', ['content must be a string']);

    expect(parseHostToWebviewMessage(notice)).toEqual({ kind: 'message', message: notice });
  });
});
