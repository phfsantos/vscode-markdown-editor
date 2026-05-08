/**
 * WidgetRegistry - Central registry for widget types and instances
 * 
 * Manages widget definitions, creation, and lifecycle.
 */

import type { BaseWidget } from './BaseWidget';
import type { IWidgetConfig } from './types';
import type { WidgetComponentDefinition } from './ReactWidgetWrapper';
import { registerReactWidget, createTagName } from './ReactWidgetWrapper';

export interface WidgetDefinition {
  type: string;
  displayName: string;
  description?: string;
  category?: string;
  icon?: string;
  defaultConfig?: Partial<IWidgetConfig>;
  
  // For React components
  reactComponent?: WidgetComponentDefinition;
  
  // For pure Web Components (must be concrete class, not abstract)
  elementClass?: CustomElementConstructor;
  tagName?: string;
}

export class WidgetRegistry {
  private static instance: WidgetRegistry;
  private definitions: Map<string, WidgetDefinition> = new Map();
  private instances: Map<string, BaseWidget> = new Map();
  
  private constructor() {}
  
  /**
   * Get singleton instance
   */
  static getInstance(): WidgetRegistry {
    if (!WidgetRegistry.instance) {
      WidgetRegistry.instance = new WidgetRegistry();
    }
    return WidgetRegistry.instance;
  }
  
  /**
   * Register a widget definition
   */
  register(definition: WidgetDefinition): void {
    if (this.definitions.has(definition.type)) {
      console.warn(`Widget type ${definition.type} is already registered`);
      return;
    }
    
    this.definitions.set(definition.type, definition);
    
    // Auto-register as custom element
    if (definition.reactComponent) {
      registerReactWidget(definition.reactComponent);
    } else if (definition.elementClass && definition.tagName) {
      if (!customElements.get(definition.tagName)) {
        customElements.define(definition.tagName, definition.elementClass);
      }
    }
    
    console.log(`[WidgetRegistry] Registered widget type: ${definition.type}`);
  }
  
  /**
   * Unregister a widget definition
   */
  unregister(type: string): void {
    this.definitions.delete(type);
    console.log(`[WidgetRegistry] Unregistered widget type: ${type}`);
  }
  
  /**
   * Get widget definition by type
   */
  getDefinition(type: string): WidgetDefinition | undefined {
    return this.definitions.get(type);
  }
  
  /**
   * Get all registered widget definitions
   */
  getDefinitions(): WidgetDefinition[] {
    return Array.from(this.definitions.values());
  }
  
  /**
   * Get definitions by category
   */
  getDefinitionsByCategory(category: string): WidgetDefinition[] {
    return Array.from(this.definitions.values()).filter(
      def => def.category === category
    );
  }
  
  /**
   * Check if widget type is registered
   */
  has(type: string): boolean {
    return this.definitions.has(type);
  }
  
  /**
   * Create a widget instance
   */
  create(config: IWidgetConfig): HTMLElement | null {
    const definition = this.definitions.get(config.type);
    
    if (!definition) {
      console.error(`Widget type not found: ${config.type}`);
      return null;
    }
    
    try {
      let element: HTMLElement;
      
      if (definition.reactComponent) {
        // Create React-based widget
        const tagName = definition.reactComponent.tagName;
        element = document.createElement(tagName);
      } else if (definition.elementClass) {
        // Create pure web component widget
        element = new definition.elementClass();
      } else {
        console.error(`Widget type ${config.type} has no component or element class`);
        return null;
      }
      
      // Apply configuration
      if ('setConfig' in element && typeof (element as any).setConfig === 'function') {
        (element as any).setConfig(config);
      } else if ('config' in element) {
        (element as any).config = config;
      }
      
      // Store instance (cast to BaseWidget for compatibility)
      this.instances.set(config.id, element as any);
      
      console.log(`[WidgetRegistry] Created widget: ${config.id} (${config.type})`);
      
      return element;
    } catch (error) {
      console.error(`Failed to create widget ${config.type}:`, error);
      return null;
    }
  }
  
  /**
   * Get widget instance by ID
   */
  getInstance(widgetId: string): BaseWidget | undefined {
    return this.instances.get(widgetId);
  }
  
  /**
   * Get all widget instances
   */
  getInstances(): BaseWidget[] {
    return Array.from(this.instances.values());
  }
  
  /**
   * Remove widget instance
   */
  removeInstance(widgetId: string): void {
    const instance = this.instances.get(widgetId);
    
    if (instance) {
      // Cleanup
      if ('disconnectedCallback' in instance && typeof (instance as any).disconnectedCallback === 'function') {
        (instance as any).disconnectedCallback();
      }
      
      this.instances.delete(widgetId);
      console.log(`[WidgetRegistry] Removed widget instance: ${widgetId}`);
    }
  }
  
  /**
   * Clear all instances
   */
  clearInstances(): void {
    for (const [_id, instance] of this.instances) {
      if ('disconnectedCallback' in instance && typeof (instance as any).disconnectedCallback === 'function') {
        (instance as any).disconnectedCallback();
      }
    }
    
    this.instances.clear();
    console.log('[WidgetRegistry] Cleared all widget instances');
  }
  
  /**
   * Get tag name for widget type
   */
  getTagName(type: string): string | null {
    const definition = this.definitions.get(type);
    
    if (!definition) {
      return null;
    }
    
    if (definition.reactComponent) {
      return definition.reactComponent.tagName;
    } else if (definition.tagName) {
      return definition.tagName;
    }
    
    return createTagName(type);
  }
  
  /**
   * Create default config for widget type
   */
  createDefaultConfig(type: string): Partial<IWidgetConfig> {
    const definition = this.definitions.get(type);
    
    if (!definition) {
      return {};
    }
    
    return {
      type,
      size: 'md',
      ...definition.defaultConfig
    };
  }
  
  /**
   * Get debug info
   */
  getDebugInfo(): {
    definitions: number;
    instances: number;
    types: string[];
  } {
    return {
      definitions: this.definitions.size,
      instances: this.instances.size,
      types: Array.from(this.definitions.keys())
    };
  }
}
