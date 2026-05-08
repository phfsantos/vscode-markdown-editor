/**
 * Core type definitions for the widget system
 */
/**
 * Widget configuration interface
 */
export interface IWidgetConfig {
    id: string;
    type: string;
    title?: string;
    size: 'sm' | 'md' | 'lg';
    position?: {
        row: number;
        col: number;
    };
    dataSource?: IDataSource;
    refreshInterval?: number;
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
        data?: any;
        url?: string;
        method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
        headers?: Record<string, string>;
        body?: any;
        transform?: string;
        path?: string;
        format?: 'json' | 'csv' | 'yaml';
        expression?: string;
        dependencies?: string[];
        widgetId?: string;
        property?: string;
    };
}
/**
 * Widget connection configuration
 */
export interface IWidgetConnection {
    id: string;
    sourceWidget: string;
    sourceEvent: string;
    targetProperty: string;
    transform?: string;
    enabled: boolean;
}
/**
 * Widget action (button/script) configuration
 */
export interface IWidgetAction {
    id: string;
    label: string;
    icon?: string;
    script: string;
    confirmMessage?: string;
    cooldown?: number;
}
/**
 * Widget theme configuration
 */
export interface IWidgetTheme {
    type: 'light' | 'dark' | 'high-contrast-light' | 'high-contrast-dark';
    colors: {
        primary: string;
        secondary: string;
        accent: string;
        background: string;
        foreground: string;
        error: string;
        success: string;
        warning: string;
        info: string;
        border: string;
        hover: string;
        active: string;
        disabled: string;
        selection: string;
        textPrimary: string;
        textSecondary: string;
        textMuted: string;
        link: string;
        linkHover: string;
        cardBackground: string;
        inputBackground: string;
        inputBorder: string;
        buttonBackground: string;
        buttonForeground: string;
        buttonHoverBackground: string;
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
//# sourceMappingURL=types.d.ts.map