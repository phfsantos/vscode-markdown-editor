/**
 * KanbanRenderer - Kanban board renderer using bundled npm package
 * 
 * This renderer provides interactive kanban board functionality with:
 * - Multiple boards per document support
 * - File-based persistence (JSON files)
 * - Backwards compatibility with inline JSON data
 * - Auto-generated board IDs
 * - Bundled @phfsantos/kanban-board v1.3.0 (no CDN required)
 * 
 * v1.3.0 API Changes:
 * - Uses setData()/getData() methods instead of deprecated data attribute
 * - Listens for 'kanban-change' event instead of 'kanban-save'
 * - Enhanced error handling with 'kanban-error' events
 * - Includes Zod validation for data integrity
 */

import type Vditor from 'vditor';
import { BaseRenderer } from '../BaseRenderer';
import type { IRenderer, IRendererCapabilities, IRenderContext } from '../types';

// Import kanban-board web component (bundled with extension)
import '@phfsantos/kanban-board';

export class KanbanRenderer extends BaseRenderer implements IRenderer {
  readonly id = 'kanban-board';
  readonly name = 'Kanban Board';
  readonly language = 'kanban-board';
  readonly version = '2.2.0';
  readonly description = 'Interactive Kanban board (bundled v1.3.0)';
  readonly author = 'VSCode Markdown Editor';
  
  readonly capabilities: IRendererCapabilities = {
    supportsPersistence: true,
    supportsMultipleInstances: true,
    supportsExport: true,
    supportsImport: false,
    requiresExtensionHost: true
  };

  /**
   * Extract board-specific ID from code block
   * Overrides BaseRenderer.extractId() to implement kanban-specific logic
   * 
   * Looks for: <!-- board: board-1 --> or <!-- board: my-board-name -->
   * Generates: board-1, board-2, board-3, etc. based on position
   */
  extractId(element: HTMLElement): string {
    const textContent = element.textContent || '';
    
    // Look for explicit board ID in comment
    // Match pattern: <!-- board: board-3 --> or <!-- board: my-board-name -->
    const boardIdMatch = textContent.match(/<!--\s*board:\s*([^\s>]+)\s*-->/);
    if (boardIdMatch) {
      console.log(`🔍 KANBAN RENDERER: Extracted boardId from comment: '${boardIdMatch[1]}'`);
      return boardIdMatch[1];
    }
    
    // Generate board ID from position in document
    const allBlocks = Array.from(document.querySelectorAll('code.language-kanban-board'));
    const currentIndex = allBlocks.indexOf(element);
    
    if (currentIndex > 0) {
      const generatedId = `board-${currentIndex + 1}`;
      console.log(`🔍 KANBAN RENDERER: Generated boardId from position: '${generatedId}'`);
      return generatedId;
    }
    
    console.log(`🔍 KANBAN RENDERER: Using default boardId`);
    return 'default';
  }

