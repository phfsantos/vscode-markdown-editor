/**
 * Handles VS Code diagnostic visualization in Vditor editor
 */
export class DiagnosticVisualizer {
    private diagnostics: any[] = [];
    private vditor: any;
    private updateTimer: NodeJS.Timeout | null = null;
    private lastContent = '';
    // Track already wrapped problem texts keyed by line+message+text to suppress duplicates
    private wrappedKeys: Set<string> = new Set();
    // Cache of text->span element for reuse (same problematic token on same line)
    private tokenSpanCache: Map<string, HTMLElement> = new Map();
    // Aggregate diagnostics per token key (line|text) for combined tooltip & quick fix
    private tokenDiagnostics: Map<string, any[]> = new Map();
    // Track applied diagnostics by element and character range to prevent overlaps
    private appliedDiagnostics: Map<HTMLElement, Array<{
        startChar: number,
        endChar: number,
        lineNumber: number,
        diagnosticId: string
    }>> = new Map();
    // Track elements by line number for efficient range checking
    private elementsByLine: Map<number, HTMLElement[]> = new Map();
    
    // NEW: Smart diagnostic management to prevent unnecessary clearing/reapplying
    private lastDiagnosticsHash: string = '';
    private diagnosticsApplied: boolean = false;
    
    // NEW: Focus-aware diagnostic management to prevent cursor jumping
    private pendingDiagnosticUpdate: boolean = false;
    private lastUserInput: number = 0;
    private focusedElement: Element | null = null;
    private previousFocusedElement: Element | null = null;
    private currentCursorElement: Element | null = null;
    private previousCursorElement: Element | null = null;
    private isUserTyping: boolean = false;
    private typingTimeout: NodeJS.Timeout | null = null;

    constructor(vditorInstance: any) {
        this.vditor = vditorInstance;
        this.setupFocusAwareness();
    }

    // VS Code logging function
    private vscodeLog(message: string): void {
        (window as any).vscode?.postMessage({
            command: "log",
            message: message
        });
    }

