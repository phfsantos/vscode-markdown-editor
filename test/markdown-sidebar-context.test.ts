import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Disposable = { dispose(): void };
type Listener<T> = (value: T) => void;

const host = vi.hoisted(() => {
  const activeEditorListeners: Array<Listener<unknown>> = [];
  const visibleEditorListeners: Array<Listener<unknown[]>> = [];
  const documentChangeListeners: Array<Listener<unknown>> = [];
  const editorPanelListeners: Array<Listener<unknown>> = [];

  return {
    activeEditorListeners,
    visibleEditorListeners,
    documentChangeListeners,
    editorPanelListeners,
    activeTextEditor: undefined as unknown,
    visibleTextEditors: [] as unknown[],
    reset() {
      activeEditorListeners.splice(0);
      visibleEditorListeners.splice(0);
      documentChangeListeners.splice(0);
      editorPanelListeners.splice(0);
      this.activeTextEditor = undefined;
      this.visibleTextEditors = [];
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

const relationshipAnalyzer = vi.hoisted(() => ({
  onCacheStatusChange: vi.fn(() => ({ dispose() {} })),
  getCacheStatus: vi.fn(),
}));

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

vi.mock('../src/app/EditorPanel', () => ({
  EditorPanel: {
    onDidChangeActiveDocument: (listener: Listener<unknown>) =>
      subscribe(host.editorPanelListeners, listener),
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

describe('MarkdownSidebarContext active document transitions', () => {
  let context: MarkdownSidebarContext | undefined;

  beforeEach(() => {
    host.reset();
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
    const subscription = MarkdownSidebarContext.onDidChangeActiveDocument((value) =>
      published.push(value),
    );

    context = new MarkdownSidebarContext({} as never);

    expect(context.getActiveDocument()).toBe(activeDocument);
    expect(MarkdownSidebarContext.getCurrentActiveDocument()).toBe(activeDocument);
    expect(published).toEqual([activeDocument]);
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

  it('tracks and clears documents published by EditorPanel', () => {
    context = new MarkdownSidebarContext({} as never);
    const customEditorDocument = document('/workspace/custom.md');
    const published: unknown[] = [];
    const subscription = MarkdownSidebarContext.onDidChangeActiveDocument((value) =>
      published.push(value),
    );

    host.editorPanelListeners[0](customEditorDocument);
    expect(context.getActiveDocument()).toBe(customEditorDocument);

    host.editorPanelListeners[0](document('/workspace/not-markdown.txt', 'plaintext'));
    expect(context.getActiveDocument()).toBeUndefined();
    expect(published).toEqual([customEditorDocument, undefined]);
    subscription.dispose();
  });
});
