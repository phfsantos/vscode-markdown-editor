import * as vscode from 'vscode';
import { CacheStatus, Link, RelatedFile } from '../services/RelationshipAnalyzer';
import {
  GraphRequestOptions,
  MarkdownSidebarContext,
  SidebarEmbedItem,
  SidebarTemplateItem
} from './MarkdownSidebarContext';

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

const sidebarContextValueCatalog = {
  currentFile: { contextValue: 'currentFile' },
  defaultEditorWarning: { contextValue: 'defaultEditorWarning' },
  inlineSuggestionToggle: { contextValue: 'inlineSuggestionToggle' },
  cacheStatus: { contextValue: 'cacheStatus' },
  refreshSidebar: { contextValue: 'refreshSidebar' },
  quickNoteTemplate: { contextValue: 'quickNoteTemplate' },
  tagGroup: { contextValue: 'tagGroup' },
  tagItem: { contextValue: 'tagItem' },
  embedResolved: { contextValue: 'embedResolved' },
  embedMissing: { contextValue: 'embedMissing' },
  outgoingLink: { contextValue: 'outgoingLink' },
  outgoingLinkMissing: { contextValue: 'outgoingLinkMissing' },
  backlink: { contextValue: 'backlink' },
  relatedFile: { contextValue: 'relatedFile' }
};

class SidebarItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    public readonly children: SidebarItem[] = []
  ) {
    super(label, collapsibleState);
  }
}

abstract class MarkdownSidebarTreeProvider implements vscode.TreeDataProvider<SidebarItem> {
  protected treeView?: vscode.TreeView<SidebarItem>;
  private readonly changeEmitter = new vscode.EventEmitter<SidebarItem | void>();

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    protected readonly sidebarContext: MarkdownSidebarContext,
    protected readonly emptyMessage: string
  ) {
    this.sidebarContext.onDidChange(() => this.refresh());
    this.sidebarContext.onDidChangeCacheStatus(() => this.refresh());
  }

  public attachTreeView(treeView: vscode.TreeView<SidebarItem>): void {
    this.treeView = treeView;
    this.treeView.message = this.sidebarContext.getActiveDocument() ? undefined : this.emptyMessage;
  }

  public refresh(): void {
    if (this.treeView) {
      this.treeView.message = this.sidebarContext.getActiveDocument() ? undefined : this.emptyMessage;
    }
    this.changeEmitter.fire();
  }

  public getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: SidebarItem): Promise<SidebarItem[]> {
    if (element) {
      return element.children;
    }

    return this.getRootChildren();
  }

  protected abstract getRootChildren(): Promise<SidebarItem[]>;
}

function openFileCommand(filePath: string): vscode.Command {
  return {
    command: 'vscode.open',
    title: 'Open File',
    arguments: [vscode.Uri.file(filePath)]
  };
}

function emptyItem(label: string): SidebarItem {
  const item = new SidebarItem(label);
  item.iconPath = new vscode.ThemeIcon('info');
  return item;
}

class MarkdownSidebarStatusProvider extends MarkdownSidebarTreeProvider {
  protected async getRootChildren(): Promise<SidebarItem[]> {
    const items: SidebarItem[] = [];
    const activeDocument = this.sidebarContext.getActiveDocument();

    if (activeDocument) {
      const currentFile = new SidebarItem(basename(activeDocument.uri.fsPath));
      currentFile.description = vscode.workspace.asRelativePath(activeDocument.uri);
      currentFile.iconPath = new vscode.ThemeIcon('file');
      currentFile.contextValue = 'currentFile';
      currentFile.command = openFileCommand(activeDocument.uri.fsPath);
      items.push(currentFile);
    }

    if (this.sidebarContext.isDefaultEditor()) {
      const defaultEditorOk = new SidebarItem('Default markdown editor is configured');
      defaultEditorOk.iconPath = new vscode.ThemeIcon('check');
      items.push(defaultEditorOk);
    } else {
      const defaultEditorWarning = new SidebarItem('Set Markdown Editor as the default .md editor');
      defaultEditorWarning.iconPath = new vscode.ThemeIcon('warning');
      defaultEditorWarning.contextValue = 'defaultEditorWarning';
      defaultEditorWarning.command = {
        command: 'markdown-editor.setAsDefaultEditor',
        title: 'Set as Default Markdown Editor'
      };
      items.push(defaultEditorWarning);
    }

    items.push(this.buildInlineSuggestionItem());

    items.push(this.buildCacheStatusItem(this.sidebarContext.getCacheStatus()));

    const refreshSidebar = new SidebarItem('Refresh Sidebar');
    refreshSidebar.iconPath = new vscode.ThemeIcon('refresh');
    refreshSidebar.contextValue = 'refreshSidebar';
    refreshSidebar.command = {
      command: 'markdown-editor.refreshSidebar',
      title: 'Refresh Sidebar'
    };
    items.push(refreshSidebar);

    return items;
  }

