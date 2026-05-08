import { IWidgetConfig, IDataSource } from './types';

export declare abstract class BaseWidget extends HTMLElement {
    abstract readonly widgetType: string;
    abstract readonly version: string;
    abstract readonly displayName: string;
    abstract readonly configSchema: any;
    protected config: IWidgetConfig;
    protected data: any;
    protected state: Map<string, any>;
    protected _isConnected: boolean;
    protected _refreshTimer?: number;
    constructor();
    /**
     * Get default configuration for this widget
     */
    protected getDefaultConfig(): IWidgetConfig;
    /**
     * Generate unique widget ID
     */
    protected generateId(): string;
    /**
     * Web Component lifecycle: connected to DOM
     */
    connectedCallback(): void;
    /**
     * Web Component lifecycle: disconnected from DOM
     */
    disconnectedCallback(): void;
    /**
     * Setup base styles with theme integration
     */
    protected setupStyles(): void;
    /**
     * Main render function - must be implemented by subclasses
     */
    abstract render(): void;
    /**
     * Update widget configuration
     */
    setConfig(config: Partial<IWidgetConfig>): void;
    /**
     * Get current configuration
     */
    getConfig(): IWidgetConfig;
    /**
     * Fetch data from configured data source
     */
    protected fetchData(source?: IDataSource): Promise<any>;
    /**
     * Save widget data
     */
    protected saveData(data: any): Promise<void>;
    /**
     * Emit custom event
     */
    protected emit(event: string, payload: any): void;
    /**
     * Subscribe to events from another widget
     */
    protected subscribe(widgetId: string, event: string, handler: (payload: any) => void): () => void;
    /**
     * Execute script safely
     */
    executeScript(script: string, context?: any): Promise<any>;
    /**
     * Send message to VSCode extension host
     */
    protected sendVSCodeMessage(command: string, payload: any): void;
    /**
     * Start auto-refresh timer
     */
    protected startAutoRefresh(): void;
    /**
     * Stop auto-refresh timer
     */
    protected stopAutoRefresh(): void;
    /**
     * Show loading state
     */
    protected showLoading(message?: string): void;
    /**
     * Show error message
     */
    protected showError(message: string): void;
    /**
     * Escape HTML to prevent XSS
     */
    protected escapeHtml(text: string): string;
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
    protected getState<T = any>(key: string, defaultValue?: T): T;
    /**
     * Set state value
     */
    protected setState(key: string, value: any): void;
}
//# sourceMappingURL=BaseWidget.d.ts.map