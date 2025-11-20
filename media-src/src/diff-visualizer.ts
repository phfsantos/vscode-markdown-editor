import { vscodeLogWarn, vscodeLogError } from "./webview-logger";

/**
 * Handles diff visualization in the markdown editor webview
 */

// Debounce and throttle timing constants (in milliseconds)
const DEBOUNCE_INPUT_REAPPLY_MS = 500;    // Wait time after input before re-applying decorations
const DEBOUNCE_DIFF_UPDATE_MS = 500;       // Wait time in EditorPanel before full diff recalculation
const THROTTLE_SCROLL_SYNC_MS = 50;        // Max scroll sync messages per second (20/sec)
const DEBOUNCE_SCROLL_FINAL_MS = 100;      // Wait time after scrolling stops for final position
const TIMEOUT_HTML_REQUEST_MS = 5000;      // Timeout for IR HTML content requests
const DELAY_DIAGNOSTICS_REAPPLY_MS = 50;   // Short delay before re-applying diagnostics
const DELAY_VDITOR_RENDER_MS = 1000;       // Wait time for Vditor to fully render content

/**
 * Represents a single change in the diff between two documents
 * @interface DiffChange
 */
interface DiffChange {
  /** Type of change: added, deleted, modified, or spacer (alignment placeholder) */
  type: "added" | "deleted" | "modified" | "spacer";
  /** Line number in the target document (includes offset from spacers) */
  lineNumber: number;
  /** HTML content of the changed line */
  content: string;
  /** Original content before modification (only for 'modified' type) */
  oldContent?: string;
  /** Which side(s) this change affects: left (original), right (modified), or both */
  side: "left" | "right" | "both";
  /** Original line number in left document (-1 for spacers/additions) */
  leftLine?: number;
  /** Original line number in right document (-1 for spacers/deletions) */
  rightLine?: number;
}

/**
 * Contains all diff information for a single editor panel
 * @interface DiffInfo
 */
interface DiffInfo {
  /** Role of this panel: left (original) or right (modified) */
  role: "left" | "right";
  /** URI of the other file in the diff pair */
  otherUri: string;
  /** Unique instance ID for this editor panel */
  instanceId?: string;
  /** Array of all changes (including spacers) for this diff */
  changes: DiffChange[];
  /** Statistics about the changes */
  stats: {
    added: number;
    deleted: number;
    modified: number;
    /** Number of spacer lines inserted for alignment */
    spacers?: number;
  };
}

/**
 * Tracks applied decorations in the DOM for idempotency checks
 * @interface DecorationInfo
 */
interface DecorationInfo {
  /** Type of decoration applied */
  type: "added" | "deleted" | "modified" | "spacer";
  /** Line number where decoration is applied */
  lineNumber: number;
  /** Unique identifier for this decoration instance */
  decorationId: string;
}

export class DiffVisualizer {
  private diffInfo: DiffInfo | null = null;
  private isInDiffView = false;
  private scrollSyncEnabled = true;
  private isScrolling = false;
  private scrollTimeout: number | null = null;
  private scrollDebounceTimeout: number | null = null;
  private lastScrollSyncTime = 0;
  private initialized = false;
  
  // Tracking system for idempotent decoration application
  private appliedDecorations: Map<HTMLElement, DecorationInfo> = new Map();
  private lastDiffHash: string = "";
  private isApplyingDiff: boolean = false;
  private inputDebounceTimeout: number | null = null;

  /**
   * Initialize the diff visualizer by setting up message listeners.
   * This should be called once during application startup.
   */
  public initialize(): void {
    if (this.initialized) {
      return;
    }
    this.setupMessageListener();
    this.setupScrollSync();
    this.setupInputListener();
    this.initialized = true;
  }

  private setupMessageListener(): void {
    window.addEventListener("message", (event) => {
      const message = event.data;

      if (message.type === "diff-view-detected") {
        if ((window as any).markdownEditorLog) {
          (window as any).markdownEditorLog(
            `[DIFF-VIZ] 📨 Received diff-view-detected: role=${message.diffInfo?.role}, changes=${message.diffInfo?.changes?.length}, isHtmlBased=${message.diffInfo?.isHtmlBased}`
          );
        }

        this.diffInfo = message.diffInfo;
        this.isInDiffView = true;

        // Clear existing spacers if requested (to prevent duplication)
        if (message.diffInfo.clearExistingSpacers) {
          if ((window as any).markdownEditorLog) {
            (window as any).markdownEditorLog(
              `[DIFF-VIZ] 🧹 Clearing existing spacers...`
            );
          }
          this.clearSpacerBlocks();
        }

        this.applyDiffVisualizations();

        // Re-apply diagnostics if requested
        if (
          message.diffInfo.reapplyDiagnostics &&
          (window as any).diagnosticVisualizer
        ) {
          // Use setTimeout to ensure diff visualizations are applied first
          // Force re-application to bypass smart checks since DOM may have been modified
          setTimeout(() => {
            (window as any).diagnosticVisualizer.addSimpleDiagnostics(true);
          }, DELAY_DIAGNOSTICS_REAPPLY_MS);
        }
      } else if (message.type === "diff-view-cleared") {
        // Clear diff visualization
        this.clearDiffVisualizations();
      } else if (message.type === "diff-scroll-sync") {
        // Receive scroll sync from other editor
        this.applyScrollFromOther(message.scrollPercentage);
      }
    });
  }

