/**
 * Core type definitions for the widget system
 */

/**
 * Values that may be embedded directly in a declarative expression.
 *
 * Keeping this JSON-shaped prevents configuration from smuggling executable
 * objects such as functions into the evaluator.
 */
export type DeclarativeValue =
  | string
  | number
  | boolean
  | null
  | readonly DeclarativeValue[]
  | { readonly [key: string]: DeclarativeValue };

/** Property paths are validated at runtime before they are traversed. */
export type PropertyPath = readonly string[];

const UNSAFE_PROPERTY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Return whether a path key is safe to use for data-only property access.
 * Runtime validation is required because configuration is workspace data.
 */
export function isSafePropertyKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && !UNSAFE_PROPERTY_KEYS.has(value)
    && /^[A-Za-z0-9_$-]+$/.test(value);
}

export function isSafePropertyPath(value: unknown): value is PropertyPath {
  return Array.isArray(value) && value.every(isSafePropertyKey);
}

export type ArithmeticOperator = 'add' | 'subtract' | 'multiply' | 'divide';

export type ComparisonOperator =
  | 'equals'
  | 'not-equals'
  | 'less-than'
  | 'less-than-or-equal'
  | 'greater-than'
  | 'greater-than-or-equal';

/** Closed, data-only expression tree used by widget configuration. */
export type ValueExpression =
  | { readonly kind: 'literal'; readonly value: DeclarativeValue }
  | { readonly kind: 'get'; readonly path: PropertyPath }
  | { readonly kind: 'coalesce'; readonly values: readonly ValueExpression[] }
  | { readonly kind: 'concat'; readonly values: readonly ValueExpression[] }
  | {
      readonly kind: 'arithmetic';
      readonly operator: ArithmeticOperator;
      readonly left: ValueExpression;
      readonly right: ValueExpression;
    }
  | {
      readonly kind: 'comparison';
      readonly operator: ComparisonOperator;
      readonly left: ValueExpression;
      readonly right: ValueExpression;
    };

export interface WidgetActionMetadata {
  id: string;
  label: string;
  icon?: string;
  confirmMessage?: string;
  cooldown?: number;
}

/** Closed, capability-backed action set for widget configuration. */
export type WidgetAction =
  | (WidgetActionMetadata & {
      readonly kind: 'set-data';
      readonly path: PropertyPath;
      readonly value: ValueExpression;
    })
  | (WidgetActionMetadata & {
      readonly kind: 'emit';
      readonly event: string;
      readonly payload?: ValueExpression;
    })
  | (WidgetActionMetadata & {
      readonly kind: 'open-url';
      readonly url: ValueExpression;
    });

/**
 * Widget configuration interface
 */
export interface IWidgetConfig {
  id: string;                          // Unique instance ID
  type: string;                        // Widget type identifier
  title?: string;                      // Display title
  size: 'sm' | 'md' | 'lg';           // Size hint
  position?: { row: number; col: number };
  
  dataSource?: IDataSource;
  refreshInterval?: number;            // Seconds
  
  connections?: IWidgetConnection[];
  actions?: IWidgetAction[];
  
  theme?: IWidgetTheme;
  customCss?: string;
}

/**
 * Data source configuration
 */
export interface IDataSource {
  type: 'static' | 'api' | 'file' | 'computed' | 'widget';
  config: {
    // Static
    data?: any;
    
    // API
    url?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: any;
    transform?: ValueExpression;
    
    // File
    path?: string;
    format?: 'json' | 'csv' | 'yaml';
    
    // Computed
    expression?: ValueExpression;
    dependencies?: string[];            // Widget IDs
    
    // Widget
    widgetId?: string;
    property?: string;
  };
}

/**
 * Widget connection configuration
 */
export interface IWidgetConnection {
  id: string;
  sourceWidget: string;                // Source widget ID
  sourceEvent: string;                 // Event name
  targetProperty: string;              // Target property to update
  transform?: ValueExpression;
  enabled: boolean;
}

/**
 * Widget action (button/script) configuration
 */
export type IWidgetAction = WidgetAction;

/**
 * Widget theme configuration
 */
export interface IWidgetTheme {
  type: 'light' | 'dark' | 'high-contrast-light' | 'high-contrast-dark';
  colors: {
    // Primary colors
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    foreground: string;
    
    // State colors
    error: string;
    success: string;
    warning: string;
    info: string;
    
    // UI element colors
    border: string;
    hover: string;
    active: string;
    disabled: string;
    selection: string;
    
    // Semantic colors
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    link: string;
    linkHover: string;
    
    // Component colors
    cardBackground: string;
    inputBackground: string;
    inputBorder: string;
    buttonBackground: string;
    buttonForeground: string;
    buttonHoverBackground: string;
    
    // Shadow and overlay
    shadow: string;
    overlay: string;
  };
}

/**
 * Widget event detail
 */
export interface IWidgetEvent<T = any> {
  widgetId: string;
  event: string;
  payload: T;
  timestamp: number;
}

/**
 * Dashboard configuration (multiple widgets)
 */
export interface IDashboardConfig {
  id: string;
  widgets: IWidgetConfig[];
  connections?: IWidgetConnection[];
  layout?: {
    type: 'grid' | 'flex' | 'absolute';
    columns?: number;
    gap?: number;
  };
}