  /**
   * Main render function
   */
  async render(element: HTMLElement, vditor: Vditor, context: IRenderContext): Promise<void> {
    try {
      // Find the code element and container nodes
      const codeElement = element.querySelector('code.language-kanban-board') as HTMLElement;
      if (!codeElement) {
        this.showError(element, 'Could not find kanban code block');
        return;
      }

      const ir__node = element.closest('.vditor-ir__node') as HTMLElement;
      const wysiwyg__node = element.closest('.vditor-wysiwyg__block') as HTMLElement;
      const containerNode = ir__node || wysiwyg__node;

      // Extract board configuration
      const textContent = codeElement.textContent || '';
      const boardId = this.extractId(codeElement);
      const requestedFilename = this.extractFilename(codeElement);
      
      console.log(`📋 KANBAN RENDERER: Rendering board '${boardId}'`);
      console.log(`   Code block content (first 200 chars):`, textContent.substring(0, 200));
      console.log(`   Extracted boardId: '${boardId}'`);
      console.log(`   Extracted filename: '${requestedFilename}'`);

      // Check for backwards compatibility - inline JSON data
      const inlineData = this.extractInlineData(textContent);
      
      // Load data
      this.showLoading(element, `Loading kanban board '${boardId}'...`);
      
      try {
        const data = await this.loadData(context, boardId, inlineData, requestedFilename);
        
        // Create kanban board element
        this.createKanbanBoard(element, data, boardId);
        
        // Setup event listeners if in editable mode
        if (containerNode) {
          setTimeout(() => {
            this.setupEventListeners(element, containerNode, boardId, context);
            this.showFileInfo(element, data.filename || this.getDefaultFilename(context, boardId), boardId);
          }, 100);
        } else {
          // Preview mode - make read-only
          this.makeReadOnly(element);
        }
        
        console.log(`✅ KANBAN RENDERER: Successfully rendered board '${boardId}'`);
      } catch (error) {
        console.error(`❌ KANBAN RENDERER: Error loading board '${boardId}'`, error);
        this.showError(element, `Failed to load board: ${error instanceof Error ? error.message : String(error)}`);
      }
    } catch (error) {
      console.error('❌ KANBAN RENDERER: Render error', error);
      this.showError(element, `Render error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract inline JSON data from code block (backwards compatibility)
   */
  private extractInlineData(textContent: string): any | null {
    try {
      const trimmedContent = textContent.trim();
      // Skip comment lines when parsing JSON
      const jsonContent = trimmedContent.replace(/<!--.*?-->/gs, '').trim();
      
      if (jsonContent && jsonContent.startsWith('{')) {
        const parsedData = JSON.parse(jsonContent);
        if (parsedData.columns && Array.isArray(parsedData.columns)) {
          console.log('📋 KANBAN RENDERER: Found inline JSON data (backwards compatibility)');
          return parsedData;
        }
      }
    } catch (error) {
      // Not JSON data, that's fine
    }
    return null;
  }

  /**
   * Load kanban data from file system or use inline/default data
   */
  private async loadData(
    context: IRenderContext, 
    boardId: string, 
    inlineData: any | null,
    requestedFilename: string | null
  ): Promise<any> {
    const requestId = Math.random().toString(36).substring(2, 15);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.warn(`⚠️ KANBAN RENDERER: Timeout loading board '${boardId}', using default data`);
        resolve({
          data: this.getDefaultData(),
          filename: this.getDefaultFilename(context, boardId),
          dataSource: 'default'
        });
      }, 10000);

      // Listen for response using generic renderer protocol
      const removeListener = context.messageHandler.on('renderer-data-loaded', (message: any) => {
        if (message.requestId === requestId && message.rendererId === this.id) {
          clearTimeout(timeout);
          removeListener();
          
          if (message.error) {
            console.warn(`⚠️ KANBAN RENDERER: Error loading '${boardId}':`, message.error);
            // Use default data on error
            resolve({
              data: this.getDefaultData(),
              filename: this.getDefaultFilename(context, boardId),
              dataSource: 'default'
            });
          } else {
            console.log(`✅ KANBAN RENDERER: Loaded board '${boardId}' from ${message.dataSource}`);
            resolve({
              data: message.data,
              filename: this.getDefaultFilename(context, boardId),
              dataSource: message.dataSource
            });
          }
        }
      });

      // Request data from extension host using generic renderer protocol
      context.messageHandler.send('renderer-load-data', {
        requestId,
        rendererId: this.id,
        boardId
      });
    });
  }

  /**
   * Create the kanban board DOM element
   * Updated for v1.3.0 API - uses setData() instead of deprecated data attribute
   */
  private createKanbanBoard(container: HTMLElement, loadedData: any, boardId: string): void {
    const data = loadedData.data || loadedData;
    
    // Create element without deprecated data attribute (v1.3.0 uses setData() method)
    container.innerHTML = `<kanban-board 
      id="kanban-board-${boardId}"
      class="language-kanban-board" 
      data-board-id='${boardId}'
    ></kanban-board>`;
    
    // Use new setData() API after element is created (v1.3.0)
    // Small delay to ensure custom element is fully registered
    setTimeout(() => {
      const board = container.querySelector('kanban-board') as any;
      if (board && board.setData) {
        const success = board.setData(data, false); // false = don't dispatch kanban-change event on initial set
        if (!success) {
          console.error(`❌ KANBAN RENDERER: Failed to set data for board '${boardId}' - validation failed`);
          this.showError(container, 'Invalid kanban board data. Please check the console for details.');
        }
      } else if (board) {
        // Fallback for older versions that don't have setData()
        console.warn(`⚠️ KANBAN RENDERER: Using deprecated data attribute for board '${boardId}' - update to v1.3.0+`);
        board.setAttribute('data', encodeURIComponent(JSON.stringify(data)));
      }
    }, 100);
  }

  /**
   * Setup event listeners for kanban interactions
   */
  private setupEventListeners(
    container: HTMLElement, 
    node: HTMLElement, 
    boardId: string,
    context: IRenderContext
  ): void {
    if (!node) return;

    // Stop event propagation for kanban board to function properly
    const letItFocus = (e: Event) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const events = [
      'click', 'mousedown', 'mouseup', 'mousemove',
      'keydown', 'keypress', 'keyup',
      'beforeinput', 'focus', 'focusin', 'input'
    ];

    events.forEach(eventName => {
      container.addEventListener(eventName, letItFocus);
    });

    // Setup kanban board save handler
    const kanbanBoard = container.querySelector('kanban-board');
    if (kanbanBoard) {
      // v1.3.0: Listen for 'kanban-change' event (replaces 'kanban-save')
      // Event detail structure changed: { data, timestamp } instead of just data
      kanbanBoard.addEventListener('kanban-change', (event: any) => {
        const data = event.detail.data;      // v1.3.0: data is nested in event.detail.data
        const timestamp = event.detail.timestamp || Date.now();
        console.log(`💾 KANBAN RENDERER: Saving board '${boardId}' at ${new Date(timestamp).toISOString()}`, data);
        
        context.messageHandler.send('renderer-save-data', {
          rendererId: this.id,
          boardId,
          data
        });
      });

      // v1.3.0: Listen for 'kanban-error' event for validation and operation errors
      kanbanBoard.addEventListener('kanban-error', (event: any) => {
        const error = event.detail;
        console.error(`❌ KANBAN RENDERER: Error for board '${boardId}'`, {
          type: error.type,              // 'validation' | 'operation' | 'system'
          message: error.message,         // Technical error message
          userMessage: error.userMessage, // User-friendly message
          details: error.details          // Additional error details
        });
        
        // Show user-friendly error message
        const errorMsg = error.userMessage || error.message || 'An error occurred with the kanban board';
        this.showError(container, errorMsg);
      });

      // Handle save confirmation using generic renderer protocol
      const handleSaveConfirmation = (message: any) => {
        if (message.rendererId === this.id && message.boardId === boardId) {
          if (message.error) {
            console.error(`❌ KANBAN RENDERER: Save error for '${boardId}'`, message.error);
            // Could show error UI here
          } else {
            console.log(`✅ KANBAN RENDERER: Successfully saved board '${boardId}'`);
          }
        }
      };

      context.messageHandler.on('renderer-data-saved', handleSaveConfirmation);
    }
  }

  /**
   * Show file information and warnings
   */
  private showFileInfo(container: HTMLElement, filename: string, boardId: string): void {
    const codeContainer = container.closest('.vditor-ir__node') || 
                          container.closest('.vditor-wysiwyg__block');
    if (!codeContainer) return;

    // Update code block with filename comment if not present
    const codeBlock = codeContainer.querySelector('code.language-kanban-board') as HTMLElement;
    if (codeBlock && codeBlock.textContent) {
      const currentContent = codeBlock.textContent;
      if (!currentContent.includes(`<!-- file: ${filename} -->`)) {
        const filenameComment = `<!-- file: ${filename} -->`;
        const boardComment = boardId !== 'default' ? `\n<!-- board: ${boardId} -->` : '';
        
        // Only add if no existing metadata
        if (!currentContent.includes('<!-- file:') && !currentContent.includes('<!-- board:')) {
          codeBlock.textContent = `${filenameComment}${boardComment}\n${currentContent}`;
        }
      }
    }

    // Create or update file info display (match TableRenderer style)
    let fileInfoElement = codeContainer.querySelector('.kanban-file-info') as HTMLElement;
    if (!fileInfoElement) {
      fileInfoElement = document.createElement('div');
      fileInfoElement.className = 'kanban-file-info';
      fileInfoElement.style.cssText = `
        background: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        border: 1px solid var(--vscode-panel-border, #3a3d41);
        border-radius: 4px;
        padding: 8px 12px;
        margin: 10px 0;
        font-size: 12px;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
      `;
      // Insert before kanban board
      const kanbanBoard = codeContainer.querySelector('kanban-board');
      if (kanbanBoard && kanbanBoard.parentNode) {
        kanbanBoard.parentNode.insertBefore(fileInfoElement, kanbanBoard);
      } else {
        codeContainer.appendChild(fileInfoElement);
      }
    }

    const boardLabel = boardId === 'default' ? 'Default Board' : `Board: ${boardId}`;
    fileInfoElement.innerHTML = `
      <div style="margin-bottom: 4px;">
        <strong>📋 ${boardLabel}</strong> → <code>${filename}</code>
      </div>
      <div style="font-size: 11px; opacity: 0.7;">
        ℹ️ Changes are auto-saved to JSON file • Use the kanban board interface to manage tasks
      </div>
    `;
  }

  /**
   * Make kanban board read-only (preview mode)
   */
  private makeReadOnly(container: HTMLElement): void {
    const kanbanBoard = container.querySelector('kanban-board');
    if (kanbanBoard) {
      kanbanBoard.setAttribute('style', 
        'pointer-events: none; cursor: not-allowed; user-select: none; opacity: 0.7;'
      );
      
      // Add preview mode indicator
      const previewIndicator = document.createElement('div');
      previewIndicator.innerHTML = '👁️ Preview Mode (Read-only)';
      previewIndicator.style.cssText = `
        position: absolute;
        top: 8px;
        right: 8px;
        background: var(--vscode-badge-background, #4d4d4d);
        color: var(--vscode-badge-foreground, #ffffff);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        z-index: 1000;
      `;
      kanbanBoard.parentNode?.insertBefore(previewIndicator, kanbanBoard);
    }
  }

  /**
   * Get default kanban data structure
   */
  private getDefaultData(): any {
    return {
      columns: [
        { id: "1", title: "Todo", items: [] },
        { id: "2", title: "Doing", items: [] },
        { id: "3", title: "Done", items: [] }
      ]
    };
  }

  /**
   * Get default filename for a board
   */
  private getDefaultFilename(context: IRenderContext, boardId: string): string {
    const docName = context.documentUri.split('/').pop()?.replace('.md', '') || 'document';
    return boardId === 'default' 
      ? `assets/${docName}.${this.id}.json`
      : `assets/${docName}.${this.id}.${boardId}.json`;
  }

}
