import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

// Drive the real custom-editor provider, EditorPanel, webview router, and
// DocumentSyncController. Only the VS Code host is replaced: applyEdit records
// the replacement text on an in-memory TextDocument, which is exactly what
// other extensions (spell checkers, linters) observe.
const host = vi.hoisted(() => ({
  appliedEdits: [] as string[],
  applyResult: true,
}));

vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mocks/vscode')>();
  const subscribe = () => ({ dispose() {} });
  class Uri {
    readonly scheme = 'file';
    constructor(public fsPath: string) {}
    get path() { return this.fsPath; }
    toString() { return `file://${this.fsPath}`; }
    static file(filePath: string) { return new Uri(filePath); }
    static joinPath(base: Uri, ...paths: string[]) { return new Uri([base.fsPath, ...paths].join('/')); }
  }
  class WorkspaceEdit {
    public replacement: string | undefined;
    replace(_uri: unknown, _range: unknown, text: string) { this.replacement = text; }
  }
  return {
    ...actual,
    Uri,
    WorkspaceEdit,
    ColorThemeKind: { Dark: 2 },
    workspace: {
      ...actual.workspace,
      onDidChangeTextDocument: vi.fn(subscribe),
      onDidOpenTextDocument: subscribe,
      onDidCloseTextDocument: subscribe,
      applyEdit: vi.fn(async (edit: WorkspaceEdit) => {
        if (host.applyResult && edit.replacement !== undefined) host.appliedEdits.push(edit.replacement);
        return host.applyResult;
      }),
    },
    window: {
      ...actual.window,
      tabGroups: { activeTabGroup: { tabs: [] }, all: [] },
      activeColorTheme: { kind: 2 },
    },
    languages: { onDidChangeDiagnostics: subscribe, getDiagnostics: () => [] },
  };
});

import { EditorPanel } from '../src/app/EditorPanel';
import { PreviewCustomEditorProvider } from '../src/app/PreviewCustomEditorProvider';

async function openEditor(initial = '# Notes\n') {
  let text = initial;
  const doc = {
    uri: vscode.Uri.file('/workspace/notes.md'),
    fileName: '/workspace/notes.md',
    languageId: 'markdown',
    isDirty: false,
    get lineCount() { return text.split('\n').length; },
    getText: () => text,
    save: vi.fn(async () => true),
  } as unknown as vscode.TextDocument & { save: ReturnType<typeof vi.fn> };
  const posted: Array<Record<string, unknown>> = [];
  let receive: ((message: unknown) => Promise<void>) | undefined;
  const panel = {
    active: true, visible: true, title: '', dispose() {},
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeViewState: () => ({ dispose() {} }),
    webview: {
      html: '', options: {}, cspSource: 'test-webview:',
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: (message: Record<string, unknown>) => { posted.push(message); return Promise.resolve(true); },
      onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose() {} }; },
    },
  };
  const context = {
    extensionUri: vscode.Uri.file('/extension'),
    globalState: { get: () => ({}), update: async () => {} },
  } as unknown as vscode.ExtensionContext;
  const dependencies = {
    aiWorkflow: { describeDocument: () => ({ relativePath: 'notes.md', isAIMarkdown: false }) },
    relatedFiles: { getRelatedFiles: async () => [] },
  };

  await new PreviewCustomEditorProvider(context, dependencies as never)
    .resolveCustomTextEditor(doc, panel as unknown as vscode.WebviewPanel, {} as vscode.CancellationToken);
  expect(receive).toBeTypeOf('function');
  await receive!({ command: 'ready' });

  return {
    doc,
    posted,
    send: receive!,
    // Mirror what VS Code does once an applied edit lands on the document.
    land: (content: string) => { text = content; },
  };
}

async function settle() {
  await vi.runAllTimersAsync();
}

beforeEach(() => {
  vi.useFakeTimers();
  host.appliedEdits.length = 0;
  host.applyResult = true;
  vi.clearAllMocks();
});

