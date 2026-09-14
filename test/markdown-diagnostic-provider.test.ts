import { beforeEach, describe, expect, test } from 'vitest';
import { MarkdownDiagnosticProvider } from '../src/diagnostics/MarkdownDiagnosticProvider';
import { __reset, __state, Uri } from './mocks/vscode';

describe('MarkdownDiagnosticProvider', () => {
  beforeEach(() => {
    __reset();
  });

  test('stores diagnostics for prose but not fenced code content', () => {
    const markdown = [
      'Prose | malformed',
      '![](prose.png)',
      '```mermaid',
      'node | label',
      '![](inside.png)',
      '```',
    ].join('\n');
    const document = {
      languageId: 'markdown',
      uri: Uri.file('/workspace/example.md'),
      getText: () => markdown,
    };
    const provider = new MarkdownDiagnosticProvider();

    (provider as unknown as { analyzeDocument(documentToAnalyze: typeof document): void })
      .analyzeDocument(document);

    expect(__state.diagnosticSets).toHaveLength(1);
    const diagnostics = __state.diagnosticSets[0].diagnostics as Array<{
      code?: string | number;
      range: { start: { line: number }; end: { line: number } };
    }>;
    expect(diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      startLine: diagnostic.range.start.line,
      endLine: diagnostic.range.end.line,
    }))).toEqual([
      { code: 'malformed-table', startLine: 0, endLine: 0 },
      { code: 'missing-alt-text', startLine: 1, endLine: 1 },
    ]);

    provider.dispose();
  });
});
