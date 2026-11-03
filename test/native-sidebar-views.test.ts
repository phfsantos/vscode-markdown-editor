import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { __reset } from './mocks/vscode';

// The sidebar manager is exercised through the VS Code registration seam: the
// tree and webview-view providers it registers are captured and driven the way
// the workbench drives them.
const host = vi.hoisted(() => ({
  treeProviders: new Map<string, { getChildren(element?: unknown): Promise<unknown[]> }>(),
  webviewViewProviders: new Map<string, { resolveWebviewView(view: unknown, context: unknown, token: unknown): void }>(),
  executed: [] as Array<{ command: string; args: unknown[] }>,
  workspaceState: new Map<string, unknown>(),
}));

vi.mock('vscode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mocks/vscode')>();
  return {
    ...actual,
    ThemeIcon: class { constructor(public id: string) {} },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    commands: {
      ...actual.commands,
      executeCommand: vi.fn(async (command: string, ...args: unknown[]) => {
        host.executed.push({ command, args });
      }),
    },
    window: {
      ...actual.window,
      createTreeView: vi.fn((viewId: string, options: { treeDataProvider: never }) => {
        host.treeProviders.set(viewId, options.treeDataProvider);
        return { dispose() {}, message: undefined, description: undefined };
      }),
      registerWebviewViewProvider: vi.fn((viewId: string, provider: never) => {
        host.webviewViewProviders.set(viewId, provider);
        return { dispose() {} };
      }),
    },
  };
});

const sidebarContext = vi.hoisted(() => ({
  activeDocument: undefined as undefined | { uri: { fsPath: string; toString(): string } },
  isDefaultEditor: true,
}));

vi.mock('../src/sidebar/MarkdownSidebarContext', () => ({
  MarkdownSidebarContext: class {
    public onDidChange = () => ({ dispose() {} });
    public onDidChangeCacheStatus = () => ({ dispose() {} });
    public getActiveDocument() { return sidebarContext.activeDocument; }
    public isDefaultEditor() { return sidebarContext.isDefaultEditor; }
    public getCacheStatus() { return { isBuilding: false, cacheSize: 3, buildProgress: null, ttl: 1 }; }
    public async getGraphData() { return { nodes: [], edges: [] }; }
    public refresh() {}
    public dispose() {}
  },
}));

import { MarkdownSidebarManager } from '../src/sidebar/MarkdownNativeViews';

interface TestItem {
  label: string;
  contextValue?: string;
  command?: { command: string };
}

function extensionContext() {
  return {
    extensionUri: vscode.Uri.file('/extension'),
    workspaceState: {
      get: (key: string) => host.workspaceState.get(key),
      update: vi.fn(async (key: string, value: unknown) => { host.workspaceState.set(key, value); }),
    },
  };
}

function createManager() {
  return new MarkdownSidebarManager(extensionContext() as never, {} as never);
}

function resolveMiniGraph() {
  let receive: ((message: unknown) => Promise<void>) | undefined;
  const view = {
    webview: {
      options: {} as Record<string, unknown>,
      html: '',
      cspSource: 'test-webview',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(async () => true),
      onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose() {} }; },
    },
  };
  host.webviewViewProviders.get('markdown-sidebar-graph')!.resolveWebviewView(view, {}, {});
  return { view, send: (message: unknown) => receive!(message) };
}

beforeEach(() => {
  __reset();
  host.treeProviders.clear();
  host.webviewViewProviders.clear();
  host.executed.length = 0;
  host.workspaceState.clear();
  sidebarContext.isDefaultEditor = true;
  sidebarContext.activeDocument = {
    uri: { fsPath: '/workspace/note.md', toString: () => 'file:///workspace/note.md' },
  };
});

describe('status view inline suggestion toggle', () => {
  it.each([
    [false, 'AI auto-complete suggestions are disabled'],
    [true, 'AI auto-complete suggestions are enabled'],
  ])('reflects the setting %s and offers the toggle command', async (enabled, label) => {
    __reset({ config: { 'ai.enableInlineSuggestions': enabled } });
    createManager();

    const items = (await host.treeProviders.get('markdown-sidebar-status')!.getChildren()) as TestItem[];
    const toggle = items.find((item) => item.contextValue === 'inlineSuggestionToggle');

    expect(toggle?.label).toBe(label);
    expect(toggle?.command?.command).toBe('markdown-editor.toggleInlineSuggestions');
  });
});

