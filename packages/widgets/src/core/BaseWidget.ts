/**
 * BaseWidget - Abstract base class for all widget implementations
 * 
 * This class provides common functionality that all widgets inherit.
 * Extend this class to create new widgets.
 */

import type { IWidgetConfig, IDataSource, IWidgetEvent } from './types';
import { WidgetBus } from './WidgetBus';
import { DataProvider } from './DataProvider';
import { ScriptExecutor } from './ScriptExecutor';

export abstract class BaseWidget extends HTMLElement {
  // Abstract properties - must be implemented by subclasses
  abstract readonly widgetType: string;
  abstract readonly version: string;
  abstract readonly displayName: string;
  abstract readonly configSchema: any;
  
  // Internal state
  protected config: IWidgetConfig;
  protected data: any;
  protected state: Map<string, any>;
  protected _isConnected: boolean = false;
  protected _refreshTimer?: number;
  
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.state = new Map();
    this.config = this.getDefaultConfig();
  }
  
  /**
   * Get default configuration for this widget
   */
  protected getDefaultConfig(): IWidgetConfig {
    return {
      id: this.generateId(),
      type: this.widgetType,
      size: 'md',
      title: this.displayName
    };
  }
  
  /**
   * Generate unique widget ID
   */
  protected generateId(): string {
    return `${this.widgetType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Web Component lifecycle: connected to DOM
   */
  connectedCallback(): void {
    this._isConnected = true;
    this.setupStyles();
    this.render();
    this.onConnect?.();
    
    // Register with widget bus
    WidgetBus.getInstance().registerWidget(this);
    
    // Setup refresh interval if configured
    if (this.config.refreshInterval && this.config.dataSource) {
      this.startAutoRefresh();
    }
  }
  
  /**
   * Web Component lifecycle: disconnected from DOM
   */
  disconnectedCallback(): void {
    this._isConnected = false;
    this.stopAutoRefresh();
    WidgetBus.getInstance().unregisterWidget(this.config.id);
    this.onDisconnect?.();
  }
  
  /**
   * Setup base styles with theme integration
   */
  protected setupStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        /* Inherit theme variables from document */
        --bg: var(--widget-bg, var(--vscode-editor-background, #1e1e1e));
        --fg: var(--widget-fg, var(--vscode-editor-foreground, #cccccc));
        --border: var(--widget-border, var(--vscode-panel-border, #3c3c3c));
        --accent: var(--widget-accent, var(--vscode-button-background, #0e639c));
        
        /* Widget base styles */
        display: block;
        background: var(--bg);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 16px;
        font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
        box-sizing: border-box;
      }
      
      :host([hidden]) {
        display: none;
      }
      
      .widget-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      
      .widget-title {
        font-size: 14px;
        font-weight: 600;
        margin: 0;
      }
      
      .widget-content {
        min-height: 50px;
      }
      
      .widget-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        opacity: 0.6;
      }
      
      .widget-error {
        color: var(--vscode-errorForeground, #f48771);
        padding: 12px;
        background: var(--vscode-inputValidation-errorBackground, rgba(244, 135, 113, 0.1));
        border-radius: 4px;
        font-size: 12px;
      }
    `;
    this.shadowRoot!.appendChild(style);
  }
  
  /**
   * Main render function - must be implemented by subclasses
   */
  abstract render(): void;
  
  /**
   * Update widget configuration
   */
  setConfig(config: Partial<IWidgetConfig>): void {
    this.config = { ...this.config, ...config };
    this.onConfigChange?.(this.config);
    this.render();
    
    // Restart refresh if interval changed
    if (config.refreshInterval !== undefined) {
      this.stopAutoRefresh();
      if (config.refreshInterval > 0 && this.config.dataSource) {
        this.startAutoRefresh();
      }
    }
  }
  
  /**
   * Get current configuration
   */
  getConfig(): IWidgetConfig {
    return { ...this.config };
  }
  
  /**
   * Fetch data from configured data source
   */
  protected async fetchData(source?: IDataSource): Promise<any> {
    const dataSource = source || this.config.dataSource;
    if (!dataSource) {
      return null;
    }
    
    try {
      const provider = DataProvider.getInstance();
      const data = await provider.fetchData(dataSource, {
        widgetId: this.config.id,
        widgetType: this.widgetType
      });
      this.data = data;
      this.onDataReceived?.(data);
      return data;
    } catch (error) {
      console.error(`[${this.widgetType}] Data fetch error:`, error);
      this.showError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
  
  /**
   * Save widget data
   */
  protected async saveData(data: any): Promise<void> {
    this.data = data;
    this.emit('data-changed', { data });
  }
  
  /**
   * Emit custom event
   */
  protected emit(event: string, payload: any): void {
    const detail: IWidgetEvent = {
      widgetId: this.config.id,
      event,
      payload,
      timestamp: Date.now()
    };
    
    this.dispatchEvent(new CustomEvent(event, { 
      detail, 
      bubbles: true, 
      composed: true 
    }));
    
    // Publish to widget bus
    WidgetBus.getInstance().publish(this.config.id, event, payload);
  }
  
  /**
   * Subscribe to events from another widget
   */
  protected subscribe(widgetId: string, event: string, handler: (payload: any) => void): () => void {
    return WidgetBus.getInstance().subscribe(widgetId, event, handler);
  }
  
  /**
   * Execute script safely
   */
  async executeScript(script: string, context: any = {}): Promise<any> {
    const executor = ScriptExecutor.getInstance();
    const result = await executor.execute(script, {
      widget: this,
      data: this.data,
      ...context
    });
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    return result.result;
  }
  
  /**
   * Send message to VSCode extension host
   */
  protected sendVSCodeMessage(command: string, payload: any): void {
    window.postMessage({
      command: `widget-${command}`,
      widgetId: this.config.id,
      widgetType: this.widgetType,
      ...payload
    }, '*');
  }
  
  /**
   * Start auto-refresh timer
   */
  protected startAutoRefresh(): void {
    if (!this.config.refreshInterval || !this.config.dataSource) {
      return;
    }
    
    this.stopAutoRefresh();
    this._refreshTimer = window.setInterval(() => {
      this.fetchData();
    }, this.config.refreshInterval * 1000);
  }
  
  /**
   * Stop auto-refresh timer
   */
  protected stopAutoRefresh(): void {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = undefined;
    }
  }
  
  /**
   * Show loading state
   */
  protected showLoading(message: string = 'Loading...'): void {
    const content = this.shadowRoot!.querySelector('.widget-content');
    if (content) {
      content.innerHTML = `
        <div class="widget-loading">
          <span>${message}</span>
        </div>
      `;
    }
  }
  
  /**
   * Show error message
   */
  protected showError(message: string): void {
    const content = this.shadowRoot!.querySelector('.widget-content');
    if (content) {
      content.innerHTML = `
        <div class="widget-error">
          <strong>⚠️ Error:</strong> ${this.escapeHtml(message)}
        </div>
      `;
    }
  }
  
  /**
   * Escape HTML to prevent XSS
   */
  protected escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Lifecycle hook: called when configuration changes
   */
  protected onConfigChange?(newConfig: IWidgetConfig): void;
  
  /**
   * Lifecycle hook: called when data is received
   */
  protected onDataReceived?(data: any): void;
  
  /**
   * Lifecycle hook: called when widget connects to DOM
   */
  protected onConnect?(): void;
  
  /**
   * Lifecycle hook: called when widget disconnects from DOM
   */
  protected onDisconnect?(): void;
  
  /**
   * Get state value
   */
  protected getState<T = any>(key: string, defaultValue?: T): T {
    return this.state.get(key) ?? defaultValue;
  }
  
  /**
   * Set state value
   */
  protected setState(key: string, value: any): void {
    this.state.set(key, value);
  }
}
