/**
 * Sidebar webview script for Obsidian-style markdown tools
 */

import { GraphView, GraphData } from './components/graph-view.js';

interface VSCode {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
}

declare const acquireVsCodeApi: () => VSCode;

interface DocumentData {
  hasActiveDocument: boolean;
  currentFile?: {
    path: string;
    name: string;
    content: string;
  };
  outgoingLinks?: LinkInfo[];
  backlinks?: FileInfo[];
  relatedFiles?: FileInfo[];
  graphData?: GraphData;
  isDefaultEditor: boolean;
}

interface LinkInfo {
  text: string;
  url: string;
  type: 'markdown' | 'wiki';
  resolved: string | null;
}

interface FileInfo {
  path: string;
  name: string;
  relativePath?: string;
  proximity?: string;
}

class SidebarApp {
  private vscode: VSCode;
  private data: DocumentData | null = null;
  private graphView: GraphView;
  private graphCollapsed: boolean = false;
  private graphDepth: number = 1;
  private graphMaxNodes: number = 15;
  private graphLoading: boolean = false;
  private graphDirectLinksOnly: boolean = false;

  constructor() {
    this.vscode = acquireVsCodeApi();
    this.graphView = new GraphView({ width: 280, height: 200, nodeRadius: 6, showLabels: true });
    
    // Restore state
    const state = this.vscode.getState() || {};
    this.graphCollapsed = state.graphCollapsed || false;
    this.graphDepth = state.graphDepth || 1;
    this.graphMaxNodes = state.graphMaxNodes || 15;
    this.graphDirectLinksOnly = state.graphDirectLinksOnly || false;
    
    this.init();
  }

  private init(): void {
    console.log('[Sidebar Webview] Initializing...');
    
    // Listen for messages from the extension
    window.addEventListener('message', event => {
      const message = event.data;
      console.log('[Sidebar Webview] Received message:', message.type, message.data);
      
      switch (message.type) {
        case 'update':
          this.data = message.data;
          this.graphLoading = false; // Reset loading state when data arrives
          this.render();
          break;
      }
    });

    // Initial render
    console.log('[Sidebar Webview] Initial render');
    this.render();

    // Request initial data
    console.log('[Sidebar Webview] Requesting initial data');
    this.vscode.postMessage({ command: 'refresh' });
  }

  private render(): void {
    const app = document.getElementById('app');
    if (!app) return;

    if (!this.data || !this.data.hasActiveDocument) {
      app.innerHTML = this.renderNoDocument();
      return;
    }

    app.innerHTML = `
      <div class="sidebar-container">
        ${this.renderHeader()}
        ${this.renderDefaultEditorCheck()}
        ${this.renderTemplates()}
        ${this.renderOutgoingLinks()}
        ${this.renderBacklinks()}
        ${this.renderRelatedFiles()}
        ${this.renderGraphView()}
      </div>
    `;

    this.attachEventListeners();
    this.attachGraphEvents();
  }

  private renderNoDocument(): string {
    return `
      <div class="no-document">
        <div class="icon">📝</div>
        <p>Open a markdown file to see links and related notes</p>
        ${this.renderTemplates()}
      </div>
    `;
  }

  private renderHeader(): string {
    const fileName = this.data?.currentFile?.name || 'Unknown';
    return `
      <div class="header">
        <h3 class="current-file">${this.escapeHtml(fileName)}</h3>
        <button class="refresh-btn" data-action="refresh" title="Refresh">
          <span class="codicon codicon-refresh"></span>
        </button>
      </div>
    `;
  }

  private renderDefaultEditorCheck(): string {
    // Check if user has dismissed the warning
    const state = this.vscode.getState() || {};
    
    // If it's now the default editor, clear the dismissal state
    if (this.data?.isDefaultEditor && state.dismissedEditorWarning) {
      state.dismissedEditorWarning = false;
      this.vscode.setState(state);
    }
    
    if (state.dismissedEditorWarning) {
      return '';
    }

    if (this.data?.isDefaultEditor) {
      return '';  // No need to show anything if already default
    }

    return `
      <div class="info-banner warning">
        <span class="codicon codicon-warning"></span>
        <span>Not set as default editor</span>
        <button class="link-btn" data-action="setDefault">Set as Default</button>
        <button class="dismiss-btn" data-action="dismissWarning" title="Dismiss">
          <span class="codicon codicon-close"></span>
        </button>
      </div>
    `;
  }

