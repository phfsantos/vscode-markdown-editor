import { BaseRenderer } from '../BaseRenderer';
import { IRenderer, IRenderContext, IRendererCapabilities } from '../types';
import { vscodeLogError, vscodeLog } from '../../webview-logger';
import { initializeWidgetSystem } from '../../widget-integration';
import { dispatchVditorInput } from '../../content-sync';

/**
 * Widget configuration in dashboard
 */
interface DashboardWidgetConfig {
  type: string;
  title?: string;
  colspan?: number; // How many columns to span (default: 1)
  rowspan?: number; // How many rows to span (default: 1)
  row?: number; // Grid row position (1-indexed, for explicit positioning)
  column?: number; // Grid column position (1-indexed, for explicit positioning)
  config?: Record<string, any>;
  data?: any;
  // Future: connector support foundation
  connectorId?: string; // Unique ID for connecting widgets
  connectTo?: string[]; // Widget connectorIds to connect to
  connectorStyle?: 'arrow' | 'line' | 'curved';
}

/**
 * Dashboard configuration
 */
interface DashboardConfig {
  title?: string;
  columns?: number; // Number of grid columns (default: 3)
  rows?: number; // Explicit row count (auto if not set)
  gap?: number; // Gap between widgets in pixels (default: 16)
  minWidgetWidth?: number; // Minimum widget width for responsiveness (default: 250)
  editMode?: boolean; // Whether dashboard is in edit mode
  widgets: DashboardWidgetConfig[];
}

/**
 * DashboardRenderer - Renders a dashboard with multiple widgets in a grid layout
 * 
 * Features:
 * - Responsive grid layout (auto-adjusts columns based on viewport)
 * - Edit mode with drag-and-drop widget positioning
 * - Add/remove widgets from registered widget types
 * - Settings panel for grid configuration
 * - Widget position data persistence
 * - Widgets centered in grid cells with consistent spacing
 * - Foundation for future widget connectors
 * 
 * Usage:
 * ```dashboard
 * title: My Dashboard
 * columns: 3
 * gap: 16
 * minWidgetWidth: 250
 * editMode: false
 * widgets:
 *   - type: clock
 *     title: Current Time
 *     row: 1
 *     column: 1
 *   - type: timer
 *     title: Focus Timer
 *     colspan: 2
 * ```
 */
export class DashboardRenderer extends BaseRenderer implements IRenderer {
  readonly id = 'dashboard-renderer';
  readonly name = 'Dashboard';
  readonly language = 'dashboard';
  readonly version = '2.0.0';
  readonly description = 'Multi-widget dashboard with grid layout, edit mode, and responsive design';
  readonly author = 'VSCode Markdown Editor';
  
  readonly capabilities: IRendererCapabilities = {
    supportsPersistence: true,
    supportsMultipleInstances: true,
    supportsExport: false,
    supportsImport: false,
    requiresExtensionHost: false
  };
  
