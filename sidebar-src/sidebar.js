"use strict";
/**
 * Sidebar webview script for Obsidian-style markdown tools
 */
class SidebarApp {
    constructor() {
        this.data = null;
        this.vscode = acquireVsCodeApi();
        this.init();
    }
    init() {
        // Listen for messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'update':
                    this.data = message.data;
                    this.render();
                    break;
            }
        });
        // Initial render
        this.render();
        // Request initial data
        this.vscode.postMessage({ command: 'refresh' });
    }
    render() {
        const app = document.getElementById('app');
        if (!app)
            return;
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
        ${this.renderGraphButton()}
      </div>
    `;
        this.attachEventListeners();
    }
    renderNoDocument() {
        return `
      <div class="no-document">
        <div class="icon">📝</div>
        <p>Open a markdown file to see links and related notes</p>
        ${this.renderTemplates()}
      </div>
    `;
    }
    renderHeader() {
        var _a, _b;
        const fileName = ((_b = (_a = this.data) === null || _a === void 0 ? void 0 : _a.currentFile) === null || _b === void 0 ? void 0 : _b.name) || 'Unknown';
        return `
      <div class="header">
        <h3 class="current-file">${this.escapeHtml(fileName)}</h3>
        <button class="refresh-btn" data-action="refresh" title="Refresh">
          <span class="codicon codicon-refresh"></span>
        </button>
      </div>
    `;
    }
    renderDefaultEditorCheck() {
        var _a;
        if ((_a = this.data) === null || _a === void 0 ? void 0 : _a.isDefaultEditor) {
            return `
        <div class="info-banner success">
          <span class="codicon codicon-check"></span>
          Default editor for .md files
        </div>
      `;
        }
        return `
      <div class="info-banner warning">
        <span class="codicon codicon-info"></span>
        <span>Not default editor</span>
        <button class="link-btn" data-action="setDefault">Set as default</button>
      </div>
    `;
    }
    renderTemplates() {
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
    renderOutgoingLinks() {
        var _a;
        const links = ((_a = this.data) === null || _a === void 0 ? void 0 : _a.outgoingLinks) || [];
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
    renderBacklinks() {
        var _a;
        const backlinks = ((_a = this.data) === null || _a === void 0 ? void 0 : _a.backlinks) || [];
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
    renderRelatedFiles() {
        var _a;
        const related = ((_a = this.data) === null || _a === void 0 ? void 0 : _a.relatedFiles) || [];
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
    renderGraphButton() {
        return `
      <div class="section">
        <button class="graph-btn" data-action="openGraph">
          <span class="codicon codicon-graph"></span>
          Open Link Graph
        </button>
      </div>
    `;
    }
    attachEventListeners() {
        // Template buttons
        document.querySelectorAll('[data-template]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const template = e.currentTarget.dataset.template;
                this.vscode.postMessage({
                    command: 'createNote',
                    template
                });
            });
        });
        // File/Link open buttons
        document.querySelectorAll('[data-action="openFile"]').forEach(item => {
            const path = item.dataset.path;
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
        // Set default editor button
        const defaultBtn = document.querySelector('[data-action="setDefault"]');
        if (defaultBtn) {
            defaultBtn.addEventListener('click', () => {
                this.vscode.postMessage({ command: 'setDefaultEditor' });
            });
        }
        // Refresh button
        const refreshBtn = document.querySelector('[data-action="refresh"]');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.vscode.postMessage({ command: 'refresh' });
            });
        }
    }
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
// Initialize the app
new SidebarApp();
//# sourceMappingURL=sidebar.js.map