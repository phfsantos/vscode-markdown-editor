import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener<T = unknown> = (value: T) => unknown;

const host = vi.hoisted(() => ({
  activeTextEditor: undefined as { document: TestDocument } | undefined,
  graphDocument: undefined as TestDocument | undefined,
  graphListeners: [] as Listener<TestDocument | undefined>[],
  editorPanelListeners: [] as Listener<TestDocument | undefined>[],
  activeEditorListeners: [] as Listener<{ document: TestDocument } | undefined>[],
  webviewMessageListener: undefined as Listener<Record<string, unknown>> | undefined,
  executeCommand: vi.fn(),
  generateSimplifiedGraph: vi.fn(),
  postMessage: vi.fn(),
  reveal: vi.fn(),
  reset() {
    this.activeTextEditor = undefined;
    this.graphDocument = undefined;
    this.graphListeners.splice(0);
    this.editorPanelListeners.splice(0);
    this.activeEditorListeners.splice(0);
    this.webviewMessageListener = undefined;
    this.executeCommand.mockReset();
    this.generateSimplifiedGraph.mockReset();
    this.generateSimplifiedGraph.mockResolvedValue({
      nodes: [{ id: 'focus', label: 'Focus', path: '/workspace/focus.md', isFocus: true }],
      edges: [],
    });
    this.postMessage.mockReset();
    this.postMessage.mockResolvedValue(true);
    this.reveal.mockReset();
  },
}));

interface TestDocument {
  languageId: string;
  fileName: string;
  uri: {
    fsPath: string;
    scheme: string;
    toString(): string;
  };
}

function subscribe<T>(listeners: Listener<T>[], listener: Listener<T>) {
  listeners.push(listener);
  return {
    dispose() {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
}

function document(path: string, languageId = 'markdown'): TestDocument {
  return {
    languageId,
    fileName: path,
    uri: {
      fsPath: path,
      scheme: 'file',
      toString: () => `file://${path}`,
    },
  };
}

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private readonly listeners: Listener<T>[] = [];
    public readonly event = (listener: Listener<T>) => subscribe(this.listeners, listener);
    public fire(value: T) {
      this.listeners.slice().forEach((listener) => listener(value));
    }
    public dispose() {
      this.listeners.splice(0);
    }
  }

  class TreeItem {
    constructor(public label: string, public collapsibleState?: number) {}
  }

  class ThemeIcon {
    constructor(public id: string) {}
  }

  return {
    EventEmitter,
    TreeItem,
    ThemeIcon,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { One: 1, Beside: 2 },
    Uri: {
      file: (fsPath: string) => ({ fsPath, scheme: 'file', toString: () => `file://${fsPath}` }),
      parse: (value: string) => ({
        fsPath: value.replace(/^file:\/\//, ''),
        scheme: 'file',
        toString: () => value,
      }),
      joinPath: (base: { toString(): string }, ...parts: string[]) => ({
        toString: () => `${base.toString()}/${parts.join('/')}`,
      }),
    },
    commands: { executeCommand: host.executeCommand },
    workspace: {
      openTextDocument: vi.fn(),
      asRelativePath: (uri: { fsPath: string }) => uri.fsPath,
    },
    window: {
      get activeTextEditor() {
        return host.activeTextEditor;
      },
      createWebviewPanel: () => ({
        title: '',
        reveal: host.reveal,
        onDidDispose: vi.fn(() => ({ dispose() {} })),
        webview: {
          cspSource: 'test-webview',
          html: '',
          asWebviewUri: (uri: { toString(): string }) => uri,
          postMessage: host.postMessage,
          onDidReceiveMessage: (listener: Listener<Record<string, unknown>>) => {
            host.webviewMessageListener = listener;
            return { dispose() {} };
          },
        },
      }),
      onDidChangeActiveTextEditor: (listener: Listener<{ document: TestDocument } | undefined>) =>
        subscribe(host.activeEditorListeners, listener),
      showTextDocument: vi.fn(),
      showErrorMessage: vi.fn(),
    },
  };
});

vi.mock('../src/services/LinkGraphGenerator', () => ({
  LinkGraphGenerator: {
    getInstance: () => ({ generateSimplifiedGraph: host.generateSimplifiedGraph }),
  },
}));

vi.mock('../src/app/_utils', () => ({
  getWebviewOptions: () => ({}),
  getNonce: () => 'test-nonce',
}));

vi.mock('../src/utils/Logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/sidebar/MarkdownSidebarContext', () => ({
  MarkdownSidebarContext: {
    getCurrentActiveDocument: () => host.graphDocument,
    onDidChangeActiveDocument: (listener: Listener<TestDocument | undefined>) =>
      subscribe(host.graphListeners, listener),
  },
}));

