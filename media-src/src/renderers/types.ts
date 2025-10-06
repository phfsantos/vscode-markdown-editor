/**
 * Core type definitions for the renderer system
 */

import type Vditor from 'vditor';

/**
 * Renderer capabilities - what features does this renderer support?
 */
export interface IRendererCapabilities {
  /** Can this renderer save data to files? */
  supportsPersistence: boolean;
  /** Can multiple instances of this renderer exist in one document? */
  supportsMultipleInstances: boolean;
  /** Can data be exported (e.g., to PNG, PDF, etc.)? */
  supportsExport: boolean;
  /** Can data be imported from external sources? */
  supportsImport: boolean;
  /** Does this renderer need to communicate with extension host? */
  requiresExtensionHost: boolean;
}

/**
 * Render context - everything a renderer needs to operate
 */
export interface IRenderContext {
  /** URI of the document containing this renderer */
  documentUri: string;
  /** Unique identifier for this renderer instance */
  instanceId: string;
  /** Board/renderer specific ID (e.g., "default", "board-2") */
  boardId: string;
  /** Reference to Vditor instance */
  vditor: Vditor;
  /** Message handler for extension communication */
  messageHandler: IMessageHandler;
  /** File system helper for persistence */
  fileSystemHelper: IFileSystemHelper;
}

/**
 * Message handler interface for webview-extension communication
 */
export interface IMessageHandler {
  /** Send a message to the extension host */
  send(command: string, payload: any): void;
  /** Listen for messages from extension host */
  on(command: string, handler: (payload: any) => void): () => void;
}

/**
 * File system helper interface
 */
export interface IFileSystemHelper {
  /** Load data for a renderer instance */
  loadRendererData(rendererId: string, boardId: string): Promise<any>;
  /** Save data for a renderer instance */
  saveRendererData(rendererId: string, boardId: string, data: any): Promise<void>;
  /** Check if renderer data file exists */
  hasRendererData(rendererId: string, boardId: string): Promise<boolean>;
}

/**
 * Core renderer interface - all renderers must implement this
 */
export interface IRenderer {
  /** Unique identifier for this renderer type (e.g., "kanban-board") */
  readonly id: string;
  
  /** Human-readable name */
  readonly name: string;
  
  /** Language identifier for code blocks (e.g., "kanban-board") */
  readonly language: string;
  
  /** Semantic version */
  readonly version: string;
  
  /** Renderer capabilities */
  readonly capabilities: IRendererCapabilities;
  
  /**
   * Extract renderer-specific ID from code block element
   * 
   * Each renderer implements its own ID extraction logic:
   * - KanbanRenderer: looks for <!-- board: X --> and generates board-1, board-2, etc.
   * - TableRenderer: looks for <!-- table: X --> and generates table-1, table-2, etc.
   * 
   * @param element The code block element to extract ID from
   * @returns The extracted or generated ID (e.g., "board-1", "table-2", "default")
   */
  extractId(element: HTMLElement): string;
  
  /** Main render function - creates the UI */
  render(element: HTMLElement, vditor: Vditor, context: IRenderContext): Promise<void>;
  
  /** Called when data needs to be saved */
  onSave?(data: any, context: IRenderContext): Promise<void>;
  
  /** Called when data needs to be loaded */
  onLoad?(context: IRenderContext): Promise<any>;
  
  /** Called when renderer is being destroyed/removed */
  onDestroy?(context: IRenderContext): void;
  
  /** Called when renderer should update (e.g., theme change) */
  onUpdate?(context: IRenderContext): Promise<void>;
  
  /** Validate configuration data */
  validateConfig?(config: any): boolean;
}

/**
 * Renderer registration info
 */
export interface IRendererRegistration {
  renderer: IRenderer;
  /** When was this renderer registered */
  registeredAt: Date;
  /** Source of registration (builtin, extension, etc.) */
  source: 'builtin' | 'extension' | 'user';
}

/**
 * VS Code message types for renderer communication
 */
export interface IRendererMessage {
  command: string;
  requestId?: string;
  rendererId?: string;
  boardId?: string;
  payload?: any;
  error?: string;
}
