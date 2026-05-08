import { vscodeLogWarn, vscodeLogError } from "./webview-logger";

/**
 * Handles VS Code diagnostic visualization in Vditor editor
 */
export class DiagnosticVisualizer {
  private diagnostics: any[] = [];
  private vditor: any;
  private updateTimer: NodeJS.Timeout | null = null;
  private lastContent = "";
  // Cache of text->span element for reuse (same problematic token on same line)
  private tokenSpanCache: Map<string, HTMLElement> = new Map();
  // Aggregate diagnostics per token key (line|text) for combined tooltip & quick fix
  private tokenDiagnostics: Map<string, any[]> = new Map();
  // Track applied diagnostics by element and character range to prevent overlaps
  private appliedDiagnostics: Map<
    HTMLElement,
    Array<{
      startChar: number;
      endChar: number;
      lineNumber: number;
      diagnosticId: string;
    }>
  > = new Map();
  // Track elements by line number for efficient range checking
  private elementsByLine: Map<number, HTMLElement[]> = new Map();

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
        this.tokenSpanCache.clear();
        this.tokenDiagnostics.clear();
      } else if (!visualElementsExist) {
        // Diagnostics same but missing from DOM - lightweight clear of tracking only
        this.tokenSpanCache.clear();
        this.tokenDiagnostics.clear();
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
   * Apply diagnostic styling to text without creating duplicate elements
   * This method finds and styles the problematic text but does NOT wrap it to avoid duplicates
   */
  private wrapTextWithDiagnostic(
    textNode: Text,
    startOffset: number,
    endOffset: number,
    diagnostic: any
  ): boolean {
    try {
      const text = textNode.textContent || "";
      if (
        startOffset >= text.length ||
        endOffset > text.length ||
        startOffset >= endOffset
      ) {
        return false;
      }

      const diagnosticText = text.substring(startOffset, endOffset);
      const lineKey = `${diagnostic.range?.start?.line ?? "na"}`;
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
      const diagnosticSpan = document.createElement("span");
      diagnosticSpan.className = `vscode-diagnostic-span ${severityClass}`;
      diagnosticSpan.textContent = diagnosticText;
      diagnosticSpan.setAttribute(
        "data-diagnostic-severity",
        diagnostic.severity.toString()
      );

      if (diagnosticText.length === 1) {
        diagnosticSpan.setAttribute("data-single-char", "true");
      }

      // Build combined tooltip content from aggregated diagnostics
      const combinedMessages = this.tokenDiagnostics.get(tokenKey) || [];
      const combinedText = combinedMessages
        .map((d) => `${d.message}${d.source ? ` (${d.source})` : ""}`)
        .join("\n");
      diagnosticSpan.setAttribute("data-diagnostic-message", combinedText);
      diagnosticSpan.setAttribute(
        "data-diagnostic-source",
        combinedMessages
          .map((d) => d.source)
          .filter(Boolean)
          .join(", ")
      );

      // Add enhanced hoverable tooltip with the styling from wrapped text
      this.addHoverableTooltip(diagnosticSpan, {
        message: combinedText,
        source: combinedMessages
          .map((d) => d.source)
          .filter(Boolean)
          .join(", "),
      });

      // Add quick fix lightbulb integrated into the same element
      this.addIntegratedQuickFixLightbulb(diagnosticSpan, diagnostic);

      // Replace the text node with our styled span
      // Duplicate prevention is handled by appliedDiagnostics with character range tracking
      const fragment = document.createDocumentFragment();
      if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
      fragment.appendChild(diagnosticSpan);
      if (afterText) fragment.appendChild(document.createTextNode(afterText));
      const parent = textNode.parentNode;
      if (parent) {
        parent.replaceChild(fragment, textNode);
        return true;
      } else {
        // vscodeLogError(`❌ No parent node found for text node containing: "${diagnosticText}"`);
        return false;
      }
    } catch (error) {
      // vscodeLogError(`❌ Error styling text with diagnostic: ${error}`);
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

      tooltip = document.createElement("div");
      tooltip.className = "vscode-diagnostic-tooltip-hoverable";
      tooltip.setAttribute("data-diagnostic-ui", "true"); // Mark as UI element

      // Create tooltip content with better styling
      const messageContent = document.createElement("div");
      messageContent.className = "vscode-diagnostic-tooltip-content";
      messageContent.textContent = diagnostic.message;

      const sourceContent = document.createElement("div");
      sourceContent.className = "vscode-diagnostic-tooltip-source";
      sourceContent.textContent = diagnostic.source || "Diagnostic";

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

      tooltip.style.position = "fixed";
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
      tooltip.style.zIndex = "10000";
      tooltip.style.userSelect = "text"; // Allow text selection

      // Add event listeners to keep tooltip open when hovering over it
      tooltip.addEventListener("mouseenter", () => {
        isTooltipHovered = true;
      });

      tooltip.addEventListener("mouseleave", () => {
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
    element.addEventListener("mouseenter", () => {
      hoverTimeout = setTimeout(showTooltip, 300); // 300ms delay
    });

    // Hide tooltip when leaving element (with delay to allow moving to tooltip)
    element.addEventListener("mouseleave", () => {
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
      case 1:
        return "vscode-diagnostic-error";
      case 2:
        return "vscode-diagnostic-warning";
      case 3:
        return "vscode-diagnostic-info";
      case 4:
        return "vscode-diagnostic-hint";
      default:
        return "vscode-diagnostic-info";
    }
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
          this.isDescendantOf(span, cursorElement) ||
          this.isDescendantOf(cursorElement, span as Node))
      ) {
        // Set flag to indicate diagnostics were skipped
        this.hasSkippedDiagnostics = true;
        this.pendingDiagnosticUpdate = true;
        return; // Skip this element
      }

      // Use centralized method to remove styling AND tracking
      this.removeDiagnosticStylingFromElement(span as HTMLElement);
    });

    // Clean up lightbulb overlays (completely separate system)
    this.cleanupLightbulbOverlays();

    // Clear applied diagnostic tracking
    this.clearAppliedDiagnosticTracking();
  }

  /**
   * Remove diagnostic styling from a specific span element and clean up tracking data
   * CENTRALIZED method to ensure appliedDiagnostics is always synchronized with DOM
   *
   * IMPORTANT: appliedDiagnostics is keyed by the PARENT element (where the span was inserted),
   * not by the span itself. This matches how we record diagnostics in recordAppliedDiagnostic().
   */
  private removeDiagnosticStylingFromElement(span: HTMLElement): void {
    // Get the parent element - this is where the diagnostic is tracked
    const parentElement = span.parentElement;

    // Remove diagnostic classes and attributes only
    span.className = span.className
      .replace(/\bvscode-diagnostic-\w+\b/g, "")
      .trim();
    span.removeAttribute("data-diagnostic-message");
    span.removeAttribute("data-diagnostic-source");
    span.removeAttribute("data-diagnostic-severity");
    span.removeAttribute("data-diagnostic-ui");
    span.removeAttribute("data-single-char");
    span.removeAttribute("data-has-lightbulb");

    if (!span.className.trim()) {
      // If no classes remain, remove class attribute entirely
      span.removeAttribute("class");
    }

    // CRITICAL: Remove from appliedDiagnostics tracking using PARENT element as key
    // The diagnostic was recorded on the parent element, not on the span itself
    if (parentElement && this.appliedDiagnostics.has(parentElement)) {
      this.appliedDiagnostics.delete(parentElement);
    }

    // Remove parent element from elementsByLine map
    if (parentElement) {
      this.elementsByLine.forEach((elements, lineNumber) => {
        const index = elements.indexOf(parentElement);
        if (index > -1) {
          elements.splice(index, 1);
          if (elements.length === 0) {
            this.elementsByLine.delete(lineNumber);
          }
        }
      });
    }

    // Only unwrap if span is completely empty of useful classes/attributes
    if (!span.hasAttributes()) {
      const parent = span.parentNode;
      if (parent) {
        // Create document fragment to safely move children
        const fragment = document.createDocumentFragment();

        // Move ALL child nodes (including text nodes, elements, etc.)
        while (span.firstChild) {
          fragment.appendChild(span.firstChild);
        }

        // Insert fragment before span, then remove span
        parent.insertBefore(fragment, span);
        parent.removeChild(span);
      }
    }
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
        this.removeDiagnosticStylingFromElement(span as HTMLElement);
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
    // Find editor element for diagnostic count (but we won't remove anything from it)
    const editor =
      document.querySelector(".vditor-ir .vditor-reset") ||
      document.querySelector(".vditor-wysiwyg .vditor-reset") ||
      document.querySelector(".vditor-sv .vditor-reset");

    // FUNDAMENTAL PRINCIPLE: Do NOT remove ANY elements from the editor content
    // The editor contains actual content with diagnostic styling - that must NEVER be removed
    // Only clean up true overlay elements that are positioned separately

    // 1. Clean up the dedicated lightbulb overlay system (Map-based overlays)
    this.cleanupLightbulbOverlays();

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
    this.applySinglePassDiagnostics(editor as HTMLElement, cursorElement);

    // Verify that spans were actually created
    const spansCreated = editor.querySelectorAll(
      ".vscode-diagnostic-span"
    ).length;
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
  private applySinglePassDiagnostics(
    editor: HTMLElement,
    cursorElement?: Element | null
  ): void {
    // Step 1: Sort diagnostics by line number for efficient processing
    const sortedDiagnostics = this.prepareSortedDiagnostics();
    if (sortedDiagnostics.length === 0) {
      return;
    }

    // Step 2: Get all block elements that could represent markdown lines
    const blockElements = this.getMarkdownBlockElements(editor);

    // Step 3: Filter out the cursor element to avoid disrupting user's typing
    // Also track which diagnostics would apply to cursor element for later application
    const safeElements = cursorElement
      ? blockElements.filter(
          (item) =>
            item.element !== cursorElement &&
            !this.isDescendantOf(item.element, cursorElement) &&
            !this.isDescendantOf(cursorElement, item.element)
        )
      : blockElements;

    if (cursorElement && safeElements.length < blockElements.length) {
      // Mark that we skipped some diagnostics due to cursor position
      this.hasSkippedDiagnostics = true;
    }

    // Step 4: Single pass through safe DOM elements, matching with sorted diagnostics
    this.matchDiagnosticsToElements(safeElements, sortedDiagnostics);
  }

  /**
   * Check if diagnostic is high confidence (specific patterns we trust)
   */
  private isHighConfidenceDiagnostic(diagnostic: any): boolean {
    const message = diagnostic.message?.toLowerCase() || "";
    const source = diagnostic.source || "";
    const range = diagnostic.range;

    // High-confidence diagnostic sources
    const trustedSources = [
      "markdownlint",
      "markdown-link-check",
      "textlint",
      "remark-lint",
      "cspell", // Spelling checker
      "spell-checker", // Alternative spelling checker
      "spell", // Generic spell checker
      "grammar", // Grammar checkers
      "languagetool", // Language tool
    ];

    // Check if source is trusted
    const isTrustedSource = trustedSources.some((pattern) =>
      source.toLowerCase().includes(pattern.toLowerCase())
    );

    if (!isTrustedSource) {
      return false;
    }

    // Additional validation for diagnostics with valid range information
    if (range && range.start && range.end) {
      const hasValidRange =
        typeof range.start.line === "number" &&
        typeof range.start.character === "number" &&
        typeof range.end.line === "number" &&
        typeof range.end.character === "number";

      if (!hasValidRange) {
        return false;
      }
    }

    // Spelling/grammar errors - high confidence with range info
    if (
      source.toLowerCase().includes("spell") ||
      source.toLowerCase().includes("cspell")
    ) {
      const hasSpellingPatterns =
        message.includes("misspelled") ||
        message.includes("unknown word") ||
        message.includes("not found") ||
        message.includes("spelling");

      if (hasSpellingPatterns && range) {
        return true;
      }
    }

    // Markdownlint diagnostics - high confidence
    if (source.toLowerCase().includes("markdownlint")) {
      return true;
    }

    // Grammar and style checkers
    if (
      source.toLowerCase().includes("grammar") ||
      source.toLowerCase().includes("languagetool")
    ) {
      return true;
    }

    // Link and reference checkers
    if (
      source.toLowerCase().includes("link-check") ||
      message.includes("broken") ||
      message.includes("missing")
    ) {
      return true;
    }

    // Default: If we have a trusted source but didn't match specific patterns, still allow it
    return true;
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
   * Add quick fix lightbulb as a completely separate overlay (never touches document content)
   */
  /**
   * Add integrated quick fix lightbulb directly to the diagnostic span (no separate overlay)
   */
  private addIntegratedQuickFixLightbulb(
    element: HTMLElement,
    diagnostic: any
  ): void {
    // Only add lightbulb for diagnostics that likely have quick fixes
    const hasQuickFix = this.diagnosticHasQuickFix(diagnostic);
    if (!hasQuickFix) {
      return;
    }

    // Don't add multiple lightbulbs to the same element
    if (element.getAttribute("data-has-lightbulb") === "true") {
      return;
    }

    // Add lightbulb styling directly to the span
    element.setAttribute("data-has-lightbulb", "true");

    // Lightbulb CSS is already defined in main.css - no need to add dynamic styles

    // Add click handler to the entire element
    element.addEventListener("click", (e) => {
      // Only trigger if clicking near the lightbulb area (right side of element)
      const rect = element.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const elementWidth = rect.width;

      // If clicking in the rightmost 25% of the element (where lightbulb appears), trigger quick fix
      if (clickX > elementWidth * 0.75) {
        e.preventDefault();
        e.stopPropagation();
        this.triggerQuickFix(diagnostic);
      }
    });
  }

  /**
   * Clean up integrated lightbulb styling (replaces old overlay cleanup)
   */
  private cleanupLightbulbOverlays(): void {
    // Remove integrated lightbulb attributes from all elements
    const elementsWithLightbulbs = document.querySelectorAll(
      '[data-has-lightbulb="true"]'
    );
    let removedCount = 0;

    elementsWithLightbulbs.forEach((element) => {
      const htmlElement = element as HTMLElement;
      htmlElement.removeAttribute("data-has-lightbulb");
      htmlElement.style.removeProperty("--lightbulb-display");
      removedCount++;
    });
  }

  /**
   * Check if diagnostic likely has quick fixes available
   */
  private diagnosticHasQuickFix(diagnostic: any): boolean {
    const source = diagnostic.source?.toLowerCase() || "";
    const message = diagnostic.message?.toLowerCase() || "";

    // Common sources that typically have quick fixes
    const quickFixSources = [
      "markdownlint",
      "eslint",
      "tslint",
      "pylint",
      "spell",
      "cspell",
    ];

    // Common message patterns that suggest quick fixes
    const quickFixPatterns = [
      "should be",
      "expected",
      "missing",
      "incorrect",
      "invalid",
      "unknown word",
      "misspelled",
      "fix available",
    ];

    return (
      quickFixSources.some((s) => source.includes(s)) ||
      quickFixPatterns.some((p) => message.includes(p))
    );
  }

  /**
   * Open VS Code problems panel for user to choose what to fix
   */
  private triggerQuickFix(diagnostic: any): void {
    // Simply open the problems panel for the user to choose what to fix
    if ((window as any).vscode) {
      (window as any).vscode.postMessage({
        command: "openProblemsPanel",
      });
    }
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
    if (!force && this.diagnosticsApplied && this.appliedDiagnostics.size > 0) {
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
    } else {
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
   * Prepare and sort diagnostics by line number for efficient processing
   */
  private prepareSortedDiagnostics(): Array<{
    diagnostic: any;
    lineNumber: number;
    lineText: string;
  }> {
    const validDiagnostics: Array<{
      diagnostic: any;
      lineNumber: number;
      lineText: string;
    }> = [];

    // Basic de-duplication: ensure each (rangeStart, rangeEnd, message) triple only applied once
    const seen = new Set<string>();

    for (const diagnostic of this.diagnostics) {
      // Create deduplication key
      const key = `${diagnostic.range?.start?.line}:${
        diagnostic.range?.start?.character
      }-${diagnostic.range?.end?.line}:${diagnostic.range?.end?.character}|${
        diagnostic.message
      }|${diagnostic.code || ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      // Only include diagnostics with valid line information
      const lineNumber = diagnostic.range?.start?.line;
      const lineText = diagnostic.lineText || "";

      if (lineNumber !== undefined && lineText.trim()) {
        // Filter to only high-confidence diagnostics to avoid false positives
        if (this.isHighConfidenceDiagnostic(diagnostic)) {
          validDiagnostics.push({
            diagnostic,
            lineNumber,
            lineText: lineText.trim(),
          });
        } else {
        }
      } else {
      }
    }

    // Sort by line number for efficient processing
    validDiagnostics.sort((a, b) => a.lineNumber - b.lineNumber);

    return validDiagnostics;
  }

  /**
   * Get markdown block elements that could represent lines in the document
   */
  private getMarkdownBlockElements(
    editor: HTMLElement
  ): Array<{ element: HTMLElement; index: number }> {
    const blockElements: Array<{ element: HTMLElement; index: number }> = [];

    // Selectors for block elements that typically represent markdown lines
    const blockSelectors = [
      "p", // Paragraphs
      "h1, h2, h3, h4, h5, h6", // Headings
      "li", // List items
      "blockquote", // Block quotes
      "pre", // Code blocks
      "div.vditor-ir__node", // Vditor IR nodes
      "div.vditor-ir__marker", // Vditor IR markers
    ];

    let index = 0;
    for (const selector of blockSelectors) {
      const elements = Array.from(editor.querySelectorAll(selector));
      for (const element of elements) {
        const htmlElement = element as HTMLElement;
        const text = htmlElement.textContent || "";

        // Only include elements with meaningful text content
        if (text.trim().length > 0) {
          blockElements.push({
            element: htmlElement,
            index: index++,
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
        return 1; // a comes after b
      }
      return 0; // same position
    });

    // Update indices after sorting
    blockElements.forEach((item, idx) => {
      item.index = idx;
    });

    return blockElements;
  }

  /**
   * Check if target text appears as a complete word (not part of another word)
   */
  private isCompleteWord(
    text: string,
    targetText: string,
    startIndex: number
  ): boolean {
    const beforeChar = startIndex > 0 ? text[startIndex - 1] : " ";
    const afterIndex = startIndex + targetText.length;
    const afterChar = afterIndex < text.length ? text[afterIndex] : " ";

    // Word boundary characters (whitespace, punctuation)
    const wordBoundary = /[\s\W]/;

    return wordBoundary.test(beforeChar) && wordBoundary.test(afterChar);
  }

  /**
   * Check if element text closely matches the expected line text
   */
  private isExactLineMatch(elementText: string, lineText: string): boolean {
    const cleanElement = elementText.trim().replace(/\s+/g, " ");
    const cleanLine = lineText.trim().replace(/\s+/g, " ");
    return cleanElement === cleanLine;
  }

  /**
   * Match diagnostics to DOM elements using content-based matching
   */
  private matchDiagnosticsToElements(
    blockElements: Array<{ element: HTMLElement; index: number }>,
    sortedDiagnostics: Array<{
      diagnostic: any;
      lineNumber: number;
      lineText: string;
    }>
  ): void {
    let appliedCount = 0;

    // Strategy: For each diagnostic, find the element that contains its target text
    for (const { diagnostic, lineNumber, lineText } of sortedDiagnostics) {
      const range = diagnostic.range;
      const startChar = range?.start?.character || 0;
      const endChar = range?.end?.character || startChar + 1;
      const targetText = lineText.substring(startChar, endChar);

      if (!targetText.trim()) {
        continue;
      }

      // Validate that the target text actually appears in the line at the expected position
      if (lineText.substring(startChar, endChar) !== targetText) {
        continue;
      }

      // CRITICAL: Check if this exact diagnostic has already been applied anywhere
      // This replaces the old wrappedKeys check and prevents duplicate application
      if (
        this.isDiagnosticAlreadyApplied(
          diagnostic,
          lineNumber,
          startChar,
          endChar
        )
      ) {
        continue;
      }

      let bestMatch: {
        element: HTMLElement;
        index: number;
        confidence: number;
        matchType: string;
      } | null = null;

      // Find elements that contain the target text with word boundary validation
      for (let i = 0; i < blockElements.length; i++) {
        const { element, index } = blockElements[i];
        const elementText = element.textContent || "";

        // Check if element contains the target text
        const targetIndex = elementText.indexOf(targetText);
        if (targetIndex === -1) {
          continue;
        }

        // CRITICAL: Validate word boundaries to prevent partial matches
        if (!this.isCompleteWord(elementText, targetText, targetIndex)) {
          continue;
        }

        // Check if this element already has a diagnostic applied for overlapping ranges
        // Only check for overlaps on the SAME element - different elements can have same char ranges
        if (
          this.hasOverlappingDiagnostic(
            element,
            startChar,
            endChar,
            lineNumber,
            diagnostic
          )
        ) {
          continue;
        }

        let confidence = 0;
        let matchType = "";

        // PRIORITY 1: Exact line text match (highest priority)
        if (this.isExactLineMatch(elementText, lineText)) {
          confidence = 1000; // Very high base score
          matchType = "exact-line-match";
        }
        // PRIORITY 2: Perfect line match (trimmed comparison)
        else if (elementText.trim() === lineText.trim()) {
          confidence = 900; // Very high base score
          matchType = "perfect-line-match";
        }
        // PRIORITY 3: Line contained in element (for multi-line elements)
        else if (elementText.includes(lineText.trim())) {
          confidence = 500; // High base score
          matchType = "line-contained";
        }
        // PRIORITY 4: Target text found with word boundaries (minimum requirement)
        else {
          confidence = 250; // Higher base score to account for proximity penalties
          matchType = "target-text-found";
        }

        // Position-based scoring with line number preference
        const positionDifference = Math.abs(lineNumber - index);

        // More balanced proximity scoring - less harsh penalties
        let proximityBonus = 0;
        if (positionDifference === 0) {
          proximityBonus = 300; // Perfect line number match
        } else if (positionDifference <= 1) {
          proximityBonus = 100; // Very close (±1 line)
        } else if (positionDifference <= 3) {
          proximityBonus = 50; // Reasonably close (±3 lines)
        } else if (positionDifference <= 5) {
          proximityBonus = 20; // Moderately close (±5 lines)
        } else if (positionDifference <= 10) {
          proximityBonus = 0; // Neutral for medium distance
        } else {
          // Gentle penalty for being very far from expected line
          proximityBonus = -Math.min(30, (positionDifference - 10) * 2);
        }

        // BONUS: Extra points for exact line number alignment
        if (index === lineNumber) {
          proximityBonus += 50; // Bonus for exact line number match
        }

        // ADDITIONAL: Character position bonus for multiple occurrences of same word
        // If the same word appears multiple times in the element, prefer the occurrence
        // that's closest to the expected character position within the line
        const expectedCharPos = startChar;
        const targetOccurrences = [];
        let searchPos = 0;
        while (
          (searchPos = elementText.indexOf(targetText, searchPos)) !== -1
        ) {
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
            charPositionBonus = 100; // Very close character position
          } else if (charPosDiff <= 20) {
            charPositionBonus = 25; // Reasonably close
          }
        }

        confidence += proximityBonus + charPositionBonus;

        // Prefer matches with better match types, then higher confidence
        if (
          !bestMatch ||
          confidence > bestMatch.confidence ||
          (confidence === bestMatch.confidence &&
            matchType === "exact-line-match")
        ) {
          bestMatch = { element, index, confidence, matchType };
        }
      }

      // Apply diagnostic if we found a good match - prioritize exact line matches
      // For target-text-found matches, be more lenient since word boundaries are now validated
      const isStrictMatch =
        bestMatch?.matchType === "exact-line-match" ||
        bestMatch?.matchType === "perfect-line-match";
      const isLineContained = bestMatch?.matchType === "line-contained";
      const isReasonableProximity = bestMatch
        ? Math.abs(lineNumber - bestMatch.index) <= 15
        : false;

      // More lenient acceptance criteria since we now have word boundary validation
      if (
        bestMatch &&
        (isStrictMatch ||
          isLineContained ||
          (bestMatch.confidence >= 100 && isReasonableProximity))
      ) {
        const matchResult = {
          matched: true,
          confidence: bestMatch.confidence,
          matchType: bestMatch.matchType,
          targetText: targetText,
          charRange: { start: startChar, end: endChar },
        };

        if (
          this.applyDiagnosticToMatchedElement(
            bestMatch.element,
            diagnostic,
            matchResult
          )
        ) {
          appliedCount++;
        }
      } else {
        // FALLBACK: If we have a word-boundary validated match but it's just below threshold, be more lenient
        if (bestMatch && bestMatch.confidence >= 80) {
          const matchResult = {
            matched: true,
            confidence: bestMatch.confidence,
            matchType: bestMatch.matchType,
            targetText: targetText,
            charRange: { start: startChar, end: endChar },
          };

          if (
            this.applyDiagnosticToMatchedElement(
              bestMatch.element,
              diagnostic,
              matchResult
            )
          ) {
            appliedCount++;
          }
        } else {
          const reason = bestMatch
            ? `confidence ${bestMatch.confidence.toFixed(
                1
              )} < 100 or proximity ${Math.abs(
                lineNumber - bestMatch.index
              )} > 15`
            : "no match found";

          // Log some elements that might have been close
          for (
            let i = Math.max(0, lineNumber - 3);
            i < Math.min(blockElements.length, lineNumber + 3);
            i++
          ) {
            if (i < blockElements.length) {
              const elementText = (
                blockElements[i].element.textContent || ""
              ).substring(0, 50);
            }
          }
        }
      }
    }
  }

  /**
   * Apply diagnostic styling to a matched element using precise character ranges
   */
  private applyDiagnosticToMatchedElement(
    element: HTMLElement,
    diagnostic: any,
    matchResult: {
      matched: boolean;
      confidence: number;
      matchType: string;
      targetText?: string;
      charRange?: { start: number; end: number };
    }
  ): boolean {
    const range = diagnostic.range;
    const lineText = diagnostic.lineText || "";
    const lineNumber = range?.start?.line;

    if (!range || !lineText.trim()) {
      return false;
    }

    const startChar = range.start?.character || 0;
    const endChar = range.end?.character || startChar + 1;
    const targetText =
      matchResult.targetText || lineText.substring(startChar, endChar).trim();

    if (!targetText) {
      // vscodeLogError(`❌ Cannot apply diagnostic: no target text identified`);
      return false;
    }

    // CRITICAL FIX: Record BEFORE wrapping to prevent within-cycle duplicates
    // During TreeWalker traversal, multiple text nodes with same content would be wrapped
    // before appliedDiagnostics map gets populated. Recording first prevents this.
    this.recordAppliedDiagnostic(
      element,
      startChar,
      endChar,
      lineNumber,
      diagnostic
    );

    // Try to find and wrap the specific target text within the element
    const applied = this.findAndWrapPreciseTextInElement(
      element,
      targetText,
      diagnostic,
      startChar,
      endChar
    );

    if (!applied) {
      // Cleanup: Remove the record since wrapping failed
      this.removeAppliedDiagnostic(
        element,
        startChar,
        endChar,
        lineNumber,
        diagnostic
      );
      // vscodeLogError(`❌ Failed to apply diagnostic: could not locate target text "${targetText}"`);
    }

    return applied;
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
    const elementText = element.textContent || "";

    // Strategy 1: Direct search for target text
    let targetIndex = elementText.indexOf(targetText);

    // Strategy 2: If multiple occurrences, try to find the right one based on character position
    if (targetIndex !== -1) {
      const allOccurrences: number[] = [];
      let searchIndex = 0;

      // Find all occurrences of the target text
      while (
        (searchIndex = elementText.indexOf(targetText, searchIndex)) !== -1
      ) {
        allOccurrences.push(searchIndex);
        searchIndex += targetText.length;
      }

      if (allOccurrences.length > 1) {
        // Multiple occurrences - try to find the best match based on character position
        targetIndex = this.selectBestOccurrenceByPosition(
          allOccurrences,
          originalStartChar,
          elementText,
          targetText
        );
      }
    }

    // Strategy 3: Case-insensitive search if exact search failed
    if (targetIndex === -1) {
      const lowerElementText = elementText.toLowerCase();
      const lowerTargetText = targetText.toLowerCase();
      targetIndex = lowerElementText.indexOf(lowerTargetText);

      if (targetIndex !== -1) {
        // Update targetText to match the actual case in the element
        targetText = elementText.substring(
          targetIndex,
          targetIndex + targetText.length
        );
      }
    }

    if (targetIndex === -1) {
      // vscodeLogError(`❌ Target text "${targetText}" not found in element text`);
      // Fallback: apply styling to entire element
      // this.addDiagnosticStylingToElement(element, diagnostic);
      return false;
    }

    // Find the text node containing the target text and wrap it
    return this.wrapTextAtPositionInElement(
      element,
      targetIndex,
      targetText.length,
      diagnostic
    );
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

    // Additional context-based filtering for common cases
    if (bestDistance > 10 && occurrences.length > 1) {
      // If the best match is still far, try context-based selection
      bestIndex = this.selectOccurrenceByContext(
        occurrences,
        originalCharPosition,
        elementText,
        targetText
      );
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
        const beforeChar = occurrence > 0 ? elementText[occurrence - 1] : " ";
        const afterChar =
          occurrence < elementText.length - 1
            ? elementText[occurrence + 1]
            : " ";

        // For lowercase letters, prefer occurrences that are mid-word (not at sentence start)
        if (char === char.toLowerCase() && char !== char.toUpperCase()) {
          if (
            beforeChar !== " " &&
            beforeChar !== "." &&
            beforeChar !== "!" &&
            beforeChar !== "?"
          ) {
            return occurrence;
          }
        }

        // For uppercase letters, prefer occurrences at word/sentence start
        if (char === char.toUpperCase() && char !== char.toLowerCase()) {
          if (
            beforeChar === " " ||
            beforeChar === "." ||
            beforeChar === "!" ||
            beforeChar === "?" ||
            occurrence === 0
          ) {
            return occurrence;
          }
        }
      }
    }

    // Fallback: return closest to original position
    return occurrences.reduce((best, current) =>
      Math.abs(current - originalCharPosition) <
      Math.abs(best - originalCharPosition)
        ? current
        : best
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
      const content = textNode.textContent || "";
      const nodeEnd = currentPosition + content.length;

      // Check if the target position is within this text node
      if (position >= currentPosition && position < nodeEnd) {
        const relativeStart = position - currentPosition;
        const relativeEnd = Math.min(relativeStart + length, content.length);

        return this.wrapTextWithDiagnostic(
          textNode,
          relativeStart,
          relativeEnd,
          diagnostic
        );
      }

      currentPosition = nodeEnd;
    }

    return false;
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
      const hasCharOverlap =
        startChar < applied.endChar && endChar > applied.startChar;

      // Check for line number conflict (different line numbers shouldn't share same element range)
      const hasDifferentLine =
        lineNumber !== undefined &&
        applied.lineNumber !== undefined &&
        lineNumber !== applied.lineNumber;

      if (hasCharOverlap) {
        return true;
      }

      if (hasDifferentLine && hasCharOverlap) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a specific diagnostic has already been applied to any element
   * This replaces the old wrappedKeys check for duplicate prevention across all elements
   */
  private isDiagnosticAlreadyApplied(
    diagnostic: any,
    lineNumber: number | undefined,
    startChar: number,
    endChar: number
  ): boolean {
    const diagnosticId = this.generateDiagnosticId(diagnostic);

    // Check all applied diagnostics across all elements
    for (const [element, appliedList] of this.appliedDiagnostics.entries()) {
      for (const applied of appliedList) {
        // Check if this is the exact same diagnostic (same ID, line, and char range)
        if (
          applied.diagnosticId === diagnosticId &&
          applied.lineNumber === (lineNumber || -1) &&
          applied.startChar === startChar &&
          applied.endChar === endChar
        ) {
          return true;
        }
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
    const message = diagnostic.message || "";
    const code = diagnostic.code || "";

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
      diagnosticId,
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
  }

  /**
   * Remove a diagnostic record from an element (cleanup after failed wrapping)
   */
  private removeAppliedDiagnostic(
    element: HTMLElement,
    startChar: number,
    endChar: number,
    lineNumber: number | undefined,
    diagnostic: any
  ): void {
    const diagnosticId = this.generateDiagnosticId(diagnostic);

    if (!this.appliedDiagnostics.has(element)) {
      return;
    }

    // Filter out the matching diagnostic record
    const appliedList = this.appliedDiagnostics.get(element)!;
    const filtered = appliedList.filter(
      (applied) =>
        !(
          applied.diagnosticId === diagnosticId &&
          applied.startChar === startChar &&
          applied.endChar === endChar
        )
    );

    if (filtered.length === 0) {
      // No more diagnostics on this element, remove it completely
      this.appliedDiagnostics.delete(element);

      // Also remove from elementsByLine if applicable
      if (lineNumber !== undefined && this.elementsByLine.has(lineNumber)) {
        const lineElements = this.elementsByLine.get(lineNumber)!;
        const elementIndex = lineElements.indexOf(element);
        if (elementIndex !== -1) {
          lineElements.splice(elementIndex, 1);
        }
        if (lineElements.length === 0) {
          this.elementsByLine.delete(lineNumber);
        }
      }
    } else {
      // Update with filtered list
      this.appliedDiagnostics.set(element, filtered);
    }
  }

  /**
   * Clear all applied diagnostic tracking (call when content changes)
   */
  private clearAppliedDiagnosticTracking(): void {
    this.appliedDiagnostics.clear();
    this.elementsByLine.clear();
    this.diagnosticsApplied = false;
    this.lastDiagnosticsHash = "";
    // CRITICAL: Also clear duplicate detection state
    this.tokenSpanCache.clear();
    this.tokenDiagnostics.clear();
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
    const appliedCount = this.appliedDiagnostics.size;

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
      const diagnosticMessage =
        element.getAttribute("data-diagnostic-message") || "";

      // Check if the element still makes sense in context
      if (!textContent.trim() || textContent.includes("💡")) {
        invalidElements++;
      }
    });

    if (invalidElements > 0) {
      this.clearDiagnosticStyles();
      this.applyDiagnosticStyles();
    } else {
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

    const elementInfo = `${element.tagName}.${
      element.className || "(no-class)"
    }`;

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
      const hasDiagnostics = this.elementHasDiagnostics(element);
      if (hasDiagnostics) {
      }
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
        !this.isDescendantOf(targetElement, currentCursor) &&
        !this.isDescendantOf(currentCursor, targetElement));

    if (elementIsSafe) {
      this.pendingDiagnosticUpdate = false;

      // Apply diagnostics but exclude the current cursor element
      this.applyDiagnosticStyles();
    } else {
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
    }

    // OPTIMIZATION: Reduce debounce delay for faster diagnostic updates
    const debounceDelay = force ? 0 : 100; // Reduced from 150ms to 100ms

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
        !this.diagnosticsApplied || this.appliedDiagnostics.size === 0;

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
          this.tokenSpanCache.clear();
          this.tokenDiagnostics.clear();
          this.applyDiagnosticStyles();
          this.lastDiagnosticsHash = currentDiagnosticsHash;
          this.diagnosticsApplied = true;
        } else if (contentChanged) {
          // Content changed but diagnostics are the same - try to preserve existing diagnostics
          // Only revalidate diagnostics without full clear/reapply
          this.revalidateExistingDiagnostics();
        }
        this.lastContent = currentContent;
      } else {
      }
      this.updateTimer = null;
    }, 150); // Reduced debounce time
  }
}
