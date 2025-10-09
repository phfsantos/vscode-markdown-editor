/**
 * Cursor Management Utility for Vditor
 * Prevents cursor jumping and manages position restoration
 */
export class CursorManager {
  private vditor: any;
  private lastPosition: { line: number; character: number; offset: number } | null = null;
  private isRestoring = false;
  private mutationObserver: MutationObserver | null = null;

  constructor(vditorInstance: any) {
    this.vditor = vditorInstance;
    this.initializeCursorTracking();
  }

  /**
   * Initialize cursor position tracking and management
   * MOSTLY DISABLED: Previous implementation was causing cursor jumping
   */
  private initializeCursorTracking(): void {
    this.setupSelectionMonitoring(); // DISABLED - was causing issues
    // this.setupMutationObserver(); // Method removed - was causing cursor jumping issues
    this.setupInputHandling();       // DISABLED - was causing issues
    this.logCursor('🎯 CursorManager initialized but most features DISABLED to prevent cursor jumping');
    this.logCursor('🎯 Only manual space/enter handling and paste handling remain active');
  }

  /**
   * Setup selection change monitoring
   * 
   * @deprecated This method is currently disabled due to cursor jumping issues.
   * The selection change monitoring was causing excessive cursor position tracking
   * during normal typing, which contributed to cursor jumping problems.
   * 
   * See: Cursor jumping issue - selection monitoring was storing position on every
   * character typed, leading to unwanted cursor restoration.
   */
  private setupSelectionMonitoring(): void {
    this.logCursor("⚠️ Selection change monitoring DISABLED - was causing excessive cursor tracking");
    
    // PROBLEM: This was storing cursor position on EVERY selection change,
    // including normal typing, which contributed to the cursor jumping issue.
    // We should only track cursor position when specifically needed.
    
    return;
    
    /*
    document.addEventListener('selectionchange', () => {
      if (!this.isRestoring) {
        this.storeCursorPosition();
      }
    });
    */
  }


  /**
   * Setup input handling to prevent cursor jumping during typing
   * 
   * @deprecated This method is temporarily disabled for debugging cursor jumping issues.
   * The input event handling was contributing to cursor position interference during
   * normal typing. Needs to be re-evaluated and potentially redesigned.
   * 
   * Note: Paste events are now handled by VSCodeIntegrator to avoid conflicts.
   */
  private setupInputHandling(): void {
    const editor = this.getEditorElement();
    if (!editor) return;

    // TEMPORARILY DISABLED - Let's test vanilla Vditor behavior first
    this.logCursor("⚠️ CursorManager input handling DISABLED for debugging");
    
    // TODO: Re-enable after identifying root cause
    /*
    // Handle input events
    editor.addEventListener('input', (e) => {
      this.handleInputEvent(e as InputEvent);
    });

    // Handle key events that might cause cursor movement
    editor.addEventListener('keydown', (e) => {
      this.handleKeydown(e as KeyboardEvent);
    });
    */

    // Note: Paste events are handled by VSCodeIntegrator to avoid conflicts
    // CursorManager will be notified via handleAfterPaste() method
  }

  /**
   * Handle input events to maintain cursor position
   */
  private handleInputEvent(e: InputEvent): void {
    const inputType = e.inputType;
    
    // Store position before potentially problematic operations
    if (inputType === 'insertText' || 
        inputType === 'insertCompositionText' ||
        inputType === 'deleteContentBackward' ||
        inputType === 'deleteContentForward') {
      
      // Store current position
      this.storeCursorPosition();
      
      // Handle end-of-document typing specifically
      if (this.isTypingAtEnd()) {
        this.handleEndOfDocumentTyping(e);
      }
    }
  }

  /**
   * Handle keydown events
   */
  private handleKeydown(e: KeyboardEvent): void {
    // Store position before navigation keys
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 
         'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      this.storeCursorPosition();
    }
    