  private renderTemplates(): string {
    return `
      <div class="section">
        <div class="section-header">
          <span class="codicon codicon-file-add"></span>
          <h4>Quick Notes</h4>
        </div>
        <div class="templates">
          <button class="template-btn" data-template="daily">
            <span class="codicon codicon-calendar"></span>
            Daily Note
          </button>
          <button class="template-btn" data-template="meeting">
            <span class="codicon codicon-organization"></span>
            Meeting
          </button>
          <button class="template-btn" data-template="quick">
            <span class="codicon codicon-note"></span>
            Quick Note
          </button>
          <button class="template-btn" data-template="task">
            <span class="codicon codicon-tasklist"></span>
            Tasks
          </button>
        </div>
      </div>
    `;
  }

  private renderOutgoingLinks(): string {
    const links = this.data?.outgoingLinks || [];
    
    if (links.length === 0) {
      return `
        <div class="section">
          <div class="section-header">
            <span class="codicon codicon-link-external"></span>
            <h4>Outgoing Links</h4>
            <span class="count">0</span>
          </div>
          <div class="empty">No outgoing links</div>
        </div>
      `;
    }

    const linksList = links.map(link => `
      <div class="link-item ${link.resolved ? 'resolved' : 'unresolved'}" 
           data-action="openFile" 
           data-path="${link.resolved || ''}"
           ${!link.resolved ? 'title="File not found"' : ''}>
        <span class="codicon ${link.type === 'wiki' ? 'codicon-symbol-namespace' : 'codicon-link'}"></span>
        <span class="link-text">${this.escapeHtml(link.text)}</span>
        ${!link.resolved ? '<span class="codicon codicon-warning" style="color: var(--vscode-editorWarning-foreground);"></span>' : ''}
      </div>
    `).join('');

    return `
      <div class="section">
        <div class="section-header">
          <span class="codicon codicon-link-external"></span>
          <h4>Outgoing Links</h4>
          <span class="count">${links.length}</span>
        </div>
        <div class="links-list">
          ${linksList}
        </div>
      </div>
    `;
  }

  private renderBacklinks(): string {
    const backlinks = this.data?.backlinks || [];
    
    if (backlinks.length === 0) {
      return `
        <div class="section">
          <div class="section-header">
            <span class="codicon codicon-references"></span>
            <h4>Backlinks</h4>
            <span class="count">0</span>
          </div>
          <div class="empty">No backlinks found</div>
        </div>
      `;
    }

    const backlinksList = backlinks.map(file => `
      <div class="file-item" data-action="openFile" data-path="${file.path}">
        <span class="codicon codicon-file"></span>
        <div class="file-info">
          <div class="file-name">${this.escapeHtml(file.name)}</div>
          ${file.relativePath ? `<div class="file-path">${this.escapeHtml(file.relativePath)}</div>` : ''}
        </div>
      </div>
    `).join('');

    return `
      <div class="section">
        <div class="section-header">
          <span class="codicon codicon-references"></span>
          <h4>Backlinks</h4>
          <span class="count">${backlinks.length}</span>
        </div>
        <div class="files-list">
          ${backlinksList}
        </div>
      </div>
    `;
  }

  private renderRelatedFiles(): string {
    const related = this.data?.relatedFiles || [];
    
    if (related.length === 0) {
      return '';
    }

    const relatedList = related.map(file => `
      <div class="file-item" data-action="openFile" data-path="${file.path}">
        <span class="codicon codicon-file"></span>
        <div class="file-info">
          <div class="file-name">${this.escapeHtml(file.name)}</div>
          ${file.proximity ? `<div class="file-proximity">${file.proximity}</div>` : ''}
        </div>
      </div>
    `).join('');

    return `
      <div class="section">
        <div class="section-header">
          <span class="codicon codicon-file-symlink-directory"></span>
          <h4>Related Files</h4>
          <span class="count">${related.length}</span>
        </div>
        <div class="files-list">
          ${relatedList}
        </div>
      </div>
    `;
  }