  /**
   * Setup input event listener to re-apply decorations after Vditor strips them
   * Vditor removes styles and data attributes when content is edited, so we need to re-apply
   */
  private setupInputListener(): void {
    // Listen for input events on the document (will bubble from Vditor)
    document.addEventListener('input', (e) => {
      // Only process if we're in diff view
      if (!this.isInDiffView || !this.diffInfo) {
        return;
      }

      // Debounce: wait 300ms after last input before re-applying
      if (this.inputDebounceTimeout) {
        clearTimeout(this.inputDebounceTimeout);
      }

      this.inputDebounceTimeout = window.setTimeout(() => {
        this.reapplyDecorationsAfterInput();
      }, DEBOUNCE_INPUT_REAPPLY_MS);
    }, { passive: true });
  }

  /**
   * Re-apply decorations after input events (Vditor strips them during editing)
   * This is lighter than full applyDiffVisualizations - just re-applies to existing elements
   */
  private reapplyDecorationsAfterInput(): void {
    if (!this.diffInfo || this.isApplyingDiff) {
      return;
    }

    // Get the content element
    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (!contentElement) {
      return;
    }

    // Build current line mapping
    const lineToDom: Map<number, HTMLElement> = new Map();
    const topLevelElements = Array.from(contentElement.children);
    topLevelElements.forEach((el, index) => {
      lineToDom.set(index, el as HTMLElement);
    });

    // Re-apply decorations to lines that need them
    this.diffInfo.changes.forEach((change) => {
      // Filter: only process changes for this side
      if (change.side !== this.diffInfo!.role && change.side !== "both") {
        return;
      }

      // Skip spacers (they're separate elements)
      if (change.type === "spacer") {
        return;
      }

      const targetElement = lineToDom.get(change.lineNumber);
      if (!targetElement) {
        return;
      }

      // Check if decoration needs re-application
      // If element lost its data-diff-type attribute, Vditor stripped it
      if (!targetElement.hasAttribute('data-diff-type')) {
        // Re-apply the decoration
        const color = this.getChangeColor(change.type);
        targetElement.style.backgroundColor = color.bg;
        targetElement.style.borderLeft = `3px solid ${color.border}`;
        targetElement.style.paddingLeft = "4px";
        targetElement.title = this.getChangeTooltip(change);

        // Re-record the decoration
        this.recordAppliedDecoration(targetElement, change.type, change.lineNumber);
      }
    });
  }

  /**
   * Apply diff visualizations to the editor
   * Now with smart hash-based application and concurrent prevention
   */
  private applyDiffVisualizations(): void {
    if (!this.diffInfo) {
      if ((window as any).markdownEditorLog) {
        (window as any).markdownEditorLog(
          `[DIFF-VIZ] ⚠️  No diffInfo, skipping visualization`
        );
      }
      return;
    }

    // PREVENT CONCURRENT APPLICATION
    if (this.isApplyingDiff) {
      return;
    }

    // SMART APPLICATION: Check if diff info actually changed
    const newHash = this.generateDiffHash();
    const decorationsExist = this.verifyDiffDecorationsExist();

    if (newHash === this.lastDiffHash && decorationsExist) {
      return;
    }

    // Set flag to prevent concurrent applications
    this.isApplyingDiff = true;

    // Clear stale decorations from previous diff (if hash changed)
    if (newHash !== this.lastDiffHash) {
      this.clearStaleDecorations();
    }

    // Update hash
    this.lastDiffHash = newHash;

    // Add a header showing diff stats
    this.addDiffHeader();

    // Wait for Vditor to render, then apply line decorations and setup scroll sync
    setTimeout(() => {
      try {
        this.applyLineDecorations();

        // Setup scroll sync after visualizations are applied
        this.setupScrollSyncListeners();
        
        // Add scrollbar diff indicators
        this.addScrollbarDiffIndicators();
      } finally {
        // Always clear the flag, even if there's an error
        this.isApplyingDiff = false;
      }
    }, DELAY_VDITOR_RENDER_MS);
  }

