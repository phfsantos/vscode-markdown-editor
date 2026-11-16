import * as vscode from 'vscode';
import { AgentActivityRegistry } from '../integration/AgentActivityRegistry';
import { AgentActivityApi } from '../integration/AgentActivityApi';
import { AgentActivityDecorations } from '../integration/AgentActivityDecorations';
import { MarkdownStudioApiService } from '../integration/MarkdownStudioApiService';
import type { MarkdownStudioApiV1 } from '../integration/MarkdownStudioApi';
import { MarkdownDiffViewSupport } from '../diff/MarkdownDiffViewSupport';
import {
  EditorPanel,
  type EditorPanelDependencies,
} from '../app/EditorPanel';
import { PreviewCustomEditorProvider } from '../app/PreviewCustomEditorProvider';
import { GraphViewPanel, type GraphViewPanelDependencies } from '../app/GraphViewPanel';
import { LinkGraphGenerator } from '../services/LinkGraphGenerator';
import { RelationshipAnalyzer } from '../services/RelationshipAnalyzer';
import { AIMarkdownWorkflowService } from '../services/AIMarkdownWorkflowService';
import { WikiLinkCompletionProvider } from '../providers/WikiLinkCompletionProvider';
import {
  MarkdownSidebarManager,
} from '../sidebar/MarkdownNativeViews';
import { EditorContextRegistry } from './EditorContextRegistry';
import { ActiveDocumentContext } from './ActiveDocumentContext';
import { MarkdownEditorNavigation } from '../navigation/MarkdownEditorNavigation';
import type {
  ActiveDocumentEvents,
  DiffCoordinator,
  EditorNavigationPreviewPort,
  EditorOpenOptions,
} from '../contracts/ports';

export interface ExtensionRuntimeOptions {
  context?: vscode.ExtensionContext;
  diffCoordinator?: vscode.Disposable & Partial<DiffCoordinator>;
  editorNavigation?: vscode.Disposable & Partial<EditorNavigationPreviewPort>;
  activeDocument?: vscode.Disposable & Partial<ActiveDocumentEvents>;
  relationshipAnalyzer?: vscode.Disposable;
  disposables?: vscode.Disposable[];
}

export class ExtensionRuntime implements vscode.Disposable {
  public readonly diffCoordinator: DiffCoordinator;
  public readonly editorNavigation: EditorNavigationPreviewPort;
  public readonly activeDocument: ActiveDocumentEvents;
  public readonly editorContext?: EditorContextRegistry;
  public readonly api?: MarkdownStudioApiV1;
  public readonly agentActivity?: AgentActivityRegistry;
  public readonly relationshipAnalyzer: RelationshipAnalyzer | vscode.Disposable;
  /** Activation-scoped services; created only when constructed from an extension context. */
  public readonly graphGenerator?: LinkGraphGenerator;
  public readonly aiWorkflow?: AIMarkdownWorkflowService;
  public readonly wikiLinkCompletion?: WikiLinkCompletionProvider;
  public readonly sidebarManager?: MarkdownSidebarManager;

  private readonly context?: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly ownedResources: vscode.Disposable[] = [];
  private disposed = false;
  private editorPanelDependencies?: EditorPanelDependencies;

  public constructor(contextOrOptions: vscode.ExtensionContext | ExtensionRuntimeOptions) {
    if (this.isExtensionContext(contextOrOptions)) {
      this.context = contextOrOptions;

      const editorContext = new EditorContextRegistry();
      this.editorContext = editorContext;
      const agentActivity = new AgentActivityRegistry({
        getDocument: uri => vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString()),
      });
      this.disposables.push(
        vscode.workspace.onDidChangeTextDocument(event => agentActivity.documentChanged(event.document.uri, event.document, event.contentChanges)),
        vscode.workspace.onDidCloseTextDocument(document => agentActivity.documentClosed(document.uri)),
        vscode.workspace.onDidDeleteFiles(event => event.files.forEach(uri => agentActivity.clearUri(uri))),
        vscode.workspace.onDidRenameFiles(event => event.files.forEach(file => agentActivity.clearUri(file.oldUri))),
      );
      this.agentActivity = agentActivity;
      const activityApi = new AgentActivityApi(agentActivity);
      this.disposables.push(activityApi, agentActivity);
      const apiService = new MarkdownStudioApiService(editorContext, undefined, activityApi);
      this.api = apiService.api;
      this.disposables.push(apiService);
      const activeDocument = new ActiveDocumentContext(editorContext);
      const relationshipAnalyzer = new RelationshipAnalyzer();
      const diffCoordinator = new MarkdownDiffViewSupport(contextOrOptions);
      // The one relationship index, graph, and AI workflow for this activation.
      // Every consumer receives these instances; none may construct its own.
      const graphGenerator = new LinkGraphGenerator(relationshipAnalyzer);
      const aiWorkflow = new AIMarkdownWorkflowService(relationshipAnalyzer, graphGenerator);
      const wikiLinkCompletion = new WikiLinkCompletionProvider(relationshipAnalyzer);
      this.graphGenerator = graphGenerator;
      this.aiWorkflow = aiWorkflow;
      this.wikiLinkCompletion = wikiLinkCompletion;

      this.disposables.push(new AgentActivityDecorations(agentActivity, {
        getActiveUri: () => activeDocument.activeDocument?.uri,
        onDidChangeActiveUri: activeDocument.onDidChangeActiveDocument,
        createStatusBarItem: () => vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90),
        registerFileDecorationProvider: provider => vscode.window.registerFileDecorationProvider(provider),
      }));
      this.activeDocument = activeDocument;
      this.relationshipAnalyzer = relationshipAnalyzer;
      this.diffCoordinator = diffCoordinator;
      const editorNavigation = this.createEditorNavigation(contextOrOptions);
      this.editorNavigation = editorNavigation;
      this.editorPanelDependencies = {
        aiWorkflow,
        relatedFiles: relationshipAnalyzer,
        diffCoordinator,
        activeDocumentEvents: activeDocument,
        editorContext,
        agentActivity,
        editorNavigation: this.editorNavigation,
      };

