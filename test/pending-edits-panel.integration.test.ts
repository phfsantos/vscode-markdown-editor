import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { __reset } from './mocks/vscode';

// The real custom editor and EditorPanel; only the extension host is replaced.
const tabs = vi.hoisted(() => ({ listeners: [] as Array<() => void> }));
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
    workspace: { ...actual.workspace, onDidChangeTextDocument: subscribe, onDidOpenTextDocument: subscribe, onDidCloseTextDocument: subscribe },
    window: { ...actual.window, tabGroups: { activeTabGroup: { tabs: [] }, all: [], onDidChangeTabs: (listener: () => void) => { tabs.listeners.push(listener); return { dispose() {} }; } }, activeColorTheme: { kind: 2 } },
    languages: { onDidChangeDiagnostics: subscribe, getDiagnostics: () => [] },
  };
});

const index = vi.hoisted(() => ({
  getOutgoingLinks: vi.fn(async () => []), getBacklinks: vi.fn(async () => []), getRelatedFiles: vi.fn(async () => []),
}));
const graph = { generateSimplifiedGraph: async () => ({ nodes: [], edges: [] }) };
vi.mock('../src/services', async () => ({
  AIMarkdownWorkflowService: (await import('../src/services/AIMarkdownWorkflowService')).AIMarkdownWorkflowService,
}));

import { EditorPanel } from '../src/app/EditorPanel';
import { PreviewCustomEditorProvider } from '../src/app/PreviewCustomEditorProvider';
import { AIMarkdownWorkflowService } from '../src/services/AIMarkdownWorkflowService';

function document(fileName: string, content: string, scheme = 'file') {
  return {
    uri: { ...vscode.Uri.file(fileName), scheme, path: fileName, fsPath: fileName, toString: () => `${scheme}:${fileName}` },
    fileName, languageId: 'markdown', version: 4, isDirty: false, lineCount: content.split('\n').length, getText: () => content,
  } as unknown as vscode.TextDocument;
}

async function openPanel(doc: vscode.TextDocument) {
  const messages: any[] = [];
  let receive: ((message: unknown) => Promise<void>) | undefined;
  const panel = {
    active: true, visible: true, title: '', dispose() {},
    onDidDispose: () => ({ dispose() {} }), onDidChangeViewState: () => ({ dispose() {} }),
    webview: {
      html: '', options: {}, cspSource: 'test-webview:', asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: (message: unknown) => { messages.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose() {} }; },
    },
  };
  const context = { extensionUri: vscode.Uri.file('/extension'), globalState: { get: () => ({}), update: async () => {} } } as unknown as vscode.ExtensionContext;
  await new PreviewCustomEditorProvider(context, { aiWorkflow: new AIMarkdownWorkflowService(index as never, graph as never), relatedFiles: index }).resolveCustomTextEditor(doc, panel as unknown as vscode.WebviewPanel, {} as vscode.CancellationToken);
  await receive!({ command: 'ready' });
  await receive!({ command: 'vditorReady' });
  return { receive: receive!, posted: () => messages.filter(message => message.command === 'pending-edits') };
}

async function openEditor(doc: vscode.TextDocument) {
  return (await openPanel(doc)).posted();
}

beforeEach(() => { vi.useFakeTimers(); __reset(); vscode.workspace.textDocuments.length = 0; tabs.listeners.length = 0; });
afterEach(() => {
  for (const editor of [...(EditorPanel.editors || [])]) editor.dispose();
  EditorPanel.currentPanel?.dispose();
  vi.clearAllTimers(); vi.useRealTimers();
});

describe('pending edits published by the editor panel', () => {
  it('sends a Copilot pending edit with its pre-edit baseline once the editor is ready', async () => {
    const doc = document('/workspace/plan.md', '- [x] One\n');
    vscode.workspace.textDocuments.push(document('/workspace/plan.md', '- [ ] One\n', 'chat-editing-text-model'));

    const posted = await openEditor(doc);

    // Each context-source publish (`ready`, then `vditorReady`) sends the current state.
    expect(posted.length).toBeGreaterThanOrEqual(1);
    expect(posted.at(-1)).toMatchObject({
      command: 'pending-edits', documentVersion: 4, content: '- [x] One\n',
      edits: [{ sourceLabel: 'Copilot', compareContent: '- [ ] One\n' }],
    });
  });

  it('sends nothing while no host has a pending edit', async () => {
    expect(await openEditor(document('/workspace/plan.md', '- [ ] One\n'))).toEqual([]);
  });

  it('resends an unchanged pending edit after every context-source publish', async () => {
    // An event-driven publish can reach the webview before the `update` that
    // carries its generation, and the webview drops it as stale. The context
    // source publish that follows that `update` must therefore always resend.
    const panel = await openPanel(document('/workspace/plan.md', '- [x] One\n'));
    expect(panel.posted()).toEqual([]);
    vscode.workspace.textDocuments.push(document('/workspace/plan.md', '- [ ] One\n', 'chat-editing-text-model'));

    for (const listener of tabs.listeners) listener();
    expect(panel.posted()).toHaveLength(1);
    await panel.receive({ command: 'vditorReady' });

    const posted = panel.posted();
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual(posted[0]);
    expect(posted[1].edits).toEqual([{ sourceLabel: 'Copilot', compareContent: '- [ ] One\n' }]);
  });

  it('sends a clear exactly once after a non-empty state', async () => {
    const panel = await openPanel(document('/workspace/plan.md', '- [x] One\n'));
    vscode.workspace.textDocuments.push(document('/workspace/plan.md', '- [ ] One\n', 'chat-editing-text-model'));
    for (const listener of tabs.listeners) listener();
    vscode.workspace.textDocuments.length = 0;

    await panel.receive({ command: 'vditorReady' });
    await panel.receive({ command: 'vditorReady' });
    for (const listener of tabs.listeners) listener();

    expect(panel.posted().map(message => message.edits)).toEqual([
      [{ sourceLabel: 'Copilot', compareContent: '- [ ] One\n' }],
      [],
    ]);
  });
});