  /**
   * Clear all diff visualizations from the editor
   */
  private clearDiffVisualizations(): void {
    // Reset state
    this.diffInfo = null;
    this.isInDiffView = false;
    this.lastDiffHash = "";

    // Remove diff header
    const existingHeader = document.querySelector(".diff-view-header");
    if (existingHeader) {
      existingHeader.remove();
    }
    
    // Remove scrollbar indicators
    const existingIndicators = document.querySelector(".diff-scrollbar-indicators");
    if (existingIndicators) {
      existingIndicators.remove();
    }

    // Remove all spacer blocks
    const spacers = document.querySelectorAll(".diff-spacer-block");
    spacers.forEach((spacer) => spacer.remove());

    // Clear decorations using tracking Map
    for (const [element, info] of this.appliedDecorations.entries()) {
      if (document.body.contains(element)) {
        // Remove visual styling
        element.style.backgroundColor = "";
        element.style.borderLeft = "";
        element.style.paddingLeft = "";
        element.style.paddingBottom = "";
        element.title = "";
        
        // Remove data attributes
        element.removeAttribute('data-diff-type');
        element.removeAttribute('data-diff-line');
        element.removeAttribute('data-decoration-id');
        element.removeAttribute('data-diff-spacer');
        element.removeAttribute('contenteditable');
      }
    }
    
    // Clear tracking Map
    this.appliedDecorations.clear();
  }

  /**
   * Clear only spacer blocks (used before re-applying to prevent duplication)
   */
  public clearSpacerBlocks(): void {
    const spacers = document.querySelectorAll(".diff-spacer-block");
    spacers.forEach((spacer) => spacer.remove());
  }

  /**
   * Clear only diff decorations (background colors, borders)
   */
  public clearDiffDecorations(): void {
    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (contentElement) {
      const allElements = contentElement.querySelectorAll(
        '[style*="background"]'
      );
      allElements.forEach((el) => {
        const element = el as HTMLElement;
        // Only clear if it looks like a diff decoration
        if (
          element.style.borderLeft &&
          element.style.borderLeft.includes("3px solid")
        ) {
          element.style.backgroundColor = "";
          element.style.borderLeft = "";
          element.style.paddingLeft = "";
          element.title = "";
        }
      });
    }
  }

  /**
   * Add a header showing diff statistics
   */
  private addDiffHeader(): void {
    if (!this.diffInfo) {
      return;
    }

    const tryAddHeader = (attempt: number = 1): void => {
      // Remove any existing diff header
      const existingHeader = document.querySelector(".diff-view-header");
      if (existingHeader) {
        existingHeader.remove();
      }

      const vditorElement = document.querySelector(".vditor");

      if (!vditorElement || !vditorElement.parentElement) {
        if (attempt < 10) {
          setTimeout(() => tryAddHeader(attempt + 1), 300);
        } else {
        }
        return;
      }

      const header = document.createElement("div");
      header.className = "diff-view-header";
      header.style.cssText = `
        position: sticky;
        top: 0;
        z-index: 1000;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: var(--vscode-font-family);
        font-size: 12px;
      `;

      const roleLabel = document.createElement("span");
      roleLabel.textContent =
        this.diffInfo!.role === "left" ? "📄 Original" : "📝 Modified";
      roleLabel.style.cssText = `
        font-weight: 600;
        color: var(--vscode-foreground);
      `;

      const stats = document.createElement("span");
      stats.innerHTML = `
        <span style="color: var(--vscode-gitDecoration-addedResourceForeground);">+${
          this.diffInfo!.stats.added
        }</span>
        <span style="color: var(--vscode-gitDecoration-deletedResourceForeground);">-${
          this.diffInfo!.stats.deleted
        }</span>
        <span style="color: var(--vscode-gitDecoration-modifiedResourceForeground);">~${
          this.diffInfo!.stats.modified
        }</span>
      `;
      stats.style.cssText = `
        display: flex;
        gap: 8px;
        margin-left: auto;
      `;

      header.appendChild(roleLabel);
      header.appendChild(stats);
      vditorElement.parentElement!.insertBefore(header, vditorElement);
    };

    tryAddHeader();
  }

  /**
   * Apply line-level diff decorations
   * NEW SIMPLE ALGORITHM: Line numbers from backend are already aligned with offsets
   * We just need to apply colors/borders and render spacers - no complex matching needed!
   */
  private applyLineDecorations(): void {
    if (!this.diffInfo) {
      return;
    }

    // Get the Vditor content container
    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (!contentElement) {
      return;
    }

    // CRITICAL: Clear any existing spacers BEFORE building the lineToDom map
    // This ensures we start with clean DOM structure
    this.clearSpacerBlocks();

    // Build simple 1:1 line-to-DOM mapping (direct children only)
    const lineToDom: Map<number, HTMLElement> = new Map();
    const topLevelElements = Array.from(contentElement.children);
    topLevelElements.forEach((el, index) => {
      lineToDom.set(index, el as HTMLElement);
    });

    // Process ALL changes - line numbers are already correct from backend
    this.diffInfo.changes.forEach((change, index) => {
      // Filter: only process changes meant for THIS side
      if (change.side !== this.diffInfo!.role && change.side !== "both") {
        return;
      }

      const targetElement = lineToDom.get(change.lineNumber);

      if (change.type === "spacer") {
        this.insertSpacerElement(contentElement, change, lineToDom);
        return;
      }
     
      // IDEMPOTENCY CHECK: Skip if decoration already applied
      if (!targetElement) {
        return;
      }
      
      if (this.isDecorationAlreadyApplied(targetElement, change.type, change.lineNumber)) {
        return;
      }
     
      // Apply normal change decoration (added, deleted, modified)
      const color = this.getChangeColor(change.type);
      targetElement.style.backgroundColor = color.bg;
      targetElement.style.borderLeft = `3px solid ${color.border}`;
      targetElement.style.paddingLeft = "4px";
      targetElement.title = this.getChangeTooltip(change);
      
      // Record the applied decoration
      this.recordAppliedDecoration(targetElement, change.type, change.lineNumber);

      // Match height with opposite side content for better scroll sync
      this.matchElementHeight(targetElement, change);
    });
  }