  private buildCacheStatusItem(status: CacheStatus): SidebarItem {
    const label = status.isBuilding
      ? `Cache rebuild in progress (${status.buildProgress?.current || 0}/${status.buildProgress?.total || 0})`
      : `Relationship cache ready (${status.cacheSize} entries)`;

    const cacheStatus = new SidebarItem(label);
    cacheStatus.description = status.buildProgress?.operation;
    cacheStatus.iconPath = new vscode.ThemeIcon('database');
    cacheStatus.contextValue = 'cacheStatus';
    cacheStatus.command = {
      command: 'markdown-editor.rebuildCache',
      title: 'Rebuild Relationship Cache'
    };
    return cacheStatus;
  }

  private buildInlineSuggestionItem(): SidebarItem {
    const enabled = vscode.workspace
      .getConfiguration('markdown-editor')
      .get<boolean>('ai.enableInlineSuggestions', false);

    const item = new SidebarItem(
      enabled ? 'AI auto-complete suggestions are enabled' : 'AI auto-complete suggestions are disabled'
    );
    item.description = enabled ? 'Click to turn them off' : 'Click to enable opt-in ghost text';
    item.iconPath = new vscode.ThemeIcon(enabled ? 'sparkle' : 'circle-slash');
    item.contextValue = 'inlineSuggestionToggle';
    item.command = {
      command: 'markdown-editor.toggleInlineSuggestions',
      title: enabled ? 'Disable AI Auto-Complete Suggestions' : 'Enable AI Auto-Complete Suggestions'
    };
    return item;
  }
}

class MarkdownSidebarQuickNotesProvider extends MarkdownSidebarTreeProvider {
  protected async getRootChildren(): Promise<SidebarItem[]> {
    const templates = this.sidebarContext.getTemplates();
    if (templates.length === 0) {
      return [emptyItem('No templates are available.')];
    }

    return templates.map((template) => this.createTemplateItem(template));
  }

  private createTemplateItem(template: SidebarTemplateItem): SidebarItem {
    const quickNoteTemplate = new SidebarItem(template.name);
    quickNoteTemplate.description = template.description;
    quickNoteTemplate.iconPath = new vscode.ThemeIcon('note');
    quickNoteTemplate.contextValue = 'quickNoteTemplate';
    quickNoteTemplate.command = {
      command: 'markdown-editor.createNoteFromTemplate',
      title: 'Create Note from Template',
      arguments: [template.id]
    };
    return quickNoteTemplate;
  }
}

class MarkdownSidebarTagsProvider extends MarkdownSidebarTreeProvider {
  protected async getRootChildren(): Promise<SidebarItem[]> {
    const groups: SidebarItem[] = [];
    const documentTags = await this.sidebarContext.getDocumentTags();
    const workspaceTags = await this.sidebarContext.getWorkspaceTags();

    if (documentTags.length > 0) {
      const tagGroup = new SidebarItem(
        'Current Note Tags',
        vscode.TreeItemCollapsibleState.Expanded,
        documentTags.map((tag) => this.createTagItem(tag))
      );
      tagGroup.iconPath = new vscode.ThemeIcon('tag');
      tagGroup.contextValue = 'tagGroup';
      groups.push(tagGroup);
    }

    if (workspaceTags.length > 0) {
      const tagGroup = new SidebarItem(
        'Workspace Tags',
        vscode.TreeItemCollapsibleState.Collapsed,
        workspaceTags.map(({ tag, count }) => this.createTagItem(tag, count))
      );
      tagGroup.iconPath = new vscode.ThemeIcon('symbol-key');
      tagGroup.contextValue = 'tagGroup';
      groups.push(tagGroup);
    }

    return groups.length > 0 ? groups : [emptyItem('No tags found.')];
  }