      this.ownedResources.push(
        diffCoordinator,
        activeDocument,
        editorContext,
        wikiLinkCompletion,
        relationshipAnalyzer,
        editorNavigation,
      );
      this.sidebarManager = new MarkdownSidebarManager(contextOrOptions, {
        activeDocumentContext: activeDocument,
        editorNavigation: this.editorNavigation,
        relationshipAnalyzer,
        graphGenerator,
      });
      this.disposables.push(this.sidebarManager);
      return;
    }

    const options = contextOrOptions;
    this.diffCoordinator = options.diffCoordinator as DiffCoordinator;
    this.editorNavigation = options.editorNavigation as EditorNavigationPreviewPort;
    this.activeDocument = options.activeDocument as ActiveDocumentEvents;
    this.relationshipAnalyzer = options.relationshipAnalyzer ?? { dispose() {} };
    this.ownedResources.push(
      ...[
        options.diffCoordinator,
        options.editorNavigation,
        options.activeDocument,
        options.relationshipAnalyzer,
        ...(options.disposables ?? []),
      ].filter((resource): resource is vscode.Disposable => Boolean(resource)),
    );
  }

  public createPreviewCustomEditorProvider(): PreviewCustomEditorProvider {
    if (!this.context || !this.editorPanelDependencies) {
      throw new Error('A VS Code extension context is required to create providers');
    }

    return new PreviewCustomEditorProvider(this.context, this.editorPanelDependencies);
  }

  public get graphViewDependencies(): GraphViewPanelDependencies {
    if (!this.graphGenerator) {
      throw new Error('A VS Code extension context is required to open graph view');
    }

    return {
      activeDocumentContext: this.activeDocument,
      graphGenerator: this.graphGenerator,
    };
  }

  public openGraphView(
    options?: string | { docUri?: string; depth?: number; maxNodes?: number; showDirectLinksOnly?: boolean },
  ): Promise<void> {
    if (!this.context) {
      return Promise.reject(new Error('A VS Code extension context is required to open graph view'));
    }

    return GraphViewPanel.createOrShow(this.context, options, this.graphViewDependencies);
  }

  public addDisposable(disposable: vscode.Disposable): void {
    this.disposables.push(disposable);
  }

  public addDisposables(...disposables: vscode.Disposable[]): void {
    this.disposables.push(...disposables);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    const resources = [...this.disposables, ...this.ownedResources];
    const seen = new Set<vscode.Disposable>();
    resources.forEach((resource) => {
      if (!resource || seen.has(resource)) {
        return;
      }
      seen.add(resource);
      resource.dispose();
    });
    this.disposables.length = 0;
    this.ownedResources.length = 0;
  }

  private createEditorNavigation(context: vscode.ExtensionContext): MarkdownEditorNavigation {
    return new MarkdownEditorNavigation({
      openEditor: async (
        documentOrUri: vscode.Uri | vscode.TextDocument,
        options: EditorOpenOptions = {},
      ) => this.editorPanelDependencies && EditorPanel.createOrShow(
        context,
        documentOrUri,
        options.tab,
        options.webviewPanel,
        options.isDiffView ?? false,
        options.readOnly,
        this.editorPanelDependencies,
        options.navigationTarget,
        options.mustExist ?? false,
      ),
      stat: async uri => vscode.workspace.fs.stat(uri),
      showError: message => { void vscode.window.showErrorMessage(message); },
    });
  }

  private isExtensionContext(value: vscode.ExtensionContext | ExtensionRuntimeOptions): value is vscode.ExtensionContext {
    return 'extensionUri' in value && 'subscriptions' in value;
  }
}
