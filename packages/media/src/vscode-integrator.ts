import { getMarkdownClipboardText } from './clipboard-selection';

/**
 * VS Code Integration Manager for Vditor webview
 * Handles context menus, clipboard operations, and cursor management
 */
export class VSCodeWebviewIntegrator {
  private vditor: any;
  private cursorManager: any = null;
  private pendingRequests: Map<string, any> = new Map();
  private contextMenuHandlers: Map<string, () => void> = new Map();
  private clipboardQueue: Array<{ type: 'read' | 'write', data?: string, resolve: (value: any) => void, reject: (reason?: any) => void }> = [];
  private isProcessingClipboard = false;
  private lastCursorPosition: { line: number, character: number } | null = null;

  constructor(vditorInstance: any) {
    this.vditor = vditorInstance;
    this.initializeIntegration();
  }

  /**
   * Set cursor manager reference for coordinated paste handling
   */
  public setCursorManager(cursorManager: any): void {
    this.cursorManager = cursorManager;
  }

  /**
   * Initialize VS Code integration features
   */
  private initializeIntegration(): void {
    this.setupContextMenuIntegration();
    this.setupClipboardIntegration();
    this.setupCursorManagement();
    this.setupQuickFixIntegration();

  }

  /**
   * Setup enhanced context menu integration - Let Vditor handle the display
   */
  private setupContextMenuIntegration(): void {
    const editor = this.getEditorElement();
    if (!editor) return;

    // Make editor properly focusable for better interaction
    editor.setAttribute('contenteditable', 'true');
    editor.setAttribute('tabindex', '0');

    // REMOVED: The conflicting event listener that was preventing Vditor's contextmenu callback from working
    // The createVditorContextMenu() method will be called by Vditor automatically when configured properly

  }

