/**
 * Renderer System - Core Infrastructure
 * 
 * This module provides the foundational components for the extensible
 * code renderer system.
 */

// Type definitions
export * from './types';

// Core classes
export { RendererRegistry, getRendererRegistry } from './RendererRegistry';
export { MessageHandler, getMessageHandler } from './MessageHandler';
export { FileSystemHelper, getFileSystemHelper } from './FileSystemHelper';
export { BaseRenderer } from './BaseRenderer';

// Built-in renderers
export { KanbanRenderer } from './builtin/KanbanRenderer';
export { TableRenderer } from './builtin/TableRenderer';
export { PlaygroundRenderer } from './builtin/PlaygroundRenderer';

// Initialization
export { 
  initializeRendererSystem, 
  generateVditorCustomRenders,
  getRendererByLanguage 
} from './init';
