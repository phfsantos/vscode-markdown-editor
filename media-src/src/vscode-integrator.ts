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
    this.vscodeLog('🔗 VSCodeWebviewIntegrator initialized');
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
    
    this.vscodeLog(`✅ Context menu integration setup - Vditor will handle display via createVditorContextMenu()`);

    // REMOVED: The conflicting event listener that was preventing Vditor's contextmenu callback from working
    // The createVditorContextMenu() method will be called by Vditor automatically when configured properly
    
    this.vscodeLog(`� Context menu integration ready - removed conflicting event listeners`);
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
      this.vscodeLog('🖱️ Context menu event captured');
      
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
    
    this.vscodeLog('🔧 Enhanced VS Code native context menu integration');
  }

  /**
   * Setup enhanced clipboard integration
   */
  private setupClipboardIntegration(): void {
    const editor = this.getEditorElement();
    if (!editor) return;

    // Override default copy behavior
    editor.addEventListener('copy', async (e) => {
      e.preventDefault();
      await this.handleCopy(e);
    });

    // Override default paste behavior
    editor.addEventListener('paste', async (e) => {
      e.preventDefault();
      await this.handlePaste(e);
    });

    // Override default cut behavior
    editor.addEventListener('cut', async (e) => {
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
        const success = await this.writeToVSCodeClipboard(selection);
        if (success) {
          this.vscodeLog(`📋 Copied: ${selection.length} characters`);
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
    try {
      const text = await this.readFromVSCodeClipboard();
      if (text) {
        this.insertTextAtCursor(text);
        this.vscodeLog(`📋 Pasted: ${text.length} characters`);
        
        // Notify cursor manager to handle positioning after paste
        if (this.cursorManager && this.cursorManager.handleAfterPaste) {
          this.cursorManager.handleAfterPaste();
        }
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
        const success = await this.writeToVSCodeClipboard(selection);
        if (success) {
          this.deleteSelectedText();
          this.vscodeLog(`📋 Cut: ${selection.length} characters`);
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
    this.vscodeLog(`🔧 Showing context menu with ${menuItems.length} items`);
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

  private insertTextAtCursor(text: string): void {
    if (this.vditor && this.vditor.insertValue) {
      this.vditor.insertValue(text);
    }
  }

  private deleteSelectedText(): void {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      selection.deleteFromDocument();
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
    this.vscodeLog('🔧 Triggering quick fix menu');
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
    this.vscodeLog(`💡 Requesting quick fix from ${source} at position: ${JSON.stringify(position)}`);
    
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
    this.vscodeLog(`📋 VDITOR CONTEXT MENU: createVditorContextMenu() called!`);
    
    // Get cursor position for context-sensitive actions
    const position = this.getCursorPositionFromEvent(event);
    const elementType = this.getElementTypeAtPosition(event.target as HTMLElement);
    const selectedText = this.getSelectedText();
    
    
    // Request VS Code actions for this position
    this.sendToVSCode({
      command: 'requestContextMenu',
      position: position,
      clientX: event.clientX,
      clientY: event.clientY,
      elementType: elementType,
      selectedText: selectedText
    });
    
    // Return comprehensive VS Code context menu items
    const contextMenu = [
      // Basic editing operations
      {
        label: 'Cut',
        click: () => {
          this.vscodeLog('📋 Cut menu item clicked');
          this.handleCut(new ClipboardEvent('cut'));
        }
      },
      {
        label: 'Copy',
        click: () => {
          this.vscodeLog('📋 Copy menu item clicked');
          this.handleCopy(new ClipboardEvent('copy'));
        }
      },
      {
        label: 'Paste',
        click: () => {
          this.vscodeLog('📋 Paste menu item clicked');
          this.handlePaste(new ClipboardEvent('paste'));
        }
      },
      {
        label: 'Select All',
        click: () => {
          this.vscodeLog('📋 Select All menu item clicked');
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
          this.vscodeLog('📋 Quick Fix menu item clicked');
          this.requestQuickFix('contextMenu', position);
        }
      },
      {
        label: 'Show Problems',
        click: () => {
          this.vscodeLog('📋 Show Problems menu item clicked');
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
          this.vscodeLog('📋 Format Document menu item clicked');
          this.sendToVSCode({
            command: 'formatDocument'
          });
        }
      },
      {
        label: 'Format Selection',
        click: () => {
          this.vscodeLog('📋 Format Selection menu item clicked');
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
          this.vscodeLog('📋 Find menu item clicked');
          this.sendToVSCode({
            command: 'find'
          });
        }
      },
      {
        label: 'Find and Replace',
        click: () => {
          this.vscodeLog('📋 Find and Replace menu item clicked');
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
          this.vscodeLog('📋 Insert Link menu item clicked');
          this.sendToVSCode({
            command: 'insertLink'
          });
        }
      },
      {
        label: 'Insert Image',
        click: () => {
          this.vscodeLog('📋 Insert Image menu item clicked');
          this.sendToVSCode({
            command: 'insertImage'
          });
        }
      },
      {
        label: 'Insert Table',
        click: () => {
          this.vscodeLog('📋 Insert Table menu item clicked');
          this.sendToVSCode({
            command: 'insertTable'
          });
        }
      },
      { separator: true },
      
      // VS Code features
      {
        label: 'Command Palette',
        click: () => {
          this.vscodeLog('📋 Command Palette menu item clicked');
          this.sendToVSCode({
            command: 'showCommandPalette'
          });
        }
      },
      {
        label: 'Toggle Word Wrap',
        click: () => {
          this.vscodeLog('📋 Toggle Word Wrap menu item clicked');
          this.sendToVSCode({
            command: 'toggleWordWrap'
          });
        }
      }
    ];
    
    this.vscodeLog(`📋 ✅ Created Vditor context menu with ${contextMenu.length} items`);
    
        // Enhanced fallback: Create custom context menu if Vditor doesn't display
        this.vscodeLog(`📋 🎯 CONTEXT MENU CALLBACK COMPLETE - Setting up display fallback`);
        
        // Give Vditor a chance to display the menu, then fallback to custom display
        setTimeout(() => {
          // Check if Vditor displayed a context menu
          const vditorMenu = document.querySelector('.vditor-menu, .vditor-contextmenu');
          if (!vditorMenu) {
            this.vscodeLog(`📋 🔧 Vditor menu not detected - creating custom context menu display`);
            this.createAndDisplayContextMenu(event.clientX, event.clientY, contextMenu);
          } else {
            this.vscodeLog(`📋 ✅ Vditor menu detected - using Vditor's display`);
          }
        }, 50); // Slightly longer delay to give Vditor time to render    // Log the complete context information for VS Code
    this.vscodeLog(`📋 Context menu request: position=${JSON.stringify(position)} elementType=${elementType} selectedText="${selectedText}"`);
    
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
    
    this.vscodeLog(`✅ Custom context menu displayed with ${menuItems.length} items`);
  }

  /**
   * Handle context menu actions received from VS Code (legacy support)
   */
  public handleContextMenuActions(actions: any[]): void {
    this.vscodeLog(`📋 Received ${actions.length} context menu actions from VS Code`);
    
    // Log available actions
    actions.forEach((action, index) => {
      this.vscodeLog(`Action ${index}: ${action.title} (${action.kind})`);
    });
    
    // Could enhance the Vditor context menu with these actions in the future
  }
}