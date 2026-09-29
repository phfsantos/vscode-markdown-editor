import * as vscode from 'vscode';
import { MarkdownDiffViewSupport } from '../diff/MarkdownDiffViewSupport';
import {
  EditorPanel,
  type EditorPanelDependencies,
} from '../app/EditorPanel';
import { PreviewCustomEditorProvider } from '../app/PreviewCustomEditorProvider';
import { GraphViewPanel, type GraphViewPanelDependencies } from '../app/GraphViewPanel';
import { LinkGraphGenerator } from '../services/LinkGraphGenerator';
import { RelationshipAnalyzer } from '../services/RelationshipAnalyzer';
import {
  MarkdownSidebarManager,
} from '../sidebar/MarkdownNativeViews';
import { ActiveDocumentContext } from './ActiveDocumentContext';
import { MarkdownEditorNavigation } from '../navigation/MarkdownEditorNavigation';
import type {
  ActiveDocumentEvents,
  DiffCoordinator,
  DiffPanelRegistry,
  EditorNavigationPreviewPort,
  EditorOpenOptions,
} from './ports';

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
  public readonly relationshipAnalyzer: RelationshipAnalyzer | vscode.Disposable;
  public readonly sidebarManager?: MarkdownSidebarManager;

  private readonly context?: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly ownedResources: vscode.Disposable[] = [];
  private readonly graphGenerator?: LinkGraphGenerator;
  private disposed = false;
  private editorPanelDependencies: EditorPanelDependencies = {};

  public constructor(contextOrOptions: vscode.ExtensionContext | ExtensionRuntimeOptions) {
    if (this.isExtensionContext(contextOrOptions)) {
      this.context = contextOrOptions;

      const activeDocument = new ActiveDocumentContext();
      const relationshipAnalyzer = new RelationshipAnalyzer();
      const panelRegistry: DiffPanelRegistry = {
        findTargetPanel: (sourceInstanceId, targetUri) => {
          return EditorPanel.editors?.find((editor) => {
            const matchesUri = editor.uri.toString() === targetUri.toString();
            const isNotSource = !sourceInstanceId || editor.instanceId !== sourceInstanceId;
            return matchesUri && isNotSource;
          });
        },
      };
      const diffCoordinator = new MarkdownDiffViewSupport(contextOrOptions, panelRegistry);
      const graphGenerator = new LinkGraphGenerator(relationshipAnalyzer);
      this.graphGenerator = graphGenerator;

      this.activeDocument = activeDocument;
      this.relationshipAnalyzer = relationshipAnalyzer;
      this.diffCoordinator = diffCoordinator;
      const editorNavigation = this.createEditorNavigation(contextOrOptions);
      this.editorNavigation = editorNavigation;
      this.editorPanelDependencies = {
        diffCoordinator,
        activeDocumentEvents: activeDocument,
        editorNavigation: this.editorNavigation,
      };

      this.ownedResources.push(diffCoordinator, activeDocument, relationshipAnalyzer, editorNavigation);
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
    if (!this.context) {
      throw new Error('A VS Code extension context is required to create providers');
    }

    return new PreviewCustomEditorProvider(this.context, this.editorPanelDependencies);
  }

  public get graphViewDependencies(): GraphViewPanelDependencies {
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
      ) => EditorPanel.createOrShow(
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