  /**
   * Insert a spacer element at the correct position
   */
  private insertSpacerElement(
    contentElement: Element,
    change: DiffChange,
    lineToDom: Map<number, HTMLElement>
  ): void {
    // Create spacer element FROM the change.content (HTML from opposite side)
    // Parse the HTML to get the actual element, then apply spacer styling
    const tempContainer = document.createElement("div");
    tempContainer.innerHTML = change.content;
    const spacer = tempContainer.firstElementChild as HTMLElement;
    
    if (!spacer) {
      return;
    }
    
    // Add spacer class and attributes
    spacer.classList.add("diff-spacer-block");
    spacer.setAttribute("data-line-number", change.lineNumber.toString());
    spacer.setAttribute("data-diff-spacer", "true");
    
    // CRITICAL: Make spacer non-editable
    spacer.setAttribute("contenteditable", "false");
    
    // Apply spacer styling
    this.applySpacerStyle(spacer, change);
    
    // Record the spacer decoration
    this.recordAppliedDecoration(spacer, "spacer", change.lineNumber);

    // Insert at the correct position
    if (change.lineNumber === 0) {
      // Insert at beginning
      if (contentElement.firstChild) {
        contentElement.insertBefore(spacer, contentElement.firstChild);
      } else {
        contentElement.appendChild(spacer);
      }
    } else {
      // Insert after the previous line
      const prevElement = lineToDom.get(change.lineNumber - 1);
      if (prevElement && prevElement.nextSibling) {
        contentElement.insertBefore(spacer, prevElement.nextSibling);
      } else if (prevElement) {
        prevElement.parentElement?.insertBefore(spacer, prevElement.nextSibling);
      } else {
        contentElement.appendChild(spacer);
      }
    }

    // CRITICAL: Shift all subsequent lines down by 1 in the map
    // When we insert a spacer at line N, all lines from N onwards need to move to N+1
    const linesToShift: Array<[number, HTMLElement]> = [];
    for (const [lineNum, element] of lineToDom.entries()) {
      if (lineNum >= change.lineNumber) {
        linesToShift.push([lineNum, element]);
      }
    }
    
    // Remove old entries and re-add with incremented line numbers
    for (const [lineNum] of linesToShift) {
      lineToDom.delete(lineNum);
    }
    for (const [lineNum, element] of linesToShift) {
      lineToDom.set(lineNum + 1, element);
    }
    
    // Now add the spacer at the correct position
    lineToDom.set(change.lineNumber, spacer);
  }