    // Handle space key to prevent cursor jumping
    if (e.key === ' ' || e.key === 'Spacebar') {
      this.handleSpaceKey(e);
    }
    
    // Handle Enter key at end of document
    if (e.key === 'Enter') {
      this.handleEnterKey(e);
    }
  }

  /**
   * Handle cursor positioning after paste operation
   * Called by VSCodeIntegrator after paste is completed
   */
  public handleAfterPaste(): void {
    this.storeCursorPosition();
    
    // If pasting at end of document, ensure proper positioning
    if (this.isTypingAtEnd()) {
      setTimeout(() => {
        this.ensureCursorAtEnd();
      }, 50);
    }
  }

  /**
   * Check if cursor is at the end of the document
   */
  private isTypingAtEnd(): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const range = selection.getRangeAt(0);
    const editor = this.getEditorElement();
    if (!editor) return false;

    // Check if cursor is in the last text node or near the end
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
      null
    );

    let lastTextNode: Node | null = null;
    let currentNode: Node | null;
    
    currentNode = walker.nextNode();
    while (currentNode) {
      lastTextNode = currentNode;
      currentNode = walker.nextNode();
    }

    if (!lastTextNode) return false;

    // Check if selection is in or after the last text node
    const isInLastNode = range.startContainer === lastTextNode;
    const isAfterLastNode = editor.contains(range.startContainer) && 
                           this.getNodePosition(range.startContainer) >= this.getNodePosition(lastTextNode);

    return isInLastNode || isAfterLastNode;
  }

  /**
   * Handle typing at end of document to prevent cursor jumping
   */
  private handleEndOfDocumentTyping(e: InputEvent): void {
    // Ensure there's always a place for the cursor at the end
    const editor = this.getEditorElement();
    if (!editor) return;

    // Add a trailing space or ensure proper structure
    setTimeout(() => {
      this.ensureTrailingSpace();
      this.ensureCursorAtActualEnd();
    }, 5);
  }

  /**
   * Handle space key to prevent cursor jumping
   */
  public handleSpaceKey(e: KeyboardEvent): void {
    // Store current position before space
    this.storeCursorPosition();
    
    // For space key, prevent any Vditor formatting
    const selection = window.getSelection();
    const range = selection?.getRangeAt(0);
    const startContainer = range?.startContainer;
    const startOffset = range?.startOffset;
    
    // Prevent default to stop Vditor from processing the space
    e.preventDefault();
    e.stopPropagation();
    
    // Insert space manually
    if (range && startContainer) {
      const textNode = startContainer.nodeType === Node.TEXT_NODE 
        ? startContainer as Text
        : document.createTextNode('');
      
      if (textNode.nodeType === Node.TEXT_NODE) {
        const currentText = textNode.textContent || '';
        textNode.textContent = currentText.slice(0, startOffset) + ' ' + currentText.slice(startOffset);
        
        // Set cursor after the inserted space
        const newRange = document.createRange();
        newRange.setStart(textNode, startOffset + 1);
        newRange.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(newRange);
      } else {
        // Fallback: insert text node with space
        const spaceNode = document.createTextNode(' ');
        range.insertNode(spaceNode);
        range.setStartAfter(spaceNode);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    
    this.logCursor('🔤 Manual space insertion completed');
    
    // Trigger content update to VS Code
    setTimeout(() => {
      if (this.vditor && typeof this.vditor.getValue === 'function') {
        const content = this.vditor.getValue();
        (window as any).vscode?.postMessage({ command: "edit", content });
      }
    }, 50);
  }

  /**
   * Handle Enter key to prevent cursor jumping
   */
  public handleEnterKey(e: KeyboardEvent): void {
    // Store current position before enter
    this.storeCursorPosition();
    
    // Prevent default to stop Vditor from processing the enter key
    e.preventDefault();
    e.stopPropagation();
    
    this.insertNewlineManually();
  }

  /**
   * Manually insert newline to prevent Vditor formatting
   */
  private insertNewlineManually(): void {
    const selection = window.getSelection();
    const range = selection?.getRangeAt(0);
    
    if (range) {
      // Create a new line break element
      const br = document.createElement('br');
      const textNode = document.createTextNode('\n');
      
      // Insert both br for display and text node for content
      range.insertNode(br);
      range.setStartAfter(br);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.collapse(true);
      
      selection?.removeAllRanges();
      selection?.addRange(range);
      
      this.logCursor('↵ Manual newline insertion completed');
      
      // Trigger content update to VS Code
      setTimeout(() => {
        if (this.vditor && typeof this.vditor.getValue === 'function') {
          const content = this.vditor.getValue();
          (window as any).vscode?.postMessage({ command: "edit", content });
        }
      }, 50);
    }
  }

  /**
   * Handle Enter key at end of document (legacy method, now uses manual insertion)
   */
  private handleEndOfDocumentEnter(e: KeyboardEvent): void {
    // This method is now handled by insertNewlineManually
    this.insertNewlineManually();
  }

  /**
   * Store current cursor position
   */
  public storeCursorPosition(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const position = this.calculateCursorPosition(range);
    
    if (position) {
      this.lastPosition = position;
      this.logCursor(`📍 Stored cursor position: line ${position.line}, char ${position.character}, offset ${position.offset}`);
    }
  }

  /**
   * Restore cursor position
   */
  private restoreCursorPosition(): void {
    if (!this.lastPosition || this.isRestoring) return;

    this.isRestoring = true;
    
    try {
      const restored = this.setCursorToPosition(this.lastPosition);
      if (restored) {
        this.logCursor(`🔄 Restored cursor to: line ${this.lastPosition.line}, char ${this.lastPosition.character}`);
      } else {
        this.logCursor(`❌ Failed to restore cursor position`);
      }
    } catch (error) {
      this.logCursor(`❌ Error restoring cursor: ${error}`);
    } finally {
      this.isRestoring = false;
    }
  }

  /**
   * Calculate cursor position from DOM range
   */
  private calculateCursorPosition(range: Range): { line: number; character: number; offset: number } | null {
    const editor = this.getEditorElement();
    if (!editor) return null;

    try {
      // Calculate line and character position
      const textContent = editor.textContent || '';
      const beforeCursor = this.getTextBeforeCursor(range);
      const lines = beforeCursor.split('\n');
      
      const position = {
        line: lines.length - 1,
        character: lines[lines.length - 1].length,
        offset: beforeCursor.length
      };

      return position;
    } catch (error) {
      this.logCursor(`❌ Error calculating cursor position: ${error}`);
      return null;
    }
  }

  /**
   * Set cursor to specific position
   */
  private setCursorToPosition(position: { line: number; character: number; offset: number }): boolean {
    const editor = this.getEditorElement();
    if (!editor) return false;

    try {
      // Try to find the exact position in the DOM
      const textNode = this.findTextNodeAtPosition(position);
      if (textNode) {
        const range = document.createRange();
        const selection = window.getSelection();
        
        // Set range at calculated position
        const offset = Math.min(position.character, textNode.textContent?.length || 0);
        range.setStart(textNode, offset);
        range.collapse(true);
        
        selection?.removeAllRanges();
        selection?.addRange(range);
        
        return true;
      }

      // Fallback: position at end of editor
      return this.setCursorAtEnd();
      
    } catch (error) {
      this.logCursor(`❌ Error setting cursor position: ${error}`);
      return false;
    }
  }

  /**
   * Ensure cursor is positioned at the actual end of content
   */
  private ensureCursorAtActualEnd(): void {
    const editor = this.getEditorElement();
    if (!editor) return;

    const selection = window.getSelection();
    if (!selection) return;

    // Find the actual last position in the editor
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
      null
    );

    let lastTextNode: Text | null = null;
    let currentNode: Node | null;
    
    currentNode = walker.nextNode();
    while (currentNode) {
      if (currentNode.textContent && currentNode.textContent.trim() !== '') {
        lastTextNode = currentNode as Text;
      }
      currentNode = walker.nextNode();
    }

    if (lastTextNode) {
      const range = document.createRange();
      range.setStart(lastTextNode, lastTextNode.textContent?.length || 0);
      range.collapse(true);
      
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /**
   * Ensure there's always a trailing space for cursor positioning
   */
  private ensureTrailingSpace(): void {
    const editor = this.getEditorElement();
    if (!editor) return;

    const lastChild = editor.lastElementChild || editor;
    const textContent = editor.textContent || '';
    
    // If content doesn't end with whitespace, add a space
    if (!textContent.endsWith(' ') && !textContent.endsWith('\n')) {
      const textNode = document.createTextNode(' ');
      lastChild.appendChild(textNode);
    }
  }

  /**
   * Set cursor at the end of the editor
   */
  private setCursorAtEnd(): boolean {
    const editor = this.getEditorElement();
    if (!editor) return false;

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      
      range.selectNodeContents(editor);
      range.collapse(false); // Collapse to end
      
      selection?.removeAllRanges();
      selection?.addRange(range);
      
      return true;
    } catch (error) {
      this.logCursor(`❌ Error setting cursor at end: ${error}`);
      return false;
    }
  }

  /**
   * Ensure cursor stays at end during typing
   */
  public ensureCursorAtEnd(): void {
    if (!this.isTypingAtEnd()) return;
    
    setTimeout(() => {
      this.setCursorAtEnd();
    }, 5);
  }

  /**
   * Get text content before cursor position
   */
  private getTextBeforeCursor(range: Range): string {
    const editor = this.getEditorElement();
    if (!editor) return '';

    const beforeRange = document.createRange();
    beforeRange.setStart(editor, 0);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    
    return beforeRange.toString();
  }

  /**
   * Find text node at specific position
   */
  private findTextNodeAtPosition(position: { line: number; character: number }): Text | null {
    const editor = this.getEditorElement();
    if (!editor) return null;

    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentLine = 0;
    let currentChar = 0;
    let textNode: Node | null;

    textNode = walker.nextNode();
    while (textNode) {
      const text = textNode.textContent || '';
      const lines = text.split('\n');
      
      if (currentLine === position.line) {
        // We're on the target line
        if (currentChar + lines[0].length >= position.character) {
          return textNode as Text;
        }
      }
      
      // Update counters
      currentLine += lines.length - 1;
      if (lines.length > 1) {
        currentChar = lines[lines.length - 1].length;
      } else {
        currentChar += text.length;
      }
      
      if (currentLine > position.line) break;
      textNode = walker.nextNode();
    }

    return null;
  }

  /**
   * Get node position in document order
   */
  private getNodePosition(node: Node): number {
    const editor = this.getEditorElement();
    if (!editor) return 0;

    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_ALL,
      null
    );

    let position = 0;
    let currentNode: Node | null;

    currentNode = walker.nextNode();
    while (currentNode) {
      if (currentNode === node) {
        return position;
      }
      position++;
      currentNode = walker.nextNode();
    }

    return position;
  }

  /**
   * Get the editor element
   */
  private getEditorElement(): HTMLElement | null {
    return document.querySelector('.vditor-ir .vditor-reset') ||
           document.querySelector('.vditor-wysiwyg .vditor-reset') ||
           document.querySelector('.vditor-sv .vditor-reset');
  }

  /**
   * Log cursor-related messages
   */
  private logCursor(message: string): void {
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        command: 'log',
        message: `[CursorManager] ${message}`
      });
    }
  }

  /**
   * Dispose of the cursor manager
   */
  public dispose(): void {
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    
    this.lastPosition = null;
    this.logCursor('🎯 Cursor manager disposed');
  }
}