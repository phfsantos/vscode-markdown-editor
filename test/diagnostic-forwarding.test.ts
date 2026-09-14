import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EditorPanel } from '../src/app/EditorPanel';
import { __reset, __state, Range, Uri } from './mocks/vscode';

function diagnostic(
  message: string,
  source: string,
  range: Range,
  extra: Record<string, unknown> = {},
) {
  return { message, source, severity: 1, range, ...extra };
}

describe('EditorPanel diagnostic forwarding', () => {
  beforeEach(() => {
    __reset();
  });

  test('forwards only prose diagnostics with their serialized metadata intact', () => {
    const documentText = [
      'wrng prose',
      '```mermaid',
      'graph TD',
      '```',
      'ordinary prose',
    ].join('\n');
    const relatedRange = new Range(4, 0, 4, 8);
    __state.diagnostics = [
      diagnostic('Unknown word', 'cSpell', new Range(0, 0, 0, 4), {
        code: 'unknown-word',
        relatedInformation: [{
          message: 'Related prose',
          location: { uri: Uri.file('/workspace/related.md'), range: relatedRange },
        }],
      }),
      diagnostic('Fence content', 'markdownlint', new Range(2, 0, 2, 5), { code: 'MD999' }),
      diagnostic('Crosses fence', 'markdown-editor', new Range(0, 5, 1, 1), { code: 'crossing' }),
    ];
    const postMessage = vi.fn();
    const panel = Object.create(EditorPanel.prototype) as EditorPanel;
    Object.assign(panel, {
      _document: {
        uri: Uri.file('/workspace/example.md'),
        getText: () => documentText,
      },
      _panel: { webview: { postMessage } },
    });

    (panel as unknown as { _updateDiagnostics(): void })._updateDiagnostics();

    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      command: 'diagnostics',
      diagnostics: [{
        message: 'Unknown word',
        severity: 1,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 4 },
        },
        source: 'cSpell',
        code: 'unknown-word',
        lineText: 'wrng prose',
        relatedInformation: [{
          message: 'Related prose',
          location: {
            uri: 'file:///workspace/related.md',
            range: relatedRange,
          },
        }],
      }],
      documentText,
      documentLines: 5,
    });
  });
});
