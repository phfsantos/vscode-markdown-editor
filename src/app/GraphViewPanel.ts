import * as vscode from 'vscode';
import * as path from 'path';
import { LinkGraphGenerator, GraphData } from '../services/LinkGraphGenerator';
import { getWebviewOptions } from './_utils';
import { logger } from '../utils/Logger';

/**
 * Full-screen graph view panel for visualizing markdown file relationships
 */
export class GraphViewPanel {
  public static currentPanel: GraphViewPanel | undefined;
  private static readonly viewType = 'markdownGraphView';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private graphGenerator: LinkGraphGenerator;
  private _activeDocument?: vscode.TextDocument;
  private _currentDepth: number = 2;
  private _currentMaxNodes: number = 100;
  private _showDirectLinksOnly: boolean = false;

  public static async createOrShow(context: vscode.ExtensionContext, docUri?: string) {
    logger.debug('[GraphViewPanel] createOrShow called', docUri);
    let activeMarkdownDoc: vscode.TextDocument | undefined = undefined;
    if (docUri) {
      try {
        const uri = vscode.Uri.parse(docUri);
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.languageId === 'markdown') {
          activeMarkdownDoc = doc;
        }
      } catch (err) {
        logger.error('[GraphViewPanel] Failed to open document from URI:', docUri, err);
      }
    } else {
      const activeEditor = vscode.window.activeTextEditor;
      activeMarkdownDoc = activeEditor?.document.languageId === 'markdown'
        ? activeEditor.document
        : undefined;
    }
    logger.debug('[GraphViewPanel] Active markdown document:', activeMarkdownDoc ? activeMarkdownDoc.fileName : 'none');
    // Always open in a split editor beside the active file
    const column = vscode.ViewColumn.Beside;
    logger.debug('[GraphViewPanel] Forcing panel to open in ViewColumn.Beside');

    logger.debug('[GraphViewPanel] Opening graph panel in column:', column);

    // If we already have a panel, show it
    if (GraphViewPanel.currentPanel) {
      logger.debug('[GraphViewPanel] Reusing existing panel');
      
      // Update the active document if we have one
      if (activeMarkdownDoc) {
        GraphViewPanel.currentPanel._activeDocument = activeMarkdownDoc;
      }
      
      GraphViewPanel.currentPanel._panel.reveal(column);
      
      // Regenerate graph with the current document
      GraphViewPanel.currentPanel._regenerateGraph();
      return;
    }

    // Otherwise, create a new panel
    logger.debug('[GraphViewPanel] Creating new panel');
    const panel = vscode.window.createWebviewPanel(
      GraphViewPanel.viewType,
      'Link Graph',
      column,
      {
        ...getWebviewOptions(context.extensionUri),
        retainContextWhenHidden: true
      }
    );