  /**
   * Update diagnostic visualizations in the editor (private implementation)
   * Now includes focus-aware logic to prevent cursor jumping
   */
  private applyDiagnosticsToEditor(diagnostics: any[]): void {
    // SMART APPLICATION: Only clear if diagnostics actually changed AND visual elements exist
    const newHash = this.generateDiagnosticsHashForArray(diagnostics);
    const currentHash = this.generateDiagnosticsHash();
    const visualElementsExist = this.verifyDiagnosticElementsExist();
    
    if (newHash === currentHash && this.diagnosticsApplied && visualElementsExist) {
      this.vscodeLog(`✅ SMART APPLY: Diagnostics unchanged and visual elements exist - skipping clear/reapply`);
      return;
    }

    // FOCUS-AWARE CHECK: Don't apply diagnostics if user is actively typing
    if (!this.isSafeToUpdateDiagnostics()) {
      this.vscodeLog(`🎯 FOCUS AWARE: User is typing - deferring diagnostic application`);
      this.diagnostics = diagnostics; // Store the new diagnostics
      this.pendingDiagnosticUpdate = true;
      return;
    }

    this.vscodeLog(`🔄 SMART APPLY: Applying diagnostics - hash changed: ${newHash !== currentHash}, applied: ${this.diagnosticsApplied}, visual: ${visualElementsExist}`);

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      this.clearDiagnosticStyles();
      this.wrappedKeys.clear();
      this.tokenSpanCache.clear();
      this.tokenDiagnostics.clear();
      this.diagnostics = diagnostics;
      this.applyDiagnosticStyles();
      this.lastDiagnosticsHash = newHash;
      this.diagnosticsApplied = true;
    });
  }

  /**
   * Apply diagnostic styling to text without creating duplicate elements
   * This method finds and styles the problematic text but does NOT wrap it to avoid duplicates
   */
  private wrapTextWithDiagnostic(textNode: Text, startOffset: number, endOffset: number, diagnostic: any): boolean {
    try {
      const text = textNode.textContent || '';
      if (startOffset >= text.length || endOffset > text.length || startOffset >= endOffset) {
        return false;
      }

      const diagnosticText = text.substring(startOffset, endOffset);
      const lineKey = `${diagnostic.range?.start?.line ?? 'na'}`;
      const tokenKey = `${lineKey}|${diagnosticText}`;

      // Aggregate diagnostics for this token
      const list = this.tokenDiagnostics.get(tokenKey) || [];
      list.push(diagnostic);
      this.tokenDiagnostics.set(tokenKey, list);

      // Create a styled span that replaces the text node with proper diagnostic styling
      const beforeText = text.substring(0, startOffset);
      const afterText = text.substring(endOffset);
      const severityClass = this.getSeverityClass(diagnostic.severity);

      // Create the diagnostic span with all the styling from the original wrapped text approach
      const diagnosticSpan = document.createElement('span');
      diagnosticSpan.className = `vscode-diagnostic-span ${severityClass}`;
      diagnosticSpan.textContent = diagnosticText;
      diagnosticSpan.setAttribute('data-diagnostic-severity', diagnostic.severity.toString());
      
      if (diagnosticText.length === 1) {
        diagnosticSpan.setAttribute('data-single-char', 'true');
      }

      // Build combined tooltip content from aggregated diagnostics
      const combinedMessages = this.tokenDiagnostics.get(tokenKey) || [];
      const combinedText = combinedMessages.map(d => `${d.message}${d.source ? ` (${d.source})` : ''}`).join('\n');
      diagnosticSpan.setAttribute('data-diagnostic-message', combinedText);
      diagnosticSpan.setAttribute('data-diagnostic-source', combinedMessages.map(d => d.source).filter(Boolean).join(', '));

      // Add enhanced hoverable tooltip with the styling from wrapped text
      this.addHoverableTooltip(diagnosticSpan, { message: combinedText, source: combinedMessages.map(d => d.source).filter(Boolean).join(', ') });

      // Add quick fix lightbulb integrated into the same element
      this.addIntegratedQuickFixLightbulb(diagnosticSpan, diagnostic);

      // Replace the text node with our styled span (avoiding duplicates)
      if (!this.wrappedKeys.has(tokenKey)) {
        const fragment = document.createDocumentFragment();
        if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
        fragment.appendChild(diagnosticSpan);
        if (afterText) fragment.appendChild(document.createTextNode(afterText));
        const parent = textNode.parentNode;
        if (parent) {
          parent.replaceChild(fragment, textNode);
          this.wrappedKeys.add(tokenKey);
          this.vscodeLog(`✅ Successfully styled text: "${diagnosticText}" with tokenKey: ${tokenKey}`);
          return true;
        } else {
          this.vscodeLog(`❌ No parent node found for text node containing: "${diagnosticText}"`);
          return false;
        }
      } else {
        this.vscodeLog(`⚠️ Duplicate detected - text already wrapped: "${diagnosticText}" with tokenKey: ${tokenKey}`);
        return false;
      }
    } catch (error) {
      this.vscodeLog(`❌ Error styling text with diagnostic: ${error}`);
      return false;
    }
  }

  /**
   * Add hoverable tooltip to diagnostic element that allows text selection and copying
   */
  private addHoverableTooltip(element: HTMLElement, diagnostic: any): void {
    let tooltip: HTMLElement | null = null;
    let hoverTimeout: NodeJS.Timeout | null = null;
    let isTooltipHovered = false;

    const showTooltip = () => {
      if (tooltip) return; // Already showing

      tooltip = document.createElement('div');
      tooltip.className = 'vscode-diagnostic-tooltip-hoverable';
      tooltip.setAttribute('data-diagnostic-ui', 'true'); // Mark as UI element
      
      // Create tooltip content with better styling
      const messageContent = document.createElement('div');
      messageContent.className = 'vscode-diagnostic-tooltip-content';
      messageContent.textContent = diagnostic.message;
      
      const sourceContent = document.createElement('div');
      sourceContent.className = 'vscode-diagnostic-tooltip-source';
      sourceContent.textContent = diagnostic.source || 'Diagnostic';
      
      tooltip.appendChild(sourceContent);
      tooltip.appendChild(messageContent);
      
      // Position tooltip
      document.body.appendChild(tooltip);
      
      const rect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      
      // Position below the element with some margin
      let top = rect.bottom + 8;
      let left = rect.left;
      
      // Adjust if tooltip would go off screen
      if (left + tooltipRect.width > window.innerWidth) {
        left = window.innerWidth - tooltipRect.width - 10;
      }
      if (top + tooltipRect.height > window.innerHeight) {
        top = rect.top - tooltipRect.height - 8;
      }
      
      tooltip.style.position = 'fixed';
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
      tooltip.style.zIndex = '10000';
      tooltip.style.userSelect = 'text'; // Allow text selection
      
      // Add event listeners to keep tooltip open when hovering over it
      tooltip.addEventListener('mouseenter', () => {
        isTooltipHovered = true;
      });
      
      tooltip.addEventListener('mouseleave', () => {
        isTooltipHovered = false;
        setTimeout(hideTooltip, 100); // Small delay to allow moving between element and tooltip
      });
    };

    const hideTooltip = () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }
      
      if (tooltip && !isTooltipHovered) {
        tooltip.remove();
        tooltip = null;
      }
    };

    // Show tooltip on hover with delay
    element.addEventListener('mouseenter', () => {
      hoverTimeout = setTimeout(showTooltip, 300); // 300ms delay
    });

    // Hide tooltip when leaving element (with delay to allow moving to tooltip)
    element.addEventListener('mouseleave', () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
        hoverTimeout = null;
      }
      setTimeout(() => {
        if (!isTooltipHovered) {
          hideTooltip();
        }
      }, 100);
    });
  }

  /**
   * Get CSS class for diagnostic severity
   */
  private getSeverityClass(severity: number): string {
    switch (severity) {
      case 1: return 'vscode-diagnostic-error';
      case 2: return 'vscode-diagnostic-warning';
      case 3: return 'vscode-diagnostic-info';
      case 4: return 'vscode-diagnostic-hint';
      default: return 'vscode-diagnostic-info';
    }
  }    /**
     * Schedule diagnostic update with debouncing to prevent flickering
     */
    private scheduleUpdate(force: boolean = false): void {
        // Delegate to the new focus-aware scheduling method
        this.scheduleUpdateFocusAware(force);
            // Generate hash of current diagnostics for comparison
            const currentDiagnosticsHash = this.generateDiagnosticsHash();
            const currentContent = this.vditor?.getValue() || '';
            
            const contentChanged = currentContent !== this.lastContent;
            const diagnosticsChanged = currentDiagnosticsHash !== this.lastDiagnosticsHash;
            const noDiagnosticsApplied = !this.diagnosticsApplied || this.wrappedKeys.size === 0;
            
            this.vscodeLog(`� SMART UPDATE CHECK: content=${contentChanged ? 'CHANGED' : 'unchanged'}, diagnostics=${diagnosticsChanged ? 'CHANGED' : 'unchanged'}, applied=${this.diagnosticsApplied}, keys=${this.wrappedKeys.size}, force=${force}`);
            
            // Only update if there's a real change or we're forced to
            if (force || contentChanged || diagnosticsChanged || noDiagnosticsApplied) {
                if (diagnosticsChanged || noDiagnosticsApplied || force) {
                    this.vscodeLog(`🔄 Diagnostics changed or not applied - full update needed`);
                    this.clearDiagnosticStyles();
                    this.applyDiagnosticStyles();
                    this.lastDiagnosticsHash = currentDiagnosticsHash;
                    this.diagnosticsApplied = true;
                } else if (contentChanged) {
                    // Content changed but diagnostics are the same - try to preserve existing diagnostics
                    this.vscodeLog(`📝 Content changed but diagnostics unchanged - preserving existing diagnostics`);
                    // Only revalidate diagnostics without full clear/reapply
                    this.revalidateExistingDiagnostics();
                }
                this.lastContent = currentContent;
            } else {
                this.vscodeLog(`✅ Content and diagnostics unchanged, diagnostics applied - skipping update`);
            }
            this.updateTimer = null;
    }

    /**
     * Clear all diagnostic styles from the editor with enhanced content preservation
     */
    private clearDiagnosticStyles(): void {
        this.vscodeLog(`🧹 Starting clearDiagnosticStyles() - preserving ALL content structure`);
        
        // Try to find the active editor element (same logic as applyDiagnosticStyles)
        let editor = document.querySelector('.vditor-ir .vditor-reset'); // IR mode
        if (!editor) {
            editor = document.querySelector('.vditor-wysiwyg .vditor-reset'); // WYSIWYG mode
        }
        if (!editor) {
            editor = document.querySelector('.vditor-sv .vditor-reset'); // Source mode
        }
        if (!editor) {
            this.vscodeLog('❌ DiagnosticVisualizer: Could not find Vditor editor element for cleanup');
            console.warn('DiagnosticVisualizer: Could not find Vditor editor element for cleanup');
            return;
        }

        this.vscodeLog(`🎯 Found editor element: ${editor.className}`);

        // Count content before cleanup for verification
        const beforeContent = editor.textContent?.length || 0;
        this.vscodeLog(`📊 Content length before cleanup: ${beforeContent} characters`);

        // Remove diagnostic CSS classes but preserve ALL original element structure
        const elements = editor.querySelectorAll('[class*="vscode-diagnostic-"]');
        this.vscodeLog(`🔍 Found ${elements.length} elements with diagnostic classes`);
        
        elements.forEach((el, index) => {
            const originalClasses = el.className;
            const originalContent = el.textContent || '';
            
            // Remove only diagnostic-related classes, preserve ALL others
            const classes = el.className.split(' ').filter(cls => 
                !cls.startsWith('vscode-diagnostic-')
            );
            
            el.className = classes.join(' ');
            el.removeAttribute('data-diagnostic-message');
            el.removeAttribute('data-diagnostic-severity');
            el.removeAttribute('data-single-char');
            
            // Verify content preservation
            const newContent = el.textContent || '';
            if (originalContent !== newContent) {
                this.vscodeLog(`⚠️ Content changed in element ${index}: "${originalContent}" → "${newContent}"`);
            }
            
            this.vscodeLog(`📝 Element ${index}: classes "${originalClasses}" → "${el.className}"`);
        });

        // Handle diagnostic spans with EXTREME care - preserve ALL child content and structure
        const diagnosticSpans = editor.querySelectorAll('.vscode-diagnostic-span');
        this.vscodeLog(`🔍 Found ${diagnosticSpans.length} diagnostic spans to process`);
        
        diagnosticSpans.forEach((span, index) => {
            const originalContent = span.textContent || '';
            
            // Remove diagnostic classes and attributes only
            span.className = span.className.replace(/\bvscode-diagnostic-\w+\b/g, '').trim();
            span.removeAttribute('data-diagnostic-message');
            span.removeAttribute('data-diagnostic-source');
            span.removeAttribute('data-diagnostic-severity');
            span.removeAttribute('data-diagnostic-ui');
            span.removeAttribute('data-single-char');
            
            // Only unwrap if span is completely empty of useful classes/attributes
            if (!span.className.trim() && !span.hasAttributes()) {
                const parent = span.parentNode;
                if (parent) {
                    this.vscodeLog(`📦 Unwrapping empty span ${index} with ${span.childNodes.length} child nodes`);
                    
                    // Create document fragment to safely move children
                    const fragment = document.createDocumentFragment();
                    
                    // Move ALL child nodes (including text nodes, elements, etc.)
                    while (span.firstChild) {
                        fragment.appendChild(span.firstChild);
                    }
                    
                    // Insert fragment before span, then remove span
                    parent.insertBefore(fragment, span);
                    parent.removeChild(span);
                    
                    this.vscodeLog(`✅ Successfully unwrapped span ${index}`);
                } else {
                    this.vscodeLog(`⚠️ Span ${index} has no parent, keeping as-is`);
                }
            } else {
                this.vscodeLog(`📝 Span ${index} kept with classes: "${span.className}"`);
            }
            
            // Verify content preservation
            const currentContent = span.parentNode?.textContent || span.textContent || '';
            if (!currentContent.includes(originalContent) && originalContent.trim()) {
                this.vscodeLog(`❌ CONTENT LOST in span ${index}: "${originalContent}"`);
            }
        });

        // Count content after cleanup for verification
        const afterContent = editor.textContent?.length || 0;
        this.vscodeLog(`📊 Content length after cleanup: ${afterContent} characters`);
        
        if (beforeContent !== afterContent) {
            this.vscodeLog(`🚨 CONTENT LENGTH CHANGED: ${beforeContent} → ${afterContent} (diff: ${afterContent - beforeContent})`);
        } else {
            this.vscodeLog(`✅ Content length preserved: ${afterContent} characters`);
        }

        // Clean up lightbulb overlays (completely separate system)
        this.cleanupLightbulbOverlays();
        
        // Clear applied diagnostic tracking
        this.clearAppliedDiagnosticTracking();

        this.vscodeLog(`✅ clearDiagnosticStyles completed - processed ${elements.length} elements and ${diagnosticSpans.length} spans`);
    }

    /**
     * Clean up quick fix UI elements to prevent them from being saved in the document
     */
    public cleanupQuickFixUI(): void {
        this.cleanupTransientUI();
    }

    /**
     * Clean up ALL transient UI elements to prevent them from being saved in the document
     * This includes: lightbulbs, hover overlays, diagnostic tooltips, etc.
     */
    public cleanupTransientUI(): void {
        this.vscodeLog(`🔍 DEBUG: cleanupTransientUI() called - cleaning up ONLY overlays, preserving ALL content`);
        
        // Find editor element for diagnostic count (but we won't remove anything from it)
        const editor = document.querySelector('.vditor-ir .vditor-reset') || 
                      document.querySelector('.vditor-wysiwyg .vditor-reset') || 
                      document.querySelector('.vditor-sv .vditor-reset');

        if (!editor) {
            this.vscodeLog('🔍 DEBUG: Could not find Vditor editor element - cleaning body overlays only');
        } else {
            this.vscodeLog(`🔍 DEBUG: Found editor element: ${editor.className}`);
        }

        // FUNDAMENTAL PRINCIPLE: Do NOT remove ANY elements from the editor content
        // The editor contains actual content with diagnostic styling - that must NEVER be removed
        // Only clean up true overlay elements that are positioned separately

        // 1. Clean up the dedicated lightbulb overlay system (Map-based overlays)
        this.cleanupLightbulbOverlays();

        // 2. Clean up ONLY overlay elements from document.body with data-diagnostic-ui="true"
        const bodyOverlays = document.body.querySelectorAll('[data-diagnostic-ui="true"]');
        
        this.vscodeLog(`🔍 DEBUG: Found ${bodyOverlays.length} overlay elements in document.body to clean up`);
        
        let removedCount = 0;
        bodyOverlays.forEach((element) => {
            // Enhanced debugging to understand what's being removed
            const elementInfo = {
                tag: element.tagName,
                classes: element.className,
                id: element.id || 'no-id',
                textContent: element.textContent?.substring(0, 50) || 'no-text',
                attributes: Array.from(element.attributes).map(attr => `${attr.name}="${attr.value}"`).join(' ')
            };
            
            this.vscodeLog(`🗑️ REMOVING OVERLAY: ${elementInfo.tag}.${elementInfo.classes} (${elementInfo.textContent})`);
            this.vscodeLog(`   📋 Element details: id="${elementInfo.id}", attrs="${elementInfo.attributes}"`);
            
            element.remove();
            removedCount++;
        });
        
        // 3. Count diagnostic styling elements being preserved in the editor (but don't touch them)
        let diagnosticCount = 0;
        if (editor) {
            const diagnosticElements = editor.querySelectorAll('.vscode-diagnostic-error, .vscode-diagnostic-warning, .vscode-diagnostic-info, .vscode-diagnostic-hint');
            diagnosticCount = diagnosticElements.length;
            
            if (diagnosticCount > 0) {
                this.vscodeLog(`🛡️ PRESERVED: ${diagnosticCount} diagnostic styling elements in editor (content styling, never removed)`);
            }
        }
        
        // 4. Final summary
        this.vscodeLog(`✅ cleanupTransientUI() completed:`);
        this.vscodeLog(`   🗑️ Removed ${removedCount} true overlay elements from document.body`);
        this.vscodeLog(`   🛡️ Preserved ${diagnosticCount} diagnostic styling elements (content)`);
        this.vscodeLog(`   🚫 NEVER removed ANY elements from editor content - only cleaned overlays`);
        
        // 5. Verify content integrity
        if (editor) {
            const contentLength = editor.textContent?.length || 0;
            this.vscodeLog(`📊 Editor content length after cleanup: ${contentLength} characters (should be unchanged)`);
        }
    }

    /**
        // - vscode-diagnostic-warning  
        // - vscode-diagnostic-info
        // These are content styling, not transient UI overlays
        
        // Only check for lightbulb emojis that might have been inserted as text content
        const allElementsWithLightbulbs = document.querySelectorAll('*');
        let lightbulbTextElements = 0;
        allElementsWithLightbulbs.forEach(el => {
            if (el.textContent && el.textContent.includes('💡')) {
                this.vscodeLog(`🔍 DEBUG: Found element with lightbulb text: ${el.tagName}.${el.className}, text: "${el.textContent}"`);
                // Only remove if it's clearly a UI overlay element, not content with diagnostic styling
                if (el.getAttribute('data-diagnostic-ui') === 'true' || 
                    el.classList.contains('vscode-quickfix-lightbulb') || 
                    el.classList.contains('vscode-lightbulb-overlay')) {
                    el.remove();
                    lightbulbTextElements++;
                }
            }
        });
        
        // Count diagnostic styling elements that are being preserved
        const diagnosticElements = editor.querySelectorAll('.vscode-diagnostic-error, .vscode-diagnostic-warning, .vscode-diagnostic-info, .vscode-diagnostic-hint');
        
        this.vscodeLog(`🔍 DEBUG: Found ${trueOverlayElements.length} overlay elements in editor, ${bodyOverlayElements.length} in body, ${lightbulbTextElements} lightbulb text elements`);
        this.vscodeLog(`🛡️ CRITICAL: ${diagnosticElements.length} diagnostic styling elements are PRESERVED - they are content styling, not transient overlays`);
        
        // Debug: Show what we're about to remove
        trueOverlayElements.forEach((element, index) => {
            this.vscodeLog(`🔍 DEBUG: Will remove overlay element ${index + 1}: ${element.tagName}.${element.className}`);
        });
        
        bodyOverlayElements.forEach((element, index) => {
            this.vscodeLog(`🔍 DEBUG: Will remove body overlay element ${index + 1}: ${element.tagName}.${element.className}`);
        });
        
        // Now actually remove the overlay elements
        trueOverlayElements.forEach(element => {
            this.vscodeLog(`🗑️ Removing overlay element from editor: ${element.tagName}.${element.className}`);
            element.remove();
        });

        bodyOverlayElements.forEach(element => {
            this.vscodeLog(`�️ Removing overlay element from body: ${element.tagName}.${element.className}`);
            element.remove();
        });

        // Also clean up any temporary diagnostic attributes that might interfere
        const elementsWithTempAttrs = editor.querySelectorAll('[data-diagnostic-temp]');
        elementsWithTempAttrs.forEach(element => {
            element.removeAttribute('data-diagnostic-temp');
        });

        const totalCleaned = trueOverlayElements.length + bodyOverlayElements.length;
        if (totalCleaned > 0) {
            this.vscodeLog(`DiagnosticVisualizer: Cleaned up ${totalCleaned} true overlay elements before content save`);
        } else {
            this.vscodeLog(`DiagnosticVisualizer: No overlay elements to clean up - diagnostic styling preserved`);
        }
    }

    /**
     * Apply diagnostic styles using efficient single-pass DOM traversal
     * Now with cursor-aware element exclusion
     */
    private applyDiagnosticStyles(): void {
        if (this.diagnostics.length === 0) {
            this.vscodeLog('DiagnosticVisualizer: No diagnostics to apply');
            return;
        }

        // Try to find the active editor element
        let editor = document.querySelector('.vditor-ir .vditor-reset'); // IR mode
        if (!editor) {
            editor = document.querySelector('.vditor-wysiwyg .vditor-reset'); // WYSIWYG mode
        }
        if (!editor) {
            editor = document.querySelector('.vditor-sv .vditor-reset'); // Source mode
        }
        if (!editor) {
            console.warn('DiagnosticVisualizer: Could not find Vditor editor element');
            return;
        }

        // Get the element that contains the cursor to exclude it from updates
        const cursorElement = this.getCursorContainerElement();
        if (cursorElement) {
            this.vscodeLog(`🎯 CURSOR AWARE: Found cursor in element ${cursorElement.tagName}.${cursorElement.className || '(no-class)'} - will exclude from diagnostic updates`);
        }

        // Use the new efficient single-pass approach with cursor awareness
        this.applySinglePassDiagnostics(editor as HTMLElement, cursorElement);
    }

    /**
     * Get the DOM element that currently contains the cursor
     */
    private getCursorContainerElement(): Element | null {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return null;
        }

        const range = selection.getRangeAt(0);
        let container = range.commonAncestorContainer;
        
        // If the container is a text node, get its parent element
        if (container.nodeType === Node.TEXT_NODE) {
            container = container.parentNode as Element;
        }

        // Find the closest block-level element that might contain diagnostics
        while (container && container.nodeType === Node.ELEMENT_NODE) {
            const element = container as Element;
            
            // Check if this is a block-level element that could have diagnostics
            if (this.isBlockLevelElement(element)) {
                return element;
            }
            
            container = container.parentNode;
        }

        return null;
    }

    /**
     * Check if an element is a block-level element that could contain diagnostics
     */
    private isBlockLevelElement(element: Element): boolean {
        const blockTags = ['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE'];
        return blockTags.includes(element.tagName) || 
               element.classList.contains('vditor-ir__node') ||
               element.classList.contains('vditor-wysiwyg');
    }

    /**
     * Check if one element is a descendant of another
     */
    private isDescendantOf(descendant: Node, ancestor: Node): boolean {
        let current: Node | null = descendant.parentNode;
        while (current) {
            if (current === ancestor) {
                return true;
            }
            current = current.parentNode;
        }
        return false;
    }

    /**
     * Efficient single-pass diagnostic application
     * Sorts diagnostics by line number and matches them during a single DOM traversal
     * Now with cursor-aware element exclusion
     */
    private applySinglePassDiagnostics(editor: HTMLElement, cursorElement?: Element | null): void {
        this.vscodeLog(`🚀 Starting single-pass diagnostic application for ${this.diagnostics.length} diagnostics`);
        
        // Step 1: Sort diagnostics by line number for efficient processing
        const sortedDiagnostics = this.prepareSortedDiagnostics();
        if (sortedDiagnostics.length === 0) {
            this.vscodeLog('No valid diagnostics to process after filtering');
            return;
        }
        
        // Step 2: Get all block elements that could represent markdown lines
        const blockElements = this.getMarkdownBlockElements(editor);
        this.vscodeLog(`Found ${blockElements.length} block elements to process`);
        
        // Step 3: Filter out the cursor element to avoid disrupting user's typing
        const safeElements = cursorElement 
            ? blockElements.filter(item => 
                item.element !== cursorElement && 
                !this.isDescendantOf(item.element, cursorElement) && 
                !this.isDescendantOf(cursorElement, item.element)
              )
            : blockElements;
            
        if (cursorElement && safeElements.length < blockElements.length) {
            this.vscodeLog(`🎯 CURSOR AWARE: Excluded ${blockElements.length - safeElements.length} elements containing cursor from diagnostic updates`);
        }
        
        // Step 4: Single pass through safe DOM elements, matching with sorted diagnostics
        this.matchDiagnosticsToElements(safeElements, sortedDiagnostics);
        
        this.vscodeLog(`✅ Single-pass diagnostic application completed`);
    }

    /**
     * Apply diagnostic with enhanced precision to avoid false positives
     */
    private applyDiagnosticWithPrecision(editor: HTMLElement, diagnostic: any): boolean {
        const message = diagnostic.message?.toLowerCase() || '';
        const source = diagnostic.source || '';
        
        // Enhanced precision: Only apply specific, well-defined diagnostics
        
        // 1. Broken link diagnostics - precise URL matching
        if (message.includes('broken') && message.includes('link') || 
            message.includes('unable to resolve') ||
            source === 'markdown-link-check') {
            return this.handleBrokenLinkDiagnostic(editor, diagnostic, message);
        }
        
        // 2. Missing alt text - precise image matching
        if (message.includes('alt') && (message.includes('missing') || message.includes('empty')) ||
            message.includes('image should have') ||
            source.includes('alt')) {
            return this.handleImageAltDiagnosticPrecise(editor, diagnostic);
        }
        
        // 3. MD012 (multiple blank lines) - DISABLED: Vditor strips blank lines in rendering
        // Need to investigate Vditor's blank line normalization before implementing
        if (source === 'markdownlint' && message.includes('md012')) {
            this.vscodeLog(`MD012 diagnostic skipped - Vditor normalizes blank lines in IR mode`);
            return false; // Skip MD012 for now
        }
        
        // 4. Markdownlint MD041 - first line should be heading
        if (source === 'markdownlint' && message.includes('md041')) {
            return this.handleMD041Diagnostic(editor, diagnostic);
        }
        
        // 5. Specific text pattern matching for known diagnostic patterns
        if (diagnostic.range && diagnostic.lineText) {
            return this.handlePreciseTextDiagnostic(editor, diagnostic);
        }
        
        // 6. Generic handling only for very specific cases to avoid false positives
        if (this.isHighConfidenceDiagnostic(diagnostic)) {
            return this.handleGenericDiagnostic(editor, diagnostic);
        }
        
        // Default: Don't apply if we can't be precise
        this.vscodeLog(`Skipping imprecise diagnostic: ${diagnostic.message}`);
        return false;
    }

    /**
     * Handle precise text-based diagnostics using range and line information
     */
    private handlePreciseTextDiagnostic(editor: HTMLElement, diagnostic: any): boolean {
        const range = diagnostic.range;
        const lineText = diagnostic.lineText || '';
        
        if (!range || !lineText.trim()) {
            this.vscodeLog(`❌ Precise text diagnostic failed: missing range or lineText`);
            return false;
        }
        
        // Extract the specific text that has the issue
        const startChar = range.start?.character || 0;
        const endChar = range.end?.character || startChar + 1;
        const problemText = lineText.substring(startChar, endChar);
        
        if (!problemText.trim()) {
            this.vscodeLog(`❌ Precise text diagnostic failed: empty problemText from range ${startChar}-${endChar}`);
            return false;
        }
        
        this.vscodeLog(`🔍 Looking for precise text: "${problemText}" in line: "${lineText}" (range: ${startChar}-${endChar})`);
        
        // Find exact text match in the DOM
        const result = this.findAndWrapExactText(editor, problemText, diagnostic);
        
        if (result) {
            this.vscodeLog(`✅ Precise text diagnostic succeeded for: "${problemText}"`);
        } else {
            this.vscodeLog(`❌ Precise text diagnostic failed for: "${problemText}" - no DOM matches found`);
        }
        
        return result;
    }

    /**
     * Find and wrap exact text with diagnostic styling - Enhanced with line-aware matching
     */
    private findAndWrapExactText(editor: HTMLElement, targetText: string, diagnostic: any): boolean {
        const lineKey = `${diagnostic.range?.start?.line ?? 'na'}`;
        const tokenKey = `${lineKey}|${targetText}`;
        const lineNumber = diagnostic.range?.start?.line;
        
        this.vscodeLog(`🔍 Starting line-aware text search for "${targetText}" on line ${lineNumber} (tokenKey: ${tokenKey})`);
        
        // Debug: Log the current DOM structure for problematic lines
        if (lineNumber && (lineNumber >= 70 && lineNumber <= 74)) { // Focus on the failing lines
            this.debugDOMStructure(editor, lineNumber);
        }
        
        // Check if this token has already been wrapped
        if (this.wrappedKeys.has(tokenKey)) {
            this.vscodeLog(`⚠️ Token already wrapped, skipping: ${tokenKey}`);
            return true; // Already processed successfully
        }
        
        // First, try to find the DOM element that corresponds to this line
        const lineElement = this.findElementForLine(editor, lineNumber, diagnostic.lineText);
        
        if (!lineElement) {
            this.vscodeLog(`❌ Could not find DOM element for line ${lineNumber}`);
            return this.fallbackToGlobalSearch(editor, targetText, diagnostic, tokenKey);
        }
        
        this.vscodeLog(`🎯 Found line element for line ${lineNumber}: ${lineElement.tagName}.${lineElement.className}`);
        
        // Search within the specific line element
        return this.searchWithinElement(lineElement, targetText, diagnostic, tokenKey);
    }
    
    /**
     * Find the DOM element that corresponds to a specific line number
     */
    private findElementForLine(editor: HTMLElement, lineNumber: number | undefined, lineText: string): HTMLElement | null {
        if (lineNumber === undefined) {
            return null;
        }
        
        this.vscodeLog(`🔍 DEBUG: Starting findElementForLine for line ${lineNumber}, text: "${lineText}"`);
        
        // Strategy 1: Look for elements with data-line attributes (if Vditor provides them)
        const lineElements = editor.querySelectorAll(`[data-line="${lineNumber}"]`);
        this.vscodeLog(`🔍 DEBUG: Strategy 1 - Found ${lineElements.length} elements with data-line="${lineNumber}"`);
        if (lineElements.length > 0) {
            this.vscodeLog(`📍 Found element by data-line attribute: line ${lineNumber}`);
            return lineElements[0] as HTMLElement;
        }
        
        // Strategy 2: Enhanced content-based line mapping with multiple approaches
        const allElements = this.getAllPossibleLineElements(editor);
        this.vscodeLog(`🔍 DEBUG: Strategy 2 - getAllPossibleLineElements returned ${allElements.length} elements`);
        
        // Debug: Log first few elements to understand structure
        if (allElements.length > 0) {
            this.vscodeLog(`🔍 DEBUG: First 5 elements from getAllPossibleLineElements:`);
            for (let i = 0; i < Math.min(5, allElements.length); i++) {
                const el = allElements[i];
                this.vscodeLog(`   ${i}: ${el.tagName}.${el.className || '(no-class)'} - "${(el.textContent || '').substring(0, 50)}..."`);
            }
        }
        
        // Enhanced Strategy 2: Position-aware text matching with MD-to-HTML awareness
        const exactMatches: Array<{element: HTMLElement, index: number, confidence: number}> = [];
        const fuzzyMatches: Array<{element: HTMLElement, index: number, confidence: number}> = [];
        
        // First pass: Collect all potential matches with their positions and confidence scores
        allElements.forEach((element, index) => {
            let elementText = element.textContent || '';
            if (element.dataset && element.dataset.marker) {
                elementText = `${element.dataset.marker} ${elementText}`;
            }
            
            // Try to convert element HTML back to markdown for better matching
            let elementMd = '';
            try {
                if (this.vditor && typeof this.vditor.html2md === 'function') {
                    elementMd = this.vditor.html2md(element.outerHTML || '');
                    // Log html2md conversion for debugging (only for first few elements)
                    if (index < 3) {
                        this.vscodeLog(`🔄 html2md conversion for element ${index}: "${element.outerHTML?.substring(0, 100)}..." → "${elementMd?.substring(0, 100)}..."`);
                    }
                } else {
                    // Log if vditor or html2md is not available
                    if (index === 0) {
                        this.vscodeLog(`⚠️ Vditor html2md not available: vditor=${!!this.vditor}, html2md=${this.vditor ? typeof this.vditor.html2md : 'N/A'}`);
                    }
                }
            } catch (e) {
                // Log html2md conversion errors
                if (index < 3) {
                    this.vscodeLog(`❌ html2md conversion failed for element ${index}: ${e}`);
                }
                // Fallback to text content if html2md fails
                elementMd = elementText;
            }
            
            // Check for exact matches (both text and markdown)
            if (elementText.trim() === lineText.trim() || elementMd.trim() === lineText.trim()) {
                const confidence = this.calculateMatchConfidence(element, lineText, index, lineNumber);
                exactMatches.push({element, index, confidence});
                this.vscodeLog(`📍 Found exact match at index ${index} for line ${lineNumber}: "${elementText.trim()}" (confidence: ${confidence})`);
            }
            // Check for fuzzy matches
            else if (elementText.includes(lineText.trim()) || lineText.trim().includes(elementText.trim()) ||
                     elementMd.includes(lineText.trim()) || lineText.trim().includes(elementMd.trim())) {
                if (this.fuzzyLineMatch(elementText, lineText) || this.fuzzyLineMatch(elementMd, lineText)) {
                    const confidence = this.calculateMatchConfidence(element, lineText, index, lineNumber);
                    fuzzyMatches.push({element, index, confidence});
                    this.vscodeLog(`📍 Found fuzzy match at index ${index} for line ${lineNumber}: "${elementText.trim()}" (confidence: ${confidence})`);
                }
            }
        });
        
        this.vscodeLog(`🔍 DEBUG: Strategy 2a - Found ${exactMatches.length} exact matches, ${fuzzyMatches.length} fuzzy matches`);
        
        // Return the best match based on position and confidence
        const bestMatch = this.selectBestMatch(exactMatches, fuzzyMatches, lineNumber);
        if (bestMatch) {
            this.vscodeLog(`🎯 Selected best match at index ${bestMatch.index} for line ${lineNumber} (confidence: ${bestMatch.confidence})`);
            return bestMatch.element;
        }
        
        // Strategy 3: Vditor IR structure aware search
        const vditorElements = Array.from(editor.querySelectorAll('.vditor-ir__node, .vditor-ir__marker'));
        this.vscodeLog(`🔍 DEBUG: Strategy 3 - Found ${vditorElements.length} Vditor IR elements`);
        
        let vditorMatches = 0;
        for (const element of vditorElements) {
            const elementText = element.textContent || '';
            if (elementText.includes(lineText.trim())) {
                vditorMatches++;
                if (this.fuzzyLineMatch(elementText, lineText)) {
                    this.vscodeLog(`📍 Found Vditor IR element for line ${lineNumber}: ${element.tagName}.${element.className}`);
                    return element as HTMLElement;
                }
            }
        }
        this.vscodeLog(`🔍 DEBUG: Strategy 3 - Found ${vditorMatches} Vditor elements containing text`);
        
        // Strategy 4: List item specific mapping (since OL/UL items often fail)
        const listItems = Array.from(editor.querySelectorAll('li, p, h1, h2, h3, h4, h5, h6'));
        this.vscodeLog(`🔍 DEBUG: Strategy 4 - Found ${listItems.length} list/heading items`);
        
        let listMatches = 0;
        for (const element of listItems) {
            const elementText = element.textContent || '';
            if (elementText.includes(lineText.trim())) {
                listMatches++;
                // For numbered lists, check if this might be the right item
                if (lineText.match(/^\d+\./) && elementText.includes(lineText.replace(/^\d+\.\s*/, ''))) {
                    this.vscodeLog(`📍 Found numbered list item for line ${lineNumber}: "${elementText.trim()}"`);
                    return element as HTMLElement;
                }
                // For regular content
                if (this.fuzzyLineMatch(elementText, lineText)) {
                    this.vscodeLog(`📍 Found list/heading item for line ${lineNumber}: "${elementText.trim()}"`);
                    return element as HTMLElement;
                }
            }
        }
        this.vscodeLog(`🔍 DEBUG: Strategy 4 - Found ${listMatches} list/heading elements containing text`);
        
        // Strategy 5: Approximate mapping by position (last resort)
        const blockElements = this.getBlockElements(editor);
        this.vscodeLog(`🔍 DEBUG: Strategy 5 - Found ${blockElements.length} block elements`);
        
        if (blockElements.length > 0) {
            this.vscodeLog(`🔍 DEBUG: First 3 block elements:`);
            for (let i = 0; i < Math.min(3, blockElements.length); i++) {
                const el = blockElements[i];
                this.vscodeLog(`   ${i}: ${el.tagName}.${el.className || '(no-class)'} - "${(el.textContent || '').substring(0, 50)}..."`);
            }
        }
        
        if (lineNumber > 0 && lineNumber <= blockElements.length * 2) { // Allow more flexible mapping
            // Try to map line numbers to elements more intelligently
            const approximateIndex = Math.min(Math.floor(lineNumber / 3), blockElements.length - 1);
            const approximateElement = blockElements[approximateIndex];
            this.vscodeLog(`📍 Using enhanced approximate mapping: line ${lineNumber} → element ${approximateIndex} (${approximateElement.tagName})`);
            return approximateElement;
        }
        
        this.vscodeLog(`❌ DEBUG: All strategies failed for line ${lineNumber}. No DOM element found.`);
        return null;
    }
    
    /**
     * Get all possible elements that could represent lines (including nested elements)
     */
    private getAllPossibleLineElements(editor: HTMLElement): HTMLElement[] {
        this.vscodeLog(`🔍 DEBUG: getAllPossibleLineElements - editor element: ${editor.tagName}.${editor.className || '(no-class)'}`);
        
        const elements: HTMLElement[] = [];
        const selectors = [
            'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 
            'div', 'blockquote', 'pre', 'span.vditor-ir__node',
            '.vditor-ir__node', '.vditor-ir__marker'
        ];
        
        selectors.forEach(selector => {
            const found = Array.from(editor.querySelectorAll(selector));
            this.vscodeLog(`🔍 DEBUG: Selector "${selector}" found ${found.length} elements`);
            
            found.forEach(el => {
                if (el instanceof HTMLElement && el.textContent && el.textContent.trim()) {
                    elements.push(el);
                }
            });
        });
        
        // Debug: Show ALL direct children of editor
        this.vscodeLog(`🔍 DEBUG: Editor has ${editor.children.length} direct children:`);
        for (let i = 0; i < Math.min(10, editor.children.length); i++) {
            const child = editor.children[i];
            this.vscodeLog(`   Child ${i}: ${child.tagName}.${child.className || '(no-class)'} - "${(child.textContent || '').substring(0, 30)}..."`);
        }
        
        this.vscodeLog(`🔍 DEBUG: getAllPossibleLineElements returning ${elements.length} total elements`);
        return elements;
    }
    
    /**
     * Debug method to understand DOM structure for line mapping
     */
    private debugDOMStructure(editor: HTMLElement, lineNumber: number): void {
        this.vscodeLog(`🏗️ DOM STRUCTURE DEBUG for line ${lineNumber}:`);
        this.vscodeLog(`🏗️ Editor: ${editor.tagName}.${editor.className || '(no-class)'} with ${editor.children.length} children`);
        
        // Show all direct children
        Array.from(editor.children).forEach((child, i) => {
            if (child instanceof HTMLElement) {
                const text = (child.textContent || '').substring(0, 60);
                this.vscodeLog(`   ${i}: ${child.tagName}.${child.className || '(no-class)'} - "${text}${text.length > 60 ? '...' : ''}"`);
                
                // If this is a list or container, show its children too
                if (child.tagName === 'UL' || child.tagName === 'OL' || child.tagName === 'DIV') {
                    Array.from(child.children).forEach((grandChild, j) => {
                        if (grandChild instanceof HTMLElement && j < 5) { // Limit to first 5
                            const grandText = (grandChild.textContent || '').substring(0, 40);
                            this.vscodeLog(`      ${i}.${j}: ${grandChild.tagName}.${grandChild.className || '(no-class)'} - "${grandText}${grandText.length > 40 ? '...' : ''}"`);
                        }
                    });
                }
            }
        });
        
        // Show some text nodes too
        const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT,
            null
        );
        
        let textNodeCount = 0;
        let textNode;
        this.vscodeLog(`🏗️ Text nodes in editor (first 10):`);
        while ((textNode = walker.nextNode()) && textNodeCount < 10) {
            if (textNode.textContent && textNode.textContent.trim()) {
                this.vscodeLog(`   TextNode ${textNodeCount}: "${textNode.textContent.substring(0, 50)}${textNode.textContent.length > 50 ? '...' : ''}"`);
                textNodeCount++;
            }
        }
    }
    
    /**
     * Check if element text roughly matches the expected line text
     */
    private fuzzyLineMatch(elementText: string, lineText: string): boolean {
        const elementWords = elementText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const lineWords = lineText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        
        if (lineWords.length === 0) return false;
        
        // Check if at least 70% of significant words match
        const matchingWords = lineWords.filter(word => elementWords.some(ew => ew.includes(word) || word.includes(ew)));
        const matchRatio = matchingWords.length / lineWords.length;
        
        return matchRatio >= 0.7;
    }
    
    /**
     * Calculate match confidence based on position, content similarity, and other factors
     */
    private calculateMatchConfidence(element: HTMLElement, lineText: string, elementIndex: number, targetLineNumber: number | undefined): number {
        let confidence = 0;
        
        // Base confidence from content similarity
        const elementText = element.textContent || '';
        if (elementText.trim() === lineText.trim()) {
            confidence += 50; // Exact match gets high base score
        } else if (this.fuzzyLineMatch(elementText, lineText)) {
            confidence += 30; // Fuzzy match gets medium base score
        } else if (elementText.includes(lineText.trim()) || lineText.trim().includes(elementText.trim())) {
            confidence += 20; // Partial match gets lower base score
        }
        
        // Position-based confidence - elements closer to expected position get higher scores
        if (targetLineNumber !== undefined) {
            // More accurate position estimation
            const totalMarkdownLines = this.vditor ? this.vditor.getValue().split('\n').length : 100;
            const totalElements = 100; // Estimate - will be more accurate in selectBestMatch
            
            // Calculate expected position as a ratio
            const expectedPositionRatio = Math.min(1, targetLineNumber / totalMarkdownLines);
            const actualPositionRatio = elementIndex / totalElements;
            const positionDifference = Math.abs(expectedPositionRatio - actualPositionRatio);
            
            // Add confidence based on position proximity (closer = higher confidence)
            // Scale from 0 to 30 based on how close the position is
            const positionConfidence = Math.max(0, 30 * (1 - positionDifference * 2));
            confidence += positionConfidence;
            
            // Extra logging for debugging position calculations
            this.vscodeLog(`🎯 Position calc for element ${elementIndex}: line ${targetLineNumber}/${totalMarkdownLines} (${expectedPositionRatio.toFixed(2)}) vs element ${elementIndex}/${totalElements} (${actualPositionRatio.toFixed(2)}) → confidence +${positionConfidence.toFixed(1)}`);
        }
        
        // Element type bonus - prefer structural elements
        if (element.tagName.match(/^H[1-6]$/)) {
            confidence += 10; // Headings are good line anchors
        } else if (element.tagName === 'P') {
            confidence += 8; // Paragraphs are good line anchors
        } else if (element.tagName === 'LI') {
            confidence += 6; // List items are decent line anchors
        }
        
        // Length similarity bonus
        const lengthDifference = Math.abs(elementText.length - lineText.length);
        if (lengthDifference < 10) {
            confidence += 10;
        } else if (lengthDifference < 50) {
            confidence += 5;
        }
        
        return confidence;
    }
    
    /**
     * Select the best match from exact and fuzzy matches based on confidence scores
     */
    private selectBestMatch(
        exactMatches: Array<{element: HTMLElement, index: number, confidence: number}>,
        fuzzyMatches: Array<{element: HTMLElement, index: number, confidence: number}>,
        targetLineNumber: number | undefined
    ): {element: HTMLElement, index: number, confidence: number} | null {
        
        // Combine all matches and sort by confidence
        const allMatches = [...exactMatches, ...fuzzyMatches]
            .sort((a, b) => b.confidence - a.confidence);
        
        if (allMatches.length === 0) {
            return null;
        }
        
        // If we have multiple high-confidence matches, prefer the one with better position
        if (allMatches.length > 1 && targetLineNumber !== undefined) {
            const topMatches = allMatches.filter(match => 
                match.confidence >= (allMatches[0].confidence - 10)
            );
            
            if (topMatches.length > 1) {
                // Among top matches, prefer the one with better position relative to line number
                const totalElements = Math.max(...allMatches.map(m => m.index)) + 1;
                const expectedPosition = targetLineNumber / 100; // Normalize to 0-1 range
                
                return topMatches.reduce((best, current) => {
                    const currentPosition = current.index / totalElements;
                    const bestPosition = best.index / totalElements;
                    
                    const currentDistance = Math.abs(currentPosition - expectedPosition);
                    const bestDistance = Math.abs(bestPosition - expectedPosition);
                    
                    return currentDistance < bestDistance ? current : best;
                });
            }
        }
        
        return allMatches[0];
    }
    
    /**
     * Search for target text within a specific DOM element
     */
    private searchWithinElement(element: HTMLElement, targetText: string, diagnostic: any, tokenKey: string): boolean {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null
        );
        
        let textNode: Text | null;
        let attemptCount = 0;
        
        this.vscodeLog(`🔍 Searching within element for "${targetText}"`);
        
        while ((textNode = walker.nextNode() as Text)) {
            const content = textNode.textContent || '';
            attemptCount++;
            
            if (content.trim().length === 0) continue; // Skip empty text nodes
            
            this.vscodeLog(`🔍 Checking text node ${attemptCount} within element: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`);
            
            // Try multiple matching strategies for better accuracy
            const strategies = [
                // Strategy 1: Exact match
                { name: 'exact', index: content.indexOf(targetText) },
                // Strategy 2: Case-insensitive match
                { name: 'case-insensitive', index: content.toLowerCase().indexOf(targetText.toLowerCase()) },
                // Strategy 3: Trimmed match (handle whitespace issues)
                { name: 'trimmed', index: content.trim().indexOf(targetText.trim()) },
                // Strategy 4: Word boundary match (for punctuation issues)
                { name: 'word-boundary', index: this.findWordBoundaryMatch(content, targetText) }
            ];
            
            for (const strategy of strategies) {
                if (strategy.index !== -1) {
                    this.vscodeLog(`🎯 Found match using ${strategy.name} strategy at index ${strategy.index} in: "${content}"`);
                    
                    // Attempt to wrap the text
                    const success = this.wrapTextWithDiagnostic(
                        textNode, 
                        strategy.index, 
                        strategy.index + targetText.length, 
                        diagnostic
                    );
                    
                    if (success) {
                        this.vscodeLog(`✅ Successfully wrapped text: "${targetText}" using ${strategy.name} strategy in correct line element`);
                        return true;
                    } else {
                        this.vscodeLog(`❌ Failed to wrap text: "${targetText}" using ${strategy.name} strategy`);
                    }
                }
            }
        }
        
        this.vscodeLog(`❌ No matches found for "${targetText}" within line element after checking ${attemptCount} text nodes`);
        return false;
    }
    
    /**
     * Fallback to global search if line-specific search fails
     */
    private fallbackToGlobalSearch(editor: HTMLElement, targetText: string, diagnostic: any, tokenKey: string): boolean {
        this.vscodeLog(`🔄 Falling back to global search for "${targetText}"`);
        
        const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT,
            null
        );
        
        let textNode: Text | null;
        let attemptCount = 0;
        
        while ((textNode = walker.nextNode() as Text)) {
            const content = textNode.textContent || '';
            attemptCount++;
            
            if (content.indexOf(targetText) !== -1) {
                this.vscodeLog(`🎯 Found match in global search at text node ${attemptCount}: "${content}"`);
                
                const success = this.wrapTextWithDiagnostic(
                    textNode, 
                    content.indexOf(targetText), 
                    content.indexOf(targetText) + targetText.length, 
                    diagnostic
                );
                
                if (success) {
                    this.vscodeLog(`✅ Successfully wrapped text: "${targetText}" using global search fallback`);
                    return true;
                }
            }
        }
        
        this.vscodeLog(`❌ Global search failed for "${targetText}" after checking ${attemptCount} text nodes`);
        return false;
    }
    
    /**
     * Find match considering word boundaries to handle punctuation better
     */
    private findWordBoundaryMatch(content: string, targetText: string): number {
        // Create a regex that matches the target text with optional word boundaries
        try {
            const escapedTarget = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedTarget}\\b`, 'i');
            const match = content.match(regex);
            return match ? content.indexOf(match[0]) : -1;
        } catch (error) {
            // Fallback to simple indexOf if regex fails
            return content.indexOf(targetText);
        }
    }

    /**
     * Check if diagnostic is high confidence (specific patterns we trust)
     */
    private isHighConfidenceDiagnostic(diagnostic: any): boolean {
        const message = diagnostic.message?.toLowerCase() || '';
        const source = diagnostic.source || '';
        const range = diagnostic.range;
        
        // High-confidence diagnostic sources
        const trustedSources = [
            'markdownlint',
            'markdown-link-check',
            'textlint',
            'remark-lint',
            'cspell',           // Spelling checker
            'spell-checker',    // Alternative spelling checker
            'spell',           // Generic spell checker
            'grammar',         // Grammar checkers
            'languagetool'     // Language tool
        ];
        
        // Check if source is trusted
        const isTrustedSource = trustedSources.some(pattern => 
            source.toLowerCase().includes(pattern.toLowerCase())
        );
        
        if (!isTrustedSource) {
            this.vscodeLog(`⚠️ Untrusted diagnostic source: "${source}"`);
            return false;
        }
        
        // Additional validation for diagnostics with valid range information
        if (range && range.start && range.end) {
            const hasValidRange = (
                typeof range.start.line === 'number' &&
                typeof range.start.character === 'number' &&
                typeof range.end.line === 'number' &&
                typeof range.end.character === 'number'
            );
            
            if (!hasValidRange) {
                this.vscodeLog(`⚠️ Diagnostic has invalid range information`);
                return false;
            }
        }
        
        // Spelling/grammar errors - high confidence with range info
        if (source.toLowerCase().includes('spell') || source.toLowerCase().includes('cspell')) {
            const hasSpellingPatterns = (
                message.includes('misspelled') ||
                message.includes('unknown word') ||
                message.includes('not found') ||
                message.includes('spelling')
            );
            
            if (hasSpellingPatterns && range) {
                this.vscodeLog(`✅ High-confidence spelling diagnostic: "${message}"`);
                return true;
            }
        }
        
        // Markdownlint diagnostics - high confidence
        if (source.toLowerCase().includes('markdownlint')) {
            this.vscodeLog(`✅ High-confidence markdownlint diagnostic: "${message}"`);
            return true;
        }
        
        // Grammar and style checkers
        if (source.toLowerCase().includes('grammar') || source.toLowerCase().includes('languagetool')) {
            this.vscodeLog(`✅ High-confidence grammar diagnostic: "${message}"`);
            return true;
        }
        
        // Link and reference checkers
        if (source.toLowerCase().includes('link-check') || message.includes('broken') || message.includes('missing')) {
            this.vscodeLog(`✅ High-confidence link/reference diagnostic: "${message}"`);
            return true;
        }
        
        // Default: If we have a trusted source but didn't match specific patterns, still allow it
        this.vscodeLog(`✅ High-confidence diagnostic from trusted source "${source}": "${message}"`);
        return true;
    }

    /**
     * Handle MD041 - First line should be heading
     */
    private handleMD041Diagnostic(editor: HTMLElement, diagnostic: any): boolean {
        this.vscodeLog('DiagnosticVisualizer: Handling MD041 - First line should be heading');
        
        // Find the first content element in the editor
        const firstElement = editor.querySelector('p, div, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, pre');
        
        if (firstElement) {
            this.applyDiagnosticStyleToElement(firstElement as HTMLElement, diagnostic);
            this.vscodeLog('MD041: Applied diagnostic to first content element');
            return true;
        }
        
        return false;

        this.vscodeLog(`DiagnosticVisualizer: Applying ${this.diagnostics.length} diagnostics to editor`);
        
        let successCount = 0;
        const failedDiagnostics: any[] = [];

        // Process each diagnostic and track results
        this.diagnostics.forEach((diagnostic, index) => {
            this.vscodeLog(`\n=== Processing Diagnostic ${index + 1}/${this.diagnostics.length} ===`);
            this.vscodeLog(`Message: ${diagnostic.message}`);
            this.vscodeLog(`Source: ${diagnostic.source}`);
            
            const success = this.applyDiagnosticByContentMatch(editor as HTMLElement, diagnostic);
            
            if (success) {
                successCount++;
                this.vscodeLog(`✅ Diagnostic ${index + 1} applied successfully`);
            } else {
                failedDiagnostics.push({
                    index: index + 1,
                    message: diagnostic.message,
                    source: diagnostic.source,
                    line: diagnostic.range?.start?.line
                });
                console.error(`❌ Diagnostic ${index + 1} failed to apply`);
            }
        });

        // Summary logging
        
        if (failedDiagnostics.length > 0) {
        }
    }

  /**
   * Apply diagnostic by finding matching content in the DOM
   */
  private applyDiagnosticByContentMatch(editor: HTMLElement, diagnostic: any): boolean {
    const message = diagnostic.message || '';
    const matchedText = diagnostic.matchedText || '';
    const source = diagnostic.source || '';
    
    this.vscodeLog(`Applying diagnostic: ${message}, source: ${source}, matchedText: "${matchedText}"`);
    
    // Handle specific diagnostic types with precision
    let handled = false;
    
    // For broken links, search by the URL in href attributes
    if (message.includes('Potentially broken link:')) {
      handled = this.handleBrokenLinkDiagnostic(editor, diagnostic, message);
    }
    
    // For images missing alt text, search for img tags without alt
    else if (message.includes('Image missing alt text')) {
      handled = this.handleImageAltDiagnostic(editor, diagnostic);
    }
    
    // For MD012: Multiple consecutive blank lines - DISABLED
    // Vditor normalizes blank lines, making this diagnostic unreliable
    else if (message.includes('Multiple consecutive blank lines') || (source === 'markdownlint' && message.includes('MD012'))) {
      this.vscodeLog(`MD012 diagnostic skipped in generic handler - Vditor normalizes blank lines`);
      handled = false; // Skip MD012
    }
    
    // For other markdownlint or VS Code diagnostics, use generic text-based matching
    else if (source === 'markdownlint' || diagnostic.range) {
      this.vscodeLog(`Using generic diagnostic matching for: ${message}`);
      handled = this.handleGenericDiagnostic(editor, diagnostic);
    }
    
    // For any remaining diagnostics, try text-based matching as fallback
    else if (matchedText) {
      this.vscodeLog(`Using text matching for: ${message}`);
      handled = this.findExactTextMatch(editor, matchedText, diagnostic);
    }
    
    if (!handled) {
      this.vscodeLog(`Diagnostic not applied (avoiding false positives): ${message}`);
    }
    
    return handled;
  }    /**
     * Handle broken link diagnostics specifically
     */
    private handleBrokenLinkDiagnostic(editor: HTMLElement, diagnostic: any, message: string): boolean {
        const urlMatch = message.match(/Potentially broken link: (.+)/);
        const brokenUrl = urlMatch ? urlMatch[1] : '';
        
        if (brokenUrl) {
            const links = editor.querySelectorAll('a');
            
            let found = false;
            links.forEach((link, index) => {
                const href = link.getAttribute('href') || '';
                
                // Try multiple matching strategies
                const isExactMatch = href === brokenUrl;
                const isPartialMatch = href.includes(brokenUrl) || brokenUrl.includes(href);
                const isNormalizedMatch = this.normalizeUrl(href) === this.normalizeUrl(brokenUrl);
                
                if (isExactMatch || isPartialMatch || isNormalizedMatch) {
                    this.applyDiagnosticStyleToElement(link as HTMLElement, diagnostic);
                    found = true;
                }
            });
            
            if (found) return true;
            
            // Also try searching in raw text for markdown that hasn't been fully rendered
            const textFound = this.findExactTextMatch(editor, brokenUrl, diagnostic);
            if (textFound) return true;
        }
        
        return false;
    }

    /**
     * Handle image alt text diagnostics specifically
     */
    private handleImageAltDiagnostic(editor: HTMLElement, diagnostic: any): boolean {
        const images = editor.querySelectorAll('img');
        
        let found = false;
        images.forEach((img, index) => {
            const alt = img.getAttribute('alt') || '';
            if (!alt.trim()) {
                this.applyDiagnosticStyleToElement(img as HTMLElement, diagnostic);
                found = true;
            }
        });
        
        return found;
    }

    /**
     * Handle image alt text diagnostics with enhanced Vditor IR structure awareness
     */
    private handleImageAltDiagnosticPrecise(editor: HTMLElement, diagnostic: any): boolean {
        this.vscodeLog('🖼️ DiagnosticVisualizer: Handling MD045 image alt text diagnostic with Vditor IR awareness');
        
        const lineNumber = diagnostic.range?.start?.line;
        const lineText = diagnostic.lineText;
        
        this.vscodeLog(`🖼️ Image alt diagnostic on line ${lineNumber}: "${lineText}"`);
        
        // Strategy 1: Look for Vditor IR image nodes specifically
        // User provided structure: <span class="vditor-ir__node" data-type="img">
        const vditorImageNodes = editor.querySelectorAll('.vditor-ir__node[data-type="img"]');
        this.vscodeLog(`🖼️ Found ${vditorImageNodes.length} Vditor IR image nodes`);
        
        // Debug: log the actual structure of each node
        vditorImageNodes.forEach((node, i) => {
            this.vscodeLog(`🖼️ Node ${i} structure: ${node.outerHTML.substring(0, 200)}...`);
        });
        
        // Strategy 1A: Check for Vditor IR image nodes
        for (let i = 0; i < vditorImageNodes.length; i++) {
            const imageNode = vditorImageNodes[i] as HTMLElement;
            
            // Look for img element within the Vditor IR structure
            const img = imageNode.querySelector('img');
            const imgSrc = img?.getAttribute('src') || '';
            const imgAlt = img?.getAttribute('alt') || '';
            
            // Also look for spans containing image path information
            const pathSpans = imageNode.querySelectorAll('.vditor-ir__marker ~ span');
            const allText = imageNode.textContent || '';
            
            this.vscodeLog(`🖼️ Vditor image node ${i}: img src="${imgSrc}", alt="${imgAlt}", text="${allText}"`);
            
            // Try to match against line text if available
            if (lineText) {
                const imgPathMatch = lineText.match(/!\[([^\]]*)\]\(([^)]+)\)/);
                if (imgPathMatch) {
                    const expectedAltText = imgPathMatch[1];
                    const expectedPath = imgPathMatch[2];
                    
                    
                    // Check if this image node contains the expected path
                    let isMatch = false;
                    
                    // Method 1: Check img src directly
                    if (imgSrc && (imgSrc === expectedPath || imgSrc.includes(expectedPath) || 
                                  expectedPath.includes(imgSrc.split('/').pop() || ''))) {
                        isMatch = true;
                    }
                    
                    // Method 2: Check node text content for path
                    if (!isMatch && allText.includes(expectedPath)) {
                        isMatch = true;
                    }
                    
                    // Method 3: Check filename only
                    if (!isMatch) {
                        const expectedFilename = expectedPath.split('/').pop() || '';
                        const imgFilename = imgSrc.split('/').pop() || '';
                        if (expectedFilename && (allText.includes(expectedFilename) || imgFilename === expectedFilename)) {
                            isMatch = true;
                        }
                    }
                    
                    if (isMatch && (!expectedAltText.trim() || imgAlt === expectedAltText)) {
                        this.vscodeLog(`✅ Found matching Vditor image with missing/empty alt text`);
                        
                        // Apply diagnostic to the Vditor image node (the span containing everything)
                        this.applyDiagnosticStyleToVditorNode(imageNode, diagnostic);
                        return true;
                    }
                }
            } else {
                // Fallback: any image without alt text
                if (img && !imgAlt.trim()) {
                    this.vscodeLog(`✅ Found Vditor image without alt text (no line text provided)`);
                    this.applyDiagnosticStyleToVditorNode(imageNode, diagnostic);
                    return true;
                }
            }
        }
        
        // Strategy 2: Fallback to regular img elements if no Vditor IR nodes found
        const images = editor.querySelectorAll('img');
        this.vscodeLog(`🖼️ Fallback: Found ${images.length} regular img elements`);
        
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            const src = img.getAttribute('src') || '';
            const alt = img.getAttribute('alt') || '';
            
            if (lineText) {
                const imgPathMatch = lineText.match(/!\[([^\]]*)\]\(([^)]+)\)/);
                if (imgPathMatch) {
                    const expectedPath = imgPathMatch[2];
                    const expectedAlt = imgPathMatch[1];
                    
                    let isMatch = false;
                    if (src === expectedPath || src.includes(expectedPath) || 
                        expectedPath.includes(src.split('/').pop() || '')) {
                        isMatch = true;
                    }
                    
                    if (isMatch && (!alt.trim() || alt === expectedAlt)) {
                        this.vscodeLog(`✅ Found matching fallback image with missing alt text`);
                        this.applyDiagnosticStyleToElement(img as HTMLElement, diagnostic);
                        return true;
                    }
                }
            } else if (!alt.trim()) {
                this.vscodeLog(`✅ Found fallback image without alt text`);
                this.applyDiagnosticStyleToElement(img as HTMLElement, diagnostic);
                return true;
            }
        }
        
        this.vscodeLog(`❌ No matching image found for MD045 diagnostic`);
        return false;
    }

    /**
     * Apply diagnostic styling to a Vditor IR node
     */
    private applyDiagnosticStyleToVditorNode(vditorNode: HTMLElement, diagnostic: any): void {
        const severity = this.getDiagnosticSeverityString(diagnostic.severity);
        const cssClass = `vscode-diagnostic-${severity}`;
        
        this.vscodeLog(`🎯 Applying diagnostic to Vditor IR node: ${cssClass}`);
        
        // Apply diagnostic styling to the Vditor node itself
        vditorNode.classList.add(cssClass);
        vditorNode.setAttribute('data-diagnostic-message', diagnostic.message || '');
        vditorNode.setAttribute('data-diagnostic-source', diagnostic.source || '');
        // NOTE: Do NOT mark content elements with data-diagnostic-ui="true"
        
        // Also apply to the img element for visual consistency
        const img = vditorNode.querySelector('img');
        if (img) {
            img.classList.add(cssClass);
            img.setAttribute('data-diagnostic-message', diagnostic.message || '');
            img.setAttribute('data-diagnostic-source', diagnostic.source || '');
            // Add integrated tooltip and lightbulb directly to the image element
            this.addHoverableTooltip(img, diagnostic);
            this.addIntegratedQuickFixLightbulb(img, diagnostic);
            // NOTE: Do NOT mark content elements with data-diagnostic-ui="true"
        }
        
        this.vscodeLog(`✅ Applied ${cssClass} to Vditor IR image node`);
    }

    /**
     * Handle MD012 diagnostics - Multiple consecutive blank lines
     */
    private handleMD012Diagnostic(editor: HTMLElement, diagnostic: any): boolean {
        this.vscodeLog('DiagnosticVisualizer: Handling MD012 - Multiple consecutive blank lines');
        
        const lineNumber = diagnostic.range?.start?.line;
        if (lineNumber === undefined) {
            this.vscodeLog('MD012: No line number provided');
            return false;
        }
        
        this.vscodeLog(`MD012: Looking for multiple blank lines around line ${lineNumber}`);
        
        // For MD012, we need to find the area where multiple blank lines occur
        // This is tricky in WYSIWYG mode because blank lines may not have direct DOM representation
        // Vditor might be trimming or normalizing blank lines during instant rendering
        
        // First, let's check the raw markdown content vs the rendered DOM
        const vditorContent = this.vditor ? this.vditor.getValue() : '';
        const lines = vditorContent.split('\n');
        this.vscodeLog(`MD012: Raw markdown has ${lines.length} lines, checking around line ${lineNumber}`);
        
        // Look for multiple consecutive blank lines in the raw content
        let consecutiveBlankLines = 0;
        let blankLineStart = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === '') {
                if (consecutiveBlankLines === 0) {
                    blankLineStart = i;
                }
                consecutiveBlankLines++;
            } else {
                if (consecutiveBlankLines >= 2) {
                    this.vscodeLog(`MD012: Found ${consecutiveBlankLines} consecutive blank lines from line ${blankLineStart} to ${i-1}`);
                    // Check if this matches our target line number
                    if (Math.abs(blankLineStart - lineNumber) <= 2 || Math.abs(i - 1 - lineNumber) <= 2) {
                        // Found the problematic area, now try to find corresponding DOM elements
                        return this.findElementsForBlankLineArea(editor, blankLineStart, i - 1, diagnostic);
                    }
                }
                consecutiveBlankLines = 0;
                blankLineStart = -1;
            }
        }
        
        this.vscodeLog(`MD012: Could not find multiple consecutive blank lines in raw content around line ${lineNumber}`);
        
        // Strategy 1: Look for paragraph elements that might represent the blank lines
        const allElements = editor.querySelectorAll('p, div, br');
        const targetElements: HTMLElement[] = [];
        
        // Find consecutive empty paragraph elements or areas with multiple br tags
        let consecutiveEmptyCount = 0;
        let lastEmptyElement: HTMLElement | null = null;
        
        allElements.forEach((element) => {
            const el = element as HTMLElement;
            const isEmpty = this.isEmptyElement(el);
            
            if (isEmpty) {
                consecutiveEmptyCount++;
                if (consecutiveEmptyCount >= 2) {
                    // Found multiple consecutive empty elements
                    if (lastEmptyElement) {
                        targetElements.push(lastEmptyElement);
                    }
                    targetElements.push(el);
                }
                lastEmptyElement = el;
            } else {
                consecutiveEmptyCount = 0;
                lastEmptyElement = null;
            }
        });
        
        // If we found target elements, apply the diagnostic style
        if (targetElements.length > 0) {
            this.vscodeLog(`MD012: Found ${targetElements.length} elements representing multiple blank lines`);
            targetElements.forEach((element) => {
                this.applyDiagnosticStyleToElement(element, diagnostic);
            });
            return true;
        }
        
        // Strategy 2: If no specific elements found, look for areas with high br density
        const brElements = editor.querySelectorAll('br');
        let consecutiveBrs: HTMLElement[] = [];
        
        for (let i = 0; i < brElements.length - 1; i++) {
            const br1 = brElements[i] as HTMLElement;
            const br2 = brElements[i + 1] as HTMLElement;
            
            // Check if br elements are close to each other (indicating consecutive blank lines)
            if (this.areElementsConsecutive(br1, br2)) {
                if (consecutiveBrs.length === 0) {
                    consecutiveBrs.push(br1);
                }
                consecutiveBrs.push(br2);
            } else {
                if (consecutiveBrs.length >= 2) {
                    // Found multiple consecutive br elements
                    consecutiveBrs.forEach((br) => {
                        this.applyDiagnosticStyleToElement(br, diagnostic);
                    });
                    this.vscodeLog(`MD012: Applied diagnostic to ${consecutiveBrs.length} consecutive br elements`);
                    return true;
                }
                consecutiveBrs = [];
            }
        }
        
        // Check the last group
        if (consecutiveBrs.length >= 2) {
            consecutiveBrs.forEach((br) => {
                this.applyDiagnosticStyleToElement(br, diagnostic);
            });
            this.vscodeLog(`MD012: Applied diagnostic to ${consecutiveBrs.length} consecutive br elements (final group)`);
            return true;
        }
        
        // Strategy 3: Fallback - apply to a nearby element using line mapping
        this.vscodeLog('MD012: Using fallback line mapping approach');
        return this.findElementByLineMapping(editor, diagnostic);
    }
    
    /**
     * Find DOM elements that correspond to a blank line area in the raw markdown
     */
    private findElementsForBlankLineArea(editor: HTMLElement, startLine: number, endLine: number, diagnostic: any): boolean {
        this.vscodeLog(`MD012: Trying to find DOM elements for blank line area from line ${startLine} to ${endLine}`);
        
        // Strategy: Since Vditor may normalize blank lines, look for paragraph breaks or line breaks
        // in the approximate area where the blank lines should be
        
        // Get all block-level elements that could represent paragraphs or line breaks
        const blockElements = editor.querySelectorAll('p, div, br, .vditor-ir__node');
        
        if (blockElements.length === 0) {
            this.vscodeLog('MD012: No block elements found in editor');
            return false;
        }
        
        // Since we can't precisely map lines to DOM elements in WYSIWYG mode,
        // apply the diagnostic to elements in the middle portion of the document
        // as a reasonable approximation
        const targetIndex = Math.floor(blockElements.length * (startLine / (this.vditor ? this.vditor.getValue().split('\n').length : 100)));
        const element = blockElements[Math.min(targetIndex, blockElements.length - 1)] as HTMLElement;
        
        if (!element) {
            this.vscodeLog('MD012: Could not find target element for blank line area');
            return false;
        }
        
        this.vscodeLog(`MD012: Applying diagnostic to element at index ${targetIndex} (${element.tagName})`);
        this.applyDiagnosticStyleToElement(element, diagnostic);
        return true;
    }

    /**
     * Check if an element is considered empty (for MD012 detection)
     */
    private isEmptyElement(element: HTMLElement): boolean {
        const tagName = element.tagName.toLowerCase();
        
        // br elements are always considered empty
        if (tagName === 'br') return true;
        
        // For p and div elements, check if they're empty or only contain whitespace/br
        if (tagName === 'p' || tagName === 'div') {
            const text = element.textContent?.trim() || '';
            if (text === '') {
                // Element is empty or only contains br elements
                const brCount = element.querySelectorAll('br').length;
                const childCount = element.children.length;
                return childCount === 0 || childCount === brCount;
            }
        }
        
        return false;
    }
    
    /**
     * Check if two elements are consecutive in the DOM (for MD012 detection)
     */
    private areElementsConsecutive(el1: HTMLElement, el2: HTMLElement): boolean {
        // Simple check - see if el2 is the next sibling or very close
        let sibling = el1.nextSibling;
        let stepsToFind = 0;
        const maxSteps = 3; // Allow for some whitespace/text nodes in between
        
        while (sibling && stepsToFind < maxSteps) {
            if (sibling === el2) return true;
            sibling = sibling.nextSibling;
            stepsToFind++;
        }
        
        return false;
    }

    /**
     * Handle generic diagnostics from external sources (like markdownlint)
     */
    private handleGenericDiagnostic(editor: HTMLElement, diagnostic: any): boolean {
        const message = diagnostic.message || '';
        const range = diagnostic.range;
        const source = diagnostic.source || 'unknown';
        const lineText = diagnostic.lineText || '';
        
        // Strategy 1: Try precise line mapping using document structure
        if (range && typeof range.start?.line === 'number') {
            
            const found = this.findElementByLineMapping(editor, diagnostic);
            if (found) {
                return true;
            }
        }
        
        // Strategy 2: Search for specific text patterns in the line
        if (lineText && lineText.trim()) {
            const found = this.findElementByTextContent(editor, lineText.trim(), diagnostic);
            if (found) {
                return true;
            }
        }
        
        // Strategy 3: Handle specific diagnostic patterns
        if (this.handleSpecificPatterns(editor, diagnostic)) {
            return true;
        }
        
        // Strategy 4: Apply to editor root as fallback
        this.applyDiagnosticStyleToElement(editor, diagnostic);
        return true;
    }

    /**
     * Map VS Code line numbers to DOM elements more precisely
     */
    private findElementByLineMapping(editor: HTMLElement, diagnostic: any): boolean {
        const lineNumber = diagnostic.range.start.line;
        const lineText = diagnostic.lineText || '';
        
        
        // Get all block-level elements that could correspond to markdown lines
        const blockElements = this.getBlockElements(editor);
        
        
        // Try direct line-to-element mapping
        if (lineNumber < blockElements.length) {
            const targetElement = blockElements[lineNumber];
            
            // Verify this element contains similar content to the diagnostic line
            if (this.elementsMatch(targetElement, lineText, diagnostic)) {
                this.applyDiagnosticStyleToElement(targetElement, diagnostic);
                return true;
            }
        }
        
        // Try to find element by content matching if direct mapping fails
        for (let i = 0; i < blockElements.length; i++) {
            if (this.elementsMatch(blockElements[i], lineText, diagnostic)) {
                this.applyDiagnosticStyleToElement(blockElements[i], diagnostic);
                return true;
            }
        }
        
        return false;
    }

    /**
     * Get all block-level elements that correspond to markdown lines
     */
    private getBlockElements(editor: HTMLElement): HTMLElement[] {
        const blockSelectors = [
            'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
            'div', 'blockquote', 'pre', 'ul', 'ol', 'li',
            'table', 'tr', 'td', 'th'
        ];
        
        const elements: HTMLElement[] = [];
        
        // Get direct children first (most likely to match lines)
        Array.from(editor.children).forEach(child => {
            if (child instanceof HTMLElement) {
                elements.push(child);
            }
        });
        
        // If we don't have enough elements, get nested block elements
        if (elements.length === 0) {
            blockSelectors.forEach(selector => {
                const found = editor.querySelectorAll(selector);
                found.forEach(el => {
                    if (el instanceof HTMLElement && !elements.includes(el)) {
                        elements.push(el);
                    }
                });
            });
        }
        
        return elements;
  }

  // Old lightbulb overlay system removed - now using integrated approach

  /**
   * Add quick fix lightbulb as a completely separate overlay (never touches document content)
   */
  /**
   * Add integrated quick fix lightbulb directly to the diagnostic span (no separate overlay)
   */
  private addIntegratedQuickFixLightbulb(element: HTMLElement, diagnostic: any): void {
    // Only add lightbulb for diagnostics that likely have quick fixes
    const hasQuickFix = this.diagnosticHasQuickFix(diagnostic);
    if (!hasQuickFix) {
      return;
    }

    // Don't add multiple lightbulbs to the same element
    if (element.getAttribute('data-has-lightbulb') === 'true') {
      return;
    }

    this.vscodeLog(`� Adding integrated lightbulb to diagnostic span: ${diagnostic.message} (${diagnostic.source})`);

    // Add lightbulb styling directly to the span
    element.style.position = 'relative';
    element.style.cursor = 'pointer';
    element.setAttribute('data-has-lightbulb', 'true');

    // Lightbulb CSS is already defined in main.css - no need to add dynamic styles
    
    // Add click handler to the entire element
    element.addEventListener('click', (e) => {
      // Only trigger if clicking near the lightbulb area (right side of element)
      const rect = element.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const elementWidth = rect.width;
      
      // If clicking in the rightmost 25% of the element (where lightbulb appears), trigger quick fix
      if (clickX > elementWidth * 0.75) {
        e.preventDefault();
        e.stopPropagation();
        this.vscodeLog(`🔧 Lightbulb clicked - triggering quick fix for: ${diagnostic.message}`);
        this.triggerQuickFix(diagnostic);
      }
    });

    this.vscodeLog(`✅ Integrated lightbulb added to diagnostic span (using main.css styles)`);
  }

  /**
   * Legacy method kept for compatibility with existing code
   */
  private addQuickFixLightbulb(element: HTMLElement, diagnostic: any): void {
    // Redirect to integrated lightbulb to avoid duplicates
    this.addIntegratedQuickFixLightbulb(element, diagnostic);
  }

  /**
   * Clean up integrated lightbulb styling (replaces old overlay cleanup)
   */
  private cleanupLightbulbOverlays(): void {
    // Remove integrated lightbulb attributes from all elements
    const elementsWithLightbulbs = document.querySelectorAll('[data-has-lightbulb="true"]');
    let removedCount = 0;
    
    elementsWithLightbulbs.forEach(element => {
      const htmlElement = element as HTMLElement;
      htmlElement.removeAttribute('data-has-lightbulb');
      htmlElement.style.removeProperty('--lightbulb-display');
      removedCount++;
    });
    
    this.vscodeLog(`✅ Cleaned up integrated lightbulbs: removed ${removedCount} lightbulb attributes`);
  }

  /**
   * Check if diagnostic likely has quick fixes available
   */
  private diagnosticHasQuickFix(diagnostic: any): boolean {
    const source = diagnostic.source?.toLowerCase() || '';
    const message = diagnostic.message?.toLowerCase() || '';
    
    // Common sources that typically have quick fixes
    const quickFixSources = [
      'markdownlint',
      'eslint',
      'tslint',
      'pylint',
      'spell',
      'cspell'
    ];
    
    // Common message patterns that suggest quick fixes
    const quickFixPatterns = [
      'should be',
      'expected',
      'missing',
      'incorrect',
      'invalid',
      'unknown word',
      'misspelled',
      'fix available'
    ];
    
    return quickFixSources.some(s => source.includes(s)) ||
           quickFixPatterns.some(p => message.includes(p));
  }



    /**
     * Check if an element matches the diagnostic line content
     */
    private elementsMatch(element: HTMLElement, lineText: string, diagnostic: any): boolean {
        if (!lineText.trim()) return false;
        
        const elementText = element.textContent || '';
        const elementTextTrimmed = elementText.trim();
        const lineTextTrimmed = lineText.trim();
        
        
        // Direct match
        if (elementTextTrimmed === lineTextTrimmed) {
            return true;
        }
        
        // Element contains the line text
        if (elementTextTrimmed.includes(lineTextTrimmed)) {
            return true;
        }
        
        // Line text contains element text (for short elements)
        if (lineTextTrimmed.includes(elementTextTrimmed) && elementTextTrimmed.length > 3) {
            return true;
        }
        
        // For markdownlint MD041 (first line should be heading), match first non-empty element
        if (diagnostic.message?.includes('First line') && diagnostic.message?.includes('heading')) {
            // Check if this is the first significant element
            const parent = element.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children);
                const significantElements = siblings.filter(el => el.textContent?.trim().length > 0);
                if (significantElements[0] === element) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * Find element by searching text content
     */
    private findElementByTextContent(editor: HTMLElement, searchText: string, diagnostic: any): boolean {
        
        const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return node instanceof HTMLElement && 
                           node.textContent?.trim().includes(searchText.trim()) ? 
                           NodeFilter.FILTER_ACCEPT : 
                           NodeFilter.FILTER_SKIP;
                }
            }
        );

        let node;
        let found = false;
        while ((node = walker.nextNode()) !== null) {
            if (node instanceof HTMLElement) {
                this.applyDiagnosticStyleToElement(node, diagnostic);
                found = true;
                break; // Apply to first match only
            }
        }
        
        return found;
    }

    /**
     * Handle specific diagnostic patterns
     */
    private handleSpecificPatterns(editor: HTMLElement, diagnostic: any): boolean {
        const message = diagnostic.message || '';
        
        // MD041: First line should be heading
        if (message.includes('MD041') || (message.includes('First line') && message.includes('heading'))) {
            const firstChild = editor.firstElementChild;
            if (firstChild instanceof HTMLElement) {
                this.applyDiagnosticStyleToElement(firstChild, diagnostic);
                return true;
            }
        }
        
        // MD047: Files should end with newline
        if (message.includes('MD047') || message.includes('newline')) {
            const lastChild = editor.lastElementChild;
            if (lastChild instanceof HTMLElement) {
                this.applyDiagnosticStyleToElement(lastChild, diagnostic);
                return true;
            }
        }
        
        // Extract quoted text or code from message
        const patterns = this.extractPatternsFromMessage(message);
        for (const pattern of patterns) {
            const found = this.findElementByTextContent(editor, pattern, diagnostic);
            if (found) return true;
        }
        
        return false;
    }

    /**
     * Extract searchable patterns from diagnostic messages
     */
    private extractPatternsFromMessage(message: string): string[] {
        const patterns: string[] = [];
        
        // Extract quoted text
        const quotedText = message.match(/'([^']*)'/g);
        if (quotedText) {
            patterns.push(...quotedText.map(q => q.slice(1, -1))); // Remove quotes
        }
        
        // Extract text in backticks
        const backtickText = message.match(/`([^`]*)`/g);
        if (backtickText) {
            patterns.push(...backtickText.map(b => b.slice(1, -1))); // Remove backticks
        }
        
        return patterns;
    }

    /**
     * Find exact text matches in the DOM
     */
    private findExactTextMatch(editor: HTMLElement, searchText: string, diagnostic: any): boolean {
        
        const walker = document.createTreeWalker(
            editor,
            NodeFilter.SHOW_TEXT,
            null
        );

        let node;
        let found = false;
        while ((node = walker.nextNode()) !== null) {
            const text = node.textContent || '';
            if (text.includes(searchText)) {
                const parent = node.parentElement;
                if (parent) {
                    this.applyDiagnosticStyleToElement(parent, diagnostic);
                    found = true;
                    // Don't return here - we might want to highlight multiple matches
                }
            }
        }
        
        if (!found) {
            console.warn(`Text "${searchText}" not found in DOM`);
        }
        
        return found;
    }

    /**
     * Apply diagnostic style to a specific element
     */
    private applyDiagnosticStyleToElement(element: HTMLElement, diagnostic: any): void {
        const severity = this.getDiagnosticSeverityString(diagnostic.severity);
        const cssClass = `vscode-diagnostic-${severity}`;
        
        this.vscodeLog(`🔍 APPLYING DIAGNOSTIC: ${cssClass} to ${element.tagName}.${element.className} for "${diagnostic.message}"`);
        
        // Apply the diagnostic CSS class
        element.classList.add(cssClass);
        
        // Add diagnostic message as data attribute for CSS content
        const message = diagnostic.message || 'Diagnostic issue';
        element.setAttribute('data-diagnostic-message', message);
        element.setAttribute('data-diagnostic-source', diagnostic.source || '');
        
        // Add integrated tooltip and lightbulb directly to the element
        this.addHoverableTooltip(element, diagnostic);
        this.addIntegratedQuickFixLightbulb(element, diagnostic);
        
        // NOTE: Do NOT mark content elements with data-diagnostic-ui="true" 
        // Only true overlay elements (tooltips, lightbulbs) should have this attribute
        
        this.vscodeLog(`✅ Applied ${cssClass} to ${element.tagName} element`);
    }



    /**
     * Open VS Code problems panel for user to choose what to fix
     */
    private triggerQuickFix(diagnostic: any): void {
        this.vscodeLog(`🔧 Opening VS Code problems panel for: ${diagnostic.message}`);
        
        // Simply open the problems panel for the user to choose what to fix
        if ((window as any).vscode) {
            (window as any).vscode.postMessage({
                command: 'openProblemsPanel'
            });
            
            this.vscodeLog(`📤 Problems panel open request sent to VS Code`);
        } else {
            this.vscodeLog(`❌ VS Code API not available for opening problems panel`);
        }
    }

    /**
     * Convert VS Code diagnostic severity to string
     */
    private getDiagnosticSeverityString(severity: number): string {
        switch (severity) {
            case 1: return 'error';
            case 2: return 'warning';
            case 3: return 'information';
            case 4: return 'hint';
            default: return 'information';
        }
    }

    /**
     * Normalize URL for better matching
     */
    private normalizeUrl(url: string): string {
        return url?.trim().toLowerCase() || '';
    }

    /**
     * Update diagnostic visualizations from external source (VS Code extension)
     */
    public updateDiagnostics(diagnostics: any[], context?: { documentText?: string; documentLines?: number }): void {
        
        // Normalize diagnostic format - convert VS Code format to our internal format
        const normalizedDiagnostics = diagnostics.map(diag => this.normalizeDiagnostic(diag, context));
        
        // SMART DIAGNOSTIC COMPARISON: Check if diagnostics have actually changed
        const newDiagnosticsHash = this.generateDiagnosticsHashForArray(normalizedDiagnostics);
        const diagnosticsActuallyChanged = newDiagnosticsHash !== this.lastDiagnosticsHash;
        
        this.vscodeLog(`🔍 DIAGNOSTIC UPDATE: ${diagnostics.length} diagnostics, hash changed: ${diagnosticsActuallyChanged}`);
        
        // Process all diagnostics
        
        // SMART CHECK: Only update if diagnostics actually changed OR if visual elements are missing
        const visualElementsExist = this.verifyDiagnosticElementsExist();
        
        if (diagnosticsActuallyChanged || !this.diagnosticsApplied || !visualElementsExist) {
            this.vscodeLog(`🔄 Diagnostics update needed - changed: ${diagnosticsActuallyChanged}, applied: ${this.diagnosticsApplied}, visual: ${visualElementsExist}`);
            this.diagnostics = normalizedDiagnostics;
            this.scheduleUpdate();
        } else {
            this.vscodeLog(`✅ Diagnostics unchanged and visual elements exist - keeping existing visualization`);
            // Still update the diagnostics array in case there are minor differences
            this.diagnostics = normalizedDiagnostics;
        }
    }

    /**
     * Update diagnostic visualizations from external source
     */
    public updateFromExtension(diagnostics: any[]): void {
        this.scheduleUpdate();
    }

    /**
     * Simple pattern matching for broken links and images without alt text
     */
    public addSimpleDiagnostics(): void {
        const content = this.vditor?.getValue() || '';
        this.vscodeLog(`DiagnosticVisualizer: Checking content for simple diagnostics, length: ${content.length}`);
        
        // SMART CHECK: Only update if content changed significantly to prevent unnecessary updates
        if (content === this.lastContent) {
            this.vscodeLog('Content unchanged, skipping simple diagnostic update');
            return;
        }
        
        // Check if diagnostics are already applied and still valid
        if (this.diagnosticsApplied && this.wrappedKeys.size > 0) {
            this.vscodeLog(`Simple diagnostics already applied (${this.wrappedKeys.size} items), checking if still valid`);
            
            // Quick validation: if existing diagnostics are mostly still valid, skip update
            let editor = document.querySelector('.vditor-ir .vditor-reset') as HTMLElement;
            if (!editor) {
                editor = document.querySelector('.vditor-wysiwyg .vditor-reset') as HTMLElement;
            }
            if (editor) {
                const existingDiagnostics = editor.querySelectorAll('[class*="vscode-diagnostic-"]');
                if (existingDiagnostics.length > 0) {
                    this.vscodeLog(`Found ${existingDiagnostics.length} existing diagnostic elements - skipping simple diagnostic update`);
                    this.lastContent = content;
                    return;
                }
            }
        }
        
        this.lastContent = content;
        
        const lines = content.split('\n');
        const simpleDiagnostics: any[] = [];

        lines.forEach((line, index) => {
            // Check for broken links (simple heuristic)
            const linkRegex = /\[([^\]]*)\]\(([^)]*)\)/g;
            let linkMatch;
            while ((linkMatch = linkRegex.exec(line)) !== null) {
                const url = linkMatch[2] || '';
                const fullMatch = linkMatch[0]; // Store the full markdown link text
                
                if (url && !this.isValidUrl(url)) {
                    simpleDiagnostics.push({
                        message: `Potentially broken link: ${url}`,
                        severity: 2, // Warning
                        matchedText: fullMatch, // Add the full markdown text for matching
                        range: {
                            start: { line: index, character: linkMatch.index },
                            end: { line: index, character: linkMatch.index + linkMatch[0].length }
                        }
                    });
                }
            }

            // Check for images without alt text
            const imageRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
            let imageMatch;
            while ((imageMatch = imageRegex.exec(line)) !== null) {
                const altText = imageMatch[1] || '';
                const fullMatch = imageMatch[0]; // Store the full markdown image text
                
                if (!altText.trim()) {
                    simpleDiagnostics.push({
                        message: 'Image missing alt text for accessibility',
                        severity: 3, // Information
                        matchedText: fullMatch, // Add the full markdown text for matching
                        range: {
                            start: { line: index, character: imageMatch.index },
                            end: { line: index, character: imageMatch.index + imageMatch[0].length }
                        }
                    });
                }
            }
        });

        this.vscodeLog(`DiagnosticVisualizer: Generated ${simpleDiagnostics.length} simple diagnostics`);
        
        // Only apply if we actually found diagnostics or need to clear existing ones
        if (simpleDiagnostics.length > 0 || this.diagnostics.length > 0) {
            this.applyDiagnosticsToEditor(simpleDiagnostics);
        } else {
            this.vscodeLog(`No simple diagnostics found and no existing diagnostics to clear`);
        }
    }

    /**
     * Simple URL validation
     */
    private isValidUrl(url: string): boolean {
        if (!url || url.trim() === '') {
            return false;
        }
        
        // Allow relative paths and anchors
        if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
            return true;
        }
        
        // Check for common file extensions that might exist
        const commonExtensions = ['.md', '.txt', '.html', '.htm', '.pdf', '.doc', '.docx'];
        if (commonExtensions.some(ext => url.toLowerCase().includes(ext))) {
            // Only mark as valid if it looks like a real relative path
            if (!url.includes('://')) {
                return false;
            }
        }
        
        // Basic URL format check
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Prepare and sort diagnostics by line number for efficient processing
     */
    private prepareSortedDiagnostics(): Array<{diagnostic: any, lineNumber: number, lineText: string}> {
        const validDiagnostics: Array<{diagnostic: any, lineNumber: number, lineText: string}> = [];
        
        // Basic de-duplication: ensure each (rangeStart, rangeEnd, message) triple only applied once
        const seen = new Set<string>();
        
        for (const diagnostic of this.diagnostics) {
            // Create deduplication key
            const key = `${diagnostic.range?.start?.line}:${diagnostic.range?.start?.character}-${diagnostic.range?.end?.line}:${diagnostic.range?.end?.character}|${diagnostic.message}|${diagnostic.code || ''}`;
            if (seen.has(key)) {
                this.vscodeLog(`🧪 De-dup skipped duplicate diagnostic: ${diagnostic.message}`);
                continue;
            }
            seen.add(key);
            
            // Only include diagnostics with valid line information
            const lineNumber = diagnostic.range?.start?.line;
            const lineText = diagnostic.lineText || '';
            
            if (lineNumber !== undefined && lineText.trim()) {
                // Filter to only high-confidence diagnostics to avoid false positives
                if (this.isHighConfidenceDiagnostic(diagnostic)) {
                    validDiagnostics.push({
                        diagnostic,
                        lineNumber,
                        lineText: lineText.trim()
                    });
                } else {
                    this.vscodeLog(`⚠️ Skipped low-confidence diagnostic: ${diagnostic.message}`);
                }
            } else {
                this.vscodeLog(`⚠️ Skipped diagnostic without line info: ${diagnostic.message}`);
            }
        }
        
        // Sort by line number for efficient processing
        validDiagnostics.sort((a, b) => a.lineNumber - b.lineNumber);
        
        this.vscodeLog(`📋 Prepared ${validDiagnostics.length} sorted diagnostics from ${this.diagnostics.length} total`);
        return validDiagnostics;
    }

    /**
     * Get markdown block elements that could represent lines in the document
     */
    private getMarkdownBlockElements(editor: HTMLElement): Array<{element: HTMLElement, index: number}> {
        const blockElements: Array<{element: HTMLElement, index: number}> = [];
        
        // Selectors for block elements that typically represent markdown lines
        const blockSelectors = [
            'p',           // Paragraphs
            'h1, h2, h3, h4, h5, h6',  // Headings
            'li',          // List items
            'blockquote',  // Block quotes
            'pre',         // Code blocks
            'div.vditor-ir__node',  // Vditor IR nodes
            'div.vditor-ir__marker' // Vditor IR markers
        ];
        
        let index = 0;
        for (const selector of blockSelectors) {
            const elements = Array.from(editor.querySelectorAll(selector));
            for (const element of elements) {
                const htmlElement = element as HTMLElement;
                const text = htmlElement.textContent || '';
                
                // Only include elements with meaningful text content
                if (text.trim().length > 0) {
                    blockElements.push({
                        element: htmlElement,
                        index: index++
                    });
                }
            }
        }
        
        // Sort by DOM position to maintain document order
        blockElements.sort((a, b) => {
            const position = a.element.compareDocumentPosition(b.element);
            if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
                return -1; // a comes before b
            } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
                return 1;  // a comes after b
            }
            return 0; // same position
        });
        
        // Update indices after sorting
        blockElements.forEach((item, idx) => {
            item.index = idx;
        });
        
        this.vscodeLog(`🏗️ Found ${blockElements.length} block elements representing document structure`);
        return blockElements;
    }

    /**
     * Check if target text appears as a complete word (not part of another word)
     */
    private isCompleteWord(text: string, targetText: string, startIndex: number): boolean {
        const beforeChar = startIndex > 0 ? text[startIndex - 1] : ' ';
        const afterIndex = startIndex + targetText.length;
        const afterChar = afterIndex < text.length ? text[afterIndex] : ' ';
        
        // Word boundary characters (whitespace, punctuation)
        const wordBoundary = /[\s\W]/;
        
        return wordBoundary.test(beforeChar) && wordBoundary.test(afterChar);
    }

    /**
     * Check if element text closely matches the expected line text
     */
    private isExactLineMatch(elementText: string, lineText: string): boolean {
        const cleanElement = elementText.trim().replace(/\s+/g, ' ');
        const cleanLine = lineText.trim().replace(/\s+/g, ' ');
        return cleanElement === cleanLine;
    }

    /**
     * Match diagnostics to DOM elements using content-based matching
     */
    private matchDiagnosticsToElements(
        blockElements: Array<{element: HTMLElement, index: number}>,
        sortedDiagnostics: Array<{diagnostic: any, lineNumber: number, lineText: string}>
    ): void {
        this.vscodeLog(`🎯 Starting content-based matching: ${blockElements.length} elements vs ${sortedDiagnostics.length} diagnostics`);
        
        let appliedCount = 0;
        
        // Strategy: For each diagnostic, find the element that contains its target text
        for (const {diagnostic, lineNumber, lineText} of sortedDiagnostics) {
            const range = diagnostic.range;
            const startChar = range?.start?.character || 0;
            const endChar = range?.end?.character || startChar + 1;
            const targetText = lineText.substring(startChar, endChar);
            
            if (!targetText.trim()) {
                this.vscodeLog(`❌ Skipping diagnostic - no target text from range ${startChar}-${endChar} in line: "${lineText}"`);
                continue;
            }
            
            // Validate that the target text actually appears in the line at the expected position
            if (lineText.substring(startChar, endChar) !== targetText) {
                this.vscodeLog(`❌ Skipping diagnostic - target text "${targetText}" doesn't match line text at position ${startChar}-${endChar}: "${lineText.substring(startChar, endChar)}"`);
                continue;
            }
            
            this.vscodeLog(`🔍 Finding element for line ${lineNumber} diagnostic: "${targetText}" from "${lineText}"`);
            
            let bestMatch: {element: HTMLElement, index: number, confidence: number, matchType: string} | null = null;
            
            // Find elements that contain the target text with word boundary validation
            for (let i = 0; i < blockElements.length; i++) {
                const {element, index} = blockElements[i];
                const elementText = element.textContent || '';
                
                // Check if element contains the target text
                const targetIndex = elementText.indexOf(targetText);
                if (targetIndex === -1) {
                    continue;
                }
                
                // CRITICAL: Validate word boundaries to prevent partial matches
                if (!this.isCompleteWord(elementText, targetText, targetIndex)) {
                    this.vscodeLog(`❌ Rejected partial word match: "${targetText}" in "${elementText.substring(Math.max(0, targetIndex-10), targetIndex+targetText.length+10)}"`);
                    continue;
                }
                
                // Check if this element already has a diagnostic applied for the same token
                const tokenKey = `${lineNumber}|${targetText}`;
                if (this.wrappedKeys.has(tokenKey)) {
                    this.vscodeLog(`⚠️ Element already has diagnostic for "${targetText}" on line ${lineNumber}, skipping`);
                    continue;
                }
                
                // Additional check: prevent applying diagnostics to elements that already have overlapping ranges
                // Only check for overlaps on the SAME element - different elements can have same char ranges
                if (this.hasOverlappingDiagnostic(element, startChar, endChar, lineNumber, diagnostic)) {
                    this.vscodeLog(`⚠️ Element ${index} already has overlapping diagnostic for chars ${startChar}-${endChar}, skipping`);
                    continue;
                }
                
                let confidence = 0;
                let matchType = '';
                
                // PRIORITY 1: Exact line text match (highest priority)
                if (this.isExactLineMatch(elementText, lineText)) {
                    confidence = 1000;  // Very high base score
                    matchType = 'exact-line-match';
                }
                // PRIORITY 2: Perfect line match (trimmed comparison)
                else if (elementText.trim() === lineText.trim()) {
                    confidence = 900;   // Very high base score
                    matchType = 'perfect-line-match';
                }
                // PRIORITY 3: Line contained in element (for multi-line elements)
                else if (elementText.includes(lineText.trim())) {
                    confidence = 500;   // High base score
                    matchType = 'line-contained';
                }
                // PRIORITY 4: Target text found with word boundaries (minimum requirement)
                else {
                    confidence = 250;   // Higher base score to account for proximity penalties
                    matchType = 'target-text-found';
                }
                
                // Position-based scoring with line number preference
                const positionDifference = Math.abs(lineNumber - index);
                
                // More balanced proximity scoring - less harsh penalties
                let proximityBonus = 0;
                if (positionDifference === 0) {
                    proximityBonus = 300;  // Perfect line number match
                } else if (positionDifference <= 1) {
                    proximityBonus = 100;  // Very close (±1 line)
                } else if (positionDifference <= 3) {
                    proximityBonus = 50;   // Reasonably close (±3 lines)
                } else if (positionDifference <= 5) {
                    proximityBonus = 20;   // Moderately close (±5 lines)
                } else if (positionDifference <= 10) {
                    proximityBonus = 0;    // Neutral for medium distance
                } else {
                    // Gentle penalty for being very far from expected line
                    proximityBonus = -Math.min(30, (positionDifference - 10) * 2);
                }
                
                // BONUS: Extra points for exact line number alignment
                if (index === lineNumber) {
                    proximityBonus += 50;  // Bonus for exact line number match
                }
                
                // ADDITIONAL: Character position bonus for multiple occurrences of same word
                // If the same word appears multiple times in the element, prefer the occurrence
                // that's closest to the expected character position within the line
                const expectedCharPos = startChar;
                const targetOccurrences = [];
                let searchPos = 0;
                while ((searchPos = elementText.indexOf(targetText, searchPos)) !== -1) {
                    targetOccurrences.push(searchPos);
                    searchPos += targetText.length;
                }
                
                let charPositionBonus = 0;
                if (targetOccurrences.length > 1) {
                    // Find the occurrence closest to the expected character position
                    const bestOccurrence = targetOccurrences.reduce((best, current) => {
                        const currentDiff = Math.abs(current - expectedCharPos);
                        const bestDiff = Math.abs(best - expectedCharPos);
                        return currentDiff < bestDiff ? current : best;
                    });
                    
                    const charPosDiff = Math.abs(bestOccurrence - expectedCharPos);
                    if (charPosDiff <= 5) {
                        charPositionBonus = 100;  // Very close character position
                    } else if (charPosDiff <= 20) {
                        charPositionBonus = 25;   // Reasonably close
                    }
                    
                    this.vscodeLog(`📍 Multiple "${targetText}" occurrences at positions: [${targetOccurrences.join(', ')}], expected: ${expectedCharPos}, best: ${bestOccurrence}, bonus: ${charPositionBonus}`);
                }
                
                confidence += proximityBonus + charPositionBonus;
                
                this.vscodeLog(`🎯 Element ${index} contains "${targetText}" - confidence: ${confidence.toFixed(1)} (${matchType}) pos-diff: ${positionDifference} proximity-bonus: ${proximityBonus} char-bonus: ${charPositionBonus} line-match: ${index === lineNumber}`);
                
                // Prefer matches with better match types, then higher confidence
                if (!bestMatch || 
                    confidence > bestMatch.confidence ||
                    (confidence === bestMatch.confidence && matchType === 'exact-line-match')) {
                    bestMatch = {element, index, confidence, matchType};
                }
            }
            
            // Apply diagnostic if we found a good match - prioritize exact line matches
            // For target-text-found matches, be more lenient since word boundaries are now validated
            const isStrictMatch = bestMatch?.matchType === 'exact-line-match' || bestMatch?.matchType === 'perfect-line-match';
            const isLineContained = bestMatch?.matchType === 'line-contained';
            const isReasonableProximity = bestMatch ? Math.abs(lineNumber - bestMatch.index) <= 15 : false;
            
            // More lenient acceptance criteria since we now have word boundary validation
            if (bestMatch && (isStrictMatch || isLineContained || (bestMatch.confidence >= 100 && isReasonableProximity))) {
                this.vscodeLog(`✅ SELECTED: Element ${bestMatch.index} with confidence ${bestMatch.confidence.toFixed(1)} (${bestMatch.matchType})`);
                
                const matchResult = {
                    matched: true,
                    confidence: bestMatch.confidence,
                    matchType: bestMatch.matchType,
                    targetText: targetText,
                    charRange: {start: startChar, end: endChar}
                };
                
                if (this.applyDiagnosticToMatchedElement(bestMatch.element, diagnostic, matchResult)) {
                    appliedCount++;
                    this.vscodeLog(`🎨 Applied diagnostic "${diagnostic.message}" to element ${bestMatch.index}`);
                } else {
                    this.vscodeLog(`❌ Failed to apply diagnostic despite good match`);
                }
            } else {
                // FALLBACK: If we have a word-boundary validated match but it's just below threshold, be more lenient
                if (bestMatch && bestMatch.confidence >= 80) {
                    this.vscodeLog(`🟡 FALLBACK MATCH: Applying lower-confidence match for "${targetText}" (confidence: ${bestMatch.confidence.toFixed(1)})`);
                    
                    const matchResult = {
                        matched: true,
                        confidence: bestMatch.confidence,
                        matchType: bestMatch.matchType,
                        targetText: targetText,
                        charRange: {start: startChar, end: endChar}
                    };
                    
                    if (this.applyDiagnosticToMatchedElement(bestMatch.element, diagnostic, matchResult)) {
                        appliedCount++;
                        this.vscodeLog(`🎨 Applied fallback diagnostic "${diagnostic.message}" to element ${bestMatch.index}`);
                    } else {
                        this.vscodeLog(`❌ Failed to apply fallback diagnostic despite match`);
                    }
                } else {
                    const reason = bestMatch ? 
                        `confidence ${bestMatch.confidence.toFixed(1)} < 100 or proximity ${Math.abs(lineNumber - bestMatch.index)} > 15` : 
                        'no match found';
                    this.vscodeLog(`❌ NO SUITABLE MATCH: Best confidence was ${bestMatch?.confidence?.toFixed(1) || 0} for "${targetText}" on line ${lineNumber} (${reason})`);
                    
                    // Log some elements that might have been close
                    for (let i = Math.max(0, lineNumber - 3); i < Math.min(blockElements.length, lineNumber + 3); i++) {
                        if (i < blockElements.length) {
                            const elementText = (blockElements[i].element.textContent || '').substring(0, 50);
                            this.vscodeLog(`📍 Element ${i}: "${elementText}${elementText.length >= 50 ? '...' : ''}"`);
                        }
                    }
                }
            }
        }
        
        this.vscodeLog(`📊 Content-based matching completed: ${appliedCount}/${sortedDiagnostics.length} diagnostics applied`);
    }

    /**
     * Try to match a diagnostic to a specific DOM element using precise character ranges
     */
    private tryMatchDiagnosticToElement(
        element: HTMLElement,
        diagnostic: any,
        lineText: string,
        positionDifference: number
    ): {matched: boolean, confidence: number, matchType: string, targetText?: string, charRange?: {start: number, end: number}} {
        const elementText = element.textContent || '';
        const range = diagnostic.range;
        const lineNumber = range?.start?.line;
        
        // Extract precise target text from character range
        const startChar = range?.start?.character || 0;
        const endChar = range?.end?.character || startChar + 1;
        const targetText = lineText.substring(startChar, endChar);
        
        if (!targetText.trim()) {
            this.vscodeLog(`❌ No target text extracted from range ${startChar}-${endChar} in line: "${lineText}"`);
            return {matched: false, confidence: 0, matchType: 'no-target-text'};
        }
        
        this.vscodeLog(`🎯 Looking for precise target text: "${targetText}" (chars ${startChar}-${endChar}) in element: "${elementText.substring(0, 100)}..."`);
        
        // Check if this diagnostic range would overlap with already applied diagnostics
        if (this.hasOverlappingDiagnostic(element, startChar, endChar, lineNumber, diagnostic)) {
            this.vscodeLog(`⚠️ Skipping diagnostic - overlaps with already applied diagnostic`);
            return {matched: false, confidence: 0, matchType: 'overlap-conflict'};
        }
        
        let confidence = 0;
        let matchType = 'none';
        
        // Strategy 1: Check if element contains the target text
        const targetIndex = elementText.indexOf(targetText);
        if (targetIndex !== -1) {
            confidence = 95;
            matchType = 'exact-target-match';
            this.vscodeLog(`✅ Found exact target text "${targetText}" at position ${targetIndex} in element`);
        }
        // Strategy 2: Case-insensitive search for target text
        else {
            const targetIndexCI = elementText.toLowerCase().indexOf(targetText.toLowerCase());
            if (targetIndexCI !== -1) {
                confidence = 90;
                matchType = 'case-insensitive-target';
                this.vscodeLog(`✅ Found case-insensitive target text "${targetText}" at position ${targetIndexCI} in element`);
            }
        }
        
        // Strategy 3: STRICT element-to-line matching - only if target text can be found
        if (confidence === 0) {
            // CRITICAL: Only match elements that actually contain the target text
            // This prevents wrong elements from being matched via fuzzy logic
            
            // First, verify line text contains target text (sanity check)
            if (!lineText.includes(targetText)) {
                this.vscodeLog(`❌ VALIDATION FAILED: Target text "${targetText}" not found in line text "${lineText}"`);
                return {matched: false, confidence: 0, matchType: 'target-not-in-line'};
            }
            
            // Check if element text matches or contains the full line AND can find target text
            if (elementText.trim() === lineText.trim()) {
                // Double-check target text exists in element
                if (elementText.includes(targetText)) {
                    confidence = 85;
                    matchType = 'full-line-exact';
                    this.vscodeLog(`✅ Element matches full line text exactly AND contains target`);
                } else {
                    this.vscodeLog(`❌ STRICT CHECK FAILED: Element matches line but missing target text "${targetText}"`);
                }
            } else if (elementText.includes(lineText.trim()) && elementText.includes(targetText)) {
                confidence = 75;
                matchType = 'full-line-contains';
                this.vscodeLog(`✅ Element contains full line text AND target text`);
            } else if (elementText.includes(targetText) && this.fuzzyLineMatch(elementText, lineText)) {
                // STRICT: Only allow fuzzy match if target text is actually present in element
                confidence = 65;
                matchType = 'full-line-fuzzy-with-target';
                this.vscodeLog(`✅ Element matches line via fuzzy matching AND contains target text`);
            } else {
                // REJECTED: Element doesn't contain target text
                this.vscodeLog(`❌ STRICT REJECTION: Element doesn't contain target text "${targetText}"`);
            }
        }
        
        // Strategy 4: Try html2md conversion for better matching
        if (confidence === 0 && this.vditor && typeof this.vditor.html2md === 'function') {
            try {
                const elementMd = this.vditor.html2md(element.outerHTML || '');
                const targetInMd = elementMd.indexOf(targetText);
                if (targetInMd !== -1) {
                    confidence = 80;
                    matchType = 'html2md-target-match';
                    this.vscodeLog(`✅ Found target text "${targetText}" in html2md converted element`);
                } else if (elementMd.trim() === lineText.trim() && lineText.includes(targetText)) {
                    confidence = 70;
                    matchType = 'html2md-line-match';
                    this.vscodeLog(`✅ html2md element matches line text and line contains target`);
                }
            } catch (e) {
                this.vscodeLog(`❌ html2md conversion failed: ${e}`);
            }
        }
        
        // Adjust confidence based on position proximity
        const positionBonus = Math.max(0, 15 * (1 - positionDifference * 2));
        confidence += positionBonus;
        
        // Element type bonus
        if (element.tagName.match(/^H[1-6]$/)) {
            confidence += 10; // Headings are reliable anchors
        } else if (element.tagName === 'P') {
            confidence += 8;  // Paragraphs are good anchors
        } else if (element.tagName === 'LI') {
            confidence += 6;  // List items are decent anchors
        }
        
        const matched = confidence >= 70; // Higher threshold for precision
        
        if (matched) {
            this.vscodeLog(`🎯 Match found: ${matchType} (confidence: ${confidence.toFixed(1)}, target: "${targetText}")`);
            return {
                matched, 
                confidence, 
                matchType, 
                targetText,
                charRange: {start: startChar, end: endChar}
            };
        } else {
            this.vscodeLog(`❌ No match: ${matchType} (confidence: ${confidence.toFixed(1)})`);
            return {matched: false, confidence, matchType};
        }
    }

    /**
     * Apply diagnostic styling to a matched element using precise character ranges
     */
    private applyDiagnosticToMatchedElement(
        element: HTMLElement,
        diagnostic: any,
        matchResult: {matched: boolean, confidence: number, matchType: string, targetText?: string, charRange?: {start: number, end: number}}
    ): boolean {
        const range = diagnostic.range;
        const lineText = diagnostic.lineText || '';
        const lineNumber = range?.start?.line;
        
        if (!range || !lineText.trim()) {
            this.vscodeLog(`❌ Cannot apply diagnostic: missing range or lineText`);
            return false;
        }
        
        const startChar = range.start?.character || 0;
        const endChar = range.end?.character || startChar + 1;
        const targetText = matchResult.targetText || lineText.substring(startChar, endChar).trim();
        
        if (!targetText) {
            this.vscodeLog(`❌ Cannot apply diagnostic: no target text identified`);
            return false;
        }
        
        this.vscodeLog(`🎨 Applying diagnostic to element: targeting "${targetText}" (chars ${startChar}-${endChar})`);
        
        // Try to find and wrap the specific target text within the element
        const applied = this.findAndWrapPreciseTextInElement(element, targetText, diagnostic, startChar, endChar);
        
        if (applied) {
            // Record that this diagnostic has been applied to prevent overlaps
            this.recordAppliedDiagnostic(element, startChar, endChar, lineNumber, diagnostic);
            this.vscodeLog(`✅ Successfully applied diagnostic: "${diagnostic.message}"`);
        } else {
            this.vscodeLog(`❌ Failed to apply diagnostic: could not locate target text "${targetText}"`);
        }
        
        return applied;
    }

    /**
     * Find and wrap specific text within an element with diagnostic styling
     */
    private findAndWrapTextInElement(element: HTMLElement, targetText: string, diagnostic: any): boolean {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null
        );
        
        let textNode: Text | null;
        while ((textNode = walker.nextNode() as Text)) {
            const content = textNode.textContent || '';
            const index = content.indexOf(targetText);
            
            if (index !== -1) {
                // Found the target text, wrap it
                return this.wrapTextWithDiagnostic(textNode, index, index + targetText.length, diagnostic);
            }
        }
        
        // Fallback: apply styling to entire element
        this.addDiagnosticStylingToElement(element, diagnostic);
        return true;
    }

    /**
     * Find and wrap precise text within an element using character position awareness
     */
    private findAndWrapPreciseTextInElement(
        element: HTMLElement,
        targetText: string,
        diagnostic: any,
        originalStartChar: number,
        originalEndChar: number
    ): boolean {
        const elementText = element.textContent || '';
        this.vscodeLog(`🔍 Precise search for "${targetText}" in element text: "${elementText.substring(0, 100)}..."`);
        
        // Strategy 1: Direct search for target text
        let targetIndex = elementText.indexOf(targetText);
        
        // Strategy 2: If multiple occurrences, try to find the right one based on character position
        if (targetIndex !== -1) {
            const allOccurrences: number[] = [];
            let searchIndex = 0;
            
            // Find all occurrences of the target text
            while ((searchIndex = elementText.indexOf(targetText, searchIndex)) !== -1) {
                allOccurrences.push(searchIndex);
                searchIndex += targetText.length;
            }
            
            this.vscodeLog(`🔍 Found ${allOccurrences.length} occurrences of "${targetText}" at positions: [${allOccurrences.join(', ')}]`);
            
            if (allOccurrences.length > 1) {
                // Multiple occurrences - try to find the best match based on character position
                targetIndex = this.selectBestOccurrenceByPosition(
                    allOccurrences,
                    originalStartChar,
                    elementText,
                    targetText
                );
                this.vscodeLog(`🎯 Selected occurrence at position ${targetIndex} based on character position analysis`);
            }
        }
        
        // Strategy 3: Case-insensitive search if exact search failed
        if (targetIndex === -1) {
            const lowerElementText = elementText.toLowerCase();
            const lowerTargetText = targetText.toLowerCase();
            targetIndex = lowerElementText.indexOf(lowerTargetText);
            
            if (targetIndex !== -1) {
                this.vscodeLog(`🔍 Found case-insensitive match at position ${targetIndex}`);
                // Update targetText to match the actual case in the element
                targetText = elementText.substring(targetIndex, targetIndex + targetText.length);
            }
        }
        
        if (targetIndex === -1) {
            this.vscodeLog(`❌ Target text "${targetText}" not found in element text`);
            // Fallback: apply styling to entire element
            this.addDiagnosticStylingToElement(element, diagnostic);
            return true;
        }
        
        // Find the text node containing the target text and wrap it
        return this.wrapTextAtPositionInElement(element, targetIndex, targetText.length, diagnostic);
    }

    /**
     * Select the best occurrence of target text when multiple matches exist
     */
    private selectBestOccurrenceByPosition(
        occurrences: number[],
        originalCharPosition: number,
        elementText: string,
        targetText: string
    ): number {
        // Strategy: Find the occurrence closest to the expected character position
        let bestIndex = occurrences[0];
        let bestDistance = Math.abs(occurrences[0] - originalCharPosition);
        
        for (const occurrence of occurrences) {
            const distance = Math.abs(occurrence - originalCharPosition);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = occurrence;
            }
        }
        
        this.vscodeLog(`🎯 Best occurrence analysis: target char ${originalCharPosition}, selected position ${bestIndex} (distance: ${bestDistance})`);
        
        // Additional context-based filtering for common cases
        if (bestDistance > 10 && occurrences.length > 1) {
            // If the best match is still far, try context-based selection
            bestIndex = this.selectOccurrenceByContext(occurrences, originalCharPosition, elementText, targetText);
        }
        
        return bestIndex;
    }

    /**
     * Select occurrence based on surrounding context (for cases like "i" vs "I")
     */
    private selectOccurrenceByContext(
        occurrences: number[],
        originalCharPosition: number,
        elementText: string,
        targetText: string
    ): number {
        // For single character matches (like "i"), prefer occurrences that match case and context
        if (targetText.length === 1) {
            const char = targetText;
            
            for (const occurrence of occurrences) {
                const beforeChar = occurrence > 0 ? elementText[occurrence - 1] : ' ';
                const afterChar = occurrence < elementText.length - 1 ? elementText[occurrence + 1] : ' ';
                
                // For lowercase letters, prefer occurrences that are mid-word (not at sentence start)
                if (char === char.toLowerCase() && char !== char.toUpperCase()) {
                    if (beforeChar !== ' ' && beforeChar !== '.' && beforeChar !== '!' && beforeChar !== '?') {
                        this.vscodeLog(`🎯 Selected occurrence at ${occurrence} - mid-word lowercase context`);
                        return occurrence;
                    }
                }
                
                // For uppercase letters, prefer occurrences at word/sentence start
                if (char === char.toUpperCase() && char !== char.toLowerCase()) {
                    if (beforeChar === ' ' || beforeChar === '.' || beforeChar === '!' || beforeChar === '?' || occurrence === 0) {
                        this.vscodeLog(`🎯 Selected occurrence at ${occurrence} - sentence-start uppercase context`);
                        return occurrence;
                    }
                }
            }
        }
        
        // Fallback: return closest to original position
        return occurrences.reduce((best, current) => 
            Math.abs(current - originalCharPosition) < Math.abs(best - originalCharPosition) ? current : best
        );
    }

    /**
     * Wrap text at a specific position within an element
     */
    private wrapTextAtPositionInElement(
        element: HTMLElement,
        position: number,
        length: number,
        diagnostic: any
    ): boolean {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null
        );
        
        let currentPosition = 0;
        let textNode: Text | null;
        
        while ((textNode = walker.nextNode() as Text)) {
            const content = textNode.textContent || '';
            const nodeEnd = currentPosition + content.length;
            
            // Check if the target position is within this text node
            if (position >= currentPosition && position < nodeEnd) {
                const relativeStart = position - currentPosition;
                const relativeEnd = Math.min(relativeStart + length, content.length);
                
                this.vscodeLog(`🎨 Wrapping text in node at relative position ${relativeStart}-${relativeEnd}: "${content.substring(relativeStart, relativeEnd)}"`);
                return this.wrapTextWithDiagnostic(textNode, relativeStart, relativeEnd, diagnostic);
            }
            
            currentPosition = nodeEnd;
        }
        
        this.vscodeLog(`❌ Could not find text node containing position ${position}`);
        return false;
    }

    /**
     * Add diagnostic styling to an entire element
     */
    private addDiagnosticStylingToElement(element: HTMLElement, diagnostic: any): void {
        const severityClass = this.getSeverityClass(diagnostic.severity || 1);
        element.classList.add(severityClass);
        
        // Add hover tooltip
        this.addHoverableTooltip(element, diagnostic);
        
        this.vscodeLog(`🎨 Added diagnostic styling to entire element: ${element.tagName}`);
    }

    /**
     * Check if a diagnostic would overlap with already applied diagnostics on the same element
     */
    private hasOverlappingDiagnostic(
        element: HTMLElement, 
        startChar: number, 
        endChar: number, 
        lineNumber: number | undefined,
        diagnostic: any
    ): boolean {
        if (!this.appliedDiagnostics.has(element)) {
            return false;
        }
        
        const diagnosticId = this.generateDiagnosticId(diagnostic);
        const appliedList = this.appliedDiagnostics.get(element)!;
        
        for (const applied of appliedList) {
            // Skip if it's the same diagnostic
            if (applied.diagnosticId === diagnosticId) {
                continue;
            }
            
            // Check for character range overlap
            const hasCharOverlap = (startChar < applied.endChar && endChar > applied.startChar);
            
            // Check for line number conflict (different line numbers shouldn't share same element range)
            const hasDifferentLine = lineNumber !== undefined && 
                                   applied.lineNumber !== undefined && 
                                   lineNumber !== applied.lineNumber;
            
            if (hasCharOverlap) {
                this.vscodeLog(`🚫 Character range overlap detected: new(${startChar}-${endChar}) vs applied(${applied.startChar}-${applied.endChar})`);
                return true;
            }
            
            if (hasDifferentLine && hasCharOverlap) {
                this.vscodeLog(`🚫 Different line numbers with overlapping ranges: line ${lineNumber} vs line ${applied.lineNumber}`);
                return true;
            }
        }
        
        return false;
    }

    /**
     * Generate a unique ID for a diagnostic for tracking purposes
     */
    private generateDiagnosticId(diagnostic: any): string {
        const range = diagnostic.range;
        const startLine = range?.start?.line || 0;
        const startChar = range?.start?.character || 0;
        const endLine = range?.end?.line || 0;
        const endChar = range?.end?.character || 0;
        const message = diagnostic.message || '';
        const code = diagnostic.code || '';
        
        return `${startLine}:${startChar}-${endLine}:${endChar}|${message}|${code}`;
    }

    /**
     * Record that a diagnostic has been applied to an element at specific character range
     */
    private recordAppliedDiagnostic(
        element: HTMLElement,
        startChar: number,
        endChar: number,
        lineNumber: number | undefined,
        diagnostic: any
    ): void {
        const diagnosticId = this.generateDiagnosticId(diagnostic);
        
        if (!this.appliedDiagnostics.has(element)) {
            this.appliedDiagnostics.set(element, []);
        }
        
        this.appliedDiagnostics.get(element)!.push({
            startChar,
            endChar,
            lineNumber: lineNumber || -1,
            diagnosticId
        });
        
        // Also track element by line number for efficient lookups
        if (lineNumber !== undefined) {
            if (!this.elementsByLine.has(lineNumber)) {
                this.elementsByLine.set(lineNumber, []);
            }
            if (!this.elementsByLine.get(lineNumber)!.includes(element)) {
                this.elementsByLine.get(lineNumber)!.push(element);
            }
        }
        
        this.vscodeLog(`📝 Recorded applied diagnostic: ${diagnosticId} at chars ${startChar}-${endChar} on line ${lineNumber}`);
    }

    /**
     * Clear all applied diagnostic tracking (call when content changes)
     */
    private clearAppliedDiagnosticTracking(): void {
        this.appliedDiagnostics.clear();
        this.elementsByLine.clear();
        this.diagnosticsApplied = false;
        this.lastDiagnosticsHash = '';
        // CRITICAL: Also clear duplicate detection state
        this.wrappedKeys.clear();
        this.tokenSpanCache.clear();
        this.tokenDiagnostics.clear();
        this.vscodeLog(`🧹 Cleared applied diagnostic tracking and duplicate detection state`);
    }

    /**
     * Generate a hash of current diagnostics to detect changes
     */
    private generateDiagnosticsHash(): string {
        return this.generateDiagnosticsHashForArray(this.diagnostics);
    }

    /**
     * Generate a hash for a specific array of diagnostics
     */
    private generateDiagnosticsHashForArray(diagnostics: any[]): string {
        if (!diagnostics || diagnostics.length === 0) {
            return '';
        }
        
        // Create a stable hash based on diagnostic properties
        const diagnosticStrings = diagnostics.map(diag => {
            return `${diag.message}|${diag.source}|${diag.severity}|${diag.range?.start?.line}|${diag.range?.start?.character}|${diag.range?.end?.line}|${diag.range?.end?.character}`;
        }).sort(); // Sort to ensure consistent hash regardless of order
        
        return diagnosticStrings.join(':::');
    }

    /**
     * Verify that diagnostic elements actually exist in the DOM
     * This prevents the "applied but invisible" state mismatch
     */
    private verifyDiagnosticElementsExist(): boolean {
        if (!this.diagnosticsApplied || this.diagnostics.length === 0) {
            this.vscodeLog(`🔍 DOM VERIFY: No diagnostics expected (applied: ${this.diagnosticsApplied}, count: ${this.diagnostics.length})`);
            return true; // No diagnostics expected, so this is "correct"
        }

        let editor = document.querySelector('.vditor-ir .vditor-reset') as HTMLElement;
        if (!editor) {
            editor = document.querySelector('.vditor-wysiwyg .vditor-reset') as HTMLElement;
        }
        if (!editor) {
            editor = document.querySelector('.vditor-sv .vditor-reset') as HTMLElement;
        }
        
        if (!editor) {
            this.vscodeLog(`❌ DOM VERIFY: Could not find editor element`);
            return false;
        }
        
        // Check if diagnostic elements actually exist in the DOM
        const diagnosticElements = editor.querySelectorAll('[class*="vscode-diagnostic-"]');
        const wrappedKeysCount = this.wrappedKeys.size;
        
        this.vscodeLog(`🔍 DOM VERIFY: Found ${diagnosticElements.length} DOM elements, expected ${this.diagnostics.length} diagnostics, wrapped keys: ${wrappedKeysCount}`);
        
        // If we expect diagnostics but have no DOM elements, something cleared them
        if (this.diagnostics.length > 0 && diagnosticElements.length === 0) {
            this.vscodeLog(`❌ DOM VERIFY: Expected ${this.diagnostics.length} diagnostics but found 0 DOM elements - visual elements missing!`);
            // AGGRESSIVE RESET: Clear all tracking state since visual elements are gone
            this.clearAppliedDiagnosticTracking();
            return false;
        }
        
        // Check if the number of elements is roughly what we expect
        const expectedMinElements = Math.min(this.diagnostics.length, wrappedKeysCount);
        if (diagnosticElements.length < expectedMinElements * 0.5) { // Allow some tolerance
            this.vscodeLog(`⚠️ DOM VERIFY: Found ${diagnosticElements.length} elements but expected at least ${expectedMinElements} - some may be missing`);
            // AGGRESSIVE RESET: Clear all tracking state to allow re-application
            this.clearAppliedDiagnosticTracking();
            return false;
        }
        
        this.vscodeLog(`✅ DOM VERIFY: Diagnostic elements exist as expected (${diagnosticElements.length} elements)`);
        return true;
    }

    /**
     * Public method to verify diagnostic elements after cleanup operations
     */
    public verifyDiagnosticElementsAfterCleanup(): boolean {
        return this.verifyDiagnosticElementsExist();
    }

    /**
     * Revalidate existing diagnostics without full clear/reapply
     * This preserves diagnostics that are still valid and removes invalid ones
     */
    private revalidateExistingDiagnostics(): void {
        this.vscodeLog(`🔍 Revalidating existing diagnostics without full clear/reapply`);
        
        // For now, use the simple approach of checking if diagnostic elements still exist and are valid
        // This is a lighter weight operation than full clear/reapply
        
        let editor = document.querySelector('.vditor-ir .vditor-reset') as HTMLElement;
        if (!editor) {
            editor = document.querySelector('.vditor-wysiwyg .vditor-reset') as HTMLElement;
        }
        if (!editor) {
            editor = document.querySelector('.vditor-sv .vditor-reset') as HTMLElement;
        }
        
        if (!editor) {
            this.vscodeLog(`❌ Could not find editor for revalidation`);
            return;
        }
        
        // Check if existing diagnostic elements are still valid
        const existingDiagnosticElements = editor.querySelectorAll('[class*="vscode-diagnostic-"]');
        this.vscodeLog(`🔍 Found ${existingDiagnosticElements.length} existing diagnostic elements to revalidate`);
        
        // Simple revalidation: if content changed significantly, we might need to reapply
        // For now, we'll trust that the diagnostics are still valid unless they're clearly broken
        let invalidElements = 0;
        existingDiagnosticElements.forEach((element, index) => {
            const textContent = element.textContent || '';
            const diagnosticMessage = element.getAttribute('data-diagnostic-message') || '';
            
            // Check if the element still makes sense in context
            if (!textContent.trim() || textContent.includes('💡')) {
                this.vscodeLog(`⚠️ Invalid diagnostic element ${index}: "${textContent}"`);
                invalidElements++;
            }
        });
        
        if (invalidElements > 0) {
            this.vscodeLog(`⚠️ Found ${invalidElements} invalid diagnostic elements - triggering full reapply`);
            this.clearDiagnosticStyles();
            this.applyDiagnosticStyles();
        } else {
            this.vscodeLog(`✅ All ${existingDiagnosticElements.length} diagnostic elements are still valid`);
        }
    }

    /**
     * Normalize diagnostic format to ensure consistent structure
     */
    private normalizeDiagnostic(diagnostic: any, context?: { documentText?: string; documentLines?: number }): any {
        // Create normalized diagnostic object
        const normalized = { ...diagnostic };
        
        // Convert VS Code diagnostic format to internal format if needed
        if (diagnostic.startLineNumber !== undefined && !diagnostic.range) {
            normalized.range = {
                start: {
                    line: (diagnostic.startLineNumber || 1) - 1,  // VS Code uses 1-based lines, we use 0-based
                    character: (diagnostic.startColumn || 1) - 1   // VS Code uses 1-based columns, we use 0-based
                },
                end: {
                    line: (diagnostic.endLineNumber || 1) - 1,
                    character: (diagnostic.endColumn || 1) - 1
                }
            };
        }
        
        // Ensure lineText is available
        if (!normalized.lineText && context?.documentText && normalized.range?.start?.line !== undefined) {
            const lines = context.documentText.split('\n');
            const lineIndex = normalized.range.start.line;
            if (lineIndex >= 0 && lineIndex < lines.length) {
                normalized.lineText = lines[lineIndex];
            }
        }
        
        // If still no lineText, try to extract from the message for spelling errors
        if (!normalized.lineText && normalized.message) {
            // For cSpell diagnostics, we can sometimes infer the word from the message
            const spellMatch = normalized.message.match(/^"([^"]+)"/);
            if (spellMatch) {
                normalized.lineText = `placeholder text with ${spellMatch[1]} for targeting`;
            }
        }
        
        this.vscodeLog(`🔄 Normalized diagnostic: line ${normalized.range?.start?.line} (was ${diagnostic.startLineNumber}), message: "${normalized.message}"`);
        return normalized;
    }

    /**
     * Setup focus awareness to prevent diagnostic updates while user is typing
     */
    private setupFocusAwareness(): void {
        this.vscodeLog(`🎯 FOCUS AWARE: Setting up focus awareness for diagnostic updates`);
        
        // Track focus changes on the document
        document.addEventListener('focusin', (event) => {
            this.focusedElement = event.target as Element;
            this.handleFocusChange(event.target as Element, true);
        });
        
        document.addEventListener('focusout', (event) => {
            this.handleFocusChange(event.target as Element, false);
            this.focusedElement = null;
        });
        
        // Track user input activity
        document.addEventListener('input', (event) => {
            this.handleUserInput(event.target as Element);
        });
        
        document.addEventListener('keydown', (event) => {
            if (this.isTypingKey(event.key)) {
                this.handleUserInput(event.target as Element);
            }
        });
        
        // Track cursor position changes on clicks and selections
        document.addEventListener('click', () => {
            setTimeout(() => {
                this.trackCursorPosition();
            }, 10); // Small delay to ensure click is processed
        });
        
        document.addEventListener('selectionchange', () => {
            this.trackCursorPosition();
        });
        
        // Setup initial state
        this.isUserTyping = false;
        this.pendingDiagnosticUpdate = false;
        
        // Initialize cursor tracking
        this.currentCursorElement = this.getCursorContainerElement();
        this.previousCursorElement = null;
    }

    /**
     * Handle focus changes on elements
     */
    private handleFocusChange(element: Element, isFocused: boolean): void {
        if (!element) return;
        
        const elementInfo = `${element.tagName}.${element.className || '(no-class)'}`;
        this.vscodeLog(`🎯 FOCUS AWARE: Focus ${isFocused ? 'IN' : 'OUT'} on ${elementInfo}`);
        
        if (isFocused) {
            // Store previous focused element before updating current
            this.previousFocusedElement = this.focusedElement;
            this.focusedElement = element;
            
            // Check if focus changed to a different element
            if (this.previousFocusedElement && this.previousFocusedElement !== element) {
                this.vscodeLog(`🎯 FOCUS CHANGE: Focus moved from ${this.previousFocusedElement.tagName} to ${element.tagName}`);
                
                // Apply pending diagnostics to the element that lost focus
                if (this.pendingDiagnosticUpdate) {
                    this.vscodeLog(`🎯 FOCUS CHANGE: Applying pending diagnostics due to focus change`);
                    setTimeout(() => {
                        this.applyPendingDiagnosticUpdateForElement(this.previousFocusedElement);
                    }, 50); // Small delay to ensure focus transition is complete
                }
            }
            
            // Check if current element has diagnostics
            const hasDiagnostics = this.elementHasDiagnostics(element);
            if (hasDiagnostics) {
                this.vscodeLog(`🎯 FOCUS AWARE: Focused element has diagnostics - will defer updates`);
            }
        } else {
            // Element lost focus - apply any pending diagnostic updates
            this.previousFocusedElement = this.focusedElement;
            this.focusedElement = null;
            
            if (this.pendingDiagnosticUpdate) {
                this.vscodeLog(`🎯 FOCUS AWARE: Element lost focus - applying pending diagnostic updates`);
                setTimeout(() => {
                    this.applyPendingDiagnosticUpdate();
                }, 100); // Small delay to ensure focus has fully moved
            }
        }
    }

    /**
     * Handle user input activity
     */
    private handleUserInput(element: Element): void {
        this.lastUserInput = Date.now();
        this.isUserTyping = true;
        
        // Track cursor position changes
        this.trackCursorPosition();
        
        // Clear existing timeout
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }
        
        // Set typing to false after a longer pause to be more conservative
        this.typingTimeout = setTimeout(() => {
            this.isUserTyping = false;
            this.vscodeLog(`🎯 FOCUS AWARE: User stopped typing - checking for pending updates`);
            
            // Wait a bit more before applying updates to ensure user has really stopped
            setTimeout(() => {
                if (this.pendingDiagnosticUpdate && this.isSafeToUpdateDiagnostics()) {
                    this.vscodeLog(`🎯 FOCUS AWARE: Applying pending diagnostic updates after extended pause`);
                    this.applyPendingDiagnosticUpdate();
                }
            }, 1000); // Additional 1 second delay
        }, 2000); // 2 second pause to determine when user stops typing
        
        this.vscodeLog(`🎯 FOCUS AWARE: User input detected on ${element.tagName} - typing state: ${this.isUserTyping}`);
    }

    /**
     * Track cursor position changes and apply pending diagnostics when cursor moves between elements
     */
    private trackCursorPosition(): void {
        const currentCursor = this.getCursorContainerElement();
        
        // Check if cursor moved to a different element
        if (this.currentCursorElement !== currentCursor) {
            this.previousCursorElement = this.currentCursorElement;
            this.currentCursorElement = currentCursor;
            
            // If cursor moved from one element to another, apply pending diagnostics to the previous element
            if (this.previousCursorElement && this.previousCursorElement !== currentCursor && this.pendingDiagnosticUpdate) {
                this.vscodeLog(`🎯 CURSOR MOVE: Cursor moved from ${this.previousCursorElement.tagName} to ${currentCursor?.tagName || 'null'}`);
                
                setTimeout(() => {
                    this.applyPendingDiagnosticUpdateForElement(this.previousCursorElement);
                }, 100); // Small delay to ensure cursor movement is complete
            }
        }
    }

    /**
     * Check if a key represents typing activity
     */
    private isTypingKey(key: string): boolean {
        // Consider alphabetic, numeric, space, and common punctuation as typing
        return key.length === 1 || 
               key === 'Backspace' || 
               key === 'Delete' || 
               key === 'Enter' || 
               key === 'Tab';
    }

    /**
     * Check if an element currently has diagnostic styling
     */
    private elementHasDiagnostics(element: Element): boolean {
        // Check if element itself has diagnostic classes
        const classList = Array.from(element.classList);
        if (classList.some(cls => cls.startsWith('vscode-diagnostic-'))) {
            return true;
        }
        
        // Check if any child elements have diagnostic classes
        const diagnosticChildren = element.querySelectorAll('[class*="vscode-diagnostic-"]');
        return diagnosticChildren.length > 0;
    }

    /**
     * Check if it's safe to update diagnostics (user is not actively typing)
     */
    private isSafeToUpdateDiagnostics(): boolean {
        const timeSinceInput = Date.now() - this.lastUserInput;
        const hasActiveFocus = this.focusedElement && this.elementHasDiagnostics(this.focusedElement);
        const recentTyping = this.isUserTyping || timeSinceInput < 3000; // 3 second grace period - much longer
        
        // Additional check: see if cursor is currently positioned in the editor
        const cursorInEditor = this.isCursorActiveInEditor();
        
        const safe = !hasActiveFocus && !recentTyping && !cursorInEditor;
        
        this.vscodeLog(`🎯 FOCUS AWARE: Safe to update diagnostics? ${safe} (focus: ${!!hasActiveFocus}, typing: ${recentTyping}, cursor: ${cursorInEditor}, timeSince: ${timeSinceInput}ms)`);
        
        return safe;
    }

    /**
     * Check if cursor is currently active in the editor (more reliable than focus detection)
     */
    private isCursorActiveInEditor(): boolean {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return false;
        }

        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        
        // Check if the selection is within the Vditor editor
        const editorElement = document.querySelector('.vditor-ir .vditor-reset') || 
                            document.querySelector('.vditor-wysiwyg .vditor-reset') || 
                            document.querySelector('.vditor-sv .vditor-reset');
        
        if (!editorElement) {
            return false;
        }

        // Check if the cursor container is within the editor
        let node: Node | null = container;
        while (node) {
            if (node === editorElement) {
                return true;
            }
            node = node.parentNode;
        }
        
        return false;
    }

    /**
     * Apply pending diagnostic updates
     */
    private applyPendingDiagnosticUpdate(): void {
        if (!this.pendingDiagnosticUpdate) {
            return;
        }
        
        this.vscodeLog(`🎯 FOCUS AWARE: Applying pending diagnostic update`);
        this.pendingDiagnosticUpdate = false;
        
        // Apply the update now
        this.applyDiagnosticStyles();
    }

    /**
     * Apply pending diagnostic updates for a specific element that's no longer focused
     */
    private applyPendingDiagnosticUpdateForElement(targetElement: Element | null): void {
        if (!this.pendingDiagnosticUpdate || !targetElement) {
            return;
        }
        
        this.vscodeLog(`🎯 ELEMENT FOCUS: Applying pending diagnostics for specific element: ${targetElement.tagName}.${targetElement.className || '(no-class)'}`);
        
        // Check if it's now safe to update this specific element
        const currentCursor = this.getCursorContainerElement();
        const elementIsSafe = !currentCursor || (currentCursor !== targetElement && !this.isDescendantOf(targetElement, currentCursor) && !this.isDescendantOf(currentCursor, targetElement));
        
        if (elementIsSafe) {
            this.vscodeLog(`🎯 ELEMENT FOCUS: Element is safe to update, applying diagnostics`);
            this.pendingDiagnosticUpdate = false;
            
            // Apply diagnostics but exclude the current cursor element
            this.applyDiagnosticStyles();
        } else {
            this.vscodeLog(`🎯 ELEMENT FOCUS: Element still contains cursor, keeping diagnostics pending`);
        }
    }

    /**
     * Handle external changes (like quick fixes) by applying pending diagnostics after a small delay
     */
    public handleExternalChange(): void {
        this.vscodeLog(`🔄 EXTERNAL CHANGE: External change detected, will apply pending diagnostics with delay`);
        
        // Apply pending diagnostics after a small delay to ensure external change is processed
        setTimeout(() => {
            if (this.pendingDiagnosticUpdate) {
                this.vscodeLog(`🔄 EXTERNAL CHANGE: Applying pending diagnostics after external change`);
                this.applyPendingDiagnosticUpdate();
            }
        }, 200); // 200ms delay to ensure external change is fully processed
    }

    /**
     * Enhanced scheduleUpdate that respects focus awareness
     */
    private scheduleUpdateFocusAware(force: boolean = false): void {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        
        // Check if it's safe to update
        if (!force && !this.isSafeToUpdateDiagnostics()) {
            this.vscodeLog(`🎯 FOCUS AWARE: User is typing - deferring diagnostic update`);
            this.pendingDiagnosticUpdate = true;
            return;
        }
        
        // Proceed with normal scheduling
        this.updateTimer = setTimeout(() => {
            // Double-check safety before actually updating
            if (!force && !this.isSafeToUpdateDiagnostics()) {
                this.vscodeLog(`🎯 FOCUS AWARE: Still not safe to update - deferring again`);
                this.pendingDiagnosticUpdate = true;
                return;
            }
            
            // Generate hash of current diagnostics for comparison
            const currentDiagnosticsHash = this.generateDiagnosticsHash();
            const currentContent = this.vditor?.getValue() || '';
            
            const contentChanged = currentContent !== this.lastContent;
            const diagnosticsChanged = currentDiagnosticsHash !== this.lastDiagnosticsHash;
            const noDiagnosticsApplied = !this.diagnosticsApplied || this.wrappedKeys.size === 0;
            
            this.vscodeLog(`🎯 FOCUS AWARE UPDATE CHECK: content=${contentChanged ? 'CHANGED' : 'unchanged'}, diagnostics=${diagnosticsChanged ? 'CHANGED' : 'unchanged'}, applied=${this.diagnosticsApplied}, keys=${this.wrappedKeys.size}, force=${force}`);
            
            // Only update if there's a real change or we're forced to
            if (force || contentChanged || diagnosticsChanged || noDiagnosticsApplied) {
                if (diagnosticsChanged || noDiagnosticsApplied || force) {
                    this.vscodeLog(`🔄 Diagnostics changed or not applied - full update needed`);
                    this.clearDiagnosticStyles();
                    this.applyDiagnosticStyles();
                    this.lastDiagnosticsHash = currentDiagnosticsHash;
                    this.diagnosticsApplied = true;
                } else if (contentChanged) {
                    // Content changed but diagnostics are the same - try to preserve existing diagnostics
                    this.vscodeLog(`📝 Content changed but diagnostics unchanged - preserving existing diagnostics`);
                    // Only revalidate diagnostics without full clear/reapply
                    this.revalidateExistingDiagnostics();
                }
                this.lastContent = currentContent;
            } else {
                this.vscodeLog(`✅ Content and diagnostics unchanged, diagnostics applied - skipping update`);
            }
            this.updateTimer = null;
        }, 150); // Reduced debounce time
    }
}