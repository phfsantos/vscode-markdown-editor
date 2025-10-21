import * as vscode from 'vscode';
import * as path from 'path';
import { 
  RelationshipAnalyzer, 
  LinkGraphGenerator, 
  TemplateManager, 
  DefaultEditorChecker 
} from '../services';
import { EditorPanel } from '../app/EditorPanel';

/**
 * Provides the Obsidian-style sidebar webview for markdown tools
 */
export class MarkdownSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'markdown-sidebar';
  private _view?: vscode.WebviewView;
  private _activeDocument?: vscode.TextDocument;
  private _disposables: vscode.Disposable[] = [];
  private relationshipAnalyzer: RelationshipAnalyzer;
  private graphGenerator: LinkGraphGenerator;
  private templateManager: TemplateManager;
  private defaultEditorChecker: DefaultEditorChecker;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    // Initialize services
    this.relationshipAnalyzer = RelationshipAnalyzer.getInstance();
    this.graphGenerator = LinkGraphGenerator.getInstance();
    this.templateManager = TemplateManager.getInstance();
    this.defaultEditorChecker = DefaultEditorChecker.getInstance();

    // Load user templates
    this.templateManager.loadUserTemplates();
    
    // Track active editor changes
    vscode.window.onDidChangeActiveTextEditor(editor => {
      console.log('[Sidebar-Debug] Active editor changed:', {
        hasEditor: !!editor,
        languageId: editor?.document.languageId,
        fileName: editor?.document.fileName
      });
      
      if (editor?.document.languageId === 'markdown') {
        this._activeDocument = editor.document;
        console.log('[Sidebar-Debug] Set active document:', this._activeDocument.fileName);
        this._updateView();
      } else {
        // Editor closed or non-markdown file, clear active document
        this._activeDocument = undefined;
        console.log('[Sidebar-Debug] Cleared active document (non-markdown or no editor)');
        this._updateView();
      }
    });

    // Track visible text editors changes (for when switching between already-open tabs)
    vscode.window.onDidChangeVisibleTextEditors(editors => {
      console.log('[Sidebar-Debug] Visible editors changed:', editors.length);
      const markdownEditor = editors.find(e => e.document.languageId === 'markdown');
      if (markdownEditor) {
        this._activeDocument = markdownEditor.document;
        console.log('[Sidebar-Debug] Set active document from visible editors:', this._activeDocument.fileName);
        this._updateView();
      } else {
        // No markdown editors visible, clear active document
        this._activeDocument = undefined;
        console.log('[Sidebar-Debug] Cleared active document (no markdown editors visible)');
        this._updateView();
      }
    });

    // Track document changes
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document === this._activeDocument) {
        console.log('[Sidebar-Debug] Active document content changed');
        this._updateView();
      }
    });

    // Listen to custom editor panel changes
    this._disposables.push(
      EditorPanel.onDidChangeActiveDocument((doc: vscode.TextDocument | undefined) => {
        console.log('[Sidebar-Debug] Custom editor changed, document:', doc ? {
          fileName: doc.fileName,
          languageId: doc.languageId
        } : 'none');
        
        if (doc?.languageId === 'markdown') {
          this._activeDocument = doc;
          console.log('[Sidebar-Debug] Set active document from custom editor:', this._activeDocument?.fileName);
          this._updateView();
        } else {
          // No document or non-markdown document
          this._activeDocument = undefined;
          console.log('[Sidebar-Debug] Cleared active document from custom editor');
          this._updateView();
        }
      })
    );

    // Initialize with current active editor if it's markdown
    const activeEditor = vscode.window.activeTextEditor;
    console.log('[Sidebar-Debug] Initial active editor:', {
      hasEditor: !!activeEditor,
      languageId: activeEditor?.document.languageId,
      fileName: activeEditor?.document.fileName
    });
    
    if (activeEditor?.document.languageId === 'markdown') {
      this._activeDocument = activeEditor.document;
      console.log('[Sidebar-Debug] Initial active document set:', this._activeDocument.fileName);
    } else {
      // No markdown editor active, check visible editors
      const markdownEditor = vscode.window.visibleTextEditors.find(e => e.document.languageId === 'markdown');
      if (markdownEditor) {
        this._activeDocument = markdownEditor.document;
        console.log('[Sidebar-Debug] Initial active document set from visible editors:', this._activeDocument.fileName);
      }
    }
  }

  /**
   * Called when the view is resolved and becomes visible
   */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Thenable<void> {
    console.log('[Sidebar-Debug] Resolving webview view');
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'sidebar-dist')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    console.log('[Sidebar-Debug] HTML set, setting up message handler');

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      console.log('[Sidebar-Debug] Received message from webview:', message.command);
      switch (message.command) {
        case 'openFile':
          await this._openFile(message.filePath);
          break;
        case 'createNote':
          await this._createNoteFromTemplate(message.template);
          break;
        case 'setDefaultEditor':
          await this._setAsDefaultEditor();
          break;
        case 'openGraphView':
          await this._openGraphView();
          break;
        case 'refreshGraph':
          await this._updateView(message.depth, message.maxNodes);
          break;
        case 'refresh':
          this._updateView();
          break;
      }
    });

    // Initial update
    console.log('[Sidebar-Debug] Triggering initial update');
    this._updateView();
  }

  /**
   * Update the webview with current document data
   */
  private async _updateView(depth?: number, maxNodes?: number): Promise<void> {
    if (!this._view) {
      console.log('[Sidebar-Debug] No view available for update');
      return;
    }

    try {
      console.log('[Sidebar-Debug] Updating view...', { depth, maxNodes });
      const data = await this._gatherDocumentData(depth, maxNodes);
      console.log('[Sidebar-Debug] Gathered data:', {
        hasActiveDocument: data.hasActiveDocument,
        outgoingLinksCount: data.outgoingLinks?.length || 0,
        backlinksCount: data.backlinks?.length || 0,
        relatedFilesCount: data.relatedFiles?.length || 0
      });
      
      this._view.webview.postMessage({
        type: 'update',
        data
      });
    } catch (error) {
      console.error('[Sidebar-Debug] Error updating view:', error);
      // Send update anyway to reset loading state
      this._view.webview.postMessage({
        type: 'update',
        data: {
          hasActiveDocument: false,
          isDefaultEditor: this.defaultEditorChecker.isDefaultEditor()
        }
      });
    }
  }

  /**
   * Gather all data about the current document using services
   */
  private async _gatherDocumentData(depth: number = 1, maxNodes: number = 15): Promise<any> {
    if (!this._activeDocument) {
      return {
        hasActiveDocument: false,
        isDefaultEditor: this.defaultEditorChecker.isDefaultEditor()
      };
    }

    // Validate and clamp parameters
    depth = Math.max(1, Math.min(3, depth));
    maxNodes = Math.max(5, Math.min(50, maxNodes));

    const fileUri = this._activeDocument.uri;

    try {
      // Generate simplified graph data for webview
      const graphData = await this.graphGenerator.generateSimplifiedGraph(fileUri, depth, maxNodes);

      return {
        hasActiveDocument: true,
        currentFile: {
          path: fileUri.fsPath,
          name: path.basename(fileUri.fsPath),
          content: this._activeDocument.getText()
        },
        outgoingLinks: await this.relationshipAnalyzer.getOutgoingLinks(fileUri),
        backlinks: await this.relationshipAnalyzer.getBacklinks(fileUri),
        relatedFiles: await this.relationshipAnalyzer.getRelatedFiles(fileUri, 5),
        graphData: graphData,
        isDefaultEditor: this.defaultEditorChecker.isDefaultEditor()
      };
    } catch (error) {
      console.error('[Sidebar-Debug] Error gathering graph data:', error);
      // Return data without graph if generation fails
      return {
        hasActiveDocument: true,
        currentFile: {
          path: fileUri.fsPath,
          name: path.basename(fileUri.fsPath),
          content: this._activeDocument.getText()
        },
        outgoingLinks: await this.relationshipAnalyzer.getOutgoingLinks(fileUri),
        backlinks: await this.relationshipAnalyzer.getBacklinks(fileUri),
        relatedFiles: await this.relationshipAnalyzer.getRelatedFiles(fileUri, 5),
        graphData: null,
        isDefaultEditor: this.defaultEditorChecker.isDefaultEditor()
      };
    }
  }

  /**
   * Find files that link to the current file (backlinks)
   */
  private async _findBacklinks(currentFilePath: string): Promise<any[]> {
    const backlinks: any[] = [];
    const currentFileName = path.basename(currentFilePath, '.md');
    
    // Search all markdown files in workspace
    const files = await vscode.workspace.findFiles('**/*.md');
    
    for (const file of files) {
      if (file.fsPath === currentFilePath) {
        continue; // Skip current file
      }
      
      const doc = await vscode.workspace.openTextDocument(file);
      const content = doc.getText();
      
      // Check for links to current file
      const hasLink = content.includes(`(${path.basename(currentFilePath)})`) ||
                     content.includes(`[[${currentFileName}]]`);
      
      if (hasLink) {
        backlinks.push({
          path: file.fsPath,
          name: path.basename(file.fsPath),
          relativePath: vscode.workspace.asRelativePath(file)
        });
      }
    }
    
    return backlinks;
  }

  /**
   * Find files related to the current file
   */
  private async _findRelatedFiles(currentFilePath: string): Promise<any[]> {
    const relatedFiles: any[] = [];
    const currentDir = path.dirname(currentFilePath);
    
    // Find files in same directory
    const pattern = new vscode.RelativePattern(currentDir, '*.md');
    const files = await vscode.workspace.findFiles(pattern);
    
    for (const file of files) {
      if (file.fsPath !== currentFilePath) {
        relatedFiles.push({
          path: file.fsPath,
          name: path.basename(file.fsPath),
          proximity: 'same-folder'
        });
      }
    }
    
    return relatedFiles.slice(0, 5); // Limit to 5 most relevant
  }

  /**
   * Set this extension as default editor
   */
  private async _setAsDefaultEditor(): Promise<void> {
    await this.defaultEditorChecker.setAsDefaultEditor();
    this._updateView();
  }

  /**
   * Open a file in the editor
   */
  private async _openFile(filePath: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    
    // Open with the default editor for .md files (which should be our custom editor)
    // Use vscode.open command which respects the default editor setting
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  /**
   * Create a new note from a template using TemplateManager
   */
  private async _createNoteFromTemplate(templateId: string): Promise<void> {
    const doc = await this.templateManager.createNoteFromTemplate(templateId);
    
    // First show the document to allow user to save it
    const editor = await vscode.window.showTextDocument(doc);
    
    // Prompt user to save the file
    const saved = await vscode.workspace.saveAs(doc.uri);
    
    if (saved) {
      // Close the text editor
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      
      // Open with default editor (which should be our custom editor)
      await vscode.commands.executeCommand('vscode.open', saved);
    }
  }

  /**
   * Open the graph view in a new editor
   */
  private async _openGraphView(): Promise<void> {
    // Use tracked _activeDocument if available, otherwise fallback to active editor
    let docUri: string | undefined = undefined;
    if (this._activeDocument) {
      docUri = this._activeDocument.uri.toString();
    } else {
      const activeEditor = vscode.window.activeTextEditor;
      const activeMarkdownDoc = activeEditor?.document.languageId === 'markdown'
        ? activeEditor.document
        : undefined;
      docUri = activeMarkdownDoc ? activeMarkdownDoc.uri.toString() : undefined;
    }
    vscode.commands.executeCommand('markdown-editor.openGraphView', docUri);
  }

  /**
   * Get HTML content for the webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'sidebar-dist', 'sidebar.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'sidebar-dist', 'sidebar.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link href="${styleUri}" rel="stylesheet">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Dispose of resources
   */
  public dispose(): void {
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