  private renderGraphView(): string {
    const graphData = this.data?.graphData;
    
    // Show loading state
    if (this.graphLoading) {
      return `
        <div class="section">
          <div class="section-header">
            <span class="codicon codicon-graph"></span>
            <h4>Link Graph</h4>
          </div>
          ${this.graphView.renderLoading()}
        </div>
      `;
    }
    
    // Show empty state
    if (!graphData || (graphData.nodes.length === 0 && graphData.edges.length === 0)) {
      return `
        <div class="section">
          <div class="section-header">
            <span class="codicon codicon-graph"></span>
            <h4>Link Graph</h4>
          </div>
          ${this.graphView.renderEmpty()}
        </div>
      `;
    }

    const graphContent = this.graphView.render(graphData);
    const collapseIcon = this.graphCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    
    return `
      <div class="section">
        <div class="section-header" data-action="toggleGraph" style="cursor: pointer;">
          <span class="codicon codicon-graph"></span>
          <h4>Link Graph</h4>
          <span class="count">${graphData.nodes.length}</span>
          <span class="codicon ${collapseIcon}" style="margin-left: auto;"></span>
        </div>
        <div class="graph-container" id="graph-container" style="display: ${this.graphCollapsed ? 'none' : 'block'};">
          <div class="graph-filters">
            <div class="filter-group filter-group-checkbox">
              <label>
                <input 
                  type="checkbox" 
                  id="graph-direct-links" 
                  ${this.graphDirectLinksOnly ? 'checked' : ''}
                  data-action="toggleDirectLinks"
                />
                Direct links only
              </label>
            </div>
            <div class="filter-group">
              <label for="graph-depth">Depth: <span id="depth-value">${this.graphDepth}</span></label>
              <input 
                type="range" 
                id="graph-depth" 
                min="1" 
                max="3" 
                value="${this.graphDepth}" 
                class="graph-slider"
                data-action="changeDepth"
                ${this.graphDirectLinksOnly ? 'disabled' : ''}
              />
            </div>
            <div class="filter-group">
              <label for="graph-max-nodes">Max nodes: <span id="max-nodes-value">${this.graphMaxNodes}</span></label>
              <input 
                type="range" 
                id="graph-max-nodes" 
                min="5" 
                max="50" 
                step="5"
                value="${this.graphMaxNodes}" 
                class="graph-slider"
                data-action="changeMaxNodes"
              />
            </div>
          </div>
          ${graphContent}
          <div class="graph-controls">
            <span class="graph-control-label">${graphData.nodes.length} nodes, ${graphData.edges.length} links</span>
            <button class="graph-expand-btn" data-action="openFullGraph">
              <span class="codicon codicon-screen-full"></span>
              Expand
            </button>
          </div>
          ${this.graphView.renderLegend()}
        </div>
      </div>
    `;
  }

