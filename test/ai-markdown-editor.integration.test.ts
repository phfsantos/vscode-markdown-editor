import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { __reset } from './mocks/vscode';

// Keep the editor, AI handler, classifier, and workflow service real. Only the
// extension host and workspace indexing boundary are replaced by in-memory data.
vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mocks/vscode')>();
  const subscribe = () => ({ dispose() {} });
  class Uri {
    readonly scheme = 'file';
    constructor(public fsPath: string) {}
    get path() { return this.fsPath; }
    toString() { return `file://${this.fsPath}`; }
    static file(path: string) { return new Uri(path); }
    static joinPath(base: Uri, ...paths: string[]) { return new Uri([base.fsPath, ...paths].join('/')); }
  }
  return {
    ...actual,
    Uri,
    ColorThemeKind: { Dark: 2 },
    workspace: {
      ...actual.workspace,
      onDidChangeTextDocument: subscribe,
      onDidOpenTextDocument: subscribe,
      onDidCloseTextDocument: subscribe,
    },
    window: {
      ...actual.window,
      tabGroups: { activeTabGroup: { tabs: [] }, all: [] },
      activeColorTheme: { kind: 2 },
    },
    languages: { onDidChangeDiagnostics: subscribe, getDiagnostics: () => [] },
  };
});

const index = vi.hoisted(() => ({
  getOutgoingLinks: vi.fn(async () => []),
  getBacklinks: vi.fn(async () => []),
  getRelatedFiles: vi.fn(async () => []),
}));
vi.mock('../src/services/RelationshipAnalyzer', () => ({
  RelationshipAnalyzer: { getInstance: () => index },
}));
vi.mock('../src/services/LinkGraphGenerator', () => ({
  LinkGraphGenerator: { getInstance: () => ({ generateSimplifiedGraph: async () => ({ nodes: [], edges: [] }) }) },
}));
vi.mock('../src/services', async () => ({
  AIMarkdownWorkflowService: (await import('../src/services/AIMarkdownWorkflowService')).AIMarkdownWorkflowService,
}));

import { EditorPanel } from '../src/app/EditorPanel';
import { PreviewCustomEditorProvider } from '../src/app/PreviewCustomEditorProvider';

function document(fileName: string, content = '# Notes\n\nHello café 👋') {
  return {
    uri: vscode.Uri.file(fileName), fileName, languageId: 'markdown',
    isDirty: false, lineCount: content.split('\n').length, getText: () => content,
  } as vscode.TextDocument;
}

async function openEditor(fileName = '/workspace/helper.agent.md', content?: string) {
  const doc = document(fileName, content);
  const messages: any[] = [];
  let receive: ((message: unknown) => Promise<void>) | undefined;
  const panel = {
    active: true, visible: true, title: '', dispose() {},
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeViewState: () => ({ dispose() {} }),
    webview: {
      html: '', options: {}, cspSource: 'test-webview:',
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: (message: unknown) => { messages.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose() {} }; },
    },
  };
  const context = {
    extensionUri: vscode.Uri.file('/extension'),
    globalState: { get: () => ({}), update: async () => {} },
  } as unknown as vscode.ExtensionContext;
  await new PreviewCustomEditorProvider(context).resolveCustomTextEditor(doc, panel as unknown as vscode.WebviewPanel, {} as vscode.CancellationToken);
  expect(receive, 'Provider must resolve an editor and register the webview receiver').toBeTypeOf('function');
  await receive!({ command: 'ready' });
  return {
    doc, messages,
    update: messages.find((message) => message.command === 'update'),
    action: async (action: string) => {
      messages.length = 0;
      await receive!({ command: 'requestAiAction', action });
      return messages;
    },
  };
}

let hostState: ReturnType<typeof __reset>;