  private createTagItem(tag: string, count?: number): SidebarItem {
    const tagItem = new SidebarItem(`#${tag}`);
    tagItem.description = typeof count === 'number' ? `${count} notes` : 'Current note';
    tagItem.iconPath = new vscode.ThemeIcon('tag');
    tagItem.contextValue = 'tagItem';
    tagItem.command = {
      command: 'markdown-editor.filterByTag',
      title: 'Filter Notes by Tag',
      arguments: [tag]
    };
    return tagItem;
  }
}

class MarkdownSidebarEmbedsProvider extends MarkdownSidebarTreeProvider {
  protected async getRootChildren(): Promise<SidebarItem[]> {
    const embeds = await this.sidebarContext.getEmbeds();
    if (embeds.length === 0) {
      return [emptyItem('No embeds found in the active note.')];
    }

    return embeds.map((embed) => this.createEmbedItem(embed));
  }

  private createEmbedItem(embed: SidebarEmbedItem): SidebarItem {
    const label = embed.filename || embed.raw;
    const item = new SidebarItem(label);
    item.description = embed.resolved ? vscode.workspace.asRelativePath(embed.resolved) : 'Missing file';
    item.command = {
      command: 'markdown-editor.previewEmbed',
      title: 'Preview Embed',
      arguments: [embed]
    };

    if (embed.resolved) {
      item.iconPath = new vscode.ThemeIcon('file-media');
      item.contextValue = 'embedResolved';
    } else {
      item.iconPath = new vscode.ThemeIcon('warning');
      item.contextValue = 'embedMissing';
    }

    return item;
  }
}

class MarkdownSidebarOutgoingLinksProvider extends MarkdownSidebarTreeProvider {
  protected async getRootChildren(): Promise<SidebarItem[]> {
    const outgoingLinks = await this.sidebarContext.getOutgoingLinks();
    if (outgoingLinks.length === 0) {
      return [emptyItem('No outgoing links found.')];
    }

    return outgoingLinks.map((link) => this.createOutgoingLinkItem(link));
  }

  private createOutgoingLinkItem(link: Link): SidebarItem {
    const item = new SidebarItem(link.text || link.url);
    item.description = link.resolved ? vscode.workspace.asRelativePath(link.resolved) : link.url;

    if (link.resolved) {
      item.iconPath = new vscode.ThemeIcon('file-symlink-file');
      item.contextValue = 'outgoingLink';
      item.command = openFileCommand(link.resolved);
    } else {
      item.iconPath = new vscode.ThemeIcon('warning');
      item.contextValue = 'outgoingLinkMissing';
    }

    return item;
  }
}

class MarkdownSidebarBacklinksProvider extends MarkdownSidebarTreeProvider {
  protected async getRootChildren(): Promise<SidebarItem[]> {
    const backlinks = await this.sidebarContext.getBacklinks();
    if (backlinks.length === 0) {
      return [emptyItem('No backlinks found.')];
    }

    return backlinks.map((backlink) => {
      const item = new SidebarItem(backlink.name);
      item.description = backlink.lineNumber ? `Line ${backlink.lineNumber}` : backlink.relativePath;
      item.tooltip = backlink.context || backlink.relativePath;
      item.iconPath = new vscode.ThemeIcon('references');
      item.contextValue = 'backlink';
      item.command = openFileCommand(backlink.path);
      return item;
    });
  }
}

class MarkdownSidebarRelatedFilesProvider extends MarkdownSidebarTreeProvider {
  protected async getRootChildren(): Promise<SidebarItem[]> {
    const relatedFiles = await this.sidebarContext.getRelatedFiles();
    if (relatedFiles.length === 0) {
      return [emptyItem('No related files found.')];
    }

    return relatedFiles.map((relatedFile) => this.createRelatedFileItem(relatedFile));
  }

  private createRelatedFileItem(relatedFile: RelatedFile): SidebarItem {
    const item = new SidebarItem(relatedFile.name);
    item.description = `${relatedFile.relativePath} • ${Math.round(relatedFile.score * 100)}%`;
    item.iconPath = new vscode.ThemeIcon('file-symlink-file');
    item.contextValue = 'relatedFile';
    item.command = openFileCommand(relatedFile.path);
    return item;
  }
}