  /**
   * Match element height with opposite side content for better scroll synchronization
   * Measures the height of opposite side content and applies padding if it's taller
   */
  private async matchElementHeight(element: HTMLElement, change: DiffChange): Promise<void> {
    // Determine what content to measure based on change type
    let oppositeContent: string | undefined;
    
    if (change.type === "modified" && change.oldContent) {
      // For modified, compare current content with old content
      oppositeContent = this.diffInfo?.role === "left" ? change.content : change.oldContent;
    } else if (change.type === "added" || change.type === "deleted") {
      // For added/deleted, use the change content (the opposite side has this)
      oppositeContent = change.content;
    }
    
    if (!oppositeContent) {
      return;
    }
    
    // Parse the opposite content directly (not in a container)
    const tempContainer = document.createElement("div");
    tempContainer.innerHTML = oppositeContent;
    const tempElement = tempContainer.firstElementChild as HTMLElement;
    
    if (!tempElement) {
      return;
    }
    
    // Style the temp element for measurement (hidden but in flow)
    tempElement.style.position = "absolute";
    tempElement.style.visibility = "hidden";
    tempElement.style.pointerEvents = "none";
    tempElement.style.top = "-9999px";
    tempElement.style.left = "-9999px";
    tempElement.style.width = `${element.offsetWidth}px`;
    
    // Copy relevant styles from the target element for accurate measurement
    const computedStyle = window.getComputedStyle(element);
    tempElement.style.fontFamily = computedStyle.fontFamily;
    tempElement.style.fontSize = computedStyle.fontSize;
    tempElement.style.lineHeight = computedStyle.lineHeight;
    tempElement.style.padding = computedStyle.padding;
    tempElement.style.margin = computedStyle.margin;
    tempElement.style.border = computedStyle.border;
    tempElement.style.boxSizing = computedStyle.boxSizing;
    
    // Mark it for easy identification and cleanup
    tempElement.setAttribute("data-temp-measurement", "true");
    
    // Insert directly after the target element (not in a separate container)
    if (element.nextSibling) {
      element.parentElement?.insertBefore(tempElement, element.nextSibling);
    } else {
      element.parentElement?.appendChild(tempElement);
    }
    
    // Wait for images and custom elements to load/render
    await new Promise<void>((resolve) => {
      // Check for images in the temp element
      const images = tempElement.querySelectorAll("img");
      
      if (images.length === 0) {
        // No images, wait a short time for custom elements to render
        setTimeout(resolve, 100);
        return;
      }
      
      // Wait for all images to load
      let loadedCount = 0;
      const totalImages = images.length;
      
      const checkComplete = () => {
        loadedCount++;
        if (loadedCount >= totalImages) {
          // All images loaded, wait a bit more for layout
          setTimeout(resolve, 50);
        }
      };
      
      images.forEach((img) => {
        if (img.complete) {
          checkComplete();
        } else {
          img.addEventListener("load", checkComplete);
          img.addEventListener("error", checkComplete); // Count errors too
        }
      });
      
      // Timeout safety net (don't wait forever)
      setTimeout(() => resolve(), 2000);
    });
    
    // Measure heights after content has loaded
    const currentHeight = element.offsetHeight;
    const oppositeHeight = tempElement.offsetHeight;
    
    // Remove temporary element
    tempElement.remove();
    
    // If opposite side is taller, add padding-bottom to match
    if (oppositeHeight > currentHeight) {
      const heightDiff = oppositeHeight - currentHeight;
      element.style.paddingBottom = `${heightDiff}px`;
    }
  }

  /**
   * Apply spacer styling to an element
   */
  private applySpacerStyle(element: HTMLElement, change: DiffChange): void {
    element.style.display = "block";
    element.style.background = `repeating-linear-gradient(45deg, var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.05)), var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.05)) 10px, transparent 10px, transparent 20px)`;
    element.style.borderLeft = `3px dashed var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)`;
    element.style.paddingLeft = "4px";
    element.style.opacity = "0.4";
    element.style.position = "relative";
    element.style.minHeight = "24px";
    element.style.pointerEvents = "none"; // Prevent interaction
    element.style.userSelect = "none"; // Prevent selection
    element.style.cursor = "not-allowed"; // Visual feedback
    element.title = "🔒 This line does not exist in this version (read-only)";
  }

  /**
   * Get colors for different change types
   */
  private getChangeColor(type: "added" | "deleted" | "modified"): {
    bg: string;
    border: string;
  } {
    switch (type) {
      case "added":
        return {
          bg: "var(--vscode-diffEditor-insertedTextBackground, rgba(155, 185, 85, 0.2))",
          border:
            "var(--vscode-gitDecoration-addedResourceForeground, #81b88b)",
        };
      case "deleted":
        return {
          bg: "var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.2))",
          border:
            "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
        };
      case "modified":
        return {
          bg: "var(--vscode-diffEditor-insertedTextBackground, rgba(155, 185, 85, 0.15))",
          border:
            "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
        };
    }
  }

  /**
   * Get tooltip text for a change
   */
  private getChangeTooltip(change: DiffChange): string {
    switch (change.type) {
      case "added":
        return "Added in this version";
      case "deleted":
        return "Deleted from original";
      case "modified":
        return `Modified from: ${change.oldContent}`;
      default:
        return "";
    }
  }

  /**
   * Setup scroll synchronization between diff editors
   */
  private setupScrollSync(): void {
    // This method is called from constructor but doesn't do anything yet
    // Actual setup happens in setupScrollSyncListeners() after diff view is detected
  }

