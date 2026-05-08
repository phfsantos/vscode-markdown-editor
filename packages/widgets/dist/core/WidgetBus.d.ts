import { BaseWidget } from './BaseWidget';
import { IWidgetConnection } from './types';

export declare class WidgetBus {
    private static instance;
    private subscribers;
    private widgets;
    private connections;
    private widgetData;
    private constructor();
    /**
     * Get singleton instance
     */
    static getInstance(): WidgetBus;
    /**
     * Register a widget
     */
    registerWidget(widget: BaseWidget): void;
    /**
     * Unregister a widget
     */
    unregisterWidget(widgetId: string): void;
    /**
     * Publish an event
     */
    publish(widgetId: string, event: string, payload: any): void;
    /**
     * Subscribe to an event
     */
    subscribe(widgetId: string, event: string, handler: (payload: any) => void): () => void;
    /**
     * Get widget data
     */
    getWidgetData(widgetId: string): any;
    /**
     * Set widget data
     */
    setWidgetData(widgetId: string, data: any): void;
    /**
     * Get widget by ID
     */
    getWidget(widgetId: string): BaseWidget | undefined;
    /**
     * Get all registered widgets
     */
    getWidgets(): BaseWidget[];
    /**
     * Create a connection between widgets
     */
    createConnection(connection: IWidgetConnection): void;
    /**
     * Remove a connection
     */
    removeConnection(connectionId: string): void;
    /**
     * Get all connections
     */
    getConnections(): IWidgetConnection[];
    /**
     * Get connections for a specific widget
     */
    getWidgetConnections(widgetId: string): IWidgetConnection[];
    /**
     * Process connections when an event is published
     */
    private processConnections;
    /**
     * Evaluate transform expression
     */
    private evaluateTransform;
    /**
     * Update widget property
     */
    private updateWidgetProperty;
    /**
     * Clear all data (useful for testing)
     */
    clear(): void;
    /**
     * Get debug info
     */
    getDebugInfo(): {
        widgets: number;
        subscribers: number;
        connections: number;
        widgetIds: string[];
    };
}
//# sourceMappingURL=WidgetBus.d.ts.map