    logger.debug('[GraphViewPanel] Panel created, initializing GraphViewPanel instance');
    GraphViewPanel.currentPanel = new GraphViewPanel(
      panel, 
      context.extensionUri,
      activeMarkdownDoc
    );
  }

  private constructor(
    panel: vscode.WebviewPanel, 
    extensionUri: vscode.Uri,
    initialDocument?: vscode.TextDocument
  ) {
    logger.debug('[GraphViewPanel] Constructor called');
    
    this._panel = panel;
    this._extensionUri = extensionUri;
    this.graphGenerator = LinkGraphGenerator.getInstance();

    // Set initial document if provided, otherwise try to get current active editor
    if (initialDocument) {
      logger.debug('[GraphViewPanel] Using provided initial document:', initialDocument.fileName);
      this._activeDocument = initialDocument;
    } else {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.languageId === 'markdown') {
        logger.debug('[GraphViewPanel] Using active editor document:', activeEditor.document.fileName);
        this._activeDocument = activeEditor.document;
      } else {
        logger.debug('[GraphViewPanel] No markdown document available');
      }
    }

    // Set initial HTML
    logger.debug('[GraphViewPanel] Calling _update() to set HTML');
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        logger.debug('[GraphViewPanel] Received message from webview:', message.command, message);
        
        switch (message.command) {
          case 'openFile':
            logger.debug('[GraphViewPanel] Opening file:', message.filePath);
            await this._openFile(message.filePath);
            break;
          case 'updateDepth':
            logger.debug('[GraphViewPanel] Updating depth to:', message.depth);
            this._currentDepth = message.depth;
            await this._regenerateGraph();
            break;
          case 'updateMaxNodes':
            logger.debug('[GraphViewPanel] Updating maxNodes to:', message.maxNodes);
            this._currentMaxNodes = message.maxNodes;
            await this._regenerateGraph();
            break;
          case 'toggleDirectLinksOnly':
            logger.debug('[GraphViewPanel] Toggling direct links only to:', message.value);
            this._showDirectLinksOnly = message.value;
            await this._regenerateGraph();
            break;
          case 'ready':
            logger.debug('[GraphViewPanel] Webview ready, generating initial graph');
            await this._regenerateGraph();
            break;
        }
      },
      null,
      this._disposables
    );

    // Listen for active editor changes
    vscode.window.onDidChangeActiveTextEditor(
      async (editor) => {
        if (editor && editor.document.languageId === 'markdown') {
          logger.debug('[GraphViewPanel] Active editor changed to:', editor.document.fileName);
          this._activeDocument = editor.document;
          await this._regenerateGraph();
        }
      },
      null,
      this._disposables
    );
  }

  private async _openFile(filePath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: true
      });
    } catch (error) {
      logger.error('Error opening file:', error);
      vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
  }

  private async _regenerateGraph(): Promise<void> {
    logger.debug('[GraphViewPanel] _regenerateGraph called', {
      hasActiveDoc: !!this._activeDocument,
      depth: this._currentDepth,
      maxNodes: this._currentMaxNodes
    });

    if (!this._activeDocument) {
      logger.debug('[GraphViewPanel] No active document, sending empty graph');
      this._panel.webview.postMessage({
        type: 'graphData',
        data: { nodes: [], edges: [] }
      });
      return;
    }

    try {
      // Show loading state
      this._panel.webview.postMessage({ type: 'loading', value: true });

      const depth = this._showDirectLinksOnly ? 1 : this._currentDepth;
      logger.debug('[GraphViewPanel] Generating graph with depth:', depth, 'maxNodes:', this._currentMaxNodes);
      
      const graphData = await this.graphGenerator.generateGraphForFile(
        this._activeDocument.uri,
        depth,
        this._currentMaxNodes
      );

      logger.debug('[GraphViewPanel] Graph generated:', {
        nodes: graphData.nodes.length,
        edges: graphData.edges.length,
        focusNode: graphData.focusNode
      });

      // Send graph data to webview
      this._panel.webview.postMessage({
        type: 'graphData',
        data: graphData
      });

      this._panel.webview.postMessage({ type: 'loading', value: false });
    } catch (error) {
      logger.error('[GraphViewPanel] Error generating graph:', error);
      this._panel.webview.postMessage({ type: 'loading', value: false });
      this._panel.webview.postMessage({
        type: 'error',
        message: 'Failed to generate graph'
      });
    }
  }

  public dispose() {
    GraphViewPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.title = 'Link Graph';
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'graph-view.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'graph-view.css')
    );

    // Debug: print resource URIs to console and add fallback inline style
    logger.debug('[GraphViewPanel] Resource URIs:', {
      scriptUri: scriptUri.toString(),
      styleUri: styleUri.toString()
    });

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>Link Graph</title>
</head>
<body>
  <div id="app">
    <div class="controls">
      <div class="control-group control-group-checkbox">
        <label>
          <input type="checkbox" id="directLinksOnly" />
          Show direct links only
        </label>
      </div>
      <div class="control-group control-group-slider">
        <label for="depth">Depth</label>
        <span class="slider-value" id="depth-value">${this._currentDepth}</span>
        <input type="range" id="depth" min="1" max="5" value="${this._currentDepth}" ${this._showDirectLinksOnly ? 'disabled' : ''} />
      </div>
      <div class="control-group control-group-slider">
        <label for="maxNodes">Max Nodes</label>
        <span class="slider-value" id="max-nodes-value">${this._currentMaxNodes}</span>
        <input type="range" id="maxNodes" min="10" max="500" step="10" value="${this._currentMaxNodes}" />
      </div>
      <div class="control-group control-group-slider">
        <label for="nodeDistance">Node Distance</label>
        <span class="slider-value" id="node-distance-value">2000</span>
        <input type="range" id="nodeDistance" min="1000" max="20000" step="100" value="2000" />
      </div>
      <div class="control-group control-group-stats">
        <span id="stats">Nodes: 0 | Links: 0</span>
      </div>
    </div>
    <div id="graph-container">
      <div class="loading-overlay" id="loading">
        <div class="loading-spinner"></div>
        <p>Generating graph...</p>
      </div>
      <svg id="graph" width="100%" height="100%"></svg>
    </div>
    <div class="legend">
      <h4>Legend</h4>
      <div class="legend-item">
        <svg width="20" height="20"><circle cx="10" cy="10" r="8" class="node-focus" /></svg>
        <span>Current file</span>
      </div>
      <div class="legend-item">
        <svg width="20" height="20"><circle cx="10" cy="10" r="6" class="node-regular" /></svg>
        <span>Linked file</span>
      </div>
      <div class="legend-item">
        <svg width="20" height="20"><line x1="0" y1="10" x2="20" y2="10" class="edge-link" /></svg>
        <span>Outgoing link</span>
      </div>
      <div class="legend-item">
        <svg width="20" height="20"><line x1="0" y1="10" x2="20" y2="10" class="edge-backlink" /></svg>
        <span>Backlink</span>
      </div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