  /**
   * Setup scroll event listeners (called after diff view is confirmed)
   */
  private setupScrollSyncListeners(): void {
    // CRITICAL: In Vditor, the actual scrollable element is pre.vditor-reset
    // NOT the container divs (.vditor, .vditor-content, .vditor-ir, etc.)
    // We must target the same element for both listening and applying scroll
    const possibleContainers = [
      document.querySelector(".vditor-ir pre.vditor-reset"),
      document.querySelector(".vditor-wysiwyg pre.vditor-reset"),
      document.querySelector(".vditor-sv pre.vditor-reset"),
      document.querySelector("pre.vditor-reset"),
      document.documentElement, // Fallback only
    ];

    let scrollableElement: HTMLElement | null = null;

    // Find the vditor-reset element (the actual scrollable content)
    for (const element of possibleContainers) {
      if (element) {
        scrollableElement = element as HTMLElement;
        break;
      }
    }

    if (!scrollableElement) {
      // vscodeLogError('❌ DIFF VISUALIZER: Could not find pre.vditor-reset element, defaulting to document.documentElement');
      scrollableElement = document.documentElement;
    }

    // Add scroll event listener with capture to catch it early
    const scrollHandler = (e: Event) => {
      if (!this.scrollSyncEnabled || this.isScrolling) {
        return;
      }

      const target = e.target as HTMLElement;

      // Use the actual element that scrolled, not the one we're listening on
      this.handleScroll(target);
    };

    scrollableElement.addEventListener("scroll", scrollHandler, {
      passive: true,
      capture: true,
    });

    // Also add a direct window scroll listener as ultimate fallback
    const windowScrollHandler = () => {
      if (!this.scrollSyncEnabled || this.isScrolling) {
        return;
      }
      this.handleScroll(document.documentElement);
    };

    window.addEventListener("scroll", windowScrollHandler, { passive: true });

    // Log current scroll position to verify element
  }



  /**
   * Handle scroll event and send to other editor
   */
  private handleScroll(element: HTMLElement): void {
    // Prevent infinite loop
    if (this.isScrolling) {
      return;
    }

    // Calculate scroll percentage
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;
    const scrollTop = element.scrollTop;

    // Prevent division by zero
    const scrollableHeight = scrollHeight - clientHeight;
    const scrollPercentage =
      scrollableHeight > 0 ? scrollTop / scrollableHeight : 0;

    // Only send if we have a valid percentage
    if (isNaN(scrollPercentage)) {
      return;
    }

    // THROTTLING: Send immediate message if enough time has passed (for smooth continuous scrolling)
    const now = Date.now();
    const timeSinceLastSync = now - this.lastScrollSyncTime;

    if (timeSinceLastSync >= THROTTLE_SCROLL_SYNC_MS) {
      this.sendScrollSyncMessage(scrollPercentage);
      this.lastScrollSyncTime = now;
    }

    // DEBOUNCING: Always schedule a final message after scrolling stops (for accurate final position)
    if (this.scrollDebounceTimeout) {
      clearTimeout(this.scrollDebounceTimeout);
    }

    this.scrollDebounceTimeout = window.setTimeout(() => {
      this.sendScrollSyncMessage(scrollPercentage);
      this.lastScrollSyncTime = Date.now();
    }, DEBOUNCE_SCROLL_FINAL_MS);
  }

  /**
   * Send scroll sync message to extension
   */
  private sendScrollSyncMessage(scrollPercentage: number): void {
    const vscode = (window as any).vscode;
    if (vscode) {
      vscode.postMessage({
        command: "diff-scroll-sync",
        scrollPercentage: scrollPercentage,
        role: this.diffInfo?.role,
      });
    }
  }

  /**
   * Apply scroll from other editor
   */
  public applyScrollFromOther(scrollPercentage: number): void {
    if (!this.scrollSyncEnabled) {
      return;
    }

    // CRITICAL: Use the SAME element that handles scroll events (PRE.vditor-reset)
    // NOT the container divs which may not be scrollable
    const scrollableElement =
      document.querySelector(".vditor-ir pre.vditor-reset") ||
      document.querySelector(".vditor-wysiwyg pre.vditor-reset") ||
      document.querySelector(".vditor-sv pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset") ||
      document.documentElement;

    if (!scrollableElement) {
      return;
    }

    const element = scrollableElement as HTMLElement;

    // Prevent our own scroll from triggering sync
    this.isScrolling = true;

    const scrollableHeight = element.scrollHeight - element.clientHeight;

    if (scrollableHeight <= 0) {
      this.isScrolling = false;
      return;
    }

    const targetScrollTop = scrollPercentage * scrollableHeight;
    element.scrollTop = targetScrollTop;

    // Clear the flag after a short delay
    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }

