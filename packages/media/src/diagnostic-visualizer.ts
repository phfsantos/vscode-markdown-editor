import { DiagnosticMatcher, isDescendantOf } from "./diagnostic-matcher";
import { DiagnosticDecorations } from "./diagnostic-decorations";

/**
 * Handles VS Code diagnostic visualization in Vditor editor
 */
export class DiagnosticVisualizer {
  private readonly decorations = new DiagnosticDecorations();
  private readonly matcher = new DiagnosticMatcher(
    (node, start, end, diagnostic) => this.decorations.wrapTextWithDiagnostic(node, start, end, diagnostic),
    () => { this.hasSkippedDiagnostics = true; },
  );
  private diagnostics: any[] = [];
  private vditor: any;
  private updateTimer: NodeJS.Timeout | null = null;
  private lastContent = "";

  // NEW: Smart diagnostic management to prevent unnecessary clearing/reapplying
  private lastDiagnosticsHash: string = "";
  private diagnosticsApplied: boolean = false;
  private isApplyingDiagnostics: boolean = false; // Prevent overlapping applications

  // NEW: Focus-aware diagnostic management to prevent cursor jumping
  private pendingDiagnosticUpdate: boolean = false;
  private lastUserInput: number = 0;
  private focusedElement: Element | null = null;
  private previousFocusedElement: Element | null = null;
  private currentCursorElement: Element | null = null;
  private previousCursorElement: Element | null = null;
  private isUserTyping: boolean = false;
  private typingTimeout: NodeJS.Timeout | null = null;
  // Track if diagnostics were skipped due to cursor position
  // When true, we need to re-apply diagnostics when cursor moves or typing stops
  private hasSkippedDiagnostics: boolean = false;

  constructor(vditorInstance: any) {
    this.vditor = vditorInstance;
    this.setupFocusAwareness();
  }

