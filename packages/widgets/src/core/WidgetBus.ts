/**
 * WidgetBus - Central event bus for inter-widget communication
 * 
 * Provides pub/sub event system, widget registration, and data sharing.
 * Uses singleton pattern for global access.
 */

import type { BaseWidget } from './BaseWidget';
import type { IWidgetConnection } from './types';

export class WidgetBus {
  private static instance: WidgetBus;
  private subscribers: Map<string, Set<(payload: any) => void>>;
  private widgets: Map<string, BaseWidget>;
  private connections: Map<string, IWidgetConnection>;
  private widgetData: Map<string, any>;
  
  private constructor() {
    this.subscribers = new Map();
    this.widgets = new Map();
    this.connections = new Map();
    this.widgetData = new Map();
  }
  
  /**
   * Get singleton instance
   */
  static getInstance(): WidgetBus {
    if (!WidgetBus.instance) {
      WidgetBus.instance = new WidgetBus();
    }
    return WidgetBus.instance;
  }
  
  /**
   * Register a widget
   */
  registerWidget(widget: BaseWidget): void {
    const config = widget.getConfig();
    this.widgets.set(config.id, widget);
    console.log(`[WidgetBus] Registered widget: ${config.id} (${config.type})`);
  }
  
  /**
   * Unregister a widget
   */
  unregisterWidget(widgetId: string): void {
    this.widgets.delete(widgetId);
    this.widgetData.delete(widgetId);
    
    // Clean up subscriptions for this widget
    const key = `${widgetId}:*`;
    this.subscribers.delete(key);
    
    // Clean up connections involving this widget
    for (const [connId, conn] of this.connections.entries()) {
      if (conn.sourceWidget === widgetId) {
        this.connections.delete(connId);
      }
    }
    
    console.log(`[WidgetBus] Unregistered widget: ${widgetId}`);
  }
  
  /**
   * Publish an event
   */
  publish(widgetId: string, event: string, payload: any): void {
    const key = `${widgetId}:${event}`;
    const subscribers = this.subscribers.get(key);
    
    if (subscribers && subscribers.size > 0) {
      subscribers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[WidgetBus] Error in subscriber for ${key}:`, error);
        }
      });
    }
    
    // Process connections
    this.processConnections(widgetId, event, payload);
  }
  
  /**
   * Subscribe to an event
   */
  subscribe(widgetId: string, event: string, handler: (payload: any) => void): () => void {
    const key = `${widgetId}:${event}`;
    
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    
    this.subscribers.get(key)!.add(handler);
    
    console.log(`[WidgetBus] Subscribed to ${key}`);
    
    // Return unsubscribe function
    return () => {
      const subscribers = this.subscribers.get(key);
      if (subscribers) {
        subscribers.delete(handler);
        if (subscribers.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }
  
  /**
   * Get widget data
   */
  getWidgetData(widgetId: string): any {
    return this.widgetData.get(widgetId);
  }
  
  /**
   * Set widget data
   */
  setWidgetData(widgetId: string, data: any): void {
    this.widgetData.set(widgetId, data);
    
    // Notify subscribers of data change
    this.publish(widgetId, 'data-changed', { data });
  }
  
  /**
   * Get widget by ID
   */
  getWidget(widgetId: string): BaseWidget | undefined {
    return this.widgets.get(widgetId);
  }
  
  /**
   * Get all registered widgets
   */
  getWidgets(): BaseWidget[] {
    return Array.from(this.widgets.values());
  }
  
  /**
   * Create a connection between widgets
   */
  createConnection(connection: IWidgetConnection): void {
    this.connections.set(connection.id, connection);
    console.log(`[WidgetBus] Created connection: ${connection.sourceWidget}.${connection.sourceEvent} -> target.${connection.targetProperty}`);
  }
  
  /**
   * Remove a connection
   */
  removeConnection(connectionId: string): void {
    this.connections.delete(connectionId);
    console.log(`[WidgetBus] Removed connection: ${connectionId}`);
  }
  
  /**
   * Get all connections
   */
  getConnections(): IWidgetConnection[] {
    return Array.from(this.connections.values());
  }
  
  /**
   * Get connections for a specific widget
   */
  getWidgetConnections(widgetId: string): IWidgetConnection[] {
    return Array.from(this.connections.values()).filter(
      conn => conn.sourceWidget === widgetId
    );
  }
  
  /**
   * Process connections when an event is published
   */
  private processConnections(sourceWidgetId: string, event: string, payload: any): void {
    const matchingConnections = Array.from(this.connections.values()).filter(
      conn => conn.sourceWidget === sourceWidgetId && 
              conn.sourceEvent === event && 
              conn.enabled
    );
    
    for (const connection of matchingConnections) {
      try {
        // Transform payload if transform expression provided
        let value = payload;
        if (connection.transform) {
          value = this.evaluateTransform(connection.transform, payload);
        }
        
        // Find target widget and update property
        const targetWidget = this.widgets.get(connection.targetProperty.split('.')[0]);
        if (targetWidget) {
          this.updateWidgetProperty(targetWidget, connection.targetProperty, value);
        }
      } catch (error) {
        console.error(`[WidgetBus] Error processing connection ${connection.id}:`, error);
      }
    }
  }
  
  /**
   * Evaluate transform expression
   */
  private evaluateTransform(transform: string, payload: any): any {
    try {
      const func = new Function('event', 'payload', `return ${transform}`);
      return func({ payload }, payload);
    } catch (error) {
      console.error('[WidgetBus] Transform evaluation error:', error);
      return payload;
    }
  }
  
  /**
   * Update widget property
   */
  private updateWidgetProperty(widget: BaseWidget, property: string, value: any): void {
    // For now, just update the widget's data
    // This can be enhanced to support nested property paths
    const config = widget.getConfig();
    const data = this.getWidgetData(config.id) || {};
    
    data[property] = value;
    this.setWidgetData(config.id, data);
    
    // Trigger widget update if it has a method for it
    if ('updateProperty' in widget && typeof (widget as any).updateProperty === 'function') {
      (widget as any).updateProperty(property, value);
    }
  }
  
  /**
   * Clear all data (useful for testing)
   */
  clear(): void {
    this.subscribers.clear();
    this.widgets.clear();
    this.connections.clear();
    this.widgetData.clear();
  }
  
  /**
   * Get debug info
   */
  getDebugInfo(): {
    widgets: number;
    subscribers: number;
    connections: number;
    widgetIds: string[];
  } {
    return {
      widgets: this.widgets.size,
      subscribers: this.subscribers.size,
      connections: this.connections.size,
      widgetIds: Array.from(this.widgets.keys())
    };
  }
}