export class MarkdownMiniGraphViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'markdown-sidebar-graph';
  private static readonly stateKey = 'markdown-editor.sidebar.graph.options';

  private view?: vscode.WebviewView;
  private graphOptions: GraphRequestOptions;

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly sidebarContext: MarkdownSidebarContext
  ) {
    this.graphOptions = {
      depth: 1,
      maxNodes: 15,
      ...this.extensionContext.workspaceState.get<GraphRequestOptions>(MarkdownMiniGraphViewProvider.stateKey)
    };

    this.sidebarContext.onDidChange(() => this.refresh());
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionContext.extensionUri]
    };
    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'openFile':
          if (message.filePath) {
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.filePath));
          }
          break;
        case 'openGraphView': {
          const docUri =
            typeof message.docUri === 'string' && message.docUri
              ? message.docUri
              : this.sidebarContext.getActiveDocument()?.uri.toString();
          await vscode.commands.executeCommand('markdown-editor.openGraphView', {
            docUri,
            depth: this.graphOptions.depth,
            maxNodes: this.graphOptions.maxNodes,
            showDirectLinksOnly: this.graphOptions.depth === 1
          });
          break;
        }
        case 'refreshGraph':
          this.refresh();
          break;
        case 'updateOptions':
          this.graphOptions = {
            ...this.graphOptions,
            ...message.options
          };
          await this.extensionContext.workspaceState.update(MarkdownMiniGraphViewProvider.stateKey, this.graphOptions);
          await this.postGraphData();
          break;
      }
    });

    void this.postGraphData();
  }

  public refresh(): void {
    void this.postGraphData();
  }

  private async postGraphData(): Promise<void> {
    if (!this.view) {
      return;
    }

    const activeDocument = this.sidebarContext.getActiveDocument();
    const graphData = activeDocument
      ? await this.sidebarContext.getGraphData(this.graphOptions)
      : null;

    await this.view.webview.postMessage({
      type: 'graphData',
      graphData,
      currentFile: activeDocument
        ? {
            name: basename(activeDocument.uri.fsPath),
            path: activeDocument.uri.fsPath,
            uri: activeDocument.uri.toString()
          }
        : null
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    .graph-shell {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
    }
    .graph-toolbar {
      display: grid;
      gap: 8px;
    }
    .graph-toolbar-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .graph-toolbar-row label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      justify-content: flex-start;
      gap: 8px;
      align-items: center;
      min-width: 96px;
    }
    .graph-toolbar-row input[type="range"] {
      flex: 1;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-radius: 4px;
      padding: 4px 8px;
      cursor: pointer;
    }
    .graph-title {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      min-height: 18px;
    }
    .graph-canvas {
      min-height: 220px;
      border-radius: 8px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorWidget-background);
      overflow: hidden;
      cursor: grab;
      padding: 8px;
    }
    .graph-canvas.grabbing {
      cursor: grabbing;
    }
    svg {
      width: 100%;
      height: 240px;
      display: block;
    }
    .graph-empty {
      min-height: 220px;
      display: grid;
      place-items: center;
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .graph-node {
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="graph-shell">
    <div class="graph-toolbar">
      <div class="graph-toolbar-row">
        <button id="refreshButton" type="button">Refresh</button>
        <button id="fullGraphButton" type="button">Open Full Graph</button>
      </div>
    </div>
    <div id="graphTitle" class="graph-title"></div>
    <div id="graphCanvas" class="graph-canvas"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const persisted = vscode.getState() || { graphZoom: { scale: 1, translateX: 0, translateY: 0 } };
    const state = {
      graphData: null,
      currentFile: null,
      zoom: persisted.graphZoom || { scale: 1, translateX: 0, translateY: 0 },
      isPanning: false,
      panStart: { x: 0, y: 0 }
    };

    vscode.setState({ graphZoom: state.zoom });

    const canvas = document.getElementById('graphCanvas');
    const title = document.getElementById('graphTitle');
    const refreshButton = document.getElementById('refreshButton');
    const fullGraphButton = document.getElementById('fullGraphButton');

    function createPositions(nodes, width, height, distance) {
      const focusIndex = nodes.findIndex((node) => node.isFocus);
      const focusNode = focusIndex >= 0 ? nodes[focusIndex] : nodes[0];
      const positions = new Map();
      const centerX = width / 2;
      const centerY = height / 2;
      const orbit = Math.min(distance, Math.max(80, Math.min(width, height) / 2 - 30));

      nodes.forEach((node, index) => {
        if (focusNode && node.id === focusNode.id) {
          positions.set(node.id, { x: centerX, y: centerY });
          return;
        }

        const offset = focusNode ? index - (focusIndex >= 0 ? 1 : 0) : index;
        const count = Math.max(1, nodes.length - 1);
        const angle = (offset / count) * Math.PI * 2;
        positions.set(node.id, {
          x: centerX + Math.cos(angle) * orbit,
          y: centerY + Math.sin(angle) * orbit,
        });
      });

      return positions;
    }

    function render() {
      title.textContent = state.currentFile ? state.currentFile.name : 'Mini graph';

      if (!state.graphData || !state.graphData.nodes || state.graphData.nodes.length === 0) {
        canvas.innerHTML = '<div class="graph-empty">Open a markdown file to see its local relationship graph.</div>';
        return;
      }

      const width = canvas.clientWidth || 280;
      const height = 240;
      const positions = createPositions(state.graphData.nodes, width, height, 200);
      const edges = state.graphData.edges.map((edge) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) {
          return '';
        }
        return '<line x1="' + source.x + '" y1="' + source.y + '" x2="' + target.x + '" y2="' + target.y + '" stroke="var(--vscode-descriptionForeground)" stroke-opacity="0.45" stroke-width="1.4" />';
      }).join('');

      const nodes = state.graphData.nodes.map((node) => {
        const pos = positions.get(node.id);
        const fill = node.isFocus
          ? 'var(--vscode-textLink-foreground)'
          : 'var(--vscode-button-secondaryBackground)';
        const textFill = node.isFocus
          ? 'var(--vscode-sideBar-background)'
          : 'var(--vscode-foreground)';
        return '<g class="graph-node" data-path="' + (node.path || '') + '">' +
          '<circle cx="' + pos.x + '" cy="' + pos.y + '" r="14" fill="' + fill + '" />' +
          '<text x="' + pos.x + '" y="' + (pos.y + 4) + '" text-anchor="middle" font-size="9" fill="' + textFill + '">' + (node.label || '').slice(0, 12) + '</text>' +
          '</g>';
      }).join('');

      const transform = 'translate(' + state.zoom.translateX + ',' + state.zoom.translateY + ') scale(' + state.zoom.scale + ')';
      canvas.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Markdown relationship graph">' +
        '<g class="graph-transform" transform="' + transform + '">' + edges + nodes + '</g></svg>';

      canvas.querySelectorAll('.graph-node').forEach((node) => {
        node.addEventListener('click', () => {
          const filePath = node.getAttribute('data-path');
          if (filePath) {
            vscode.postMessage({ command: 'openFile', filePath });
          }
        });
      });
    }

    canvas.addEventListener('wheel', (e) => {
      const wheelEvent = e;
      if (wheelEvent.ctrlKey || wheelEvent.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const svg = canvas.querySelector('svg');
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const oldScale = state.zoom.scale;
        const delta = wheelEvent.deltaY > 0 ? -0.05 : 0.05;
        state.zoom.scale = Math.max(0.5, Math.min(3, state.zoom.scale + delta));
        const mouseX = wheelEvent.clientX - rect.left;
        const mouseY = wheelEvent.clientY - rect.top;
        const scaleDiff = state.zoom.scale - oldScale;
        state.zoom.translateX -= (mouseX * scaleDiff) / state.zoom.scale;
        state.zoom.translateY -= (mouseY * scaleDiff) / state.zoom.scale;
        vscode.setState({ graphZoom: state.zoom });
        const g = canvas.querySelector('.graph-transform');
        if (g) {
          g.setAttribute('transform', 'translate(' + state.zoom.translateX + ',' + state.zoom.translateY + ') scale(' + state.zoom.scale + ')');
        }
      }
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        const target = e.target;
        if (!target.closest('.graph-node')) {
          state.isPanning = true;
          state.panStart = { x: e.clientX, y: e.clientY };
          canvas.classList.add('grabbing');
          e.preventDefault();
        }
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (state.isPanning) {
        const dx = e.clientX - state.panStart.x;
        const dy = e.clientY - state.panStart.y;
        state.zoom.translateX += dx;
        state.zoom.translateY += dy;
        state.panStart = { x: e.clientX, y: e.clientY };
        const g = canvas.querySelector('.graph-transform');
        if (g) {
          g.setAttribute('transform', 'translate(' + state.zoom.translateX + ',' + state.zoom.translateY + ') scale(' + state.zoom.scale + ')');
        }
        e.preventDefault();
      }
    });

    const endPanning = () => {
      if (state.isPanning) {
        state.isPanning = false;
        vscode.setState({ graphZoom: state.zoom });
        canvas.classList.remove('grabbing');
      }
    };

    canvas.addEventListener('mouseup', endPanning);
    canvas.addEventListener('mouseleave', endPanning);

    refreshButton.addEventListener('click', () => {
      vscode.postMessage({ command: 'refreshGraph' });
    });

    fullGraphButton.addEventListener('click', () => {
      vscode.postMessage({
        command: 'openGraphView',
        docUri: state.currentFile?.uri ?? null
      });
    });

    window.addEventListener('message', (event) => {
      if (event.data.type === 'graphData') {
        state.graphData = event.data.graphData;
        state.currentFile = event.data.currentFile;
        render();
      }
    });

    render();
  </script>
</body>
</html>`;
  }
}

export class MarkdownSidebarManager implements vscode.Disposable {
  private readonly sidebarContext: MarkdownSidebarContext;
  private readonly graphViewProvider: MarkdownMiniGraphViewProvider;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    this.sidebarContext = new MarkdownSidebarContext(extensionContext);
    this.graphViewProvider = new MarkdownMiniGraphViewProvider(extensionContext, this.sidebarContext);

    this.registerTreeView('markdown-sidebar-status', new MarkdownSidebarStatusProvider(this.sidebarContext, 'Open a markdown file to inspect its status.'));
    this.registerTreeView('markdown-sidebar-quick-notes', new MarkdownSidebarQuickNotesProvider(this.sidebarContext, 'Quick note templates are always available.'));
    this.registerTreeView('markdown-sidebar-tags', new MarkdownSidebarTagsProvider(this.sidebarContext, 'Open a markdown file to inspect tags.'));
    this.registerTreeView('markdown-sidebar-embeds', new MarkdownSidebarEmbedsProvider(this.sidebarContext, 'Open a markdown file to inspect embeds.'));
    this.registerTreeView('markdown-sidebar-outgoing-links', new MarkdownSidebarOutgoingLinksProvider(this.sidebarContext, 'Open a markdown file to inspect outgoing links.'));
    this.registerTreeView('markdown-sidebar-backlinks', new MarkdownSidebarBacklinksProvider(this.sidebarContext, 'Open a markdown file to inspect backlinks.'));
    this.registerTreeView('markdown-sidebar-related-files', new MarkdownSidebarRelatedFilesProvider(this.sidebarContext, 'Open a markdown file to inspect related files.'));

    this.disposables.push(
      vscode.window.registerWebviewViewProvider(MarkdownMiniGraphViewProvider.viewType, this.graphViewProvider)
    );
  }

  public refresh(): void {
    this.sidebarContext.refresh();
    this.graphViewProvider.refresh();
  }

  public async createNoteFromTemplate(templateId: string): Promise<void> {
    await this.sidebarContext.createNoteFromTemplate(templateId);
  }

  public async previewEmbed(embed?: SidebarEmbedItem): Promise<void> {
    await this.sidebarContext.previewEmbed(embed);
  }

  public async rebuildCache(): Promise<void> {
    await this.sidebarContext.rebuildCache();
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.sidebarContext.dispose();
  }

  private registerTreeView(viewId: string, provider: MarkdownSidebarTreeProvider): void {
    const treeView = vscode.window.createTreeView(viewId, {
      treeDataProvider: provider,
      showCollapseAll: false
    });
    provider.attachTreeView(treeView);
    this.disposables.push(treeView);
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * Math.random() * chars.length));
  }
  return nonce;
}