vi.mock('../src/app/EditorPanel', () => ({
  EditorPanel: {
    currentPanel: undefined,
    editors: [],
    onDidChangeActiveDocument: (listener: Listener<TestDocument | undefined>) =>
      subscribe(host.editorPanelListeners, listener),
  },
}));

import { GraphViewPanel } from '../src/app/GraphViewPanel';
import { MarkdownMiniGraphViewProvider } from '../src/sidebar/MarkdownNativeViews';

const extensionUri = { toString: () => 'file:///extension' };
const extensionContext = {
  extensionUri,
  workspaceState: {
    get: vi.fn(),
    update: vi.fn(),
  },
};

describe('GraphViewPanel active document behavior', () => {
  beforeEach(() => {
    host.reset();
    extensionContext.workspaceState.get.mockReset();
    extensionContext.workspaceState.update.mockReset();
  });

  afterEach(() => {
    GraphViewPanel.currentPanel?.dispose();
  });

  it('prefers the sidebar context document over the active VS Code editor', async () => {
    const sidebarDocument = document('/workspace/sidebar.md');
    const textEditorDocument = document('/workspace/editor.md');
    host.graphDocument = sidebarDocument;
    host.activeTextEditor = { document: textEditorDocument };

    await GraphViewPanel.createOrShow(extensionContext as never);
    await host.webviewMessageListener?.({ command: 'ready' });

    expect(host.postMessage).toHaveBeenCalledWith({
      type: 'controlsState',
      data: { depth: 2, maxNodes: 100, showDirectLinksOnly: false },
    });
    expect(host.generateSimplifiedGraph).toHaveBeenCalledWith(sidebarDocument.uri, 2, 100);
    expect(host.generateSimplifiedGraph).not.toHaveBeenCalledWith(textEditorDocument.uri, 2, 100);
  });

  it('regenerates an open graph when the sidebar publishes a new markdown document', async () => {
    const initialDocument = document('/workspace/initial.md');
    const nextDocument = document('/workspace/next.md');
    host.graphDocument = initialDocument;
    await GraphViewPanel.createOrShow(extensionContext as never);
    host.generateSimplifiedGraph.mockClear();

    await Promise.all(host.graphListeners.map((listener) => listener(nextDocument)));

    expect(host.generateSimplifiedGraph).toHaveBeenCalledOnce();
    expect(host.generateSimplifiedGraph).toHaveBeenCalledWith(nextDocument.uri, 2, 100);
  });

  it('ignores direct editor events after the sidebar selects the active document', async () => {
    const sidebarDocument = document('/workspace/sidebar.md');
    const conflictingDocument = document('/workspace/conflicting-editor.md');
    host.graphDocument = sidebarDocument;
    await GraphViewPanel.createOrShow(extensionContext as never);
    host.generateSimplifiedGraph.mockClear();

    await Promise.all(host.activeEditorListeners.map((listener) =>
      listener({ document: conflictingDocument }),
    ));

    expect(host.generateSimplifiedGraph).not.toHaveBeenCalled();
  });
});

describe('MarkdownMiniGraphViewProvider', () => {
  beforeEach(() => {
    host.reset();
    extensionContext.workspaceState.get.mockReset();
    extensionContext.workspaceState.update.mockReset();
  });

  it('opens the full graph with the active document URI and current graph options', async () => {
    const activeDocument = document('/workspace/active-note.md');
    extensionContext.workspaceState.get.mockReturnValue({ depth: 3, maxNodes: 42 });
    const sidebarContext = {
      onDidChange: vi.fn(() => ({ dispose() {} })),
      getActiveDocument: vi.fn(() => activeDocument),
      getGraphData: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    };
    const provider = new MarkdownMiniGraphViewProvider(
      extensionContext as never,
      sidebarContext as never,
    );
    const view = {
      webview: {
        cspSource: 'test-webview',
        options: {},
        html: '',
        postMessage: host.postMessage,
        onDidReceiveMessage: (listener: Listener<Record<string, unknown>>) => {
          host.webviewMessageListener = listener;
          return { dispose() {} };
        },
      },
    };
    provider.resolveWebviewView(view as never, {} as never, {} as never);

    await host.webviewMessageListener?.({ command: 'openGraphView' });

    expect(host.executeCommand).toHaveBeenCalledWith('markdown-editor.openGraphView', {
      docUri: activeDocument.uri.toString(),
      depth: 3,
      maxNodes: 42,
      showDirectLinksOnly: false,
    });
  });
});
