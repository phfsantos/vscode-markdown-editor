import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Whole-tree syntax scans are slow under coverage instrumentation.
vi.setConfig({ testTimeout: 30_000 });

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(rootDirectory, 'src');

const SHARED_SERVICES = [
  'RelationshipAnalyzer',
  'LinkGraphGenerator',
  'AIMarkdownWorkflowService',
  'WikiLinkCompletionProvider',
];

const created = vi.hoisted(() => ({
  analyzers: [] as unknown[],
  graphs: [] as Array<{ analyzer: unknown }>,
  aiWorkflows: [] as Array<{ analyzer: unknown; graphGenerator: unknown }>,
  completions: [] as Array<{ analyzer: unknown }>,
  sidebarDependencies: [] as Array<Record<string, unknown>>,
  providerDependencies: [] as Array<Record<string, unknown>>,
}));

vi.mock('../src/services/RelationshipAnalyzer', () => ({
  RelationshipAnalyzer: class {
    public constructor() {
      created.analyzers.push(this);
    }
    public dispose(): void {}
  },
}));

vi.mock('../src/services/LinkGraphGenerator', () => ({
  LinkGraphGenerator: class {
    public constructor(public readonly analyzer: unknown) {
      created.graphs.push(this);
    }
  },
}));

vi.mock('../src/services/AIMarkdownWorkflowService', () => ({
  AIMarkdownWorkflowService: class {
    public constructor(public readonly analyzer: unknown, public readonly graphGenerator: unknown) {
      created.aiWorkflows.push(this);
    }
  },
}));

vi.mock('../src/providers/WikiLinkCompletionProvider', () => ({
  WikiLinkCompletionProvider: class {
    public constructor(public readonly analyzer: unknown) {
      created.completions.push(this);
    }
    public dispose(): void {}
  },
}));

vi.mock('../src/sidebar/MarkdownNativeViews', () => ({
  MarkdownSidebarManager: class {
    public constructor(_context: unknown, dependencies: Record<string, unknown>) {
      created.sidebarDependencies.push(dependencies);
    }
    public dispose(): void {}
  },
}));

vi.mock('../src/app/PreviewCustomEditorProvider', () => ({
  PreviewCustomEditorProvider: class {
    public constructor(_context: unknown, dependencies: Record<string, unknown>) {
      created.providerDependencies.push(dependencies);
    }
  },
}));

vi.mock('../src/app/EditorPanel', () => ({ EditorPanel: { editors: [] } }));
vi.mock('../src/app/GraphViewPanel', () => ({ GraphViewPanel: { createOrShow: vi.fn() } }));
vi.mock('../src/diff/MarkdownDiffViewSupport', () => ({
  MarkdownDiffViewSupport: class { public dispose(): void {} },
}));
vi.mock('../src/navigation/MarkdownEditorNavigation', () => ({
  MarkdownEditorNavigation: class { public dispose(): void {} },
}));
vi.mock('../src/runtime/ActiveDocumentContext', () => ({
  ActiveDocumentContext: class { public readonly onDidChangeActiveDocument = () => ({ dispose() {} }); public dispose(): void {} },
}));

function listSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    return entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

interface SingletonUse {
  file: string;
  line: number;
  text: string;
}

function findSingletonUses(): SingletonUse[] {
  const uses: SingletonUse[] = [];
  for (const file of listSourceFiles(sourceDirectory)) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      const isServiceCall =
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'getInstance' &&
        ts.isIdentifier(node.expression.expression) &&
        SHARED_SERVICES.includes(node.expression.expression.text);
      const isServiceAccessor =
        ts.isMethodDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'getInstance' &&
        ts.isClassDeclaration(node.parent) &&
        SHARED_SERVICES.includes(node.parent.name?.text ?? '');
      if (isServiceCall || isServiceAccessor) {
        uses.push({
          file: path.relative(rootDirectory, file),
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          text: node.getText().split('\n')[0],
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return uses;
}

function extensionContext() {
  return {
    extensionUri: { fsPath: '/extension', toString: () => 'file:///extension' },
    subscriptions: [],
    workspaceState: { get: vi.fn(), update: vi.fn() },
    globalState: { get: vi.fn(), update: vi.fn() },
  };
}

describe('relationship service ownership', () => {
  beforeEach(() => {
    created.analyzers.length = 0;
    created.graphs.length = 0;
    created.aiWorkflows.length = 0;
    created.completions.length = 0;
    created.sidebarDependencies.length = 0;
    created.providerDependencies.length = 0;
  });

  it('exposes no process-wide accessor for activation-scoped services', () => {
    const uses = findSingletonUses();
    expect(
      uses,
      uses.map((use) => `${use.file}:${use.line} ${use.text}`).join('\n'),
    ).toEqual([]);
  });

  it('creates exactly one relationship analyzer and graph generator per activation', async () => {
    const { ExtensionRuntime } = await import('../src/runtime/ExtensionRuntime');

    const runtime = new ExtensionRuntime(extensionContext() as never);

    expect(created.analyzers).toHaveLength(1);
    expect(created.graphs).toHaveLength(1);
    expect(created.aiWorkflows).toHaveLength(1);
    expect(created.completions).toHaveLength(1);
    runtime.dispose();
  });

  it('shares the activation analyzer and graph with every consumer', async () => {
    const { ExtensionRuntime } = await import('../src/runtime/ExtensionRuntime');

    const runtime = new ExtensionRuntime(extensionContext() as never);
    runtime.createPreviewCustomEditorProvider();
    const [analyzer] = created.analyzers;
    const [graph] = created.graphs;
    const [aiWorkflow] = created.aiWorkflows;

    expect(graph.analyzer).toBe(analyzer);
    expect(aiWorkflow.analyzer).toBe(analyzer);
    expect(aiWorkflow.graphGenerator).toBe(graph);
    expect(created.completions[0].analyzer).toBe(analyzer);
    expect(created.sidebarDependencies[0]).toMatchObject({ relationshipAnalyzer: analyzer, graphGenerator: graph });
    expect(runtime.graphViewDependencies.graphGenerator).toBe(graph);
    expect(created.providerDependencies[0]).toMatchObject({ relatedFiles: analyzer, aiWorkflow });
    expect(runtime.aiWorkflow).toBe(aiWorkflow);
    expect(runtime.wikiLinkCompletion).toBe(created.completions[0]);
    runtime.dispose();
  });

  it('gives a second activation its own service graph', async () => {
    const { ExtensionRuntime } = await import('../src/runtime/ExtensionRuntime');

    const first = new ExtensionRuntime(extensionContext() as never);
    const second = new ExtensionRuntime(extensionContext() as never);

    expect(created.analyzers).toHaveLength(2);
    expect(created.analyzers[0]).not.toBe(created.analyzers[1]);
    expect(created.aiWorkflows[1].analyzer).toBe(created.analyzers[1]);
    first.dispose();
    second.dispose();
  });
});
