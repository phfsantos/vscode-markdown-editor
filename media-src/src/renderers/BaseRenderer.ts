/**
 * BaseRenderer - Abstract base class for all renderers
 * 
 * This class provides common functionality that all renderers can inherit.
 * Extend this class to create new renderers.
 */

import type Vditor from 'vditor';
import type { IRenderer, IRendererCapabilities, IRenderContext } from './types';

export abstract class BaseRenderer implements IRenderer {
  // Abstract properties - must be implemented by subclasses
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly language: string;
  abstract readonly version: string;
  abstract readonly capabilities: IRendererCapabilities;
  
  // Track loaded scripts to avoid duplicates
  private static loadedScripts: Set<string> = new Set();
  
  /**
   * Main render function - must be implemented by subclasses
   */
  abstract render(element: HTMLElement, vditor: Vditor, context: IRenderContext): Promise<void>;
  
  /**
   * Helper: Load an external script
   */
  protected loadScript(url: string): Promise<void> {
    if (BaseRenderer.loadedScripts.has(url)) {
      console.log(`📜 RENDERER: Script already loaded: ${url}`);
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      console.log(`📜 RENDERER: Loading script: ${url}`);
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => {
        BaseRenderer.loadedScripts.add(url);
        console.log(`✅ RENDERER: Loaded script: ${url}`);
        resolve();
      };
      script.onerror = () => {
        console.error(`❌ RENDERER: Failed to load script: ${url}`);
        reject(new Error(`Failed to load script: ${url}`));
      };
      document.head.appendChild(script);
    });
  }
  
  /**
   * Helper: Load an external stylesheet
   */
  protected loadStylesheet(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`🎨 RENDERER: Loading stylesheet: ${url}`);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.onload = () => {
        console.log(`✅ RENDERER: Loaded stylesheet: ${url}`);
        resolve();
      };
      link.onerror = () => {
        console.error(`❌ RENDERER: Failed to load stylesheet: ${url}`);
        reject(new Error(`Failed to load stylesheet: ${url}`));
      };
      document.head.appendChild(link);
    });
  }
  
  /**
   * Helper: Send message to extension host
   */
  protected sendMessage(context: IRenderContext, command: string, payload: any): void {
    context.messageHandler.send(command, {
      rendererId: this.id,
      boardId: context.boardId,
      instanceId: context.instanceId,
      ...payload
    });
  }
  
  /**
   * Helper: Listen for messages from extension host
   */
  protected onMessage(
    context: IRenderContext, 
    command: string, 
    handler: (payload: any) => void
  ): () => void {
    return context.messageHandler.on(command, (message) => {
      // Only handle messages for this renderer instance
      if (message.rendererId === this.id && 
          message.boardId === context.boardId &&
          message.instanceId === context.instanceId) {
        handler(message);
      }
    });
  }
  
  /**
   * Helper: Extract board ID from code block
   */
  protected extractBoardId(element: HTMLElement): string {
    const textContent = element.textContent || '';
    
    // Look for explicit board ID in comment
    const boardIdMatch = textContent.match(/<!--\s*board:\s*([^-\s]+)\s*-->/);
    if (boardIdMatch) {
      return boardIdMatch[1];
    }
    
    // Generate board ID from position in document
    const allBlocks = Array.from(
      document.querySelectorAll(`code.language-${this.language}`)
    );
    const currentIndex = allBlocks.indexOf(element);
    
    if (currentIndex > 0) {
      return `board-${currentIndex + 1}`;
    }
    
    return 'default';
  }
  
  /**
   * Helper: Extract filename from code block
   */
  protected extractFilename(element: HTMLElement): string | null {
    const textContent = element.textContent || '';
    const filenameMatch = textContent.match(/<!--\s*file:\s*([^-\s]+(?:\/[^-\s]+)*)\s*-->/);
    return filenameMatch ? filenameMatch[1] : null;
  }
  
  /**
   * Helper: Show error in renderer element
   */
  protected showError(element: HTMLElement, error: string): void {
    element.innerHTML = `
      <div class="renderer-error" style="
        padding: 16px;
        border: 2px solid var(--vscode-errorForeground, #f48771);
        border-radius: 4px;
        background: var(--vscode-inputValidation-errorBackground, rgba(244, 135, 113, 0.1));
        color: var(--vscode-errorForeground, #f48771);
        font-family: var(--vscode-font-family);
      ">
        <strong>⚠️ Renderer Error (${this.name})</strong><br>
        ${error}
      </div>
    `;
  }
  
  /**
   * Helper: Show loading indicator
   */
  protected showLoading(element: HTMLElement, message: string = 'Loading...'): void {
    element.innerHTML = `
      <div class="renderer-loading" style="
        padding: 16px;
        text-align: center;
        color: var(--vscode-foreground);
        font-family: var(--vscode-font-family);
      ">
        <div class="spinner" style="
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid var(--vscode-progressBar-background, rgba(14, 99, 156, 0.4));
          border-top-color: var(--vscode-button-background, #0e639c);
          border-radius: 50%;
          animation: renderer-spin 1s linear infinite;
        "></div>
        <p style="margin-top: 8px;">${message}</p>
      </div>
    `;
    
    // Add spinner animation if not already present
    if (!document.querySelector('#renderer-spinner-styles')) {
      const style = document.createElement('style');
      style.id = 'renderer-spinner-styles';
      style.textContent = `
        @keyframes renderer-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  /**
   * Optional: Called when data needs to be saved
   */
  async onSave?(data: any, context: IRenderContext): Promise<void>;
  
  /**
   * Optional: Called when data needs to be loaded
   */
  async onLoad?(context: IRenderContext): Promise<any>;
  
  /**
   * Optional: Called when renderer is being destroyed
   */
  onDestroy?(context: IRenderContext): void;
  
  /**
   * Optional: Called when renderer should update
   */
  async onUpdate?(context: IRenderContext): Promise<void>;
  
  /**
   * Optional: Validate configuration data
   */
  validateConfig?(config: any): boolean;
}