    this.scrollTimeout = window.setTimeout(() => {
      this.isScrolling = false;
    }, DEBOUNCE_SCROLL_FINAL_MS);
  }

  /**
   * Toggle scroll synchronization
   */
  public toggleScrollSync(): void {
    this.scrollSyncEnabled = !this.scrollSyncEnabled;
  }

  /**
   * Check if currently in diff view
   */
  public inDiffView(): boolean {
    return this.isInDiffView;
  }

  /**
   * Get current diff info
   */
  public getDiffInfo(): DiffInfo | null {
    return this.diffInfo;
  }
  
  /**
   * Generate a hash from DiffInfo to detect changes
   */
  private generateDiffHash(): string {
    if (!this.diffInfo) {
      return "";
    }
    
    // Create a stable string representation of the diff info
    const hashData = {
      role: this.diffInfo.role,
      changesCount: this.diffInfo.changes.length,
      changes: this.diffInfo.changes.map(c => ({
        type: c.type,
        lineNumber: c.lineNumber,
        contentHash: c.content.substring(0, 50) // First 50 chars for change detection
      }))
    };
    
    return JSON.stringify(hashData);
  }
  
  /**
   * Verify that diff decorations still exist in the DOM
   */
  private verifyDiffDecorationsExist(): boolean {
    if (this.appliedDecorations.size === 0) {
      return false;
    }
    
    let foundCount = 0;
    for (const [element, info] of this.appliedDecorations.entries()) {
      // Check if element is still in DOM and has decoration markers
      if (document.body.contains(element) && 
          element.hasAttribute('data-diff-type')) {
        foundCount++;
      }
    }
    
    // Consider decorations to exist if at least 50% are still present
    // (some may be legitimately removed during editing)
    return foundCount >= this.appliedDecorations.size * 0.5;
  }
  
  /**
   * Check if decoration is already applied to an element
   * CRITICAL: Only returns true if element is tracked AND in DOM AND has correct attributes
   * This ensures we re-apply decorations to re-rendered elements
   */
  private isDecorationAlreadyApplied(element: HTMLElement, type: string, lineNumber: number): boolean {
    // Check Map first - if element is tracked and in DOM, it's applied
    const existing = this.appliedDecorations.get(element);
    if (existing && 
        existing.type === type && 
        existing.lineNumber === lineNumber &&
        document.body.contains(element)) {
      // Also verify the element still has the decoration attributes
      const hasAttributes = element.hasAttribute('data-diff-type') &&
                           element.getAttribute('data-diff-type') === type;
      return hasAttributes;
    }
    
    // Not in tracking Map or element was re-rendered - needs application
    return false;
  }
  
  /**
   * Record an applied decoration in the tracking Map
   */
  private recordAppliedDecoration(element: HTMLElement, type: "added" | "deleted" | "modified" | "spacer", lineNumber: number): void {
    const decorationId = `${type}-${lineNumber}-${Date.now()}`;
    
    this.appliedDecorations.set(element, {
      type,
      lineNumber,
      decorationId
    });
    
    // Also add data attributes for DOM verification
    element.setAttribute('data-diff-type', type);
    element.setAttribute('data-diff-line', lineNumber.toString());
    element.setAttribute('data-decoration-id', decorationId);
  }
  
  /**
   * Clear stale decorations that are no longer in the new diff info
   * CRITICAL: Only removes from tracking Map, doesn't touch DOM
   * This allows decorations to be re-applied to new elements at the same line
   */
  private clearStaleDecorations(): void {
    if (!this.diffInfo || this.appliedDecorations.size === 0) {
      return;
    }
    
    // Build a set of valid line numbers from current diff info
    const validLines = new Set<number>();
    this.diffInfo.changes.forEach(change => {
      if (change.side === this.diffInfo!.role || change.side === "both") {
        validLines.add(change.lineNumber);
      }
    });
    
    // Remove decorations from tracking Map if:
    // 1. Line number is no longer in diff (diff changed)
    // 2. Element is no longer in DOM (Vditor re-rendered it)
    // We DON'T remove styles from DOM - just clear tracking so decorations can be re-applied
    const toRemove: HTMLElement[] = [];
    for (const [element, info] of this.appliedDecorations.entries()) {
      // Remove from tracking if line no longer needs decoration OR element was re-rendered
      if (!validLines.has(info.lineNumber) || !document.body.contains(element)) {
        toRemove.push(element);
      }
    }
    
    toRemove.forEach(element => {
      // ONLY remove from tracking Map - DON'T touch DOM
      // This allows the decoration to be re-applied in applyLineDecorations()
      this.appliedDecorations.delete(element);
    });
  }
  
  /**
   * Add scrollbar diff indicators showing where changes are located
   */
  private addScrollbarDiffIndicators(): void {
    if (!this.diffInfo) {
      return;
    }

    // Remove any existing indicators
    const existingIndicators = document.querySelector(".diff-scrollbar-indicators");
    if (existingIndicators) {
      existingIndicators.remove();
    }

    // Get the scrollable content element
    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (!contentElement) {
      return;
    }

    // Get the content container (not .vditor which includes toolbar)
    // Use .vditor-ir, .vditor-wysiwyg, or .vditor-sv which are the actual content areas
    const contentContainer = 
      document.querySelector(".vditor-ir") ||
      document.querySelector(".vditor-wysiwyg") ||
      document.querySelector(".vditor-sv");
      
    if (!contentContainer) {
      return;
    }

    // Get total document height (scrollHeight) and viewport bounds
    const totalHeight = (contentElement as HTMLElement).scrollHeight;
    if (totalHeight === 0) {
      return;
    }

    // Get the content container's position to calculate relative positioning (excludes toolbar)
    const containerRect = contentContainer.getBoundingClientRect();
    const containerTop = containerRect.top;
    const containerHeight = containerRect.height;

    // Create indicator container that overlays the scrollbar area within the Vditor container
    const indicatorContainer = document.createElement("div");
    indicatorContainer.className = "diff-scrollbar-indicators";
    indicatorContainer.style.cssText = `
      position: fixed;
      top: ${containerTop}px;
      right: 0;
      width: 14px;
      height: ${containerHeight}px;
      pointer-events: none;
      z-index: 9999;
      background: transparent;
    `;

    // Add markers for each change (including spacers)
    const processedLines = new Set<number>();
    
    this.diffInfo.changes.forEach((change) => {
      // Skip already processed lines (but include spacers this time)
      if (processedLines.has(change.lineNumber)) {
        return;
      }
      
      // Filter: only process changes for this side
      if (change.side !== this.diffInfo!.role && change.side !== "both") {
        return;
      }
      
      processedLines.add(change.lineNumber);

      // Get the actual DOM element for this line
      // For spacers, look for elements with diff-spacer-block class
      let lineElement: HTMLElement | null = null;
      
      if (change.type === "spacer") {
        // Find spacer by data-line-number attribute
        lineElement = contentElement.querySelector(
          `.diff-spacer-block[data-line-number="${change.lineNumber}"]`
        ) as HTMLElement;
      } else {
        // For regular elements, we need to get the actual child at this index
        // BUT skip any temporary measurement elements (they shouldn't be in children but let's be safe)
        const allChildren = Array.from(contentElement.children);
        const realChildren = allChildren.filter(child => 
          !child.hasAttribute('data-temp-measurement')
        );
        lineElement = realChildren[change.lineNumber] as HTMLElement;
      }
      
      if (!lineElement) {
        return;
      }
      
      // Skip temporary measurement elements (they have negative offsetTop from being positioned at -9999px)
      if (lineElement.hasAttribute('data-temp-measurement') || lineElement.offsetTop < 0) {
        return;
      }

      // Calculate position for scrollbar indicator
      // The indicator container height represents the VIEWPORT, not the total scrollable height
      // So we need to map element positions to the viewport-relative scrollbar
      
      // Use offsetTop which gives us the position relative to the offsetParent (the content element)
      const elementOffsetTop = lineElement.offsetTop;
      
      // Map the element's position in the document to a position on the scrollbar
      // The scrollbar represents the entire document (totalHeight) compressed into the viewport height
      // So position on scrollbar = (elementPosition / totalHeight) * 100%
      const scrollbarPosition = (elementOffsetTop / totalHeight) * 100;
      
      // Clamp position to valid range (0-100%)
      const clampedPosition = Math.max(0, Math.min(100, scrollbarPosition));
      
      // Get color for this change type
      const color = this.getScrollbarMarkerColor(change.type);
      
      // Create marker element
      const marker = document.createElement("div");
      marker.className = `diff-scrollbar-marker diff-scrollbar-marker-${change.type}`;
      marker.style.cssText = `
        position: absolute;
        top: ${clampedPosition}%;
        left: 0;
        width: calc(100% - 3px);
        height: ${change.type === "spacer" ? "3px" : "4px"};
        background-color: ${color};
        opacity: ${change.type === "spacer" ? "0.6" : "0.85"};
        transition: opacity 0.2s, height 0.2s;
        border-radius: 2px;
        ${change.type === "spacer" ? "background: repeating-linear-gradient(90deg, " + color + " 0px, " + color + " 4px, transparent 4px, transparent 8px);" : ""}
      `;
      marker.title = change.type === "spacer" ? "This line does not exist in this version" : this.getChangeTooltip(change);
      
      // Make marker clickable to jump to that line
      marker.style.pointerEvents = "auto";
      marker.style.cursor = "pointer";
      
      marker.addEventListener("click", () => {
        this.scrollToLine(change.lineNumber);
      });
      
      // Add hover effect
      marker.addEventListener("mouseenter", () => {
        marker.style.opacity = "1";
        marker.style.height = change.type === "spacer" ? "5px" : "6px";
      });
      marker.addEventListener("mouseleave", () => {
        marker.style.opacity = change.type === "spacer" ? "0.6" : "0.85";
        marker.style.height = change.type === "spacer" ? "3px" : "4px";
      });
      
      indicatorContainer.appendChild(marker);
    });

    // Attach to document body for fixed positioning
    document.body.appendChild(indicatorContainer);
  }
  
  /**
   * Scroll to a specific line number
   */
  private scrollToLine(lineNumber: number): void {
    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");
    
    if (!contentElement) {
      return;
    }
    
    const targetElement = contentElement.children[lineNumber] as HTMLElement;
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  
  /**
   * Get scrollbar marker color for change type
   */
  private getScrollbarMarkerColor(type: "added" | "deleted" | "modified" | "spacer"): string {
    switch (type) {
      case "added":
        return "var(--vscode-gitDecoration-addedResourceForeground, #81b88b)";
      case "deleted":
        return "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)";
      case "modified":
        return "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)";
      case "spacer":
        return "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)";
    }
  }
}

// Export singleton instance
export const diffVisualizer = new DiffVisualizer();