  // State management
  private currentConfig: DashboardConfig | null = null;
  private currentCodeBlockNode: HTMLElement | null = null;
  private currentVditor: any = null;
  private currentContainer: HTMLElement | null = null;
  private widgetUpdateHandler: ((e: Event) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private editMode: boolean = false;
  private draggedWidget: HTMLElement | null = null;
  private dragOverWidget: HTMLElement | null = null;
  
  // Track calculated responsive columns
  private currentResponsiveColumns: number = 3;

  /**
   * Initialize widget system on load
   */
  async onLoad(context: IRenderContext): Promise<void> {
    initializeWidgetSystem();
    if (context.vditor) {
      this.currentVditor = context.vditor;
    }
    this.setupWidgetUpdateListener(context);
  }
  
  /**
   * Setup listener for widget-update events (for persistence)
   */
  private setupWidgetUpdateListener(context: IRenderContext): void {
    if (this.widgetUpdateHandler) {
      document.removeEventListener('widget-update', this.widgetUpdateHandler);
    }
    
    this.widgetUpdateHandler = (e: Event) => {
      const customEvent = e as CustomEvent;
      const detail = customEvent.detail;
      
      if (!detail) return;
      
      const widgetId = detail.widgetId;
      if (!widgetId || !this.currentConfig) return;
      
      // Only handle dashboard widgets
      if (!widgetId.startsWith('dashboard-widget-')) return;
      
      const dashboardContainer = document.querySelector('.dashboard-container');
      if (!dashboardContainer) return;
      
      // Find widget wrapper by ID
      const widgetWrappers = dashboardContainer.querySelectorAll('.dashboard-widget-wrapper');
      let foundIndex = -1;
      
      widgetWrappers.forEach((wrapper, idx) => {
        if (wrapper.getAttribute('data-widget-id') === widgetId) {
          foundIndex = idx;
        }
      });
      
      if (foundIndex === -1) return;
      
      const widget = this.currentConfig.widgets[foundIndex];
      if (!widget) return;
      
      if (detail.config) {
        const { colspan, rowspan, row, column, connectorId, connectTo } = widget;
        const updatedConfig = detail.config;
        
        widget.type = updatedConfig.type || widget.type;
        widget.title = updatedConfig.title || widget.title;
        
        // Merge config properties
        widget.config = widget.config || {};
        for (const [key, value] of Object.entries(updatedConfig)) {
          if (!['type', 'title', 'id', 'colspan', 'rowspan', 'row', 'column'].includes(key)) {
            widget.config[key] = value;
          }
        }
        
        // Preserve position/layout
        widget.colspan = colspan;
        widget.rowspan = rowspan;
        widget.row = row;
        widget.column = column;
        widget.connectorId = connectorId;
        widget.connectTo = connectTo;
        
        if (detail.data) {
          widget.data = detail.data;
        }
        
        this.persistDashboardConfig();
      }
    };
    
    document.addEventListener('widget-update', this.widgetUpdateHandler);
  }
  
  /**
   * Persist the current dashboard config back to the code block
   */
  private persistDashboardConfig(): void {
    const vditor = this.currentVditor || (window as any).vditor;
    
    if (!this.currentConfig || !this.currentCodeBlockNode || !vditor) {
      return;
    }
    
    const content = this.serializeDashboardConfig(this.currentConfig);
    this.updateCodeBlock(this.currentCodeBlockNode, content, vditor);
  }
  
  /**
   * Serialize dashboard config back to YAML-like format
   */
  private serializeDashboardConfig(config: DashboardConfig): string {
    const lines: string[] = [];
    
    // Top-level config
    if (config.title) {
      lines.push(`title: ${config.title}`);
    }
    if (config.columns !== undefined && config.columns !== 3) {
      lines.push(`columns: ${config.columns}`);
    }
    if (config.gap !== undefined && config.gap !== 16) {
      lines.push(`gap: ${config.gap}`);
    }
    if (config.minWidgetWidth !== undefined && config.minWidgetWidth !== 250) {
      lines.push(`minWidgetWidth: ${config.minWidgetWidth}`);
    }
    if (config.editMode) {
      lines.push(`editMode: true`);
    }
    
    // Widgets
    lines.push('widgets:');
    for (const widget of config.widgets) {
      lines.push(`  - type: ${widget.type}`);
      
      if (widget.title) {
        lines.push(`    title: ${widget.title}`);
      }
      if (widget.row !== undefined && widget.row > 0) {
        lines.push(`    row: ${widget.row}`);
      }
      if (widget.column !== undefined && widget.column > 0) {
        lines.push(`    column: ${widget.column}`);
      }
      if (widget.colspan && widget.colspan > 1) {
        lines.push(`    colspan: ${widget.colspan}`);
      }
      if (widget.rowspan && widget.rowspan > 1) {
        lines.push(`    rowspan: ${widget.rowspan}`);
      }
      // Connector foundation
      if (widget.connectorId) {
        lines.push(`    connectorId: ${widget.connectorId}`);
      }
      if (widget.connectTo && widget.connectTo.length > 0) {
        lines.push(`    connectTo: ${JSON.stringify(widget.connectTo)}`);
      }
      
      // Widget-specific config
      if (widget.config && Object.keys(widget.config).length > 0) {
        lines.push(`    config:`);
        for (const [key, value] of Object.entries(widget.config)) {
          if (typeof value === 'object' && value !== null) {
            lines.push(`      ${key}: ${JSON.stringify(value)}`);
          } else {
            lines.push(`      ${key}: ${value}`);
          }
        }
      }
      
      // Widget data
      if (widget.data && Object.keys(widget.data).length > 0) {
        lines.push(`    data:`);
        for (const [key, value] of Object.entries(widget.data)) {
          if (typeof value === 'object' && value !== null) {
            lines.push(`      ${key}: ${JSON.stringify(value)}`);
          } else {
            lines.push(`      ${key}: ${value}`);
          }
        }
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Update the code block content in Vditor
   */
  private updateCodeBlock(codeBlockNode: HTMLElement, newContent: string, vditor: any): void {
    try {
      // Find the marker code element (source of truth in IR mode)
      const markerCode = codeBlockNode.querySelector('.vditor-ir__marker--pre code');
      if (markerCode) {
        markerCode.textContent = newContent;
      } else {
        const codeEl = codeBlockNode.querySelector('code.language-dashboard, code[class*="language-dashboard"]');
        if (codeEl) {
          codeEl.textContent = newContent;
        }
      }
      
      // Let Vditor serialize the completed mutation through its input callback.
      if (vditor) {
        dispatchVditorInput(vditor);
      }
      
      if (vditor && typeof vditor.ir?.processAfterRender === 'function') {
        vditor.ir.processAfterRender(vditor);
      }
    } catch (error) {
      vscodeLogError('[DashboardRenderer] Failed to update code block:', error);
    }
  }

  /**
   * Parse dashboard configuration from YAML-like content
   */
  private parseDashboardConfig(content: string): DashboardConfig | null {
    try {
      const trimmed = content.trim();
      if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed) as DashboardConfig;
      }
      
      const lines = content.split('\n');
      const config: DashboardConfig = {
        widgets: [],
        columns: 3,
        gap: 16,
        minWidgetWidth: 400
      };
      
      let currentWidget: DashboardWidgetConfig | null = null;
      let inWidgets = false;
      let currentSection: 'config' | 'data' | null = null;
      let sectionContent: string[] = [];
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (!trimmedLine || trimmedLine.startsWith('#')) continue;
        
        if (trimmedLine === 'widgets:') {
          inWidgets = true;
          continue;
        }
        
        // Top-level config
        if (!inWidgets) {
          const colonIdx = trimmedLine.indexOf(':');
          if (colonIdx > 0) {
            const key = trimmedLine.substring(0, colonIdx).trim();
            const value = trimmedLine.substring(colonIdx + 1).trim();
            
            if (key === 'title') {
              config.title = value;
            } else if (key === 'columns') {
              config.columns = parseInt(value, 10) || 3;
            } else if (key === 'rows') {
              config.rows = parseInt(value, 10);
            } else if (key === 'gap') {
              config.gap = parseInt(value, 10) || 16;
            } else if (key === 'minWidgetWidth') {
              config.minWidgetWidth = parseInt(value, 10) || 250;
            } else if (key === 'editMode') {
              config.editMode = value === 'true';
            }
          }
          continue;
        }
        
        // Widget array item start
        if (trimmedLine.startsWith('- type:')) {
          if (currentWidget) {
            this.finishSection(currentWidget, currentSection, sectionContent);
            config.widgets.push(currentWidget);
          }
          
          currentWidget = {
            type: trimmedLine.substring(7).trim()
          };
          currentSection = null;
          sectionContent = [];
          continue;
        }
        
        // Widget properties
        if (currentWidget && (line.startsWith('    ') || line.startsWith('\t'))) {
          const propLine = trimmedLine;
          const colonIdx = propLine.indexOf(':');
          
          if (colonIdx > 0) {
            const key = propLine.substring(0, colonIdx).trim();
            const value = propLine.substring(colonIdx + 1).trim();
            
            if (key === 'config' && !value) {
              this.finishSection(currentWidget, currentSection, sectionContent);
              currentSection = 'config';
              sectionContent = [];
              continue;
            }
            if (key === 'data' && !value) {
              this.finishSection(currentWidget, currentSection, sectionContent);
              currentSection = 'data';
              sectionContent = [];
              continue;
            }
            
            if (currentSection) {
              sectionContent.push(propLine);
              continue;
            }
            
            // Direct properties
            if (key === 'title') {
              currentWidget.title = value;
            } else if (key === 'colspan') {
              currentWidget.colspan = parseInt(value, 10) || 1;
            } else if (key === 'rowspan') {
              currentWidget.rowspan = parseInt(value, 10) || 1;
            } else if (key === 'row') {
              currentWidget.row = parseInt(value, 10);
            } else if (key === 'column') {
              currentWidget.column = parseInt(value, 10);
            } else if (key === 'connectorId') {
              currentWidget.connectorId = value;
            } else if (key === 'connectTo') {
              try {
                currentWidget.connectTo = JSON.parse(value);
              } catch {
                currentWidget.connectTo = [value];
              }
            } else if (key === 'connectorStyle') {
              currentWidget.connectorStyle = value as 'arrow' | 'line' | 'curved';
            }
          } else if (currentSection) {
            sectionContent.push(propLine);
          }
        }
      }
      
      if (currentWidget) {
        this.finishSection(currentWidget, currentSection, sectionContent);
        config.widgets.push(currentWidget);
      }
      
      return config;
    } catch (error) {
      vscodeLogError('[DashboardRenderer] Failed to parse dashboard config:', error);
      return null;
    }
  }
  
  /**
   * Finish parsing a section (config or data)
   */
  private finishSection(
    widget: DashboardWidgetConfig, 
    section: 'config' | 'data' | null, 
    content: string[]
  ): void {
    if (!section || content.length === 0) return;
    
    const obj: Record<string, any> = {};
    for (const line of content) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim();
        let value: any = line.substring(colonIdx + 1).trim();
        
        if (value.startsWith('{') || value.startsWith('[')) {
          try { value = JSON.parse(value); } catch { /* keep string */ }
        } else if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        } else if (!isNaN(Number(value)) && value !== '') {
          value = Number(value);
        }
        
        obj[key] = value;
      }
    }
    
    if (section === 'config') {
      widget.config = obj;
    } else {
      widget.data = obj;
    }
  }

  /**
   * Render the dashboard
   */
  async render(element: HTMLElement, vditor: any, context: IRenderContext): Promise<void> {
    try {
      // Check if already rendered
      const existingDashboard = element.querySelector('.dashboard-container');
      if (existingDashboard) {
        return;
      }

      initializeWidgetSystem();
      
      if (!window.markdownWidgets) {
        this.showDashboardError(element, 'Widget system not available.');
        return;
      }

      const content = this.extractCode(element);
      if (!content) {
        this.showDashboardError(element, 'Empty dashboard block');
        return;
      }

      const config = this.parseDashboardConfig(content);
      if (!config) {
        this.showDashboardError(element, 'Failed to parse dashboard configuration');
        return;
      }

      // Create main wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'dashboard-wrapper';
      wrapper.style.cssText = `
        position: relative;
        margin: 8px 0;
      `;

      // Create toolbar
      const toolbar = this.createToolbar(config);
      wrapper.appendChild(toolbar);

      // Create dashboard container
      const container = document.createElement('div');
      container.className = 'dashboard-container';
      this.currentContainer = container;
      
      const columns = config.columns || 3;
      const gap = config.gap || 16;
      const minWidgetWidth = config.minWidgetWidth || 400;
      
      // Use CSS grid with auto-fit for responsiveness
      container.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(${minWidgetWidth}px, 1fr));
        gap: ${gap}px;
        padding: 16px;
        border-radius: 0 0 8px 8px;
        background: var(--vscode-editor-background, #1e1e1e);
        border: 1px solid var(--vscode-panel-border, #454545);
        border-top: none;
        min-height: 200px;
      `;
      
      // Store max columns for explicit positioning
      container.setAttribute('data-max-columns', String(columns));
      container.setAttribute('data-gap', String(gap));
      container.setAttribute('data-min-widget-width', String(minWidgetWidth));

      // Add dashboard title if provided
      if (config.title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'dashboard-title';
        titleEl.style.cssText = `
          grid-column: 1 / -1;
          font-size: 1.5em;
          font-weight: 600;
          color: var(--vscode-foreground, #cccccc);
          padding-bottom: 8px;
          border-bottom: 1px solid var(--vscode-panel-border, #454545);
          margin-bottom: 8px;
        `;
        titleEl.textContent = config.title;
        container.appendChild(titleEl);
      }

      const { WidgetRegistry } = window.markdownWidgets;
      if (!WidgetRegistry) {
        this.showDashboardError(element, 'WidgetRegistry not found');
        return;
      }
      
      const registry = WidgetRegistry.getInstance();

      // Render widgets
      if (config.widgets.length === 0) {
        // Show empty state with add button
        const emptyState = this.createEmptyState(registry);
        container.appendChild(emptyState);
      } else {
        for (let i = 0; i < config.widgets.length; i++) {
          const widgetConfig = config.widgets[i];
          const widgetWrapper = this.createWidgetWrapper(widgetConfig, registry, i, config.editMode || false);
          container.appendChild(widgetWrapper);
        }
      }

      wrapper.appendChild(container);

      // Setup resize observer for responsive columns
      this.setupResizeObserver(container, config);

      // Replace element content
      element.innerHTML = '';
      element.appendChild(wrapper);

      // Get Vditor node for event handling
      const ir__node = element.closest('.vditor-ir__node') as HTMLElement;
      const wysiwyg__node = element.closest('.vditor-wysiwyg__block') as HTMLElement;
      const containerNode = ir__node || wysiwyg__node;

      // Store references
      this.currentConfig = config;
      this.currentCodeBlockNode = containerNode;
      this.currentVditor = vditor;
      this.editMode = config.editMode || false;

      if (containerNode) {
        this.setupVditorEventStoppers(wrapper, containerNode);
      }

      // If edit mode is on, enable drag and drop
      if (this.editMode) {
        this.enableEditMode(container);
      }

      vscodeLog(`[DashboardRenderer] Rendered dashboard with ${config.widgets.length} widgets`);
    } catch (error) {
      vscodeLogError('[DashboardRenderer] Render failed:', error);
      this.showDashboardError(element, `Failed to render dashboard: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create the dashboard toolbar with settings and edit mode toggle
   */
  private createToolbar(config: DashboardConfig): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'dashboard-toolbar';
    toolbar.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 8px 16px;
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, #454545);
      border-radius: 8px 8px 0 0;
    `;

    // Settings button
    const settingsBtn = this.createToolbarButton('⚙️', 'Dashboard Settings', () => {
      this.showSettingsPanel(config);
    });
    
    // Add widget button
    const addBtn = this.createToolbarButton('➕', 'Add Widget', () => {
      this.showAddWidgetPanel();
    });
    
    // Edit mode toggle
    const editBtn = this.createToolbarButton(
      config.editMode ? '✅ Edit Mode' : '✏️ Edit',
      config.editMode ? 'Exit Edit Mode' : 'Enter Edit Mode (drag to reorder)',
      () => {
        this.toggleEditMode();
      }
    );
    editBtn.className = 'dashboard-edit-toggle';
    if (config.editMode) {
      editBtn.style.background = 'var(--vscode-button-background, #0e639c)';
      editBtn.style.color = 'var(--vscode-button-foreground, #ffffff)';
    }

    toolbar.appendChild(settingsBtn);
    toolbar.appendChild(addBtn);
    toolbar.appendChild(editBtn);

    return toolbar;
  }

  /**
   * Create a toolbar button
   */
  private createToolbarButton(text: string, title: string, onClick: () => void): HTMLElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.title = title;
    btn.style.cssText = `
      padding: 4px 12px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #cccccc);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'var(--vscode-button-secondaryHoverBackground, #45494e)';
    });
    btn.addEventListener('mouseleave', () => {
      if (!btn.classList.contains('dashboard-edit-toggle') || !this.editMode) {
        btn.style.background = 'var(--vscode-button-secondaryBackground, #3a3d41)';
      }
    });
    return btn;
  }

  /**
   * Create empty state when no widgets
   */
  private createEmptyState(_registry: any): HTMLElement {
    const emptyState = document.createElement('div');
    emptyState.className = 'dashboard-empty-state';
    emptyState.style.cssText = `
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px;
      color: var(--vscode-descriptionForeground, #888888);
      text-align: center;
    `;
    
    emptyState.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">📊</div>
      <div style="font-size: 16px; margin-bottom: 8px;">No widgets yet</div>
      <div style="font-size: 13px; margin-bottom: 16px;">Click "Add Widget" in the toolbar to get started</div>
    `;
    
    const addBtn = document.createElement('button');
    addBtn.textContent = '➕ Add Widget';
    addBtn.style.cssText = `
      padding: 8px 16px;
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;
    addBtn.addEventListener('click', () => this.showAddWidgetPanel());
    emptyState.appendChild(addBtn);
    
    return emptyState;
  }

  /**
   * Show the settings panel for dashboard configuration
   */
  private showSettingsPanel(config: DashboardConfig): void {
    // Remove existing panel if any
    const existing = document.querySelector('.dashboard-settings-panel');
    if (existing) {
      existing.remove();
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'dashboard-settings-panel';
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, #454545);
      border-radius: 8px;
      padding: 20px;
      z-index: 10000;
      min-width: 300px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; color: var(--vscode-foreground, #cccccc);">Dashboard Settings</h3>
        <button class="close-btn" style="background: none; border: none; color: var(--vscode-foreground); cursor: pointer; font-size: 18px;">✕</button>
      </div>
      
      <div style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px; color: var(--vscode-foreground);">Title</label>
        <input type="text" class="setting-title" value="${config.title || ''}" style="width: 100%; padding: 6px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); border-radius: 4px; box-sizing: border-box;" />
      </div>
      
      <div style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px; color: var(--vscode-foreground);">Max Columns</label>
        <input type="number" class="setting-columns" value="${config.columns || 3}" min="1" max="6" style="width: 100%; padding: 6px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); border-radius: 4px; box-sizing: border-box;" />
      </div>
      
      <div style="margin-bottom: 12px;">
        <label style="display: block; margin-bottom: 4px; color: var(--vscode-foreground);">Gap (px)</label>
        <input type="number" class="setting-gap" value="${config.gap || 16}" min="0" max="48" style="width: 100%; padding: 6px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); border-radius: 4px; box-sizing: border-box;" />
      </div>
      
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; color: var(--vscode-foreground);">Min Widget Width (px)</label>
        <input type="number" class="setting-min-width" value="${config.minWidgetWidth || 250}" min="150" max="500" style="width: 100%; padding: 6px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); border-radius: 4px; box-sizing: border-box;" />
      </div>
      
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button class="cancel-btn" style="padding: 6px 12px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
        <button class="save-btn" style="padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer;">Save</button>
      </div>
    `;

    // Event handlers
    panel.querySelector('.close-btn')?.addEventListener('click', () => panel.remove());
    panel.querySelector('.cancel-btn')?.addEventListener('click', () => panel.remove());
    
    panel.querySelector('.save-btn')?.addEventListener('click', () => {
      if (!this.currentConfig) return;
      
      const titleVal = (panel.querySelector('.setting-title') as HTMLInputElement).value;
      this.currentConfig.title = titleVal || undefined;
      this.currentConfig.columns = parseInt((panel.querySelector('.setting-columns') as HTMLInputElement).value) || 3;
      this.currentConfig.gap = parseInt((panel.querySelector('.setting-gap') as HTMLInputElement).value) || 16;
      this.currentConfig.minWidgetWidth = parseInt((panel.querySelector('.setting-min-width') as HTMLInputElement).value) || 250;
      
      this.persistDashboardConfig();
      panel.remove();
      
      // Re-render dashboard
      this.reRenderDashboard();
    });

    document.body.appendChild(panel);
  }

  /**
   * Show panel to add a new widget
   */
  private showAddWidgetPanel(): void {
    const existing = document.querySelector('.dashboard-add-widget-panel');
    if (existing) {
      existing.remove();
      return;
    }

    if (!window.markdownWidgets) return;
    
    const { WidgetRegistry } = window.markdownWidgets;
    const registry = WidgetRegistry.getInstance();
    const definitions = registry.getDefinitions();

    const panel = document.createElement('div');
    panel.className = 'dashboard-add-widget-panel';
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--vscode-editor-background, #1e1e1e);
      border: 1px solid var(--vscode-panel-border, #454545);
      border-radius: 8px;
      padding: 20px;
      z-index: 10000;
      min-width: 400px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    `;

    let widgetListHtml = '';
    const categories = new Set(definitions.map((d: any) => d.category || 'other'));
    
    for (const category of categories) {
      const categoryWidgets = definitions.filter((d: any) => (d.category || 'other') === category);
      widgetListHtml += `
        <div style="margin-bottom: 16px;">
          <h4 style="margin: 0 0 8px 0; color: var(--vscode-descriptionForeground); text-transform: capitalize;">${category}</h4>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
            ${categoryWidgets.map((w: any) => `
              <button class="widget-option" data-type="${w.type}" style="
                padding: 12px;
                text-align: left;
                background: var(--vscode-button-secondaryBackground);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                cursor: pointer;
                color: var(--vscode-foreground);
              ">
                <div style="font-weight: 500;">${w.displayName}</div>
                <div style="font-size: 11px; color: var(--vscode-descriptionForeground);">${w.description || ''}</div>
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }

    panel.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; color: var(--vscode-foreground, #cccccc);">Add Widget</h3>
        <button class="close-btn" style="background: none; border: none; color: var(--vscode-foreground); cursor: pointer; font-size: 18px;">✕</button>
      </div>
      ${widgetListHtml}
    `;

    // Event handlers
    panel.querySelector('.close-btn')?.addEventListener('click', () => panel.remove());
    
    panel.querySelectorAll('.widget-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).getAttribute('data-type');
        if (type) {
          this.addWidget(type);
          panel.remove();
        }
      });
      
      btn.addEventListener('mouseenter', () => {
        (btn as HTMLElement).style.background = 'var(--vscode-list-hoverBackground)';
      });
      btn.addEventListener('mouseleave', () => {
        (btn as HTMLElement).style.background = 'var(--vscode-button-secondaryBackground)';
      });
    });

    document.body.appendChild(panel);
  }

  /**
   * Add a new widget to the dashboard
   */
  private addWidget(type: string): void {
    if (!this.currentConfig) return;
    
    this.currentConfig.widgets.push({
      type,
      colspan: 1,
      rowspan: 1
    });
    
    this.persistDashboardConfig();
    this.reRenderDashboard();
  }

  /**
   * Remove a widget from the dashboard
   */
  private removeWidget(index: number): void {
    if (!this.currentConfig) return;
    
    this.currentConfig.widgets.splice(index, 1);
    this.persistDashboardConfig();
    this.reRenderDashboard();
  }

  /**
   * Toggle edit mode for drag-and-drop reordering
   */
  private toggleEditMode(): void {
    if (!this.currentConfig) return;
    
    this.editMode = !this.editMode;
    this.currentConfig.editMode = this.editMode;
    
    this.persistDashboardConfig();
    this.reRenderDashboard();
  }

  /**
   * Enable edit mode with drag-and-drop
   */
  private enableEditMode(container: HTMLElement): void {
    const wrappers = container.querySelectorAll('.dashboard-widget-wrapper');
    
    wrappers.forEach((wrapper) => {
      const el = wrapper as HTMLElement;
      el.setAttribute('draggable', 'true');
      
      // Add edit-mode class for CSS styling (dashed border, padding, button positioning)
      el.classList.add('edit-mode');
      
      el.addEventListener('dragstart', (e) => this.handleDragStart(e as DragEvent, el));
      el.addEventListener('dragend', (e) => this.handleDragEnd(e as DragEvent, el));
      el.addEventListener('dragover', (e) => this.handleDragOver(e as DragEvent, el));
      el.addEventListener('dragleave', (e) => this.handleDragLeave(e as DragEvent, el));
      el.addEventListener('drop', (e) => this.handleDrop(e as DragEvent, el));
    });
  }

  /**
   * Handle drag start
   */
  private handleDragStart(e: DragEvent, el: HTMLElement): void {
    this.draggedWidget = el;
    el.style.opacity = '0.5';
    
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.getAttribute('data-widget-index') || '');
    }
  }

  /**
   * Handle drag end
   */
  private handleDragEnd(_e: DragEvent, el: HTMLElement): void {
    el.style.opacity = '1';
    el.style.cursor = 'grab';
    this.draggedWidget = null;
    this.dragOverWidget = null;
    
    // Remove all drag-over indicators
    document.querySelectorAll('.dashboard-widget-wrapper').forEach(w => {
      (w as HTMLElement).style.transform = '';
      (w as HTMLElement).style.transition = '';
    });
  }

  /**
   * Handle drag over
   */
  private handleDragOver(e: DragEvent, el: HTMLElement): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    
    if (this.draggedWidget === el) return;
    
    this.dragOverWidget = el;
    el.style.transform = 'scale(1.02)';
    el.style.transition = 'transform 0.2s';
  }

  /**
   * Handle drag leave
   */
  private handleDragLeave(_e: DragEvent, el: HTMLElement): void {
    if (this.dragOverWidget === el) {
      el.style.transform = '';
      this.dragOverWidget = null;
    }
  }

  /**
   * Handle drop
   */
  private handleDrop(e: DragEvent, el: HTMLElement): void {
    e.preventDefault();
    
    if (!this.currentConfig || !this.draggedWidget || this.draggedWidget === el) return;
    
    const fromIndex = parseInt(this.draggedWidget.getAttribute('data-widget-index') || '0');
    const toIndex = parseInt(el.getAttribute('data-widget-index') || '0');
    
    // Swap widgets in config
    const widgets = this.currentConfig.widgets;
    const temp = widgets[fromIndex];
    widgets[fromIndex] = widgets[toIndex];
    widgets[toIndex] = temp;
    
    // Update row/column positions if set
    if (widgets[fromIndex].row || widgets[toIndex].row) {
      const tempRow = widgets[fromIndex].row;
      const tempCol = widgets[fromIndex].column;
      widgets[fromIndex].row = widgets[toIndex].row;
      widgets[fromIndex].column = widgets[toIndex].column;
      widgets[toIndex].row = tempRow;
      widgets[toIndex].column = tempCol;
    }
    
    this.persistDashboardConfig();
    this.reRenderDashboard();
  }

  /**
   * Re-render the dashboard (after config changes)
   */
  private reRenderDashboard(): void {
    if (!this.currentCodeBlockNode || !this.currentConfig) return;
    
    const previewEl = this.currentCodeBlockNode.querySelector('pre.vditor-ir__preview') ||
                      this.currentCodeBlockNode.querySelector('.vditor-wysiwyg__block');
    
    if (previewEl) {
      // Use stored config instead of extracting from element (which may be empty after clearing)
      this.renderFromConfig(previewEl as HTMLElement, this.currentConfig);
    }
  }

  /**
   * Render dashboard from an existing config object (for re-renders)
   */
  private renderFromConfig(element: HTMLElement, config: DashboardConfig): void {
    try {
      initializeWidgetSystem();
      
      if (!window.markdownWidgets) {
        this.showDashboardError(element, 'Widget system not available.');
        return;
      }

      // Clear and rebuild
      element.innerHTML = '';

      // Create main wrapper
      const wrapper = document.createElement('div');
      wrapper.className = 'dashboard-wrapper';
      wrapper.style.cssText = `
        position: relative;
        margin: 8px 0;
      `;

      // Create toolbar
      const toolbar = this.createToolbar(config);
      wrapper.appendChild(toolbar);

      // Create dashboard container
      const container = document.createElement('div');
      container.className = 'dashboard-container';
      this.currentContainer = container;
      
      const columns = config.columns || 3;
      const gap = config.gap || 16;
      const minWidgetWidth = config.minWidgetWidth || 400;
      
      container.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(${minWidgetWidth}px, 1fr));
        gap: ${gap}px;
        padding: 16px;
        border-radius: 0 0 8px 8px;
        background: var(--vscode-editor-background, #1e1e1e);
        border: 1px solid var(--vscode-panel-border, #454545);
        border-top: none;
        min-height: 200px;
      `;
      
      container.setAttribute('data-max-columns', String(columns));
      container.setAttribute('data-gap', String(gap));
      container.setAttribute('data-min-widget-width', String(minWidgetWidth));

      // Add dashboard title if provided
      if (config.title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'dashboard-title';
        titleEl.style.cssText = `
          grid-column: 1 / -1;
          font-size: 1.5em;
          font-weight: 600;
          color: var(--vscode-foreground, #cccccc);
          padding-bottom: 8px;
          border-bottom: 1px solid var(--vscode-panel-border, #454545);
          margin-bottom: 8px;
        `;
        titleEl.textContent = config.title;
        container.appendChild(titleEl);
      }

      const { WidgetRegistry } = window.markdownWidgets;
      if (!WidgetRegistry) {
        this.showDashboardError(element, 'WidgetRegistry not found');
        return;
      }
      
      const registry = WidgetRegistry.getInstance();

      // Render widgets
      if (config.widgets.length === 0) {
        const emptyState = this.createEmptyState(registry);
        container.appendChild(emptyState);
      } else {
        for (let i = 0; i < config.widgets.length; i++) {
          const widgetConfig = config.widgets[i];
          const widgetWrapper = this.createWidgetWrapper(widgetConfig, registry, i, config.editMode || false);
          container.appendChild(widgetWrapper);
        }
      }

      wrapper.appendChild(container);

      // Setup resize observer for responsive columns
      this.setupResizeObserver(container, config);

      element.appendChild(wrapper);

      // Setup event stoppers
      const ir__node = element.closest('.vditor-ir__node') as HTMLElement;
      const wysiwyg__node = element.closest('.vditor-wysiwyg__block') as HTMLElement;
      const containerNode = ir__node || wysiwyg__node;

      if (containerNode) {
        this.setupVditorEventStoppers(wrapper, containerNode);
      }

      // If edit mode is on, enable drag and drop
      if (config.editMode) {
        this.enableEditMode(container);
      }

      this.editMode = config.editMode || false;

      vscodeLog(`[DashboardRenderer] Re-rendered dashboard with ${config.widgets.length} widgets`);
    } catch (error) {
      vscodeLogError('[DashboardRenderer] Re-render failed:', error);
      this.showDashboardError(element, `Failed to re-render dashboard: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Setup resize observer for responsive columns
   */
  private setupResizeObserver(container: HTMLElement, config: DashboardConfig): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const minWidgetWidth = config.minWidgetWidth || 400;
        const maxColumns = config.columns || 3;
        const gap = config.gap || 16;
        
        // Calculate how many columns fit
        const calculatedColumns = Math.max(1, Math.min(
          maxColumns,
          Math.floor((width + gap) / (minWidgetWidth + gap))
        ));
        
        if (calculatedColumns !== this.currentResponsiveColumns) {
          this.currentResponsiveColumns = calculatedColumns;
          vscodeLog(`[DashboardRenderer] Responsive columns: ${calculatedColumns}`);
        }
      }
    });
    
    this.resizeObserver.observe(container);
  }

  /**
   * Create a wrapper for a single widget in the dashboard
   */
  private createWidgetWrapper(
    widgetConfig: DashboardWidgetConfig, 
    registry: any,
    widgetIndex: number,
    editMode: boolean
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'dashboard-widget-wrapper';
    
    const colspan = widgetConfig.colspan || 1;
    const rowspan = widgetConfig.rowspan || 1;
    
    // Build grid positioning
    let gridStyles = `
      grid-column: span ${colspan};
      grid-row: span ${rowspan};
      min-height: 150px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      position: relative;
    `;
    
    // Explicit positioning if row/column specified
    if (widgetConfig.row && widgetConfig.column) {
      gridStyles = `
        grid-column: ${widgetConfig.column} / span ${colspan};
        grid-row: ${widgetConfig.row} / span ${rowspan};
        min-height: 150px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        position: relative;
      `;
    }
    
    wrapper.style.cssText = gridStyles;

    try {
      const registryDefaults = registry.createDefaultConfig(widgetConfig.type);
      const widgetId = `dashboard-widget-${Date.now()}-${widgetIndex}-${Math.random().toString(36).substr(2, 9)}`;
      
      const fullConfig = {
        ...registryDefaults,
        ...widgetConfig.config,
        id: widgetId,
        type: widgetConfig.type,
        title: widgetConfig.title,
      };
      
      for (const key of Object.keys(fullConfig)) {
        if (fullConfig[key] === undefined) {
          delete fullConfig[key];
        }
      }

      const widget = registry.create(fullConfig);
      
      if (!widget) {
        wrapper.innerHTML = this.getWidgetErrorHtml(`Unknown widget type: ${widgetConfig.type}`);
        return wrapper;
      }

      if (widgetConfig.data && typeof (widget as any).setData === 'function') {
        (widget as any).setData(widgetConfig.data);
      }
      
      if (widget instanceof HTMLElement) {
        widget.setAttribute('data-widget-id', widgetId);
        // Let widgets use their natural size (no forced width)
      }
      
      wrapper.setAttribute('data-widget-id', widgetId);
      wrapper.setAttribute('data-widget-type', widgetConfig.type);
      wrapper.setAttribute('data-widget-index', String(widgetIndex));
      
      // Store connector info for future use
      if (widgetConfig.connectorId) {
        wrapper.setAttribute('data-connector-id', widgetConfig.connectorId);
      }
      if (widgetConfig.connectTo) {
        wrapper.setAttribute('data-connect-to', JSON.stringify(widgetConfig.connectTo));
      }

      // Add remove button - CSS handles visibility and hover states
      const removeBtn = document.createElement('button');
      removeBtn.className = 'widget-remove-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.title = 'Remove widget';
      
      // In edit mode, add class to wrapper for CSS to handle
      if (editMode) {
        wrapper.classList.add('edit-mode');
      }
      
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeWidget(widgetIndex);
      });

      wrapper.appendChild(removeBtn);
      wrapper.appendChild(widget);
    } catch (error) {
      wrapper.innerHTML = this.getWidgetErrorHtml(
        `Failed to create ${widgetConfig.type} widget: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return wrapper;
  }

  /**
   * Get HTML for widget error display
   */
  private getWidgetErrorHtml(message: string): string {
    return `<div class="widget-error">⚠️ ${message}</div>`;
  }

  /**
   * Show dashboard error message
   */
  private showDashboardError(element: HTMLElement, message: string): void {
    element.innerHTML = `
      <div class="dashboard-error">
        <strong>⚠️ Dashboard Error</strong><br>
        ${message}
      </div>
    `;
  }

  /**
   * Setup event stoppers to prevent Vditor from interfering with dashboard
   * CRITICAL: Must allow clipboard operations (Ctrl+C/V/X) to work within widgets
   */
  private setupVditorEventStoppers(container: HTMLElement, node: HTMLElement): void {
    if (!node) return;

    // Helper: check if an element is an interactive form element where
    // the browser's default key handling (backspace, arrows, etc.) must work
    const isInteractiveFormElement = (el: EventTarget | null): boolean => {
      if (!el || !(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      const role = el.getAttribute('role');
      if (role === 'textbox' || role === 'spinbutton') return true;
      return false;
    };

    const stopBubblingToVditor = (e: Event) => {
      if (!container.contains(e.target as Node)) {
        return;
      }
      
      e.stopPropagation();
      
      if (e instanceof KeyboardEvent) {
        const key = e.key.toLowerCase();
        const hasModifier = e.ctrlKey || e.metaKey;
        const targetIsFormElement = isInteractiveFormElement(e.target);
        
        // Navigation/editing keys — only preventDefault when the target is NOT
        // an interactive form element. Inside inputs/textareas the browser must
        // handle backspace, delete, arrows, etc. natively.
        if (['Enter', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !targetIsFormElement) {
          e.preventDefault();
        }
        
        // For clipboard shortcuts (Ctrl/Cmd + C/V/X/A/Z/Y), stop propagation to Vditor
        // but do NOT preventDefault - let the browser handle copy/paste/cut/undo/redo naturally
        if (hasModifier) {
          const clipboardShortcuts = ['c', 'v', 'x', 'a', 'z', 'y'];
          if (clipboardShortcuts.includes(key)) {
            // Don't preventDefault - let the browser handle clipboard operations
            e.stopPropagation();
          }
        }
      }
    };

    const eventsToBlock = [
      'click', 'dblclick', 'mousedown', 'mouseup',
      'keydown', 'keypress', 'keyup',
      'beforeinput', 'input',
      'focus', 'focusin', 'focusout', 'blur',
      'change', 'submit',
      'dragstart', 'drag', 'dragend', 'dragover', 'dragenter', 'dragleave', 'drop',
      'copy', 'cut', 'paste'  // Include clipboard events
    ];

    eventsToBlock.forEach(eventName => {
      node.addEventListener(eventName, stopBubblingToVditor, { capture: false });
    });

    // CRITICAL: Also add CAPTURE-phase listeners on the container itself.
    // Vditor registers capture-phase handlers on ancestor elements (the contentEditable div)
    // that intercept keydown/input events before our bubble-phase handlers run.
    // For interactive form elements (input, textarea, select), we must stop propagation
    // in the capture phase so Vditor never sees these events.
    const stopInCapture = (e: Event) => {
      if (!isInteractiveFormElement(e.target)) return;
      e.stopPropagation();
    };
    const captureEvents = [
      'keydown', 'keypress', 'keyup',
      'beforeinput', 'input',
    ];
    captureEvents.forEach(eventName => {
      container.addEventListener(eventName, stopInCapture, { capture: true });
    });
    
    container.setAttribute('data-dashboard-interactive', 'true');
  }

  /**
   * Clean up dashboard on destroy
   */
  async onDestroy(_context: IRenderContext): Promise<void> {
    if (this.widgetUpdateHandler) {
      document.removeEventListener('widget-update', this.widgetUpdateHandler);
      this.widgetUpdateHandler = null;
    }
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    
    // Remove any open panels
    document.querySelectorAll('.dashboard-settings-panel, .dashboard-add-widget-panel').forEach(p => p.remove());
    
    this.currentConfig = null;
    this.currentCodeBlockNode = null;
    this.currentVditor = null;
    this.currentContainer = null;
  }

  extractCode(element: HTMLElement): string {
    if (element.textContent) {
      return element.textContent.trim();
    }

    const codeEl = element.querySelector('code');
    if (codeEl) {
      return codeEl.textContent?.trim() || '';
    }

    return '';
  }

  extractId(_element: HTMLElement): string {
    return 'default';
  }
}
