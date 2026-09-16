/**
 * Core module exports
 * 
 * Central export point for all core widget system components
 */

// Types
export * from './types';

// Core classes
export { BaseWidget } from './BaseWidget';
export { WidgetBus } from './WidgetBus';
export { ThemeBridge } from './ThemeBridge';
export { DataProvider } from './DataProvider';
export {
  DeclarativeActionEngine,
  DeclarativeActionError,
} from './DeclarativeActionEngine';
export type {
  DeclarativeActionCapabilities,
  DeclarativeActionEngineOptions,
  DeclarativeActionErrorCode,
} from './DeclarativeActionEngine';

// React wrapper and registry
export { ReactWidgetWrapper, createWidgetElement, registerReactWidget, createTagName } from './ReactWidgetWrapper';
export type { ReactWidgetProps, WidgetComponentDefinition } from './ReactWidgetWrapper';
export { WidgetRegistry } from './WidgetRegistry';
export type { WidgetDefinition } from './WidgetRegistry';