  /**
   * Setup element-specific context menus for links, images, etc.
   * Ensure VS Code's native context menu appears with cut/copy/paste options
   */
  private setupElementSpecificContextMenus(): void {
    const editor = this.getEditorElement();
    if (!editor) return;

    // Make the editor focusable and selectable for VS Code context menu
    editor.setAttribute('tabindex', '0');
    editor.setAttribute('contenteditable', 'true');
    
    // Remove any existing Vditor context menu handlers
    const existingHandlers = editor.querySelectorAll('[data-contextmenu]');
    existingHandlers.forEach(el => {
      el.removeAttribute('data-contextmenu');
    });

    // Ensure context menu events bubble to VS Code with proper selection handling
    editor.addEventListener('contextmenu', (e) => {

      // Ensure there's a selection for cut/copy to work
      const selection = window.getSelection();
      if (!selection || selection.toString().length === 0) {
        // If no selection, select the word at cursor position
        const range = document.createRange();
        const target = e.target as Node;
        if (target && target.nodeType === Node.TEXT_NODE) {
          range.selectNode(target);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
      
      // Focus the editor to ensure VS Code recognizes it as the active element
      editor.focus();
      
      // Allow the event to bubble to VS Code
      // VS Code will handle showing the native context menu
    }, false);

    // Also handle right-click on the container
    const container = document.querySelector('#app');
    if (container) {
      container.addEventListener('contextmenu', (e) => {
        // Make sure VS Code context menu appears even if clicked on container
        editor.focus();
      });
    }

  }

  /**
   * Setup enhanced clipboard integration
   */
  private setupClipboardIntegration(): void {
    const editor = this.getEditorElement();
    if (!editor) return;

    // Override default copy behavior
    editor.addEventListener('copy', async (e) => {
      // Skip if inside widget container or dashboard - let them handle it
      const target = e.target as HTMLElement;
      if (target?.closest?.('.widget-container') || target?.closest?.('.dashboard-container')) {
        return;
      }
      e.preventDefault();
      await this.handleCopy(e);
    });

    // Override default paste behavior
    editor.addEventListener('paste', async (e) => {
      this.vscodeLog(`[paste-debug] PASTE_EVENT Paste event listener triggered`);
      
      // Check if paste originated from within a widget container or dashboard - if so, let them handle it
      const target = e.target as HTMLElement;
      if (target?.closest?.('.widget-container') || target?.closest?.('.dashboard-container')) {
        this.vscodeLog(`[paste-debug] PASTE_EVENT Skipping - inside widget/dashboard container`);
        return; // Let the widget/dashboard handle paste naturally
      }
      
      // CRITICAL: Stop event propagation to prevent Vditor's handler from also running
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Check if this is a programmatic paste from performClipboardAction
      const flagValue = (window as any).isProgrammaticPaste;
      this.vscodeLog(`[paste-debug] PASTE_EVENT Flag check: ${flagValue}`);
      
      if (flagValue) {
        this.vscodeLog('[paste-debug] PASTE_EVENT Skipping - programmatic paste');
        return;
      }
      
      this.vscodeLog(`[paste-debug] PASTE_EVENT Processing paste`);
      await this.handlePaste(e);
      this.vscodeLog(`[paste-debug] PASTE_EVENT Completed`);
    }, { capture: true });

    // Override default cut behavior
    editor.addEventListener('cut', async (e) => {
      // Skip if inside widget container or dashboard - let them handle it
      const target = e.target as HTMLElement;
      if (target?.closest?.('.widget-container') || target?.closest?.('.dashboard-container')) {
        return;
      }
      e.preventDefault();
      await this.handleCut(e);
    });

    // Add keyboard shortcuts (only for quick fixes - copy/paste/cut handled by event listeners)
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === '.') {
        // Ctrl+. for quick fixes (VS Code default)
        e.preventDefault();
        this.triggerQuickFix();
      }
    });
  }

  /**
   * Setup cursor position management to prevent jumping
   */
  private setupCursorManagement(): void {
    const editor = this.getEditorElement();
    if (!editor) return;

    // Track cursor position changes
    editor.addEventListener('selectionchange', () => {
      this.trackCursorPosition();
    });

    // Handle content changes that might affect cursor position
    if (this.vditor) {
      const originalInput = this.vditor.options?.input;
      this.vditor.options = {
        ...this.vditor.options,
        input: (...args: any[]) => {
          // Store cursor position before processing
          this.storeCursorPosition();
          
          // Call original input handler
          if (originalInput) {
            originalInput.apply(this.vditor, args);
          }
          
          // Restore cursor position after a brief delay
          setTimeout(() => {
            this.restoreCursorPosition();
          }, 10);
        }
      };
    }
  }

  /**
   * Setup quick fix integration
   */
  private setupQuickFixIntegration(): void {
    // Listen for diagnostic hover events
    document.addEventListener('mouseover', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('vscode-diagnostic-error') ||
          target.classList.contains('vscode-diagnostic-warning') ||
          target.classList.contains('vscode-diagnostic-info')) {
        this.showQuickFixHover(target, e);
      }
    });

    // Listen for quick fix clicks
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('vscode-quickfix-button')) {
        e.preventDefault();
        const action = target.getAttribute('data-action');
        const position = JSON.parse(target.getAttribute('data-position') || '{}');
        this.executeQuickFix(action, position);
      }
    });
  }

  /**
   * Handle copy operation with VS Code integration
   */
  private async handleCopy(e: Event): Promise<void> {
    try {
      const selection = this.getSelectedText();
      if (selection) {
        const clipboardText = this.getClipboardMarkdown(selection);

        // Use modern Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(clipboardText);
          this.vscodeLog(`✅ Copy successful via Clipboard API (${clipboardText.length} chars)`);
        } else {
          // Fallback to VS Code clipboard
          const success = await this.writeToVSCodeClipboard(clipboardText);
          if (success) {
            this.vscodeLog(`✅ Copy successful via VS Code (${clipboardText.length} chars)`);
          }
        }
      }
    } catch (error) {
      this.vscodeLog(`❌ Copy failed: ${error}`);
    }
  }

  /**
   * Handle paste operation with VS Code integration
   */
  private async handlePaste(e: Event): Promise<void> {
    this.vscodeLog(`[paste-debug] 🟡 handlePaste() called in vscode-integrator`);
    
    try {
      let text = '';
      
      // Use modern Clipboard API first
      if (navigator.clipboard && navigator.clipboard.readText) {
        this.vscodeLog(`[paste-debug] 🟡 Using Clipboard API to read text...`);
        text = await navigator.clipboard.readText();
        this.vscodeLog(`[paste-debug] 🟡 Read ${text.length} chars: "${text.substring(0, 50)}..."`);
        this.vscodeLog(`✅ Paste via Clipboard API (${text.length} chars)`);
      } else {
        // Fallback to VS Code clipboard
        this.vscodeLog(`[paste-debug] 🟡 Falling back to VS Code clipboard read...`);
        text = await this.readFromVSCodeClipboard();
        this.vscodeLog(`[paste-debug] 🟡 Read ${text.length} chars from VS Code clipboard`);
        this.vscodeLog(`✅ Paste via VS Code (${text.length} chars)`);
      }
      
      if (text) {
        this.vscodeLog(`[paste-debug] 🟡 Calling insertTextAtCursor() with ${text.length} chars`);
        this.insertTextAtCursor(text);

        // Notify cursor manager to handle positioning after paste
        if (this.cursorManager && this.cursorManager.handleAfterPaste) {
          this.vscodeLog(`[paste-debug] 🟡 Notifying cursor manager`);
          this.cursorManager.handleAfterPaste();
        }
      } else {
        this.vscodeLog(`[paste-debug] ⚠️ No text to paste`);
      }
    } catch (error) {
      this.vscodeLog(`❌ Paste failed: ${error}`);
    }
  }

  /**
   * Handle cut operation with VS Code integration
   */
  private async handleCut(e: Event): Promise<void> {
    try {
      const selection = this.getSelectedText();
      if (selection) {
        const clipboardText = this.getClipboardMarkdown(selection);

        // Use modern Clipboard API
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(clipboardText);
          this.deleteSelectedText();
          this.vscodeLog(`✅ Cut successful via Clipboard API (${clipboardText.length} chars)`);
        } else {
          // Fallback to VS Code clipboard
          const success = await this.writeToVSCodeClipboard(clipboardText);
          if (success) {
            this.deleteSelectedText();
            this.vscodeLog(`✅ Cut successful via VS Code (${clipboardText.length} chars)`);
          }
        }
      }
    } catch (error) {
      this.vscodeLog(`❌ Cut failed: ${error}`);
    }
  }

  /**
   * Request VS Code context menu with position information
   */
  private async requestVSCodeContextMenu(position: any, event: MouseEvent): Promise<void> {
    const requestId = this.generateRequestId();
    
    // Send context menu request to VS Code
    this.sendToVSCode({
      command: 'requestContextMenu',
      position: position,
      requestId: requestId,
      elementType: this.getElementTypeAtPosition(event.target as HTMLElement),
      selectedText: this.getSelectedText()
    });

    // Show loading indicator
    this.showContextMenuLoading(event.clientX, event.clientY);
  }

  /**
   * Show link-specific context menu
   */
  private showLinkContextMenu(e: MouseEvent, href: string, element: HTMLElement): void {
    const menu = this.createContextMenu([
      {
        label: 'Open Link',
        action: () => window.open(href, '_blank')
      },
      {
        label: 'Copy Link',
        action: () => this.writeToVSCodeClipboard(href)
      },
      {
        label: 'Edit Link',
        action: () => this.editLink(element)
      },
      { separator: true },
      {
        label: 'Check Link',
        action: () => this.checkLink(href)
      }
    ]);

    this.showContextMenuAt(menu, e.clientX, e.clientY);
  }

  /**
   * Show image-specific context menu
   */
  private showImageContextMenu(e: MouseEvent, src: string, alt: string, element: HTMLElement): void {
    const menu = this.createContextMenu([
      {
        label: 'View Image',
        action: () => window.open(src, '_blank')
      },
      {
        label: 'Copy Image URL',
        action: () => this.writeToVSCodeClipboard(src)
      },
      {
        label: alt ? 'Edit Alt Text' : 'Add Alt Text',
        action: () => this.editImageAlt(element)
      },
      { separator: true },
      {
        label: 'Replace Image',
        action: () => this.replaceImage(element)
      }
    ]);

    this.showContextMenuAt(menu, e.clientX, e.clientY);
  }

  /**
   * Write text to VS Code clipboard
   */
  private async writeToVSCodeClipboard(text: string): Promise<boolean> {
    return new Promise((resolve) => {
      const requestId = this.generateRequestId();
      
      this.pendingRequests.set(requestId, { resolve, type: 'clipboardWrite' });
      
      this.sendToVSCode({
        command: 'clipboardWrite',
        text: text,
        requestId: requestId
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          resolve(false);
        }
      }, 5000);
    });
  }

  /**
   * Read text from VS Code clipboard
   */
  private async readFromVSCodeClipboard(): Promise<string> {
    return new Promise((resolve) => {
      const requestId = this.generateRequestId();
      
      this.pendingRequests.set(requestId, { resolve, type: 'clipboardRead' });
      
      this.sendToVSCode({
        command: 'clipboardRead',
        requestId: requestId
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          resolve('');
        }
      }, 5000);
    });
  }

  /**
   * Track and store current cursor position
   */
  private trackCursorPosition(): void {
    try {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const position = this.convertDOMPositionToLineChar(range.startContainer, range.startOffset);
        
        if (position) {
          this.lastCursorPosition = position;
          
          // Send cursor position update to VS Code
          this.sendToVSCode({
            command: 'cursorPosition',
            line: position.line,
            character: position.character
          });
        }
      }
    } catch (error) {
      this.vscodeLog(`❌ Error tracking cursor position: ${error}`);
    }
  }

  /**
   * Store cursor position before content changes
   */
  private storeCursorPosition(): void {
    this.trackCursorPosition();
  }

  /**
   * Restore cursor position after content changes
   */
  private restoreCursorPosition(): void {
    if (!this.lastCursorPosition) return;

    try {
      const element = this.findElementAtLineChar(
        this.lastCursorPosition.line,
        this.lastCursorPosition.character
      );

      if (element) {
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(element, 0);
        range.collapse(true);
        
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    } catch (error) {
      this.vscodeLog(`❌ Error restoring cursor position: ${error}`);
    }
  }

  /**
   * Handle incoming messages from VS Code
   */
  public handleVSCodeMessage(message: any): void {
    switch (message.command) {
      case 'contextMenuActions':
        this.showVSCodeContextMenu(message.actions);
        break;
      
      case 'clipboardWriteResult':
        this.handleClipboardWriteResult(message);
        break;
      
      case 'clipboardReadResult':
        this.handleClipboardReadResult(message);
        break;
    }
  }

  /**
   * Show VS Code context menu actions
   */
  private showVSCodeContextMenu(actions: any[]): void {
    const menuItems = actions.map(action => ({
      label: action.title,
      action: () => this.executeVSCodeAction(action)
    }));

    // Add standard editor actions
    menuItems.push(
      {
        label: 'Cut',
        action: () => this.handleCut(new Event('cut'))
      },
      {
        label: 'Copy',
        action: () => this.handleCopy(new Event('copy'))
      },
      {
        label: 'Paste',
        action: () => this.handlePaste(new Event('paste'))
      }
    );

    // Show context menu at last click position
    // (This would need to be implemented based on your UI framework)

  }

  /**
   * Utility methods
   */
  private getEditorElement(): HTMLElement | null {
    return document.querySelector('.vditor-ir .vditor-reset') ||
           document.querySelector('.vditor-wysiwyg .vditor-reset') ||
           document.querySelector('.vditor-sv .vditor-reset');
  }

  private getCursorPositionFromEvent(e: MouseEvent): any {
    // Implementation depends on Vditor's internal structure
    // This is a simplified version
    return {
      line: 0,
      character: 0
    };
  }

  private getSelectedText(): string {
    const selection = window.getSelection();
    return selection ? selection.toString() : '';
  }

  private getClipboardMarkdown(fallbackText: string): string {
    const selection = window.getSelection();
    return getMarkdownClipboardText({
      fallbackText,
      fallbackRoot: this.getEditorElement(),
      selection,
      vditor: this.vditor,
    });
  }

  private insertTextAtCursor(text: string): void {
    this.vscodeLog(`[paste-debug] 🟣 insertTextAtCursor() called with ${text.length} chars`);
    this.vscodeLog(`[paste-debug] 🟣 vditor available: ${!!this.vditor}, insertValue available: ${!!this.vditor?.insertValue}`);

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (!range.collapsed) {
        range.deleteContents();
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    if (this.vditor && this.vditor.insertMD) {
      this.vscodeLog(`[paste-debug] 🟣 Calling vditor.insertMD()`);
      this.vditor.insertMD(text);
      this.vscodeLog(`[paste-debug] 🟣 vditor.insertMD() completed`);
      return;
    }

    if (this.vditor && this.vditor.insertValue) {
      this.vscodeLog(`[paste-debug] 🟣 Calling vditor.insertValue()`);
      this.vditor.insertValue(text);
      this.vditor.vditor?.ir?.element?.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      this.vscodeLog(`[paste-debug] 🟣 vditor.insertValue() completed`);
    } else {
      this.vscodeLog(`[paste-debug] ⚠️ Cannot insert text - vditor or insertValue not available`);
    }
  }

  private deleteSelectedText(): void {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (!range.collapsed) {
        range.deleteContents();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private sendToVSCode(message: any): void {
    if ((window as any).vscode) {
      (window as any).vscode.postMessage(message);
    }
  }

  private vscodeLog(message: string): void {
    this.sendToVSCode({
      command: 'log',
      message: `[WebviewIntegrator] ${message}`
    });
  }

  /**
   * Trigger quick fix at current cursor position
   */
  public triggerQuickFix(): void {

    this.sendToVSCode({
      command: 'triggerQuickFix'
    });
  }

  // Placeholder methods for additional functionality
  private getElementTypeAtPosition(element: HTMLElement): string {
    if (element.tagName === 'A') return 'link';
    if (element.tagName === 'IMG') return 'image';
    if (element.tagName === 'CODE') return 'code';
    return 'text';
  }

  private showContextMenuLoading(x: number, y: number): void {
    // Show loading indicator at position
  }

  private createContextMenu(items: any[]): HTMLElement {
    // Create context menu DOM element
    const menu = document.createElement('div');
    menu.className = 'vscode-context-menu';
    return menu;
  }

  private showContextMenuAt(menu: HTMLElement, x: number, y: number): void {
    // Position and show context menu
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    document.body.appendChild(menu);
  }

  private editLink(element: HTMLElement): void {
    // Implementation for editing links
  }

  private checkLink(href: string): void {
    // Implementation for checking links
  }

  private editImageAlt(element: HTMLElement): void {
    // Implementation for editing image alt text
  }

  private replaceImage(element: HTMLElement): void {
    // Implementation for replacing images
  }

  private convertDOMPositionToLineChar(node: Node, offset: number): { line: number, character: number } | null {
    // Convert DOM position to line/character coordinates
    return null;
  }

  private findElementAtLineChar(line: number, character: number): Node | null {
    // Find DOM element at line/character position
    return null;
  }

  private executeVSCodeAction(action: any): void {
    this.sendToVSCode({
      command: 'requestQuickFix',
      actionTitle: action.title,
      actionCommand: action.command,
      position: this.lastCursorPosition
    });
  }

  private executeQuickFix(action: string | null, position: any): void {
    this.sendToVSCode({
      command: 'requestQuickFix',
      actionTitle: action,
      position: position
    });
  }

  /**
   * Request quick fix from VS Code with enhanced debugging
   */
  public requestQuickFix(source: string, position: any): void {

    this.sendToVSCode({
      command: 'requestQuickFix',
      source: source,
      position: position || this.lastCursorPosition,
      actionTitle: 'quickfix'
    });
  }

  private showQuickFixHover(element: HTMLElement, e: MouseEvent): void {
    // Show quick fix options on hover
  }

  private handleClipboardWriteResult(message: any): void {
    const pending = this.pendingRequests.get(message.requestId);
    if (pending && pending.type === 'clipboardWrite') {
      pending.resolve(message.success);
      this.pendingRequests.delete(message.requestId);
    }
  }

  private handleClipboardReadResult(message: any): void {
    const pending = this.pendingRequests.get(message.requestId);
    if (pending && pending.type === 'clipboardRead') {
      pending.resolve(message.text || '');
      this.pendingRequests.delete(message.requestId);
    }
  }

  /**
   * Create Vditor context menu with VS Code commands - Enhanced with comprehensive debugging
   */
  public createVditorContextMenu(event: MouseEvent): any[] {

    // Get cursor position for context-sensitive actions
    const position = this.getCursorPositionFromEvent(event);
    const elementType = this.getElementTypeAtPosition(event.target as HTMLElement);
    const selectedText = this.getSelectedText();
    
    // Store event coordinates for menu positioning
    const menuX = event.clientX;
    const menuY = event.clientY;
    
    // Calculate viewport boundaries to prevent menu overflow
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const menuEstimatedHeight = 400; // Approximate menu height
    const menuEstimatedWidth = 200;  // Approximate menu width
    
    // Adjust position if menu would appear outside viewport
    let adjustedX = menuX;
    let adjustedY = menuY;
    
    // Check if menu would overflow bottom of viewport
    if (menuY + menuEstimatedHeight > viewportHeight) {
      // Position menu above cursor instead
      adjustedY = Math.max(0, menuY - menuEstimatedHeight);

    }
    
    // Check if menu would overflow right of viewport
    if (menuX + menuEstimatedWidth > viewportWidth) {
      // Position menu to left of cursor instead
      adjustedX = Math.max(0, menuX - menuEstimatedWidth);

    }
    
    // Request VS Code actions for this position
    this.sendToVSCode({
      command: 'requestContextMenu',
      position: position,
      clientX: adjustedX,
      clientY: adjustedY,
      elementType: elementType,
      selectedText: selectedText
    });
    
    // Return comprehensive VS Code context menu items
    const contextMenu = [
      // Basic editing operations
      {
        label: 'Cut',
        click: () => {

          this.handleCut(new ClipboardEvent('cut'));
        }
      },
      {
        label: 'Copy',
        click: () => {

          this.handleCopy(new ClipboardEvent('copy'));
        }
      },
      {
        label: 'Paste',
        click: () => {

          this.handlePaste(new ClipboardEvent('paste'));
        }
      },
      {
        label: 'Select All',
        click: () => {

          this.sendToVSCode({
            command: 'selectAll'
          });
        }
      },
      { separator: true },
      
      // Code quality and diagnostics
      {
        label: 'Quick Fix...',
        click: () => {

          this.requestQuickFix('contextMenu', position);
        }
      },
      {
        label: 'Show Problems',
        click: () => {

          this.sendToVSCode({
            command: 'showProblems'
          });
        }
      },
      { separator: true },
      
      // Formatting operations
      {
        label: 'Format Document',
        click: () => {

          this.sendToVSCode({
            command: 'formatDocument'
          });
        }
      },
      {
        label: 'Format Selection',
        click: () => {

          this.sendToVSCode({
            command: 'formatSelection'
          });
        }
      },
      { separator: true },
      
      // Search and navigation
      {
        label: 'Find',
        click: () => {

          this.sendToVSCode({
            command: 'find'
          });
        }
      },
      {
        label: 'Find and Replace',
        click: () => {

          this.sendToVSCode({
            command: 'findAndReplace'
          });
        }
      },
      { separator: true },
      
      // Markdown-specific operations
      {
        label: 'Insert Link',
        click: () => {

          this.sendToVSCode({
            command: 'insertLink'
          });
        }
      },
      {
        label: 'Insert Image',
        click: () => {

          this.sendToVSCode({
            command: 'insertImage'
          });
        }
      },
      {
        label: 'Insert Table',
        click: () => {

          this.sendToVSCode({
            command: 'insertTable'
          });
        }
      },
      { separator: true },
      
      // Custom renderers
      {
        label: 'Insert Kanban Board',
        click: () => {

          this.sendToVSCode({
            command: 'requestInsertRenderer',
            rendererType: 'kanban-board'
          });
        }
      },
      {
        label: 'Insert Interactive Table',
        click: () => {

          this.sendToVSCode({
            command: 'requestInsertRenderer',
            rendererType: 'table'
          });
        }
      },
      {
        label: 'Insert Code Playground',
        click: () => {

          // Playground doesn't need extension - insert directly
          const playgroundText = `\n\`\`\`playground\nconsole.log('Hello, World!');\n\`\`\`\n`;
          if ((window as any).vditor) {
            (window as any).vditor.insertValue(playgroundText);
          }
        }
      },
      {
        label: 'Insert Dashboard',
        click: () => {
          const dashboardText = `\n\`\`\`dashboard
title: My Dashboard
columns: 3
widgets:
  - type: clock
    config:
      format: 12h
  - type: calendar
  - type: weather
    data:
      temperature: 72
      condition: sunny
\`\`\`\n`;
          if ((window as any).vditor) {
            (window as any).vditor.insertValue(dashboardText);
          }
        }
      },
      { separator: true },
      
      // Widgets (wigggle-ui inspired)
      {
        label: '⏰ Insert Clock Widget',
        click: () => {
          this.insertWidgetBlock('clock', { title: 'Current Time', format: '12h', showSeconds: true, showDate: true });
        }
      },
      {
        label: '📅 Insert Calendar Widget',
        click: () => {
          this.insertWidgetBlock('calendar', { title: 'Today', showYear: true });
        }
      },
      {
        label: '🌤️ Insert Weather Widget',
        click: () => {
          this.insertWidgetBlock('weather', { 
            title: 'Weather', 
            location: 'London',
            unit: 'C',
            refreshInterval: 30,
            size: 'sm'
          });
        }
      },
      {
        label: '📈 Insert Stock Widget',
        click: () => {
          this.insertWidgetBlock('stock', { title: 'Stock' }, { symbol: 'MSFT', company: 'Microsoft', price: 450.25, change: 5.50, changePercent: 1.24 });
        }
      },
      {
        label: '✅ Insert Tasks Widget',
        click: () => {
          this.insertWidgetBlock('productivity', { 
            title: 'Tasks',
            size: 'sm',
            showAddButton: true,
            showDeleteButton: true,
            showProgress: true,
            maxTasks: 20
          }, { tasks: [{ id: '1', text: 'Task 1', completed: false }] });
        }
      },
      {
        label: '📊 Insert Chart Widget',
        click: () => {
          this.insertWidgetBlock('chart', { title: 'My Chart', chartType: 'bar' }, { labels: ['A', 'B', 'C'], datasets: [{ label: 'Data', data: [10, 20, 30] }] });
        }
      },
      {
        label: '📋 Insert Table Widget',
        click: () => {
          this.insertWidgetBlock('table', { title: 'My Table', enableSort: true }, [{ id: 1, name: 'Item 1' }]);
        }
      },
      {
        label: '📝 Insert Form Widget',
        click: () => {
          this.insertWidgetBlock('form', { title: 'My Form', submitLabel: 'Submit' }, { fields: [{ name: 'name', label: 'Name', type: 'text' }] });
        }
      },
      {
        label: '🎛️ Insert Macro Board Widget',
        click: () => {
          this.insertWidgetBlock('macro-board', {
            title: 'Macro Board',
            size: 'md',
            rows: 3,
            columns: 3,
            buttons: [
              { id: 'commands', label: 'Commands', icon: 'bolt', command: 'workbench.action.showCommands', tone: 'danger' },
              { id: 'daily-note', label: 'Daily Note', icon: 'calendar', command: 'markdown-editor.openDailyNote' },
              { id: 'quick-open', label: 'Quick Open', icon: 'search', command: 'workbench.action.quickOpen' },
              { id: 'sidebar', label: 'Sidebar', icon: 'layers', command: 'workbench.action.toggleSidebarVisibility' },
              { id: 'graph', label: 'Graph View', icon: 'sparkles', command: 'markdown-editor.openGraphView', tone: 'success' },
              { id: 'notes', label: 'Open Note', icon: 'chat', command: 'markdown-editor.quickOpenNote' },
              { id: 'terminal', label: 'Terminal', icon: 'code', command: 'workbench.action.terminal.toggleTerminal' },
              { id: 'settings', label: 'Settings', icon: 'sliders', command: 'workbench.action.openSettings' },
              { id: 'save-all', label: 'Save All', icon: 'camera', command: 'workbench.action.files.saveAll' }
            ]
          }, {
            executionCounts: {}
          });
        }
      },
      { separator: true },
      
      // VS Code features
      {
        label: 'Command Palette',
        click: () => {

          this.sendToVSCode({
            command: 'showCommandPalette'
          });
        }
      },
      {
        label: 'Toggle Word Wrap',
        click: () => {

          this.sendToVSCode({
            command: 'toggleWordWrap'
          });
        }
      }
    ];

        // Enhanced fallback: Create custom context menu if Vditor doesn't display

        // Give Vditor a chance to display the menu, then fallback to custom display
        setTimeout(() => {
          // Check if Vditor displayed a context menu
          const vditorMenu = document.querySelector('.vditor-menu, .vditor-contextmenu');
          if (!vditorMenu) {

            this.createAndDisplayContextMenu(event.clientX, event.clientY, contextMenu);
          } else {

          }
        }, 50); // Slightly longer delay to give Vditor time to render    // Log the complete context information for VS Code

    return contextMenu;
  }

  /**
   * Create and display our own context menu when Vditor's display fails
   */
  private createAndDisplayContextMenu(x: number, y: number, menuItems: any[]): void {
    
    // Remove any existing context menu
    const existingMenu = document.getElementById('vscode-custom-context-menu');
    if (existingMenu) existingMenu.remove();
    
    // Create context menu element
    const menu = document.createElement('div');
    menu.id = 'vscode-custom-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.backgroundColor = 'var(--vscode-menu-background, #1e1e1e)';
    menu.style.border = '1px solid var(--vscode-menu-border, #454545)';
    menu.style.borderRadius = '3px';
    menu.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.5)';
    menu.style.zIndex = '10000';
    menu.style.minWidth = '180px';
    menu.style.padding = '4px 0';
    menu.style.fontSize = '13px';
    menu.style.fontFamily = 'var(--vscode-font-family)';
    
    menuItems.forEach(item => {
      if (item.separator) {
        const separator = document.createElement('div');
        separator.style.height = '1px';
        separator.style.backgroundColor = 'var(--vscode-menu-separatorBackground, #454545)';
        separator.style.margin = '4px 8px';
        menu.appendChild(separator);
      } else {
        const menuItem = document.createElement('div');
        menuItem.textContent = item.label;
        menuItem.style.padding = '8px 16px';
        menuItem.style.cursor = 'pointer';
        menuItem.style.color = 'var(--vscode-menu-foreground, #cccccc)';
        menuItem.style.whiteSpace = 'nowrap';
        menuItem.style.userSelect = 'none';
        menuItem.style.fontSize = '13px';
        
        menuItem.addEventListener('mouseenter', () => {
          menuItem.style.backgroundColor = 'var(--vscode-menu-selectionBackground, #094771)';
        });
        
        menuItem.addEventListener('mouseleave', () => {
          menuItem.style.backgroundColor = 'transparent';
        });
        
        menuItem.addEventListener('click', () => {
          if (item.click) item.click();
          menu.remove();
        });
        
        menu.appendChild(menuItem);
      }
    });
    
    // Add to document
    document.body.appendChild(menu);
    
    // Remove on click outside or escape
    const removeMenu = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'click' && menu.contains(e.target as Node)) return;
      
      menu.remove();
      document.removeEventListener('click', removeMenu);
      document.removeEventListener('keydown', removeMenu);
    };
    
    setTimeout(() => {
      document.addEventListener('click', removeMenu);
      document.addEventListener('keydown', removeMenu);
    }, 100);

  }

  /**
   * Handle context menu actions received from VS Code (legacy support)
   */
  public handleContextMenuActions(actions: any[]): void {

    // Log available actions
    actions.forEach((action, index) => {

    });
    
    // Could enhance the Vditor context menu with these actions in the future
  }

  /**
   * Insert a widget block into the editor
   */
  private insertWidgetBlock(type: string, config: Record<string, any>, data?: any): void {
    const fullConfig = { type, ...config };
    
    // Build config lines
    const configLines = Object.entries(fullConfig)
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value)}`;
        }
        return `${key}: ${value}`;
      })
      .join('\n');
    
    // Build data section
    const dataSection = data ? `\n---\ndata: ${JSON.stringify(data, null, 2)}` : '';
    
    const widgetBlock = `\n\`\`\`widget\n${configLines}${dataSection}\n\`\`\`\n\n`;
    
    if ((window as any).vditor) {
      (window as any).vditor.insertValue(widgetBlock);
    }
  }
}