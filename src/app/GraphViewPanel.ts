import * as vscode from 'vscode';
import { LinkGraphGenerator } from '../services/LinkGraphGenerator';
import { getWebviewOptions } from './_utils';
import { logger } from '../utils/Logger';
import { MarkdownSidebarContext } from '../sidebar/MarkdownSidebarContext';
import { EditorPanel } from './EditorPanel';

/**
 * Full-screen graph view panel for visualizing markdown file relationships
 */
interface GraphViewPanelOpenOptions {
  docUri?: string;
  depth?: number;
  maxNodes?: number;
  showDirectLinksOnly?: boolean;
}

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
  private _regenerateRunId = 0;

  public static async createOrShow(
    context: vscode.ExtensionContext,
    optionsOrDocUri?: string | GraphViewPanelOpenOptions
  ) {
    const openOptions =
      typeof optionsOrDocUri === 'string' ? { docUri: optionsOrDocUri } : optionsOrDocUri ?? {};

    logger.debug('[GraphViewPanel] createOrShow called', openOptions);
    const activeMarkdownDoc = await GraphViewPanel._resolveMarkdownDocument(openOptions.docUri);

    logger.debug(
      '[GraphViewPanel] Active markdown document:',
      activeMarkdownDoc ? activeMarkdownDoc.fileName : 'none'
    );

    const column = vscode.ViewColumn.Beside;
    logger.debug('[GraphViewPanel] Opening graph panel in column:', column);

    if (GraphViewPanel.currentPanel) {
      logger.debug('[GraphViewPanel] Reusing existing panel');
      GraphViewPanel.currentPanel._applyOpenOptions(openOptions);
      if (activeMarkdownDoc) {
        GraphViewPanel.currentPanel._activeDocument = activeMarkdownDoc;
      }
      GraphViewPanel.currentPanel._panel.reveal(column);
      await GraphViewPanel.currentPanel._syncControls();
      await GraphViewPanel.currentPanel._regenerateGraph();
      return;
    }

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

    GraphViewPanel.currentPanel = new GraphViewPanel(
      panel,
      context.extensionUri,
      activeMarkdownDoc,
      openOptions
    );
  }

  private static async _resolveMarkdownDocument(docUri?: string): Promise<vscode.TextDocument | undefined> {
    if (typeof docUri === 'string' && docUri.length > 0) {
      try {
        const uri = vscode.Uri.parse(docUri);
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.languageId === 'markdown') {
          return doc;
        }
      } catch (err) {
        logger.error('[GraphViewPanel] Failed to open document from URI:', docUri, err);
      }
    }

    const sidebarDocument = MarkdownSidebarContext.getCurrentActiveDocument();
    if (sidebarDocument?.languageId === 'markdown') {
      return sidebarDocument;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.languageId === 'markdown') {
      return activeEditor.document;
    }

    const customEditorCandidates = [
      EditorPanel.currentPanel?._document,
      ...(EditorPanel.editors ?? []).map((editor) => editor._document)
    ];

    for (let index = customEditorCandidates.length - 1; index >= 0; index -= 1) {
      const document = customEditorCandidates[index];
      if (document?.languageId === 'markdown') {
        return document;
      }
    }

    return undefined;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    initialDocument?: vscode.TextDocument,
    initialOptions?: GraphViewPanelOpenOptions
  ) {
    logger.debug('[GraphViewPanel] Constructor called');

    this._panel = panel;
    this._extensionUri = extensionUri;
    this.graphGenerator = LinkGraphGenerator.getInstance();
    this._activeDocument = initialDocument;
    this._applyOpenOptions(initialOptions);

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        logger.debug('[GraphViewPanel] Received message from webview:', message.command, message);

        switch (message.command) {
          case 'openFile':
            await this._openFile(message.filePath);
            break;
          case 'updateDepth':
            this._currentDepth = message.depth;
            await this._regenerateGraph();
            break;
          case 'updateMaxNodes':
            this._currentMaxNodes = message.maxNodes;
            await this._regenerateGraph();
            break;
          case 'toggleDirectLinksOnly':
            this._showDirectLinksOnly = message.value;
            await this._regenerateGraph();
            break;
          case 'ready':
            await this._syncControls();
            await this._regenerateGraph();
            break;
        }
      },
      null,
      this._disposables
    );

    MarkdownSidebarContext.onDidChangeActiveDocument(
      async (document) => {
        if (document?.languageId === 'markdown') {
          await this._setActiveDocument(document);
          return;
        }

        // Sidebar cleared its active markdown document. Only fall back when
        // we can find another markdown source; otherwise keep the current
        // graph rather than wiping it (avoids race on panel focus changes).
        const fallbackDocument = await GraphViewPanel._resolveMarkdownDocument();
        if (fallbackDocument) {
          await this._setActiveDocument(fallbackDocument);
        }
      },
      null,
      this._disposables
    );

    vscode.window.onDidChangeActiveTextEditor(
      async (editor) => {
        if (editor?.document.languageId === 'markdown') {
          await this._setActiveDocument(editor.document);
          return;
        }

        if (editor && editor.document.languageId !== 'markdown') {
          const fallbackDocument = GraphViewPanel._getCurrentCustomEditorDocument();
          if (fallbackDocument) {
            await this._setActiveDocument(fallbackDocument);
          }
        }
      },
      null,
      this._disposables
    );

    EditorPanel.onDidChangeActiveDocument(
      async (document) => {
        if (document?.languageId === 'markdown') {
          await this._setActiveDocument(document);
          return;
        }

        const fallbackDocument = await GraphViewPanel._resolveMarkdownDocument();
        if (fallbackDocument) {
          await this._setActiveDocument(fallbackDocument);
        }
      },
      null,
      this._disposables
    );
  }

  private _applyOpenOptions(options?: GraphViewPanelOpenOptions): void {
    if (!options) {
      return;
    }

    if (typeof options.depth === 'number' && Number.isFinite(options.depth)) {
      this._currentDepth = Math.max(1, Math.min(5, Math.trunc(options.depth)));
    }

    if (typeof options.maxNodes === 'number' && Number.isFinite(options.maxNodes)) {
      this._currentMaxNodes = Math.max(10, Math.min(500, Math.trunc(options.maxNodes)));
    }

    if (typeof options.showDirectLinksOnly === 'boolean') {
      this._showDirectLinksOnly = options.showDirectLinksOnly;
    }
  }

  private async _syncControls(): Promise<void> {
    await this._panel.webview.postMessage({
      type: 'controlsState',
      data: {
        depth: this._currentDepth,
        maxNodes: this._currentMaxNodes,
        showDirectLinksOnly: this._showDirectLinksOnly
      }
    });
  }

  private static _getCurrentCustomEditorDocument(): vscode.TextDocument | undefined {
    const candidates = [
      EditorPanel.currentPanel?._document,
      ...(EditorPanel.editors ?? []).map((editor) => editor._document)
    ];

    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const document = candidates[index];
      if (document?.languageId === 'markdown') {
        return document;
      }
    }

    return undefined;
  }

  private async _setActiveDocument(document?: vscode.TextDocument): Promise<void> {
    const currentUri = this._activeDocument?.uri.toString();
    const nextUri = document?.uri.toString();

    if (currentUri === nextUri) {
      return;
    }

    logger.debug('[GraphViewPanel] Active document updated:', document?.fileName ?? 'none');
    this._activeDocument = document;
    await this._regenerateGraph();
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
    const runId = ++this._regenerateRunId;
    logger.debug('[GraphViewPanel] _regenerateGraph called', {
      runId,
      hasActiveDoc: !!this._activeDocument,
      depth: this._currentDepth,
      maxNodes: this._currentMaxNodes
    });

    if (!this._activeDocument) {
      await this._panel.webview.postMessage({ type: 'loading', value: false });
      await this._panel.webview.postMessage({
        type: 'emptyState',
        message: 'Open a markdown file to view its link graph.'
      });
      await this._panel.webview.postMessage({
        type: 'graphData',
        data: { nodes: [], edges: [] }
      });
      return;
    }

    await this._panel.webview.postMessage({ type: 'loading', value: true });

    try {
      const depth = this._showDirectLinksOnly ? 1 : this._currentDepth;

      // Use the simplified graph format expected by the webview (includes isFocus)
      const graphData = await this.graphGenerator.generateSimplifiedGraph(
        this._activeDocument.uri,
        depth,
        this._currentMaxNodes
      );

      // If a newer run started while we awaited, drop this result so it
      // does not overwrite fresher data with stale state.
      if (runId !== this._regenerateRunId) {
        logger.debug('[GraphViewPanel] Discarding stale graph result', { runId });
        return;
      }

      if (!graphData.nodes.length) {
        await this._panel.webview.postMessage({
          type: 'emptyState',
          message: 'No graph data is available for the active markdown file.'
        });
      }

      await this._panel.webview.postMessage({
        type: 'graphData',
        data: graphData
      });
    } catch (error) {
      logger.error('[GraphViewPanel] Error generating graph:', error);
      if (runId === this._regenerateRunId) {
        await this._panel.webview.postMessage({
          type: 'error',
          message: 'Failed to generate graph for the active markdown file.'
        });
      }
    } finally {
      // Always clear loading for the latest run so the spinner cannot get
      // stuck on "Generating graph...".
      if (runId === this._regenerateRunId) {
        await this._panel.webview.postMessage({ type: 'loading', value: false });
      }
    }
  }

  public dispose() {
    GraphViewPanel.currentPanel = undefined;

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
          <input type="checkbox" id="directLinksOnly" ${this._showDirectLinksOnly ? 'checked' : ''} />
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
      <div class="control-group control-group-stats">
        <span id="stats">Nodes: 0 | Links: 0</span>
      </div>
    </div>
    <div id="graph-container">
      <div class="loading-overlay hidden" id="loading">
        <div class="loading-spinner"></div>
        <p>Generating graph...</p>
      </div>
      <div class="status-message hidden" id="status-message" role="status" aria-live="polite"></div>
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
    text += possible.charAt(Math.floor(Math.random() * Math.random() * possible.length));
  }
  return text;
}
