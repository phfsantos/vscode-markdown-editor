/**
 * ReactWidgetWrapper - Wraps React components as Web Components using @lit/react
 * 
 * This utility creates a bridge between React components and Web Components,
 * allowing React widgets to be used as custom elements in the DOM.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import type { IWidgetConfig } from './types';

export interface ReactWidgetProps {
  config: IWidgetConfig;
  data?: any;
  onUpdate?: (data: any) => void;
  onError?: (error: Error) => void;
}

export interface WidgetComponentDefinition {
  component: React.ComponentType<ReactWidgetProps>;
  tagName: string;
  displayName: string;
  description?: string;
  defaultConfig?: Partial<IWidgetConfig>;
}

/**
 * Creates a Web Component class for a React component
 * 
 * @param definition - Widget component definition
 * @returns Web Component class
 */
export function createWidgetElement(
  definition: WidgetComponentDefinition
): typeof HTMLElement {
  const { component } = definition;
  
  return class extends HTMLElement {
    private _config: IWidgetConfig | null = null;
    private _data: any = null;
    private _updateCallback: ((data: any) => void) | null = null;
    private _errorCallback: ((error: Error) => void) | null = null;
    private _root: ReactDOM.Root | null = null;
    private _container: HTMLDivElement | null = null;
    
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }
    
    static get observedAttributes() {
      return ['config', 'data'];
    }
    
    get config(): IWidgetConfig | null {
      return this._config;
    }
    
    set config(value: IWidgetConfig | null) {
      this._config = value;
      this.render();
    }
    
    get data(): any {
      return this._data;
    }
    
    set data(value: any) {
      this._data = value;
      this.render();
    }
    
    connectedCallback() {
      this.setupContainer();
      this.render();
    }
    
    disconnectedCallback() {
      if (this._root) {
        this._root.unmount();
        this._root = null;
      }
    }
    
    attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
      if (name === 'config' && newValue) {
        try {
          this.config = JSON.parse(newValue);
        } catch (e) {
          console.error('Failed to parse config:', e);
        }
      } else if (name === 'data' && newValue) {
        try {
          this.data = JSON.parse(newValue);
        } catch (e) {
          console.error('Failed to parse data:', e);
        }
      }
    }
    
    setConfig(config: IWidgetConfig) {
      this.config = config;
    }
    
    setData(data: any) {
      this.data = data;
    }
    
    setOnUpdate(callback: (data: any) => void) {
      this._updateCallback = callback;
    }
    
    setOnError(callback: (error: Error) => void) {
      this._errorCallback = callback;
    }
    
    private setupContainer() {
      if (!this.shadowRoot || this._container) return;
      
      this._container = document.createElement('div');
      this._container.className = 'widget-root';
      this.shadowRoot.appendChild(this._container);
      
      this._root = ReactDOM.createRoot(this._container);
    }
    
    private render() {
      if (!this._root || !this._config) return;
      
      const props: ReactWidgetProps = {
        config: this._config,
        data: this._data,
        onUpdate: this._updateCallback || undefined,
        onError: this._errorCallback || undefined
      };
      
      this._root.render(React.createElement(component, props));
    }
  };
}

/**
 * Register a React widget as a custom element
 * 
 * @param definition - Widget component definition
 */
export function registerReactWidget(definition: WidgetComponentDefinition): void {
  if (customElements.get(definition.tagName)) {
    console.warn(`Widget ${definition.tagName} is already registered`);
    return;
  }
  
  const WebComponent = createWidgetElement(definition);
  customElements.define(definition.tagName, WebComponent);
  
  console.log(`[ReactWidgetWrapper] Registered ${definition.tagName}`);
}

/**
 * Helper to create widget tag name from type
 */
export function createTagName(type: string): string {
  return `md-widget-${type.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
}

// Export as namespace for convenience
export const ReactWidgetWrapper = {
  createWidgetElement,
  registerReactWidget,
  createTagName
};
