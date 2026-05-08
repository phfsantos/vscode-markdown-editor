/**
 * Main entry point for @phfsantos/markdown-widgets
 * 
 * Exports all core components, widgets, and utilities
 */

// Core exports
export * from './core';

// UI components (wigggle-ui inspired)
export * from './ui';

// Settings UI exports
export { WidgetSettings, DataSourceEditor } from './settings/WidgetSettings';
export type { WidgetSettingsProps } from './settings/WidgetSettings';

// Widget types
export type { IWidgetConfig, IDataSource, IWidgetConnection, IWidgetAction, IWidgetTheme } from './core/types';

// Core widgets
export { HelloWorldWidget } from './widgets/HelloWorldWidget';
export { ChartWidget } from './widgets/ChartWidget';
export type { ChartWidgetConfig } from './widgets/ChartWidget';
export { TableWidget } from './widgets/TableWidget';
export type { TableWidgetConfig, TableColumn } from './widgets/TableWidget';
export { FormWidget } from './widgets/FormWidget';
export type { FormWidgetConfig, FormField } from './widgets/FormWidget';

// wigggle-ui inspired widgets
export { ClockWidget } from './widgets/ClockWidget';
export { CalendarWidget } from './widgets/CalendarWidget';
export { WeatherWidget } from './widgets/WeatherWidget';
export { StockWidget } from './widgets/StockWidget';
export { ProductivityWidget } from './widgets/ProductivityWidget';
export { MacroBoardWidget } from './widgets/MacroBoardWidget';
export type { MacroBoardWidgetConfig, MacroBoardWidgetData, MacroBoardButton } from './widgets/MacroBoardWidget';

// Widget registration
export { registerCoreWidgets } from './widgets/registerWidgets';