beforeEach(() => {
  vi.useFakeTimers();
  hostState = __reset();
  vscode.workspace.textDocuments.length = 0;
  vi.clearAllMocks();
});
afterEach(() => {
  for (const editor of [...(EditorPanel.editors || [])]) editor.dispose();
  EditorPanel.currentPanel?.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('AI markdown custom editor update payload', () => {
  it.each([
    ['helper.agent.md', 'agent', 'Agent'],
    ['compose.prompt.md', 'prompt', 'Prompt'],
    ['SKILL.md', 'skill', 'Skill'],
  ])('publishes %s classification when the webview becomes ready', async (filename, kind, badgeLabel) => {
    const { update } = await openEditor(`/workspace/${filename}`);
    expect(update).toMatchObject({
      command: 'update', type: 'init', content: '# Notes\n\nHello café 👋',
      documentPath: `/workspace/${filename}`, isDiffView: false, isReadOnly: false,
      aiMarkdown: { kind, badgeLabel, isAIMarkdown: true, relativePath: filename, hasPendingChatEdits: false },
      chatAnchor: { visible: false }, inlineSuggestion: { enabled: false, languageId: 'markdown' },
    });
  });

  it('preserves ordinary Markdown content and chat affordance without AI classification', async () => {
    const content = '---\ntitle: Ordinary\n---\n\n# Hello\n\n```ts\nconst a = 1;\n```\n';
    const { update } = await openEditor('/workspace/notes.md', content);
    expect(update).toMatchObject({ content, documentFilename: 'notes', generation: 0,
      aiMarkdown: { kind: 'none', isAIMarkdown: false, badgeLabel: '', suggestedSections: [] },
      chatAnchor: { visible: true, relativePath: 'notes.md' },
    });
  });

  it('carries disabled AI settings into the webview descriptor', async () => {
    hostState = __reset({ config: { 'ai.enable': false } });
    const { update } = await openEditor();
    expect(update.aiMarkdown.availability).toMatchObject({ enabled: false, status: 'disabled' });
  });

  it('reports pending chat edits from matching workspace baseline documents', async () => {
    const baseline = document('/workspace/helper.agent.md', 'Original');
    vscode.workspace.textDocuments.push({ ...baseline, uri: { ...baseline.uri, scheme: 'chat-editing-text-model', path: baseline.uri.path } } as vscode.TextDocument);
    const editor = await openEditor();
    expect(editor.update.aiMarkdown.hasPendingChatEdits).toBe(true);
    await editor.action('copyContext');
    expect(hostState.clipboardWrites[0]).toContain('Pending chat edits are currently detected for this file.');
  });
});

describe('requestAiAction messages through the real AI handler', () => {
  it('copies the generated context package to the host clipboard', async () => {
    const editor = await openEditor();
    const messages = await editor.action('copyContext');
    expect(hostState.clipboardWrites).toHaveLength(1);
    expect(hostState.clipboardWrites[0]).toContain('# AI Markdown Context Package');
    expect(hostState.clipboardWrites[0]).toContain('helper.agent.md');
    expect(messages).toContainEqual({ command: 'aiMarkdownActionResult', message: 'AI context copied to the clipboard.', level: 'info' });
  });

  it('inserts context at the cursor through a webview edit message', async () => {
    const editor = await openEditor();
    const messages = await editor.action('insertContext');
    expect(messages[0]).toMatchObject({ command: 'insertTextAtCursor', text: expect.stringContaining('# AI Markdown Context Package') });
    expect(messages[1]).toMatchObject({ command: 'aiMarkdownActionResult', level: 'info' });
    expect(hostState.clipboardWrites).toEqual([]);
  });

  it('inserts the template appropriate to the current filename', async () => {
    const editor = await openEditor('/workspace/compose.prompt.md');
    const messages = await editor.action('insertTemplate');
    expect(messages[0]).toMatchObject({ command: 'insertTextAtCursor', text: expect.stringContaining('## Expected Output') });
    expect(messages[1]).toMatchObject({ command: 'aiMarkdownActionResult', level: 'info' });
  });

  it('returns missing sections from validation', async () => {
    const editor = await openEditor('/workspace/compose.prompt.md', '# Prompt\n\n## Intent\n');
    expect(await editor.action('validate')).toEqual([{ command: 'aiMarkdownActionResult', level: 'warning', message: 'Missing sections: Inputs, Variables, Constraints, Expected Output' }]);
  });

  it('passes validation when all required prompt sections are present', async () => {
    const content = ['Intent', 'Inputs', 'Variables', 'Constraints', 'Expected Output']
      .map((heading) => `## ${heading}\nContent`).join('\n\n');
    const editor = await openEditor('/workspace/compose.prompt.md', content);
    expect(await editor.action('validate')).toEqual([{ command: 'aiMarkdownActionResult', level: 'info', message: 'AI markdown validation passed.' }]);
  });

  it('opens the graph through the registered extension command', async () => {
    const editor = await openEditor();
    expect(await editor.action('openGraph')).toEqual([{ command: 'aiMarkdownActionResult', level: 'info', message: 'Graph view opened for the current markdown file.' }]);
    expect(hostState.executedCommands).toEqual(['markdown-editor.openGraphView']);
  });

  it('warns when validation is requested for ordinary Markdown', async () => {
    const editor = await openEditor('/workspace/notes.md');
    expect(await editor.action('validate')).toEqual([{ command: 'aiMarkdownActionResult', level: 'warning', message: 'This file is not classified as AI markdown by filename.' }]);
  });

  it('falls back to clipboard handoff when no chat provider is available', async () => {
    const editor = await openEditor();
    const messages = await editor.action('openChat');
    expect(hostState.clipboardWrites[0]).toContain('# AI Markdown Context Package');
    expect(hostState.executedCommands).toEqual([]);
    expect(messages).toEqual([{ command: 'aiMarkdownActionResult', level: 'warning', message: expect.stringContaining('copied') }]);
  });

  it('reports unsupported actions without performing a host action', async () => {
    const editor = await openEditor();
    expect(await editor.action('unknown')).toEqual([{ command: 'aiMarkdownActionResult', level: 'warning', message: 'Unsupported AI markdown action: unknown' }]);
    expect(hostState.clipboardWrites).toEqual([]);
    expect(hostState.executedCommands).toEqual([]);
  });

  it('reports context-index failures to the webview without announcing success', async () => {
    index.getOutgoingLinks.mockRejectedValueOnce(new Error('Index unavailable'));
    const editor = await openEditor();
    expect(await editor.action('copyContext')).toEqual([{ command: 'aiMarkdownActionResult', level: 'error', message: 'AI markdown action failed: Index unavailable' }]);
    expect(hostState.clipboardWrites).toEqual([]);
  });
});
