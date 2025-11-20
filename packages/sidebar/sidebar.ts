/**
 * Sidebar webview script for Obsidian-style markdown tools
 */

import { GraphView, GraphData } from './components/graph-view.js';
import { vscodeLogError, vscodeLogWarn } from './webview-logger.js';

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
  loading?: {
    tags?: boolean;
    embeds?: boolean;
    outgoingLinks?: boolean;
    backlinks?: boolean;
    relatedFiles?: boolean;
    graph?: boolean;
  };
  tags?: string[];
  globalTags?: any[];
  embeds?: any[];
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

interface CacheStatus {
  isBuilding: boolean;
  cacheSize: number;
  buildProgress: { current: number; total: number; operation: string } | null;
  ttl: number;
}

class SidebarApp {
  private vscode: VSCode;
  private data: DocumentData | null = null;
  private cacheStatus: CacheStatus | null = null;
  private graphView: GraphView;
  private graphDepth: number = 1;
  private graphMaxNodes: number = 15;
  private graphLoading: boolean = false;
  private graphDirectLinksOnly: boolean = false;
  private collapsedSections: Set<string> = new Set();
  private sectionHeights: Map<string, number> = new Map();
  private isResizing: boolean = false;
  private currentResizeSection: string | null = null;
  private containerResizeObserver: ResizeObserver | null = null;
  private lastContainerHeight: number = 0;
  private readonly HEADER_SIZE = 35; // Must match CSS .section-header height
  private readonly MIN_SECTION_HEIGHT = 150;
  private readonly RESIZABLE_SECTIONS = ['templates', 'tags', 'embeds', 'outgoing-links', 'backlinks', 'related-files', 'graph'];

  constructor() {
    this.vscode = acquireVsCodeApi();
    this.graphView = new GraphView({ width: 280, height: 200, nodeRadius: 6, showLabels: true, repulsionStrength: 2000 });
    
    // Restore state
    const state = this.vscode.getState() || {};
    this.graphDepth = state.graphDepth || 1;
    this.graphMaxNodes = state.graphMaxNodes || 15;
    this.graphDirectLinksOnly = state.graphDirectLinksOnly || false;
    this.collapsedSections = new Set(state.collapsedSections || []);
    
    // Restore section heights
    if (state.sectionHeights) {
      this.sectionHeights = new Map(Object.entries(state.sectionHeights).map(([k, v]) => [k, Number(v)]));
    }
    
    this.init();
  }

  private init(): void {
    
    // Listen for messages from the extension
    window.addEventListener('message', event => {
      const message = event.data;
      
      switch (message.type) {
        case 'update':
          // Full update - replace all data
          this.data = message.data;
          this.graphLoading = message.data.loading?.graph || false;
          this.render();
          break;
        case 'updateSection':
          // Incremental update - merge section data
          if (this.data) {
            this.data = { ...this.data, ...message.data };
            this.graphLoading = message.data.loading?.graph || false;
            this.render();
          }
          break;
        case 'cacheStatus':
          // Cache status update
          this.cacheStatus = message.status;
          this.updateCacheStatusDisplay();
          break;
      }
    });

    // Initial render
    this.render();

    // Request initial data
    this.vscode.postMessage({ command: 'refresh' });
    
    // Setup container resize observer for VS Code-like behavior
    this.setupContainerResizeObserver();
  }