  private attachEventListeners(): void {
    console.log('[Sidebar Webview] Attaching event listeners');
    
    // Template buttons
    document.querySelectorAll('[data-template]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const template = (e.currentTarget as HTMLElement).dataset.template;
        console.log('[Sidebar Webview] Template clicked:', template);
        this.vscode.postMessage({
          command: 'createNote',
          template
        });
      });
    });

    // File/Link open buttons
    document.querySelectorAll('[data-action="openFile"]').forEach(item => {
      const path = (item as HTMLElement).dataset.path;
      if (path) {
        item.addEventListener('click', () => {
          console.log('[Sidebar Webview] Opening file:', path);
          this.vscode.postMessage({
            command: 'openFile',
            filePath: path
          });
        });
      }
    });

    // Graph button
    const graphBtn = document.querySelector('[data-action="openGraph"]');
    if (graphBtn) {
      graphBtn.addEventListener('click', () => {
        console.log('[Sidebar Webview] Opening graph');
        this.vscode.postMessage({ command: 'openGraphView' });
      });
    }

    // Set default editor button
    const defaultBtn = document.querySelector('[data-action="setDefault"]');
    if (defaultBtn) {
      defaultBtn.addEventListener('click', () => {
        console.log('[Sidebar Webview] Setting default editor');
        this.vscode.postMessage({ command: 'setDefaultEditor' });
      });
    }

    // Dismiss warning button
    const dismissBtn = document.querySelector('[data-action="dismissWarning"]');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        console.log('[Sidebar Webview] Dismissing editor warning');
        // Store dismissal state
        const state = this.vscode.getState() || {};
        state.dismissedEditorWarning = true;
        this.vscode.setState(state);
        // Re-render to hide the warning
        this.render();
      });
    }

    // Refresh button
    const refreshBtn = document.querySelector('[data-action="refresh"]');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        console.log('[Sidebar Webview] Refreshing');
        this.vscode.postMessage({ command: 'refresh' });
      });
    }
  }

  private attachGraphEvents(): void {
    // Toggle graph collapse
    const graphHeader = document.querySelector('[data-action="toggleGraph"]');
    if (graphHeader) {
      graphHeader.addEventListener('click', () => {
        this.graphCollapsed = !this.graphCollapsed;
        const state = this.vscode.getState() || {};
        state.graphCollapsed = this.graphCollapsed;
        this.vscode.setState(state);
        this.render();
      });
    }

    // Direct links only toggle
    const directLinksCheckbox = document.querySelector('[data-action="toggleDirectLinks"]') as HTMLInputElement;
    if (directLinksCheckbox) {
      directLinksCheckbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        this.graphDirectLinksOnly = target.checked;
        
        // Disable/enable depth slider
        const depthSlider = document.getElementById('graph-depth') as HTMLInputElement;
        if (depthSlider) {
          depthSlider.disabled = this.graphDirectLinksOnly;
        }
        
        const state = this.vscode.getState() || {};
        state.graphDirectLinksOnly = this.graphDirectLinksOnly;
        this.vscode.setState(state);
        this.requestGraphRefresh();
      });
    }

    // Depth filter
    const depthSlider = document.querySelector('[data-action="changeDepth"]') as HTMLInputElement;
    if (depthSlider) {
      depthSlider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        this.graphDepth = parseInt(target.value, 10);
        const valueDisplay = document.getElementById('depth-value');
        if (valueDisplay) {
          valueDisplay.textContent = String(this.graphDepth);
        }
      });
      
      depthSlider.addEventListener('change', () => {
        const state = this.vscode.getState() || {};
        state.graphDepth = this.graphDepth;
        this.vscode.setState(state);
        this.requestGraphRefresh();
      });
    }

    // Max nodes filter
    const maxNodesSlider = document.querySelector('[data-action="changeMaxNodes"]') as HTMLInputElement;
    if (maxNodesSlider) {
      maxNodesSlider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        this.graphMaxNodes = parseInt(target.value, 10);
        const valueDisplay = document.getElementById('max-nodes-value');
        if (valueDisplay) {
          valueDisplay.textContent = String(this.graphMaxNodes);
        }
      });
      
      maxNodesSlider.addEventListener('change', () => {
        const state = this.vscode.getState() || {};
        state.graphMaxNodes = this.graphMaxNodes;
        this.vscode.setState(state);
        this.requestGraphRefresh();
      });
    }

    // Expand full graph
    const expandBtn = document.querySelector('[data-action="openFullGraph"]');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        console.log('[Sidebar Webview] Opening full graph');
        this.vscode.postMessage({ command: 'openGraphView' });
      });
    }

    // Attach click events to graph nodes
    const graphContainer = document.getElementById('graph-container');
    if (graphContainer) {
      this.graphView.attachEvents(graphContainer, (nodeId: string, label: string) => {
        console.log('[Sidebar Webview] Graph node clicked:', label);
        this.vscode.postMessage({
          command: 'openFile',
          filePath: nodeId
        });
      });
    }
  }

  private requestGraphRefresh(): void {
    // Validate parameters
    if (this.graphDepth < 1 || this.graphDepth > 3) {
      console.error('[Sidebar Webview] Invalid depth:', this.graphDepth);
      return;
    }
    if (this.graphMaxNodes < 5 || this.graphMaxNodes > 50) {
      console.error('[Sidebar Webview] Invalid maxNodes:', this.graphMaxNodes);
      return;
    }

    // Use depth=1 if direct links only is checked
    const effectiveDepth = this.graphDirectLinksOnly ? 1 : this.graphDepth;

    console.log('[Sidebar Webview] Requesting graph refresh', { 
      depth: effectiveDepth, 
      maxNodes: this.graphMaxNodes,
      directLinksOnly: this.graphDirectLinksOnly 
    });
    this.graphLoading = true;
    this.render();
    
    this.vscode.postMessage({ 
      command: 'refreshGraph',
      depth: effectiveDepth,
      maxNodes: this.graphMaxNodes
    });

    // Safety timeout: reset loading state after 5 seconds if no response
    setTimeout(() => {
      if (this.graphLoading) {
        console.warn('[Sidebar Webview] Graph refresh timeout, resetting loading state');
        this.graphLoading = false;
        this.render();
      }
    }, 5000);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the app
new SidebarApp();