describe('status view default-editor item', () => {
  it('offers Markdown Studio as the default editor through the stable command ID', async () => {
    sidebarContext.isDefaultEditor = false;
    createManager();

    const items = (await host.treeProviders.get('markdown-sidebar-status')!.getChildren()) as TestItem[];
    const warning = items.find((item) => item.contextValue === 'defaultEditorWarning');

    expect(warning?.label).toBe('Set Markdown Studio as the default Markdown editor');
    expect(warning?.command).toMatchObject({
      command: 'markdown-editor.setAsDefaultEditor',
      title: 'Set Markdown Studio as Default',
    });
  });

  it('reports Markdown Studio as the configured default', async () => {
    createManager();

    const items = (await host.treeProviders.get('markdown-sidebar-status')!.getChildren()) as TestItem[];

    expect(items.some((item) => item.label === 'Markdown Studio is the default Markdown editor')).toBe(true);
  });
});

describe('mini graph view', () => {
  it('restricts resources to the extension and does not retain hidden context', () => {
    createManager();

    const { view } = resolveMiniGraph();

    expect(view.webview.options).toEqual({
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file('/extension')],
    });
    expect(view.webview.options).not.toHaveProperty('retainContextWhenHidden');
  });

  it('renders no node-distance control', () => {
    createManager();

    const { view } = resolveMiniGraph();

    expect(view.webview.html).not.toMatch(/nodeDistance|node-distance|distanceRange|distanceValue/);
  });

  it('opens the full graph for the active document with its current options', async () => {
    createManager();
    const { send } = resolveMiniGraph();

    await send({ command: 'openGraphView' });

    expect(host.executed).toContainEqual({
      command: 'markdown-editor.openGraphView',
      args: [{ docUri: 'file:///workspace/note.md', depth: 1, maxNodes: 15, showDirectLinksOnly: true }],
    });
  });

  it('persists option changes per workspace and applies them to later graph requests', async () => {
    createManager();
    const { send } = resolveMiniGraph();

    await send({ command: 'updateOptions', options: { depth: 2, maxNodes: 30 } });
    await send({ command: 'openGraphView' });

    expect(host.workspaceState.get('markdown-editor.sidebar.graph.options')).toEqual({ depth: 2, maxNodes: 30 });
    expect(host.executed.at(-1)?.args[0]).toMatchObject({ depth: 2, maxNodes: 30, showDirectLinksOnly: false });
  });

  it('restores persisted options when the sidebar is recreated', async () => {
    host.workspaceState.set('markdown-editor.sidebar.graph.options', { depth: 3, maxNodes: 40 });
    createManager();
    const { send } = resolveMiniGraph();

    await send({ command: 'openGraphView' });

    expect(host.executed.at(-1)?.args[0]).toMatchObject({ depth: 3, maxNodes: 40 });
  });

  it('opens a node file in the editor', async () => {
    createManager();
    const { send } = resolveMiniGraph();

    await send({ command: 'openFile', filePath: '/workspace/linked.md' });

    expect(host.executed).toContainEqual({ command: 'vscode.open', args: [vscode.Uri.file('/workspace/linked.md')] });
  });
});

describe('sidebar manifest contributions', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const menus = packageJson.contributes.menus ?? {};
  const titleMenus: Array<{ command: string; when?: string }> = menus['view/title'] ?? [];
  const itemMenus: Array<{ command: string; when?: string }> = menus['view/item/context'] ?? [];

  it('contributes sidebar-specific title or item menus', () => {
    const sidebarEntries = [...titleMenus, ...itemMenus].filter((entry) => {
      const when = String(entry.when ?? '');
      return when.includes('markdown-sidebar') || when.includes('markdown-tools') || when.includes('viewItem');
    });

    expect(sidebarEntries.length).toBeGreaterThan(0);
  });

  it('offers the inline suggestion toggle from the status view title and item', () => {
    expect(titleMenus.some((entry) => entry.command === 'markdown-editor.toggleInlineSuggestions')).toBe(true);
    expect(itemMenus.some((entry) => entry.command === 'markdown-editor.toggleInlineSuggestions')).toBe(true);
  });
});