  private setupContainerResizeObserver(): void {
    // Observe #app for size changes to proportionally adjust sections with explicit heights
    this.containerResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        if (this.lastContainerHeight > 0 && newHeight !== this.lastContainerHeight) {
          this.handleContainerResize(this.lastContainerHeight, newHeight);
        }
        this.lastContainerHeight = newHeight;
      }
    });
    
    // Wait for #app to be rendered
    const checkApp = setInterval(() => {
      const app = document.getElementById('app');
      if (app) {
        clearInterval(checkApp);
        this.containerResizeObserver!.observe(app);
        this.lastContainerHeight = app.clientHeight;
      }
    }, 100);
  }
  
  /**
   * Get the full content height of a section (scrollHeight of section-content)
   * Similar to VSCode's body size calculation
   */
  private getContentHeight(sectionId: string): number {
    const section = document.querySelector(`.section[data-section="${sectionId}"]`);
    if (!section) return 0;
    const content = section.querySelector('.section-content') as HTMLElement;
    if (!content) return 0;
    return content.scrollHeight; // Full scrollable content height
  }
  
  /**
   * Calculate min/max constraints for a section based on content scrollability
   * VSCode pattern: sections with scrollable content can grow beyond viewport,
   * sections without scrollable content are limited to their natural size
   */
  private getSectionConstraints(sectionId: string): { min: number; max: number } {
    const section = document.querySelector(`.section[data-section="${sectionId}"]`);
    if (!section) {
      return {
        min: this.HEADER_SIZE + this.MIN_SECTION_HEIGHT,
        max: Number.POSITIVE_INFINITY
      };
    }
    
    const content = section.querySelector('.section-content') as HTMLElement;
    if (!content) {
      return {
        min: this.HEADER_SIZE + this.MIN_SECTION_HEIGHT,
        max: Number.POSITIVE_INFINITY
      };
    }
    
    const contentHeight = content.scrollHeight;
    const visibleHeight = content.clientHeight;
    
    // If content is scrollable (has more content than visible), allow growth
    // Otherwise, limit to natural content size
    const hasScrollableContent = contentHeight > visibleHeight;
    
    return {
      min: this.HEADER_SIZE + this.MIN_SECTION_HEIGHT,
      max: hasScrollableContent 
        ? Number.POSITIVE_INFINITY // Can grow indefinitely if content is scrollable
        : this.HEADER_SIZE + Math.max(this.MIN_SECTION_HEIGHT, contentHeight) // Limited to content size
    };
  }
  
  private handleContainerResize(oldHeight: number, newHeight: number): void {
    // VSCode behavior: Let CSS flexbox handle container resizing
    // Don't manually adjust section heights on container resize
    // This prevents jumping and maintains natural flex distribution
    
    // Simply ignore container resizes - CSS will handle it via flex properties
    return;
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
        ${this.renderTags()}
        ${this.renderEmbeds()}
        ${this.renderOutgoingLinks()}
        ${this.renderBacklinks()}
        ${this.renderRelatedFiles()}
        ${this.renderGraphView()}
      </div>
    `;

    this.attachEventListeners();
    this.attachGraphEvents();
    
    // Update resize handles visibility based on section positions
    this.updateResizeHandles();
  }
  
  /**
   * Update which sections show resize handles
   * VSCode behavior: only show resize handle if there's another expanded section below
   * Last expanded section never has a resize handle
   */
  private updateResizeHandles(): void {
    // Get all expanded sections in order
    const expandedSections: string[] = [];
    this.RESIZABLE_SECTIONS.forEach(sectionId => {
      if (!this.collapsedSections.has(sectionId)) {
        expandedSections.push(sectionId);
      }
    });
    
    // Remove has-section-below class from all sections first
    document.querySelectorAll('.section.resizable').forEach(el => {
      el.classList.remove('has-section-below');
    });
    
    // Add has-section-below class to sections that have another expanded section below
    expandedSections.forEach((sectionId, index) => {
      // Only add class if this is NOT the last expanded section
      if (index < expandedSections.length - 1) {
        const section = document.querySelector(`.section[data-section="${sectionId}"]`);
        if (section) {
          section.classList.add('has-section-below');
        }
      }
    });
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
        <div class="header-actions">
          <div id="cache-status" class="cache-status"></div>
          <button class="refresh-btn" data-action="refresh" title="Refresh">
            <span class="codicon codicon-refresh"></span>
          </button>
        </div>
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
    const isCollapsed = this.collapsedSections.has('templates');
    const chevron = isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    const height = this.sectionHeights.get('templates');
    // Only apply explicit height if section is expanded
    const sectionStyle = (!isCollapsed && height) ? `style="height: ${height}px;"` : '';
    const heightClass = (!isCollapsed && height) ? 'has-explicit-height' : '';
    
    return `
      <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="templates" ${sectionStyle}>
        <div class="section-header" data-section-toggle="templates">
          <span class="codicon ${chevron} chevron"></span>
          <span class="codicon codicon-file-add"></span>
          <h4>Quick Notes</h4>
        </div>
        <div class="section-content templates">
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

  private renderTags(): string {
  const tags: string[] = (this.data as any)?.tags || [];
  const globalTags: any[] = (this.data as any)?.globalTags || [];
  const loading = this.data?.loading?.tags || false;

    const isCollapsed = this.collapsedSections.has('tags');
    const chevron = isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    const height = this.sectionHeights.get('tags');
    const sectionStyle = (!isCollapsed && height) ? `style="height: ${height}px;"` : '';
    const heightClass = (!isCollapsed && height) ? 'has-explicit-height' : '';
    
    let contentHtml = '';
    if (loading) {
      contentHtml = '<div class="loading-skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';
    } else {
      const localList = tags.map(t => `<span class="tag">#${this.escapeHtml(t)}</span>`).join(' ');
      const globalList = globalTags.map((g: any) => `<div class="global-tag" data-tag="${this.escapeHtml(g.tag)}">#${this.escapeHtml(g.tag)} <span class="count">(${g.count})</span></div>`).join('');
      contentHtml = `
        <div class="tags-local">${localList || '<em>No tags in this file</em>'}</div>
        <div class="tags-global">${globalList || '<em>No tags in workspace</em>'}</div>
      `;
    }
    
    return `
      <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="tags" ${sectionStyle}>
        <div class="section-header" data-section-toggle="tags">
          <span class="codicon ${chevron} chevron"></span>
          <span class="codicon codicon-tag"></span>
          <h4>Tags</h4>
        </div>
        <div class="section-content">
          ${contentHtml}
        </div>
      </div>
    `;
  }

  private renderEmbeds(): string {
    const embeds = (this.data as any)?.embeds || [];
    const loading = this.data?.loading?.embeds || false;
    
    if (!loading && (!embeds || embeds.length === 0)) return '';

    const isCollapsed = this.collapsedSections.has('embeds');
    const chevron = isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    const height = this.sectionHeights.get('embeds');
    const sectionStyle = (!isCollapsed && height) ? `style="height: ${height}px;"` : '';
    const heightClass = (!isCollapsed && height) ? 'has-explicit-height' : '';
    
    let contentHtml = '';
    if (loading) {
      contentHtml = '<div class="loading-skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div>';
    } else {
      const list = embeds.map((e: any) => `
        <div class="embed-item">
          <span class="codicon codicon-file-media"></span>
          <div class="embed-info">
            <div class="embed-filename">${this.escapeHtml(e.filename)}</div>
            <div class="embed-path">${this.escapeHtml(e.resolved || 'Not found')}</div>
          </div>
          <div class="embed-actions">
            <button class="embed-preview-btn" data-path="${this.escapeHtml(e.resolved || '')}" data-raw="${this.escapeHtml(e.raw)}">Preview</button>
          </div>
        </div>
      `).join('');
      contentHtml = list;
    }
    
    return `
      <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="embeds" ${sectionStyle}>
        <div class="section-header" data-section-toggle="embeds">
          <span class="codicon ${chevron} chevron"></span>
          <span class="codicon codicon-file-media"></span>
          <h4>Embeds</h4>
          <span class="count">${loading ? '...' : embeds.length}</span>
        </div>
        <div class="section-content embeds-list">${contentHtml}</div>
      </div>
    `;
  }

  private renderOutgoingLinks(): string {
    const links = this.data?.outgoingLinks || [];
    const loading = this.data?.loading?.outgoingLinks || false;
    const isCollapsed = this.collapsedSections.has('outgoing-links');
    const chevron = isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    const height = this.sectionHeights.get('outgoing-links');
    const sectionStyle = (!isCollapsed && height) ? `style="height: ${height}px;"` : '';
    const heightClass = (!isCollapsed && height) ? 'has-explicit-height' : '';
    
    if (loading) {
      return `
        <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="outgoing-links" ${sectionStyle}>
          <div class="section-header" data-section-toggle="outgoing-links">
            <span class="codicon ${chevron} chevron"></span>
            <span class="codicon codicon-link-external"></span>
            <h4>Outgoing Links</h4>
            <span class="count">...</span>
          </div>
          <div class="section-content"><div class="loading-skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>
        </div>
      `;
    }
    
    if (links.length === 0) {
      return `
        <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="outgoing-links" ${sectionStyle}>
          <div class="section-header" data-section-toggle="outgoing-links">
            <span class="codicon ${chevron} chevron"></span>
            <span class="codicon codicon-link-external"></span>
            <h4>Outgoing Links</h4>
            <span class="count">0</span>
          </div>
          <div class="section-content empty">No outgoing links</div>
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
      <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="outgoing-links" ${sectionStyle}>
        <div class="section-header" data-section-toggle="outgoing-links">
          <span class="codicon ${chevron} chevron"></span>
          <span class="codicon codicon-link-external"></span>
          <h4>Outgoing Links</h4>
          <span class="count">${links.length}</span>
        </div>
        <div class="section-content links-list">
          ${linksList}
        </div>
      </div>
    `;
  }

  private renderBacklinks(): string {
    const backlinks = this.data?.backlinks || [];
    const loading = this.data?.loading?.backlinks || false;
    const isCollapsed = this.collapsedSections.has('backlinks');
    const chevron = isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    const height = this.sectionHeights.get('backlinks');
    const sectionStyle = (!isCollapsed && height) ? `style="height: ${height}px;"` : '';
    const heightClass = (!isCollapsed && height) ? 'has-explicit-height' : '';
    
    if (loading) {
      return `
        <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="backlinks" ${sectionStyle}>
          <div class="section-header" data-section-toggle="backlinks">
            <span class="codicon ${chevron} chevron"></span>
            <span class="codicon codicon-references"></span>
            <h4>Backlinks</h4>
            <span class="count">...</span>
          </div>
          <div class="section-content"><div class="loading-skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>
        </div>
      `;
    }
    
    if (backlinks.length === 0) {
      return `
        <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="backlinks" ${sectionStyle}>
          <div class="section-header" data-section-toggle="backlinks">
            <span class="codicon ${chevron} chevron"></span>
            <span class="codicon codicon-references"></span>
            <h4>Backlinks</h4>
            <span class="count">0</span>
          </div>
          <div class="section-content empty">No backlinks found</div>
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
      <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="backlinks" ${sectionStyle}>
        <div class="section-header" data-section-toggle="backlinks">
          <span class="codicon ${chevron} chevron"></span>
          <span class="codicon codicon-references"></span>
          <h4>Backlinks</h4>
          <span class="count">${backlinks.length}</span>
        </div>
        <div class="section-content files-list">
          ${backlinksList}
        </div>
      </div>
    `;
  }

  private renderRelatedFiles(): string {
    const related = this.data?.relatedFiles || [];
    const loading = this.data?.loading?.relatedFiles || false;
    
    if (!loading && related.length === 0) {
      return '';
    }
    
    const isCollapsed = this.collapsedSections.has('related-files');
    const chevron = isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    const height = this.sectionHeights.get('related-files');
    const sectionStyle = (!isCollapsed && height) ? `style="height: ${height}px;"` : '';
    const heightClass = (!isCollapsed && height) ? 'has-explicit-height' : '';
    
    if (loading) {
      return `
        <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="related-files" ${sectionStyle}>
          <div class="section-header" data-section-toggle="related-files">
            <span class="codicon ${chevron} chevron"></span>
            <span class="codicon codicon-file-symlink-directory"></span>
            <h4>Related Files</h4>
            <span class="count">...</span>
          </div>
          <div class="section-content"><div class="loading-skeleton"><div class="skeleton-line"></div><div class="skeleton-line"></div></div></div>
        </div>
      `;
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
      <div class="section resizable ${isCollapsed ? 'collapsed' : ''} ${heightClass}" data-section="related-files" ${sectionStyle}>
        <div class="section-header" data-section-toggle="related-files">
          <span class="codicon ${chevron} chevron"></span>
          <span class="codicon codicon-file-symlink-directory"></span>
          <h4>Related Files</h4>
          <span class="count">${related.length}</span>
        </div>
        <div class="section-content files-list">
          ${relatedList}
        </div>
      </div>
    `;
  }

  private renderGraphView(): string {
    const graphData = this.data?.graphData;
    const isCollapsed = this.collapsedSections.has('graph');
    const chevron = isCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down';
    
    // Show loading state
    if (this.graphLoading) {
      return `
        <div class="section ${isCollapsed ? 'collapsed' : ''}" data-section="graph">
          <div class="section-header" data-section-toggle="graph">
            <span class="codicon ${chevron} chevron"></span>
            <span class="codicon codicon-graph"></span>
            <h4>Link Graph</h4>
          </div>
          <div class="section-content">
            ${this.graphView.renderLoading()}
          </div>
        </div>
      `;
    }
    
    // Show empty state
    if (!graphData || (graphData.nodes.length === 0 && graphData.edges.length === 0)) {
      return `
        <div class="section ${isCollapsed ? 'collapsed' : ''}" data-section="graph">
          <div class="section-header" data-section-toggle="graph">
            <span class="codicon ${chevron} chevron"></span>
            <span class="codicon codicon-graph"></span>
            <h4>Link Graph</h4>
          </div>
          <div class="section-content">
            ${this.graphView.renderEmpty()}
          </div>
        </div>
      `;
    }

    const graphContent = this.graphView.render(graphData);
    const collapseIcon = chevron;
    
    return `
      <div class="section ${isCollapsed ? 'collapsed' : ''}" data-section="graph">
        <div class="section-header" data-section-toggle="graph">
          <span class="codicon ${collapseIcon} chevron"></span>
          <span class="codicon codicon-graph"></span>
          <h4>Link Graph</h4>
          <span class="count">${graphData.nodes.length}</span>
        </div>
        <div class="section-content graph-container" id="graph-container">
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
            <div class="filter-group">
              <label for="graph-node-distance">Node distance: <span id="node-distance-value">2000</span></label>
              <input 
                type="range" 
                id="graph-node-distance" 
                min="1000" 
                max="20000" 
                step="100"
                value="2000" 
                class="graph-slider"
                data-action="changeNodeDistance"
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
    // Template buttons
    document.querySelectorAll('[data-template]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const template = (e.currentTarget as HTMLElement).dataset.template;
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
        this.vscode.postMessage({ command: 'openGraphView' });
      });
    }

    // Embed preview buttons
    document.querySelectorAll('.embed-preview-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const el = e.currentTarget as HTMLElement;
        const path = el.dataset.path || '';
        const raw = el.dataset.raw || '';
        this.vscode.postMessage({ command: 'openEmbed', path, raw });
      });
    });

    // Global tag clicks (filter by tag)
    document.querySelectorAll('.global-tag').forEach(el => {
      el.addEventListener('click', (e) => {
        const tag = (e.currentTarget as HTMLElement).dataset.tag;
        // Request extension to focus/tag-filter (future)
        this.vscode.postMessage({ command: 'filterByTag', tag });
      });
    });

    // Set default editor button
    const defaultBtn = document.querySelector('[data-action="setDefault"]');
    if (defaultBtn) {
      defaultBtn.addEventListener('click', () => {
        this.vscode.postMessage({ command: 'setDefaultEditor' });
      });
    }

    // Dismiss warning button
    const dismissBtn = document.querySelector('[data-action="dismissWarning"]');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
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
        this.vscode.postMessage({ command: 'refresh' });
      });
    }
    
    // Section toggle handlers
    document.querySelectorAll('[data-section-toggle]').forEach(header => {
      header.addEventListener('click', (e) => {
        const sectionId = (e.currentTarget as HTMLElement).dataset.sectionToggle;
        if (sectionId) {
          this.toggleSection(sectionId);
        }
      });
    });
    
    // Attach resize handlers to resizable sections
    this.attachResizeHandlers();
  }
  
  private toggleSection(sectionId: string): void {
    const wasCollapsed = this.collapsedSections.has(sectionId);
    
    if (wasCollapsed) {
      this.collapsedSections.delete(sectionId);
      // When opening a section, let it be naturally sized by flexbox
      // Don't force an explicit height unless user manually resizes
    } else {
      this.collapsedSections.add(sectionId);
    }
    
    // Save state
    const state = this.vscode.getState() || {};
    state.collapsedSections = Array.from(this.collapsedSections);
    this.vscode.setState(state);
    
    // Re-render
    this.render();
    // Note: updateResizeHandles() is called at the end of render()
  }
  
  private attachResizeHandlers(): void {
    // Attach mousedown handlers to section resize handles
    document.querySelectorAll('.section.resizable').forEach(section => {
      const sectionEl = section as HTMLElement;
      const sectionId = sectionEl.dataset.section;
      if (!sectionId) return;
      
      // Only allow resize on expanded sections
      if (sectionEl.classList.contains('collapsed')) return;
      
      // Create a resize handle area
      sectionEl.addEventListener('mousedown', (e: MouseEvent) => {
        // Don't allow resize if section is collapsed
        if (sectionEl.classList.contains('collapsed')) return;
        
        const rect = sectionEl.getBoundingClientRect();
        const isNearBottom = e.clientY > rect.bottom - 10;
        
        if (isNearBottom) {
          e.preventDefault();
          this.startResize(sectionId, e.clientY);
        }
      });
    });
    
    // Global mousemove and mouseup handlers
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (this.isResizing && this.currentResizeSection) {
        this.handleResize(e.clientY);
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (this.isResizing) {
        this.endResize();
      }
    });
  }
  
  private startResize(sectionId: string, startY: number): void {
    this.isResizing = true;
    this.currentResizeSection = sectionId;
    
    const section = document.querySelector(`.section[data-section="${sectionId}"]`) as HTMLElement;
    if (section) {
      section.classList.add('resizing');
      // Store current height of entire section
      const currentHeight = section.offsetHeight;
      this.sectionHeights.set(sectionId, currentHeight);
    }
    
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }
  
  private handleResize(currentY: number): void {
    if (!this.currentResizeSection) return;
    
    const section = document.querySelector(`.section[data-section="${this.currentResizeSection}"]`) as HTMLElement;
    if (!section || section.classList.contains('collapsed')) return;
    
    const rect = section.getBoundingClientRect();
    const desiredHeight = currentY - rect.top;
    
    // Get content-based constraints (VSCode pattern)
    const constraints = this.getSectionConstraints(this.currentResizeSection);
    
    // Clamp between min and max - prevents growing beyond content if not scrollable
    const newHeight = Math.max(constraints.min, Math.min(constraints.max, desiredHeight));
    const oldHeight = this.sectionHeights.get(this.currentResizeSection) || section.offsetHeight;
    
    // Only apply if there's a significant change
    if (Math.abs(newHeight - oldHeight) < 5) return;
    
    // VSCode behavior: Only set explicit height on the section being resized
    // Other sections will flex naturally via CSS - don't manually adjust them
    section.style.height = `${newHeight}px`;
    section.classList.add('has-explicit-height');
    this.sectionHeights.set(this.currentResizeSection, newHeight);
  }
  

  
  private endResize(): void {
    this.isResizing = false;
    
    if (this.currentResizeSection) {
      const section = document.querySelector(`.section[data-section="${this.currentResizeSection}"]`) as HTMLElement;
      if (section) {
        section.classList.remove('resizing');
      }
      
      // Save state
      const state = this.vscode.getState() || {};
      const heightsObj: Record<string, number> = {};
      this.sectionHeights.forEach((value, key) => {
        heightsObj[key] = value;
      });
      state.sectionHeights = heightsObj;
      this.vscode.setState(state);
      
      this.currentResizeSection = null;
    }
    
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  private attachGraphEvents(): void {
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

    // Node distance filter
    const nodeDistanceSlider = document.querySelector('[data-action="changeNodeDistance"]') as HTMLInputElement;
    if (nodeDistanceSlider) {
      nodeDistanceSlider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const nodeDistance = parseInt(target.value, 10);
        const valueDisplay = document.getElementById('node-distance-value');
        if (valueDisplay) {
          valueDisplay.textContent = String(nodeDistance);
        }
        // Update graph view with new repulsion strength
        this.graphView = new GraphView({ 
          width: 280, 
          height: 200, 
          nodeRadius: 6, 
          showLabels: true, 
          repulsionStrength: nodeDistance
        });
        // Re-render immediately for live feedback
        if (this.data?.graphData) {
          const graphContainer = document.getElementById('graph-container');
          if (graphContainer) {
            const graphContent = this.graphView.render(this.data.graphData);
            const existingGraph = graphContainer.querySelector('.graph-container');
            if (existingGraph) {
              existingGraph.outerHTML = graphContent;
              // Re-attach events after re-render
              this.graphView.attachZoomEvents(graphContainer);
              this.graphView.attachEvents(graphContainer, (nodeId: string, label: string) => {
                this.vscode.postMessage({
                  command: 'openFile',
                  filePath: nodeId
                });
              });
            }
          }
        }
      });
    }

    // Expand full graph
    const expandBtn = document.querySelector('[data-action="openFullGraph"]');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        this.vscode.postMessage({ command: 'openGraphView' });
      });
    }

    // Attach click events to graph nodes
    const graphContainer = document.getElementById('graph-container');
    if (graphContainer) {
      // Attach zoom controls
      this.graphView.attachZoomEvents(graphContainer);
      
      // Attach node click events
      this.graphView.attachEvents(graphContainer, (nodeId: string, label: string) => {
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
      vscodeLogError('[Sidebar Webview] Invalid depth:', this.graphDepth);
      return;
    }
    if (this.graphMaxNodes < 5 || this.graphMaxNodes > 50) {
      vscodeLogError('[Sidebar Webview] Invalid maxNodes:', this.graphMaxNodes);
      return;
    }

    // Use depth=1 if direct links only is checked
    const effectiveDepth = this.graphDirectLinksOnly ? 1 : this.graphDepth;

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
        vscodeLogWarn('[Sidebar Webview] Graph refresh timeout, resetting loading state');
        this.graphLoading = false;
        this.render();
      }
    }, 5000);
  }

  private updateCacheStatusDisplay(): void {
    const statusEl = document.getElementById('cache-status');
    if (!statusEl || !this.cacheStatus) return;

    if (this.cacheStatus.isBuilding && this.cacheStatus.buildProgress) {
      const { current, total, operation } = this.cacheStatus.buildProgress;
      statusEl.innerHTML = `
        <span class="cache-building" title="${this.escapeHtml(operation)}">
          <span class="codicon codicon-sync codicon-modifier-spin"></span>
          ${current}/${total}
        </span>
      `;
      statusEl.classList.add('visible');
    } else {
      const cacheSize = this.cacheStatus.cacheSize;
      const ttlMinutes = Math.floor(this.cacheStatus.ttl / 60000);
      statusEl.innerHTML = `
        <button class="cache-rebuild-btn" data-action="rebuildCache" title="Rebuild cache (${cacheSize} entries, ${ttlMinutes}min TTL)">
          <span class="codicon codicon-database"></span>
          <span class="cache-count">${cacheSize}</span>
        </button>
      `;
      statusEl.classList.add('visible');
      
      // Attach event listener
      const rebuildBtn = statusEl.querySelector('[data-action="rebuildCache"]');
      if (rebuildBtn) {
        rebuildBtn.addEventListener('click', () => {
          this.vscode.postMessage({ command: 'rebuildCache' });
        });
      }
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize the app
new SidebarApp();
