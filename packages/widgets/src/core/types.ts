/**
 * Core type definitions for the widget system
 */

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
    transform?: string;                // JS expression
    
    // File
    path?: string;
    format?: 'json' | 'csv' | 'yaml';
    
    // Computed
    expression?: string;
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
  transform?: string;                  // Optional JS transform
  enabled: boolean;
}

/**
 * Widget action (button/script) configuration
 */
export interface IWidgetAction {
  id: string;
  label: string;
  icon?: string;
  script: string;                      // JavaScript to execute
  confirmMessage?: string;
  cooldown?: number;                   // Milliseconds
}

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