  /**
   * Update diagnostic visualizations in the editor (private implementation)
   * Now includes focus-aware logic to prevent cursor jumping
   */
  private applyDiagnosticsToEditor(
    diagnostics: any[],
    force: boolean = false
  ): void {

    // CRITICAL: Prevent overlapping applications - block ALL calls when already applying
    // This includes force=true to prevent cascade of overlapping requestAnimationFrames
    if (this.isApplyingDiagnostics) {
      return;
    }

    // SMART APPLICATION: Only clear if diagnostics actually changed AND visual elements exist
    const newHash = this.generateDiagnosticsHashForArray(diagnostics);
    const currentHash = this.generateDiagnosticsHash();
    const visualElementsExist = this.verifyDiagnosticElementsExist();

    // OPTIMIZATION: If diagnostics haven't changed and are still visible, skip entire operation
    if (
      !force &&
      newHash === currentHash &&
      this.diagnosticsApplied &&
      visualElementsExist
    ) {
      return;
    }

    // FOCUS-AWARE CHECK: Don't apply diagnostics if user is actively typing (unless forced)
    const isSafe = this.isSafeToUpdateDiagnostics();

    if (!force && !isSafe) {
      this.diagnostics = diagnostics; // Store the new diagnostics
      this.pendingDiagnosticUpdate = true;
      return;
    }

    // CRITICAL FIX: When forced, mark as "in progress" IMMEDIATELY to prevent race conditions
    // This stops other diagnostic updates from interfering while we're applying
    if (force) {
      this.diagnosticsApplied = true; // Claim we're applying NOW
      this.lastDiagnosticsHash = newHash; // Update hash NOW to prevent duplicate attempts
      this.isApplyingDiagnostics = true; // Block other applications
    }

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      // OPTIMIZATION: Only clear if diagnostics content changed (not just missing from DOM)
      // This prevents unnecessary clearing during getValue() operations that temporarily strip styles
      const hashChanged = newHash !== currentHash;

      if (hashChanged) {
        // Only clear when diagnostics content changed
        this.clearDiagnosticStyles();
        this.decorations.clearTokens();
      } else if (!visualElementsExist) {
        // Diagnostics same but missing from DOM - lightweight clear of tracking only
        this.decorations.clearTokens();
      }

      this.diagnostics = diagnostics;
      this.applyDiagnosticStyles();

      // Update state after application (only if not already set by force flag above)
      if (!force) {
        this.lastDiagnosticsHash = newHash;
        this.diagnosticsApplied = true;
      }

      // Release the lock after a short delay to allow DOM to stabilize
      // IMPORTANT: Only reset isApplyingDiagnostics, keep diagnosticsApplied as-is
      setTimeout(() => {
        this.isApplyingDiagnostics = false;
      }, 100);
    });
  }
  /**
   * Schedule diagnostic update with debouncing to prevent flickering
   * DEPRECATED: This method now delegates to scheduleUpdateFocusAware
   */
  private scheduleUpdate(force: boolean = false): void {
    // Delegate to the new focus-aware scheduling method
    this.scheduleUpdateFocusAware(force);
  }

  /**
   * Clear all diagnostic styles from the editor with enhanced content preservation
   * Now cursor-aware to prevent cursor jumping during typing
   */
  private clearDiagnosticStyles(): void {
    // Try to find the active editor element (same logic as applyDiagnosticStyles)
    let editor = document.querySelector(".vditor-ir .vditor-reset"); // IR mode
    if (!editor) {
      editor = document.querySelector(".vditor-wysiwyg .vditor-reset"); // WYSIWYG mode
    }
    if (!editor) {
      editor = document.querySelector(".vditor-sv .vditor-reset"); // Source mode
    }
    if (!editor) {
      return;
    }

    // CURSOR-AWARE: ALWAYS get cursor element to prevent clearing cursor line diagnostics
    const cursorElement = this.getCursorContainerElement();

    // Remove diagnostic CSS classes but preserve ALL original element structure
    const diagnosticElements = editor.querySelectorAll(
      '[class*="vscode-diagnostic-"]'
    );

    diagnosticElements.forEach((span, index) => {
      // CURSOR-AWARE: Skip clearing diagnostics in cursor element
      if (
        cursorElement &&
        (span === cursorElement ||
          isDescendantOf(span, cursorElement) ||
          isDescendantOf(cursorElement, span as Node))
      ) {
        // Set flag to indicate diagnostics were skipped
        this.hasSkippedDiagnostics = true;
        this.pendingDiagnosticUpdate = true;
        return; // Skip this element
      }

      // Use centralized method to remove styling AND tracking
      this.matcher.removeDiagnosticStylingFromElement(span as HTMLElement);
    });

    // Clean up lightbulb overlays (completely separate system)
    this.decorations.cleanupLightbulbOverlays();

    // Clear applied diagnostic tracking
    this.clearAppliedDiagnosticTracking();
  }

  /**
   * Clear diagnostics from a specific element (e.g., the cursor line when user starts typing)
   */
  private clearDiagnosticsFromElement(element: Element): void {
    if (!element) {
      return;
    }

    // Preserve current selection before mutating diagnostic spans in this element.
    // Without this, unwrapping spans can move the caret to the end of the token.
    const selectionBookmark = this.createSelectionBookmarkForElement(element);

    // Find all diagnostic spans within this element
    const diagnosticSpans = element.querySelectorAll(
      '[class*="vscode-diagnostic-"]'
    );

    if (diagnosticSpans.length > 0) {
      diagnosticSpans.forEach((span) => {
        // Use centralized method to remove styling AND tracking
        this.matcher.removeDiagnosticStylingFromElement(span as HTMLElement);
      });

      // CRITICAL: Mark diagnostics as not fully applied since we cleared some
      // This ensures they will be reapplied when the cursor moves away
      this.diagnosticsApplied = false;
      this.hasSkippedDiagnostics = true;
      this.pendingDiagnosticUpdate = true;

      // Restore selection after DOM changes to keep caret stable while typing.
      this.restoreSelectionBookmarkForElement(element, selectionBookmark);
    }
  }

  /**
   * Capture selection as character offsets relative to an element.
   */
  private createSelectionBookmarkForElement(
    element: Element
  ): { start: number; end: number; collapsed: boolean } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (
      !this.isNodeWithinElement(range.startContainer, element) &&
      !this.isNodeWithinElement(range.endContainer, element)
    ) {
      return null;
    }

    try {
      const startRange = range.cloneRange();
      startRange.selectNodeContents(element);
      startRange.setEnd(range.startContainer, range.startOffset);

      const endRange = range.cloneRange();
      endRange.selectNodeContents(element);
      endRange.setEnd(range.endContainer, range.endOffset);

      return {
        start: startRange.toString().length,
        end: endRange.toString().length,
        collapsed: range.collapsed,
      };
    } catch {
      return null;
    }
  }

  /**
   * Restore a previously captured selection bookmark within an element.
   */
  private restoreSelectionBookmarkForElement(
    element: Element,
    bookmark: { start: number; end: number; collapsed: boolean } | null
  ): void {
    if (!bookmark) {
      return;
    }

    const resolveOffset = (
      targetOffset: number
    ): { node: Node; offset: number } | null => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
      let textNode: Text | null;
      let traversed = 0;

      while ((textNode = walker.nextNode() as Text)) {
        const length = textNode.textContent?.length ?? 0;
        if (targetOffset <= traversed + length) {
          return {
            node: textNode,
            offset: Math.max(0, Math.min(length, targetOffset - traversed)),
          };
        }
        traversed += length;
      }

      const lastNode = element.lastChild;
      if (!lastNode) {
        return null;
      }

      if (lastNode.nodeType === Node.TEXT_NODE) {
        const length = lastNode.textContent?.length ?? 0;
        return { node: lastNode, offset: length };
      }

      const childCount = lastNode.childNodes?.length ?? 0;
      return { node: lastNode, offset: childCount };
    };

    const startPos = resolveOffset(bookmark.start);
    const endPos = resolveOffset(bookmark.end);
    if (!startPos || !endPos) {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    try {
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      if (bookmark.collapsed) {
        range.collapse(true);
      } else {
        range.setEnd(endPos.node, endPos.offset);
      }

      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Best-effort restore only.
    }
  }

  /**
   * Check if a node is inside an element (or the element itself).
   */
  private isNodeWithinElement(node: Node | null, element: Element): boolean {
    if (!node) {
      return false;
    }

    if (node === element) {
      return true;
    }

    let current: Node | null = node;
    while (current) {
      if (current === element) {
        return true;
      }
      current = current.parentNode;
    }

    return false;
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

    // FUNDAMENTAL PRINCIPLE: Do NOT remove ANY elements from the editor content
    // The editor contains actual content with diagnostic styling - that must NEVER be removed
    // Only clean up true overlay elements that are positioned separately

    // 1. Clean up the dedicated lightbulb overlay system (Map-based overlays)
    this.decorations.cleanupLightbulbOverlays();

    // 1.1 Clean up all styles
    this.clearDiagnosticStyles();

    // 2. Clean up ONLY overlay elements from document.body with data-diagnostic-ui="true"
    const bodyOverlays = document.body.querySelectorAll(
      '[data-diagnostic-ui="true"]'
    );

    bodyOverlays.forEach((element) => {
      element.remove();
    });
  }

  /**
   * Apply diagnostic styles using efficient single-pass DOM traversal
   * Now with cursor-aware element exclusion
   */
  private applyDiagnosticStyles(): void {
    if (this.diagnostics.length === 0) {
      return;
    }

    // Try to find the active editor element
    let editor = document.querySelector(".vditor-ir .vditor-reset"); // IR mode
    if (!editor) {
      editor = document.querySelector(".vditor-wysiwyg .vditor-reset"); // WYSIWYG mode
    }
    if (!editor) {
      editor = document.querySelector(".vditor-sv .vditor-reset"); // Source mode
    }
    if (!editor) {
      return;
    }

    // CRITICAL: ALWAYS exclude cursor element to prevent cursor jumping during ANY update
    // This applies even during force updates - we track skipped diagnostics for later application
    const cursorElement = this.getCursorContainerElement();

    // Use the new efficient single-pass approach with cursor awareness
    this.matcher.apply(editor as HTMLElement, this.diagnostics, cursorElement);
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
   * Check if cursor or selection is at the beginning of the line
   * Returns true if cursor is at position 0 OR selection touches position 0
   */
  private isCursorAtBeginningOfLine(): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    // Check if either the start or end of the selection is at position 0
    return range.startOffset === 0 || range.endOffset === 0;
  }

  /**
   * Check if cursor or selection is at the end of the line
   * Returns true if cursor is at end OR selection touches end of text
   */
  private isCursorAtEndOfLine(): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const textLength = range.commonAncestorContainer.textContent?.length || 0;
    // Check if either the start or end of the selection is at the end of the text
    return range.endOffset === textLength || range.startOffset === textLength;
  }

  /**
   * Check if there is an active text selection (not just a collapsed cursor)
   */
  private hasActiveSelection(): boolean {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return false;
    }
    
    const range = selection.getRangeAt(0);
    return !range.collapsed; // True if selection has content
  }

  /**
   * Check if an element is a block-level element that could contain diagnostics
   */
  private isBlockLevelElement(element: Element): boolean {
    const blockTags = [
      "P",
      "DIV",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "LI",
      "BLOCKQUOTE",
      "PRE",
    ];
    return (
      blockTags.includes(element.tagName) ||
      element.classList.contains("vditor-ir__node") ||
      element.classList.contains("vditor-wysiwyg")
    );
  }

  /**
   * Get all block-level elements covered by the current selection
   */
  private getSelectedBlockElements(): Element[] {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return [];
    }

    const range = selection.getRangeAt(0);
    const elements: Element[] = [];
    
    // Get the common ancestor container
    let container = range.commonAncestorContainer;
    
    // If it's a text node, get its parent element
    if (container.nodeType === Node.TEXT_NODE) {
      container = container.parentElement!;
    }
    
    // If selection spans content, find all block elements in range
    if (!range.collapsed) {
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) => {
            const element = node as Element;
            if (this.isBlockLevelElement(element)) {
              // Check if this element intersects with the selection range
              try {
                const elementRange = document.createRange();
                elementRange.selectNodeContents(element);
                
                // Check if ranges intersect
                const startComparison = range.compareBoundaryPoints(Range.END_TO_START, elementRange);
                const endComparison = range.compareBoundaryPoints(Range.START_TO_END, elementRange);
                
                if (startComparison <= 0 && endComparison >= 0) {
                  return NodeFilter.FILTER_ACCEPT;
                }
              } catch (e) {
                // If comparison fails, skip this element
              }
            }
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      
      let node;
      while ((node = walker.nextNode())) {
        elements.push(node as Element);
      }
    }
    
    // If no block elements found in selection, add the cursor container element
    if (elements.length === 0) {
      const cursorElement = this.getCursorContainerElement();
      if (cursorElement) {
        elements.push(cursorElement);
      }
    }
    
    return elements;
  }

  /**
   * Update diagnostic visualizations from external source (VS Code extension)
   */
  public updateDiagnostics(
    diagnostics: any[],
    context?: { documentText?: string; documentLines?: number },
    forceApply: boolean = false
  ): void {

    // Normalize diagnostic format - convert VS Code format to our internal format
    const normalizedDiagnostics = diagnostics.map((diag) =>
      this.normalizeDiagnostic(diag, context)
    );

    // SMART DIAGNOSTIC COMPARISON: Check if diagnostics have actually changed
    const newDiagnosticsHash = this.generateDiagnosticsHashForArray(
      normalizedDiagnostics
    );
    const diagnosticsActuallyChanged =
      newDiagnosticsHash !== this.lastDiagnosticsHash;

    // Process all diagnostics

    // CRITICAL: Always check if visual elements exist to detect if they were cleared
    const visualElementsExist = this.verifyDiagnosticElementsExist();

    // Update if: diagnostics changed OR not applied yet OR visual elements missing OR forced
    if (
      forceApply ||
      diagnosticsActuallyChanged ||
      !this.diagnosticsApplied ||
      !visualElementsExist
    ) {
      this.diagnostics = normalizedDiagnostics;

      // OPTIMIZATION: Apply immediately if safe OR forced, otherwise schedule
      // This ensures diagnostics appear at the first opportunity
      const isSafe = this.isSafeToUpdateDiagnostics();

      if (forceApply || isSafe) {
        // Apply immediately for instant feedback
        // CRITICAL: Pass forceApply through to bypass all safety checks
        this.applyDiagnosticsToEditor(normalizedDiagnostics, forceApply);
      } else {
        // User is typing, schedule for later
        this.pendingDiagnosticUpdate = true;
        this.scheduleUpdate();
      }
    } else {
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
   * @param force - Force re-application even if content hasn't changed (useful after DOM manipulation)
   */
  public addSimpleDiagnostics(force: boolean = false): void {
    const content = this.vditor?.getValue() || "";

    // SMART CHECK: Only update if content changed significantly to prevent unnecessary updates
    if (!force && content === this.lastContent) {
      return;
    }

    // Check if diagnostics are already applied and still valid
    if (!force && this.diagnosticsApplied && this.matcher.appliedElementCount > 0) {
      // Quick validation: if existing diagnostics are mostly still valid, skip update
      let editor = document.querySelector(
        ".vditor-ir .vditor-reset"
      ) as HTMLElement;
      if (!editor) {
        editor = document.querySelector(
          ".vditor-wysiwyg .vditor-reset"
        ) as HTMLElement;
      }
      if (editor) {
        const existingDiagnostics = editor.querySelectorAll(
          '[class*="vscode-diagnostic-"]'
        );
        if (existingDiagnostics.length > 0) {
          this.lastContent = content;
          return;
        }
      }
    }

    this.lastContent = content;

    const lines = content.split("\n");
    const simpleDiagnostics: any[] = [];

    lines.forEach((line, index) => {
      // Check for broken links (simple heuristic)
      const linkRegex = /\[([^\]]*)\]\(([^)]*)\)/g;
      let linkMatch;
      while ((linkMatch = linkRegex.exec(line)) !== null) {
        const url = linkMatch[2] || "";
        const fullMatch = linkMatch[0]; // Store the full markdown link text

        if (url && !this.isValidUrl(url)) {
          simpleDiagnostics.push({
            message: `Potentially broken link: ${url}`,
            severity: 2, // Warning
            matchedText: fullMatch, // Add the full markdown text for matching
            range: {
              start: { line: index, character: linkMatch.index },
              end: {
                line: index,
                character: linkMatch.index + linkMatch[0].length,
              },
            },
          });
        }
      }

      // Check for images without alt text
      const imageRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
      let imageMatch;
      while ((imageMatch = imageRegex.exec(line)) !== null) {
        const altText = imageMatch[1] || "";
        const fullMatch = imageMatch[0]; // Store the full markdown image text

        if (!altText.trim()) {
          simpleDiagnostics.push({
            message: "Image missing alt text for accessibility",
            severity: 3, // Information
            matchedText: fullMatch, // Add the full markdown text for matching
            range: {
              start: { line: index, character: imageMatch.index },
              end: {
                line: index,
                character: imageMatch.index + imageMatch[0].length,
              },
            },
          });
        }
      }
    });

    // Only apply if we actually found diagnostics or need to clear existing ones
    if (simpleDiagnostics.length > 0 || this.diagnostics.length > 0) {
      this.applyDiagnosticsToEditor(simpleDiagnostics);
    }
  }

  /**
   * Simple URL validation
   */
  private isValidUrl(url: string): boolean {
    if (!url || url.trim() === "") {
      return false;
    }

    // Allow relative paths and anchors
    if (
      url.startsWith("#") ||
      url.startsWith("/") ||
      url.startsWith("./") ||
      url.startsWith("../")
    ) {
      return true;
    }

    // Check for common file extensions that might exist
    const commonExtensions = [
      ".md",
      ".txt",
      ".html",
      ".htm",
      ".pdf",
      ".doc",
      ".docx",
    ];
    if (commonExtensions.some((ext) => url.toLowerCase().includes(ext))) {
      // Only mark as valid if it looks like a real relative path
      if (!url.includes("://")) {
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
   * Clear all applied diagnostic tracking (call when content changes)
   */
  private clearAppliedDiagnosticTracking(): void {
    this.matcher.clearTracking();
    this.diagnosticsApplied = false;
    this.lastDiagnosticsHash = "";
    // CRITICAL: Also clear duplicate detection state
    this.decorations.clearTokens();
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
      return "";
    }

    // Create a stable hash based on diagnostic properties
    const diagnosticStrings = diagnostics
      .map((diag) => {
        return `${diag.message}|${diag.source}|${diag.severity}|${diag.range?.start?.line}|${diag.range?.start?.character}|${diag.range?.end?.line}|${diag.range?.end?.character}`;
      })
      .sort(); // Sort to ensure consistent hash regardless of order

    return diagnosticStrings.join(":::");
  }

  /**
   * Verify that diagnostic elements actually exist in the DOM
   * This prevents the "applied but invisible" state mismatch
   */
  private verifyDiagnosticElementsExist(): boolean {
    if (!this.diagnosticsApplied || this.diagnostics.length === 0) {
      return true; // No diagnostics expected, so this is "correct"
    }

    let editor = document.querySelector(
      ".vditor-ir .vditor-reset"
    ) as HTMLElement;
    if (!editor) {
      editor = document.querySelector(
        ".vditor-wysiwyg .vditor-reset"
      ) as HTMLElement;
    }
    if (!editor) {
      editor = document.querySelector(
        ".vditor-sv .vditor-reset"
      ) as HTMLElement;
    }

    if (!editor) {
      return false;
    }

    // Check if diagnostic elements actually exist in the DOM
    const diagnosticElements = editor.querySelectorAll(
      '[class*="vscode-diagnostic-"]'
    );
    const appliedCount = this.matcher.appliedElementCount;

    // If we expect diagnostics but have no DOM elements, something cleared them
    if (this.diagnostics.length > 0 && diagnosticElements.length === 0) {
      // CRITICAL: Mark diagnostics as not applied so they will be reapplied
      this.diagnosticsApplied = false;
      this.clearAppliedDiagnosticTracking();
      return false;
    }

    // Check if the number of elements is roughly what we expect
    const expectedMinElements = Math.min(this.diagnostics.length, appliedCount);
    if (diagnosticElements.length < expectedMinElements * 0.5) {
      // Allow some tolerance
      // CRITICAL: Mark diagnostics as not applied so they will be reapplied
      this.diagnosticsApplied = false;
      this.clearAppliedDiagnosticTracking();
      return false;
    }

    return true;
  }

  /**
   * Public method to verify diagnostic elements after cleanup operations
   * Returns true if diagnostics are properly applied, false if they need reapplication
   */
  public verifyDiagnosticElementsAfterCleanup(): boolean {
    const elementsExist = this.verifyDiagnosticElementsExist();

    // If elements don't exist but we have diagnostics, trigger reapplication
    if (!elementsExist && this.diagnostics.length > 0) {
      // Mark as needing reapplication
      this.pendingDiagnosticUpdate = true;

      // Apply immediately if safe
      if (this.isSafeToUpdateDiagnostics()) {
        this.applyDiagnosticsToEditor(this.diagnostics);
      }
    }

    return elementsExist;
  }

  /**
   * Revalidate existing diagnostics without full clear/reapply
   * This preserves diagnostics that are still valid and removes invalid ones
   */
  private revalidateExistingDiagnostics(): void {
    // For now, use the simple approach of checking if diagnostic elements still exist and are valid
    // This is a lighter weight operation than full clear/reapply

    let editor = document.querySelector(
      ".vditor-ir .vditor-reset"
    ) as HTMLElement;
    if (!editor) {
      editor = document.querySelector(
        ".vditor-wysiwyg .vditor-reset"
      ) as HTMLElement;
    }
    if (!editor) {
      editor = document.querySelector(
        ".vditor-sv .vditor-reset"
      ) as HTMLElement;
    }

    if (!editor) {
      return;
    }

    // Check if existing diagnostic elements are still valid
    const existingDiagnosticElements = editor.querySelectorAll(
      '[class*="vscode-diagnostic-"]'
    );

    // Simple revalidation: if content changed significantly, we might need to reapply
    // For now, we'll trust that the diagnostics are still valid unless they're clearly broken
    let invalidElements = 0;
    existingDiagnosticElements.forEach((element, index) => {
      const textContent = element.textContent || "";

      // Check if the element still makes sense in context
      if (!textContent.trim() || textContent.includes("💡")) {
        invalidElements++;
      }
    });

    if (invalidElements > 0) {
      this.clearDiagnosticStyles();
      this.applyDiagnosticStyles();
    }
  }

  /**
   * Normalize diagnostic format to ensure consistent structure
   */
  private normalizeDiagnostic(
    diagnostic: any,
    context?: { documentText?: string; documentLines?: number }
  ): any {
    // Create normalized diagnostic object
    const normalized = { ...diagnostic };

    // Convert VS Code diagnostic format to internal format if needed
    if (diagnostic.startLineNumber !== undefined && !diagnostic.range) {
      normalized.range = {
        start: {
          line: (diagnostic.startLineNumber || 1) - 1, // VS Code uses 1-based lines, we use 0-based
          character: (diagnostic.startColumn || 1) - 1, // VS Code uses 1-based columns, we use 0-based
        },
        end: {
          line: (diagnostic.endLineNumber || 1) - 1,
          character: (diagnostic.endColumn || 1) - 1,
        },
      };
    }

    // Ensure lineText is available
    if (
      !normalized.lineText &&
      context?.documentText &&
      normalized.range?.start?.line !== undefined
    ) {
      const lines = context.documentText.split("\n");
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

    return normalized;
  }

  /**
   * Setup focus awareness to prevent diagnostic updates while user is typing
   */
  private setupFocusAwareness(): void {
    // Track focus changes on the document
    document.addEventListener("focusin", (event) => {
      this.focusedElement = event.target as Element;
      this.handleFocusChange(event.target as Element, true);
    });

    document.addEventListener("focusout", (event) => {
      this.handleFocusChange(event.target as Element, false);
      this.focusedElement = null;
    });

    // Track user input activity
    document.addEventListener("input", (event) => {
      this.handleUserInput(event.target as Element);
    });

    document.addEventListener("keydown", (event) => {
      if (this.isTypingKey(event.key)) {
        this.handleUserInput(event.target as Element, event.key);
      }
    });

    // Track cursor position changes on clicks and selections
    document.addEventListener("click", () => {
      setTimeout(() => {
        this.trackCursorPosition();
      }, 10); // Small delay to ensure click is processed
    });

    document.addEventListener("selectionchange", () => {
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

    if (isFocused) {
      // Store previous focused element before updating current
      this.previousFocusedElement = this.focusedElement;
      this.focusedElement = element;

      // Check if focus changed to a different element
      if (
        this.previousFocusedElement &&
        this.previousFocusedElement !== element
      ) {
        // Apply pending diagnostics to the element that lost focus
        if (this.pendingDiagnosticUpdate) {
          setTimeout(() => {
            this.applyPendingDiagnosticUpdateForElement(
              this.previousFocusedElement
            );
          }, 50); // Small delay to ensure focus transition is complete
        }
      }

      // Check if current element has diagnostics
    } else {
      // Element lost focus - apply any pending diagnostic updates
      this.previousFocusedElement = this.focusedElement;
      this.focusedElement = null;

      if (this.pendingDiagnosticUpdate) {
        setTimeout(() => {
          this.applyPendingDiagnosticUpdate();
        }, 100); // Small delay to ensure focus has fully moved
      }
    }
  }

  /**
   * Handle user input activity
   */
  private handleUserInput(element: Element, key?: string): void {
    this.lastUserInput = Date.now();
    this.isUserTyping = true;

    // Get cursor element and selection state
    const cursorElement = this.getCursorContainerElement();
    const hasSelection = this.hasActiveSelection();
    const selectedElements = this.getSelectedBlockElements();
    
    if (!cursorElement) {
      return;
    }

    // SCENARIO 1: Active selection exists (any key will replace selection and potentially combine lines)
    if (hasSelection && selectedElements.length > 0) {      
      // Clear diagnostics from ALL selected elements
      selectedElements.forEach(el => {
        this.clearDiagnosticsFromElement(el);
      });
      
      // If selection spans multiple elements or blocks, also clear adjacent lines
      // because they might be combined when the selection is deleted
      if (selectedElements.length > 1) {
        const firstElement = selectedElements[0];
        const lastElement = selectedElements[selectedElements.length - 1];
        
        // Clear previous sibling of first selected element (might merge with it)
        if (firstElement.previousElementSibling) {
          this.clearDiagnosticsFromElement(firstElement.previousElementSibling);
        }
        
        // Clear next sibling of last selected element (might merge with it)
        if (lastElement.nextElementSibling) {
          this.clearDiagnosticsFromElement(lastElement.nextElementSibling);
        }
      } else {
        // Single element selected, but check if selection touches boundaries
        // If it touches beginning or end, adjacent lines might be affected
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const elementText = selectedElements[0].textContent || '';
          
          // If selection starts at position 0, might affect previous line
          if (range.startOffset === 0 && selectedElements[0].previousElementSibling) {
            this.clearDiagnosticsFromElement(selectedElements[0].previousElementSibling);
          }
          
          // If selection ends at end of text, might affect next line
          if (range.endOffset === elementText.length && selectedElements[0].nextElementSibling) {
            this.clearDiagnosticsFromElement(selectedElements[0].nextElementSibling);
          }
        }
      }
    }
    // SCENARIO 2: No selection (collapsed cursor) - handle specific keys
    else {
      // Always clear current cursor element
      this.clearDiagnosticsFromElement(cursorElement);
      
      // Backspace at beginning of line combines with previous line
      if (key === "Backspace" && this.isCursorAtBeginningOfLine() && cursorElement.previousElementSibling) {
        this.clearDiagnosticsFromElement(cursorElement.previousElementSibling);
      }

      // Delete at end of line combines with next line
      if (key === "Delete" && this.isCursorAtEndOfLine() && cursorElement.nextElementSibling) {
        this.clearDiagnosticsFromElement(cursorElement.nextElementSibling);
      }
    }

    // Mark that we need to re-apply diagnostics for these lines later
    this.hasSkippedDiagnostics = true;

    // Track cursor position changes
    this.trackCursorPosition();

    // OPTIMIZATION: If Enter key was pressed, apply pending diagnostics immediately after a short delay
    // This gives the user instant feedback when they move to a new line
    if (key === "Enter" && this.pendingDiagnosticUpdate) {
      setTimeout(() => {
        if (this.pendingDiagnosticUpdate) {
          this.isUserTyping = false; // Temporarily allow diagnostics
          this.applyPendingDiagnosticUpdate();
        }
      }, 100); // Very short delay after Enter for instant line feedback
    }

    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Set typing to false after a shorter pause for better responsiveness
    this.typingTimeout = setTimeout(() => {
      this.isUserTyping = false;

      // Apply updates immediately when typing stops
      if (this.pendingDiagnosticUpdate && this.isSafeToUpdateDiagnostics()) {
        this.applyPendingDiagnosticUpdate();
      }
    }, 500); // Reduced from 2000ms to 500ms for faster response
  }

  /**
   * Track cursor position changes and apply pending diagnostics when cursor moves between elements
   */
  private trackCursorPosition(): void {
    const currentCursor = this.getCursorContainerElement();

    // CRITICAL FIX: Always update currentCursorElement to the latest DOM reference
    // This prevents stale element references from blocking subsequent cursor movements
    const cursorElementChanged = this.currentCursorElement !== currentCursor;

    if (cursorElementChanged) {
      this.previousCursorElement = this.currentCursorElement;
      this.currentCursorElement = currentCursor;

      // If cursor moved from one element to another, apply any skipped diagnostics
      if (
        this.previousCursorElement &&
        this.previousCursorElement !== currentCursor
      ) {
        // If we have skipped diagnostics, trigger a full re-application
        if (this.hasSkippedDiagnostics) {
          setTimeout(() => {
            // Trigger full re-application (cursor is now on different element)
            this.applyDiagnosticsToEditor(this.diagnostics, true);
            // CRITICAL: Reset flag AFTER application completes, not before
            // This ensures rapid cursor movements don't lose the flag state
            this.hasSkippedDiagnostics = false;
          }, 50);
        }

        // Also apply any pending general updates
        if (this.pendingDiagnosticUpdate) {
          setTimeout(() => {
            this.applyPendingDiagnosticUpdateForElement(
              this.previousCursorElement
            );
          }, 50);
        }
      }
    }
  }

  /**
   * Check if a key represents typing activity
   */
  private isTypingKey(key: string): boolean {
    // Consider alphabetic, numeric, space, and common punctuation as typing
    return (
      key.length === 1 ||
      key === "Backspace" ||
      key === "Delete" ||
      key === "Enter" ||
      key === "Tab"
    );
  }

  /**
   * Check if an element currently has diagnostic styling
   */
  private elementHasDiagnostics(element: Element): boolean {
    // Check if element itself has diagnostic classes
    const classList = Array.from(element.classList);
    if (classList.some((cls) => cls.startsWith("vscode-diagnostic-"))) {
      return true;
    }

    // Check if any child elements have diagnostic classes
    const diagnosticChildren = element.querySelectorAll(
      '[class*="vscode-diagnostic-"]'
    );
    return diagnosticChildren.length > 0;
  }

  /**
   * Check if it's safe to update diagnostics (user is not actively typing)
   */
  private isSafeToUpdateDiagnostics(): boolean {
    // If no recent user input, it's always safe (e.g., on file load)
    if (this.lastUserInput === 0) {
      return true;
    }

    const timeSinceInput = Date.now() - this.lastUserInput;
    const hasActiveFocus =
      this.focusedElement && this.elementHasDiagnostics(this.focusedElement);
    const recentTyping = this.isUserTyping || timeSinceInput < 1000; // 1 second grace period after typing

    // Additional check: see if cursor is currently positioned in the editor
    const cursorInEditor = this.isCursorActiveInEditor();

    // It's safe if: no active focus on diagnostic elements AND not recently typing AND cursor not in editor
    // OR if enough time has passed since last input (allow background updates)
    const safe =
      !hasActiveFocus &&
      (!recentTyping || timeSinceInput > 2000) &&
      !cursorInEditor;

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
    const editorElement =
      document.querySelector(".vditor-ir .vditor-reset") ||
      document.querySelector(".vditor-wysiwyg .vditor-reset") ||
      document.querySelector(".vditor-sv .vditor-reset");

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

    this.pendingDiagnosticUpdate = false;

    // If we have skipped diagnostics, clear the flag (they'll be applied in the next line)
    if (this.hasSkippedDiagnostics) {
      this.hasSkippedDiagnostics = false;
    }

    // OPTIMIZATION: Force immediate application using the main method
    // This ensures all smart checking and state management happens correctly
    this.applyDiagnosticsToEditor(this.diagnostics);
  }

  /**
   * Apply pending diagnostic updates for a specific element that's no longer focused
   */
  private applyPendingDiagnosticUpdateForElement(
    targetElement: Element | null
  ): void {
    if (!this.pendingDiagnosticUpdate || !targetElement) {
      return;
    }

    // Check if it's now safe to update this specific element
    const currentCursor = this.getCursorContainerElement();
    const elementIsSafe =
      !currentCursor ||
      (currentCursor !== targetElement &&
        !isDescendantOf(targetElement, currentCursor) &&
        !isDescendantOf(currentCursor, targetElement));

    if (elementIsSafe) {
      this.pendingDiagnosticUpdate = false;

      // Apply diagnostics but exclude the current cursor element
      this.applyDiagnosticStyles();
    }
  }

  /**
   * Handle external changes (like quick fixes, setValue from save) by forcing diagnostic verification
   * CRITICAL: Apply immediately after save/external change without waiting for user interaction
   */
  public handleExternalChange(): void {
    // IMMEDIATE APPLICATION: After setValue (from save/external change), DOM is reset
    // Force immediate reapplication without any delays or safety checks

    // Store current diagnostics to ensure they survive the operation
    const diagnosticsToApply = [...this.diagnostics];

    // Use requestAnimationFrame for immediate next-frame application
    requestAnimationFrame(() => {
      // Verify if diagnostics still exist in DOM
      const elementsExist = this.verifyDiagnosticElementsExist();

      // If elements missing and we have diagnostics, force reapply immediately
      if (!elementsExist && diagnosticsToApply.length > 0) {
        // FORCE APPLICATION: Bypass all safety checks for external changes
        this.pendingDiagnosticUpdate = false; // Clear pending flag
        this.applyDiagnosticsToEditor(diagnosticsToApply, true); // CRITICAL: force=true
      } else if (
        this.pendingDiagnosticUpdate &&
        diagnosticsToApply.length > 0
      ) {
        // Apply pending updates immediately
        this.pendingDiagnosticUpdate = false;
        this.applyDiagnosticsToEditor(diagnosticsToApply, true); // CRITICAL: force=true
      }
    });

    // Fallback: If immediate application fails, try again after a very short delay
    setTimeout(() => {
      const elementsExist = this.verifyDiagnosticElementsExist();
      if (!elementsExist && diagnosticsToApply.length > 0) {
        this.applyDiagnosticsToEditor(diagnosticsToApply, true); // CRITICAL: force=true
      }
    }, 100); // 100ms fallback safety net
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
      this.pendingDiagnosticUpdate = true;
      return;
    } // Reduced from 150ms to 100ms

    // Proceed with normal scheduling
    this.updateTimer = setTimeout(() => {
      // Double-check safety before actually updating
      if (!force && !this.isSafeToUpdateDiagnostics()) {
        this.pendingDiagnosticUpdate = true;
        return;
      }

      // Generate hash of current diagnostics for comparison
      const currentDiagnosticsHash = this.generateDiagnosticsHash();
      const currentContent = this.vditor?.getValue() || "";

      const contentChanged = currentContent !== this.lastContent;
      const diagnosticsChanged =
        currentDiagnosticsHash !== this.lastDiagnosticsHash;
      const noDiagnosticsApplied =
        !this.diagnosticsApplied || this.matcher.appliedElementCount === 0;

      // Only update if there's a real change or we're forced to
      if (
        force ||
        contentChanged ||
        diagnosticsChanged ||
        noDiagnosticsApplied
      ) {
        if (diagnosticsChanged || noDiagnosticsApplied || force) {
          // OPTIMIZATION: Only clear if diagnostics content actually changed
          // This prevents unnecessary clearing during getValue() operations
          this.clearDiagnosticStyles();
          this.decorations.clearTokens();
          this.applyDiagnosticStyles();
          this.lastDiagnosticsHash = currentDiagnosticsHash;
          this.diagnosticsApplied = true;
        } else if (contentChanged) {
          // Content changed but diagnostics are the same - try to preserve existing diagnostics
          // Only revalidate diagnostics without full clear/reapply
          this.revalidateExistingDiagnostics();
        }
        this.lastContent = currentContent;
      }
      this.updateTimer = null;
    }, 150); // Reduced debounce time
  }
}
