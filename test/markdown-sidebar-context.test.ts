import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Disposable = { dispose(): void };
type Listener<T> = (value: T) => void;

const host = vi.hoisted(() => {
  const activeEditorListeners: Array<Listener<unknown>> = [];
  const visibleEditorListeners: Array<Listener<unknown[]>> = [];
  const documentChangeListeners: Array<Listener<unknown>> = [];
  const activeDocumentListeners: Array<Listener<unknown>> = [];

  return {
    activeEditorListeners,
    visibleEditorListeners,
    documentChangeListeners,
    activeDocumentListeners,
    activeTextEditor: undefined as unknown,
    visibleTextEditors: [] as unknown[],
    navigationPort: {
      previewEmbed: vi.fn().mockResolvedValue(undefined),
    },
    reset() {
      activeEditorListeners.splice(0);
      visibleEditorListeners.splice(0);
      documentChangeListeners.splice(0);
      activeDocumentListeners.splice(0);
      this.activeTextEditor = undefined;
      this.visibleTextEditors = [];
      this.navigationPort.previewEmbed.mockReset();
      this.navigationPort.previewEmbed.mockResolvedValue(undefined);
    },
  };
});

function subscribe<T>(listeners: Array<Listener<T>>, listener: Listener<T>): Disposable {
  listeners.push(listener);
  return {
    dispose() {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
}

vi.mock('vscode', () => {
  class EventEmitter<T> {
    private readonly listeners: Array<Listener<T>> = [];

    public readonly event = (listener: Listener<T>): Disposable =>
      subscribe(this.listeners, listener);

    public fire(value: T): void {
      this.listeners.slice().forEach((listener) => listener(value));
    }

    public dispose(): void {
      this.listeners.splice(0);
    }
  }

  return {
    EventEmitter,
    commands: {
      executeCommand: vi.fn().mockResolvedValue(undefined),
    },
    Uri: {
      file: (fsPath: string) => ({
        fsPath,
        scheme: 'file',
        toString: () => `file://${fsPath}`,
      }),
    },
    window: {
      get activeTextEditor() {
        return host.activeTextEditor;
      },
      get visibleTextEditors() {
        return host.visibleTextEditors;
      },
      onDidChangeActiveTextEditor: (listener: Listener<unknown>) =>
        subscribe(host.activeEditorListeners, listener),
      onDidChangeVisibleTextEditors: (listener: Listener<unknown[]>) =>
        subscribe(host.visibleEditorListeners, listener),
    },
    workspace: {
      onDidChangeTextDocument: (listener: Listener<unknown>) =>
        subscribe(host.documentChangeListeners, listener),
    },
  };
});

vi.mock('../src/runtime/ActiveDocumentContext', () => ({
  ActiveDocumentContext: class {
    public activeDocument: TestDocument | undefined;
    public readonly onDidChangeActiveDocument = (listener: Listener<unknown>) =>
      subscribe(host.activeDocumentListeners, listener);

    constructor() {
      this.activeDocument = undefined;
      const active = host.activeTextEditor as { document: TestDocument } | undefined;
      if (active?.document.languageId === 'markdown') {
        this.activeDocument = active.document;
      } else {
        this.activeDocument = (host.visibleTextEditors.find(
          (editor) => (editor as { document: TestDocument }).document.languageId === 'markdown',
        ) as { document: TestDocument } | undefined)?.document;
      }
      subscribe(host.activeEditorListeners, (value) => {
        const editor = value as { document: TestDocument } | undefined;
        this.setActiveDocument(editor?.document.languageId === 'markdown' ? editor.document : undefined);
      });
      subscribe(host.visibleEditorListeners, (editors) => {
        const markdownEditor = editors.find(
          (editor) => (editor as { document: TestDocument }).document.languageId === 'markdown',
        ) as { document: TestDocument } | undefined;
        this.setActiveDocument(markdownEditor?.document);
      });
    }

    public setActiveDocument(document: TestDocument | undefined): void {
      if (this.activeDocument?.uri.toString() === document?.uri.toString()) return;
      this.activeDocument = document;
      host.activeDocumentListeners.slice().forEach((listener) => listener(document));
    }

    public dispose(): void {}
  },
}));

const relationshipAnalyzer = vi.hoisted(() => {
  const cacheStatusSubscription = { dispose: vi.fn() };
  return {
    cacheStatusSubscription,
    onCacheStatusChange: vi.fn(() => cacheStatusSubscription),
    getCacheStatus: vi.fn(),
  };
});

vi.mock('../src/services', () => ({
  DefaultEditorChecker: { getInstance: () => ({ isDefaultEditor: vi.fn() }) },
  LinkGraphGenerator: { getInstance: () => ({}) },
  RelationshipAnalyzer: { getInstance: () => relationshipAnalyzer },
  TemplateManager: {
    getInstance: () => ({
      loadUserTemplates: vi.fn().mockResolvedValue(undefined),
      getAllTemplates: vi.fn(() => []),
    }),
  },
}));

vi.mock('../src/services/RelationshipAnalyzer', () => ({
  RelationshipAnalyzer: { getInstance: () => relationshipAnalyzer },
}));

vi.mock('../src/services/TagManager', () => ({
  TagManager: {
    getInstance: () => ({ getAllTags: vi.fn(() => []) }),
    extractTagsFromText: vi.fn(() => []),
  },
}));

import { MarkdownSidebarContext } from '../src/sidebar/MarkdownSidebarContext';

interface TestDocument {
  languageId: string;
  fileName: string;
  uri: {
    path: string;
    fsPath: string;
    scheme: string;
    toString(): string;
  };
  getText(): string;
}

function document(path: string, languageId = 'markdown', scheme = 'file'): TestDocument {
  return {
    languageId,
    fileName: path,
    uri: {
      path,
      fsPath: path,
      scheme,
      toString: () => `${scheme}://${path}`,
    },
    getText: () => '',
  };
}

function editor(doc: TestDocument): { document: TestDocument } {
  return { document: doc };
}

function createContextWithNavigationPort(navigationPort: unknown): MarkdownSidebarContext {
  const Context = MarkdownSidebarContext as unknown as new (...args: unknown[]) => MarkdownSidebarContext;
  return new Context({} as never, { editorNavigation: navigationPort });
}

describe('MarkdownSidebarContext active document transitions', () => {
  let context: MarkdownSidebarContext | undefined;

  beforeEach(() => {
    host.reset();
    relationshipAnalyzer.cacheStatusSubscription.dispose.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    context?.dispose();
    context = undefined;
  });

  it('starts with the active Markdown text editor and publishes it', () => {
    const activeDocument = document('/workspace/active.md');
    const visibleDocument = document('/workspace/visible.md');
    host.activeTextEditor = editor(activeDocument);
    host.visibleTextEditors = [editor(visibleDocument)];
    const published: unknown[] = [];
    const subscription = subscribe(host.activeDocumentListeners, (value) =>
      published.push(value),
    );

    context = new MarkdownSidebarContext({} as never);

    expect(context.getActiveDocument()).toBe(activeDocument);
    expect(published).toEqual([]);
    subscription.dispose();
  });

  it('falls back to a visible Markdown editor when the active editor is not Markdown', () => {
    const visibleDocument = document('/workspace/visible.md');
    host.activeTextEditor = editor(document('/workspace/code.ts', 'typescript'));
    host.visibleTextEditors = [
      editor(document('/workspace/code.ts', 'typescript')),
      editor(visibleDocument),
    ];

    context = new MarkdownSidebarContext({} as never);

    expect(context.getActiveDocument()).toBe(visibleDocument);
  });

  it('tracks an active Markdown text editor and clears for an active non-Markdown file', () => {
    context = new MarkdownSidebarContext({} as never);
    const markdownDocument = document('/workspace/new-active.md');
    const changes = vi.fn();
    context.onDidChange(changes);

    host.activeEditorListeners[0](editor(markdownDocument));
    expect(context.getActiveDocument()).toBe(markdownDocument);

    host.activeEditorListeners[0](editor(document('/workspace/code.ts', 'typescript')));
    expect(context.getActiveDocument()).toBeUndefined();
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('uses a visible Markdown editor and clears it when no Markdown editor remains visible', () => {
    context = new MarkdownSidebarContext({} as never);
    const markdownDocument = document('/workspace/visible.md');

    host.visibleEditorListeners[0]([editor(markdownDocument)]);
    expect(context.getActiveDocument()).toBe(markdownDocument);

    host.activeTextEditor = editor(document('/workspace/code.ts', 'typescript'));
    host.visibleEditorListeners[0]([editor(document('/workspace/code.ts', 'typescript'))]);
    expect(context.getActiveDocument()).toBeUndefined();
  });

  it('tracks and clears documents published by the application active-document context', () => {
    context = new MarkdownSidebarContext({} as never);
    const customEditorDocument = document('/workspace/custom.md');
    const published: unknown[] = [];
    const subscription = subscribe(host.activeDocumentListeners, (value) =>
      published.push(value),
    );

    const activeContext = (context as unknown as { activeDocumentContext: { setActiveDocument(value: unknown): void } }).activeDocumentContext;
    activeContext.setActiveDocument(customEditorDocument);
    expect(context.getActiveDocument()).toBe(customEditorDocument);

    activeContext.setActiveDocument(undefined);
    expect(context.getActiveDocument()).toBeUndefined();
    expect(published).toEqual([customEditorDocument, undefined]);
    subscription.dispose();
  });

  it('converges text-editor, visible-editor, and custom-editor signals on one public stream', () => {
    context = new MarkdownSidebarContext({} as never);
    const textEditorDocument = document('/workspace/text-editor.md');
    const customEditorDocument = document('/workspace/custom-editor.md');
    const visibleEditorDocument = document('/workspace/visible-editor.md');
    const published: unknown[] = [];
    const subscription = subscribe(host.activeDocumentListeners, (value) =>
      published.push(value),
    );

    host.activeEditorListeners[0](editor(textEditorDocument));
    const activeContext = (context as unknown as { activeDocumentContext: { setActiveDocument(value: unknown): void } }).activeDocumentContext;
    activeContext.setActiveDocument(customEditorDocument);
    host.visibleEditorListeners[0]([editor(visibleEditorDocument)]);

    expect(context.getActiveDocument()).toBe(visibleEditorDocument);
    expect(published).toEqual([
      textEditorDocument,
      customEditorDocument,
      visibleEditorDocument,
    ]);
    subscription.dispose();
  });

  it('routes embed preview through the public navigation seam', async () => {
    const activeDocument = document('/workspace/active.md');
    host.activeTextEditor = editor(activeDocument);
    const embed = { raw: 'diagram.png', resolved: '/workspace/diagram.png' };
    const navigationPort = host.navigationPort;
    context = createContextWithNavigationPort(navigationPort);

    await context.previewEmbed(embed);

    expect(navigationPort.previewEmbed).toHaveBeenCalledOnce();
    expect(navigationPort.previewEmbed).toHaveBeenCalledWith(activeDocument, {
      path: embed.resolved,
      raw: embed.raw,
    });
  });

  it('disposes the relationship-cache status subscription with the sidebar context', () => {
    context = new MarkdownSidebarContext({} as never);
    const cacheStatusSubscription = relationshipAnalyzer.cacheStatusSubscription;

    context.dispose();

    expect(cacheStatusSubscription.dispose).toHaveBeenCalledOnce();
  });
});