afterEach(() => {
  for (const editor of [...(EditorPanel.editors || [])]) editor.dispose();
  EditorPanel.currentPanel?.dispose();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('document synchronization through the webview message seam', () => {
  it('applies an accepted webview revision to the real VS Code document', async () => {
    const { send } = await openEditor();

    await send({ command: 'edit', content: '# Notes\n\nspeling', generation: 0, revision: 1 });
    await settle();

    expect(host.appliedEdits).toEqual(['# Notes\n\nspeling']);
  });

  it('applies only the newest of several queued revisions in order', async () => {
    const { send } = await openEditor();

    await send({ command: 'edit', content: 'one', generation: 0, revision: 1 });
    await send({ command: 'edit', content: 'two', generation: 0, revision: 2 });
    await send({ command: 'edit', content: 'stale', generation: 0, revision: 1 });
    await settle();

    expect(host.appliedEdits.at(-1)).toBe('two');
    expect(host.appliedEdits).not.toContain('stale');
  });

  it('saves the requested revision through the document', async () => {
    const { send, doc, land } = await openEditor();

    await send({ command: 'edit', content: 'saved body', generation: 0, revision: 1 });
    await settle();
    land('saved body');
    await send({ command: 'save', content: 'saved body', generation: 0, revision: 1 });
    await settle();

    expect(host.appliedEdits).toContain('saved body');
    expect(doc.save).toHaveBeenCalledOnce();
  });

  it('rejects a malformed revision explicitly and leaves the document untouched', async () => {
    const { send, posted, doc } = await openEditor();
    posted.length = 0;

    await send({ command: 'edit', content: 'no revision', generation: 0 });
    await send({ command: 'save', content: 42, generation: 0, revision: 1 });
    await settle();

    expect(host.appliedEdits).toEqual([]);
    expect(doc.save).not.toHaveBeenCalled();
    expect(posted.filter((message) => message.command === 'messageRejected')).toEqual([
      { command: 'messageRejected', rejectedCommand: 'edit', issues: ['revision is required'] },
      { command: 'messageRejected', rejectedCommand: 'save', issues: ['content must be a string'] },
    ]);
  });

  it('ignores a revision from an older document generation', async () => {
    const { send } = await openEditor();

    await send({ command: 'edit', content: 'from the future', generation: 5, revision: 1 });
    await settle();

    expect(host.appliedEdits).toEqual([]);
  });
});

function documentChanged(doc: vscode.TextDocument) {
  const listener = vi.mocked(vscode.workspace.onDidChangeTextDocument).mock.calls.at(-1)![0] as (event: unknown) => void;
  const at = { line: 0, character: 0 };
  listener({ document: doc, contentChanges: [{ range: { start: at, end: at }, rangeLength: 0, text: 'x' }], reason: undefined });
}

describe('write-origin classification of VS Code document changes', () => {
  it('treats the change produced by a synchronized write as internal', async () => {
    const { send, posted, doc, land } = await openEditor();
    await send({ command: 'edit', content: 'from webview', generation: 0, revision: 1 });
    await settle();
    posted.length = 0;

    land('from webview');
    documentChanged(doc);
    await settle();

    expect(posted.filter((message) => message.command === 'update')).toEqual([]);
  });

  it('treats text from a rejected write as an external change', async () => {
    const { send, posted, doc, land } = await openEditor();
    host.applyResult = false;
    await send({ command: 'edit', content: 'never applied', generation: 0, revision: 1 });
    await settle();
    posted.length = 0;

    land('never applied');
    documentChanged(doc);
    await settle();

    expect(posted.filter((message) => message.command === 'update')).toEqual([
      expect.objectContaining({ content: 'never applied', generation: 1 }),
    ]);
  });

  it('starts a new generation for an external change so older revisions are dropped', async () => {
    const { send, posted, doc, land } = await openEditor();
    land('typed in the text editor');
    documentChanged(doc);
    await settle();
    host.appliedEdits.length = 0;

    await send({ command: 'edit', content: 'late webview revision', generation: 0, revision: 1 });
    await send({ command: 'edit', content: 'current webview revision', generation: 1, revision: 1 });
    await settle();

    expect(posted.filter((message) => message.command === 'update').at(-1)).toMatchObject({ generation: 1 });
    expect(host.appliedEdits).toEqual(['current webview revision']);
  });
});

describe('synchronization ownership', () => {
  it('has a single synchronization path with no shadow text-sync provider', () => {
    const root = path.resolve(__dirname, '..');
    const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');

    expect(fs.existsSync(path.join(root, 'src', 'sync', 'MarkdownTextSyncProvider.ts'))).toBe(false);
    expect(extensionSource).not.toMatch(/\bMarkdownTextSyncProvider\b/);
  });
});
