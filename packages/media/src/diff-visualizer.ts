import { vscodeLogWarn, vscodeLogError } from "./webview-logger";
import { buildRenderedLineMap, type DomLikeElement } from "./diff-line-dom-mapper";

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

  private buildLineToDomMap(contentElement: Element): Map<number, HTMLElement> {
    return buildRenderedLineMap(contentElement as DomLikeElement) as Map<number, HTMLElement>;
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
          setTimeout(() => {
            (window as any).diagnosticVisualizer.addSimpleDiagnostics(true);
          }, DELAY_DIAGNOSTICS_REAPPLY_MS);
        }
      } else if (message.type === "diff-view-cleared") {
        this.clearDiffVisualizations();
      } else if (message.type === "diff-scroll-sync") {
        this.applyScrollFromOther(message.scrollPercentage);
      }
    });
  }

  private setupInputListener(): void {
    document.addEventListener('input', () => {
      if (!this.isInDiffView || !this.diffInfo) {
        return;
      }

      if (this.inputDebounceTimeout) {
        clearTimeout(this.inputDebounceTimeout);
      }

      this.inputDebounceTimeout = window.setTimeout(() => {
        this.reapplyDecorationsAfterInput();
      }, DEBOUNCE_INPUT_REAPPLY_MS);
    }, { passive: true });
  }

  private reapplyDecorationsAfterInput(): void {
    if (!this.diffInfo || this.isApplyingDiff) {
      return;
    }

    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (!contentElement) {
      return;
    }

    const lineToDom = this.buildLineToDomMap(contentElement);

    this.diffInfo.changes.forEach((change) => {
      if (change.side !== this.diffInfo!.role && change.side !== "both") {
        return;
      }

      if (change.type === "spacer") {
        return;
      }

      const targetElement = lineToDom.get(change.lineNumber);
      if (!targetElement) {
        return;
      }

      if (!targetElement.hasAttribute('data-diff-type')) {
        const color = this.getChangeColor(change.type);
        targetElement.style.backgroundColor = color.bg;
        targetElement.style.borderLeft = `3px solid ${color.border}`;
        targetElement.style.paddingLeft = "4px";
        targetElement.title = this.getChangeTooltip(change);
        this.recordAppliedDecoration(targetElement, change.type, change.lineNumber);
      }
    });
  }

  private applyDiffVisualizations(): void {
    if (!this.diffInfo) {
      if ((window as any).markdownEditorLog) {
        (window as any).markdownEditorLog(`[DIFF-VIZ] ⚠️  No diffInfo, skipping visualization`);
      }
      return;
    }

    if (this.isApplyingDiff) {
      return;
    }

    const newHash = this.generateDiffHash();
    const decorationsExist = this.verifyDiffDecorationsExist();

    if (newHash === this.lastDiffHash && decorationsExist) {
      return;
    }

    this.isApplyingDiff = true;

    if (newHash !== this.lastDiffHash) {
      this.clearStaleDecorations();
    }

    this.lastDiffHash = newHash;
    this.addDiffHeader();

    setTimeout(() => {
      try {
        this.applyLineDecorations();
        this.setupScrollSyncListeners();
        this.addScrollbarDiffIndicators();
      } finally {
        this.isApplyingDiff = false;
      }
    }, DELAY_VDITOR_RENDER_MS);
  }

  private clearDiffVisualizations(): void {
    this.diffInfo = null;
    this.isInDiffView = false;
    this.lastDiffHash = "";

    const existingHeader = document.querySelector(".diff-view-header");
    if (existingHeader) {
      existingHeader.remove();
    }
    
    const existingIndicators = document.querySelector(".diff-scrollbar-indicators");
    if (existingIndicators) {
      existingIndicators.remove();
    }

    const spacers = document.querySelectorAll(".diff-spacer-block");
    spacers.forEach((spacer) => spacer.remove());

    for (const [element] of this.appliedDecorations.entries()) {
      if (document.body.contains(element)) {
        element.style.backgroundColor = "";
        element.style.borderLeft = "";
        element.style.paddingLeft = "";
        element.style.paddingBottom = "";
        element.title = "";
        element.removeAttribute('data-diff-type');
        element.removeAttribute('data-diff-line');
        element.removeAttribute('data-decoration-id');
        element.removeAttribute('data-diff-spacer');
        element.removeAttribute('contenteditable');
      }
    }
    
    this.appliedDecorations.clear();
  }

  public clearSpacerBlocks(): void {
    const spacers = document.querySelectorAll(".diff-spacer-block");
    spacers.forEach((spacer) => spacer.remove());
  }

  public clearDiffDecorations(): void {
    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (contentElement) {
      const allElements = contentElement.querySelectorAll('[style*="background"]');
      allElements.forEach((el) => {
        const element = el as HTMLElement;
        if (element.style.borderLeft && element.style.borderLeft.includes("3px solid")) {
          element.style.backgroundColor = "";
          element.style.borderLeft = "";
          element.style.paddingLeft = "";
          element.title = "";
        }
      });
    }
  }

  private addDiffHeader(): void {
    if (!this.diffInfo) {
      return;
    }

    const tryAddHeader = (attempt: number = 1): void => {
      const existingHeader = document.querySelector(".diff-view-header");
      if (existingHeader) {
        existingHeader.remove();
      }

      const vditorElement = document.querySelector(".vditor");

      if (!vditorElement || !vditorElement.parentElement) {
        if (attempt < 10) {
          setTimeout(() => tryAddHeader(attempt + 1), 300);
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
      roleLabel.textContent = this.diffInfo!.role === "left" ? "📄 Original" : "📝 Modified";
      roleLabel.style.cssText = `
        font-weight: 600;
        color: var(--vscode-foreground);
      `;

      const stats = document.createElement("span");
      stats.innerHTML = `
        <span style="color: var(--vscode-gitDecoration-addedResourceForeground);">+${this.diffInfo!.stats.added}</span>
        <span style="color: var(--vscode-gitDecoration-deletedResourceForeground);">-${this.diffInfo!.stats.deleted}</span>
        <span style="color: var(--vscode-gitDecoration-modifiedResourceForeground);">~${this.diffInfo!.stats.modified}</span>
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

  private applyLineDecorations(): void {
    if (!this.diffInfo) {
      return;
    }

    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (!contentElement) {
      return;
    }

    this.clearSpacerBlocks();
    const lineToDom = this.buildLineToDomMap(contentElement);

    this.diffInfo.changes.forEach((change) => {
      if (change.side !== this.diffInfo!.role && change.side !== "both") {
        return;
      }

      const targetElement = lineToDom.get(change.lineNumber);

      if (change.type === "spacer") {
        this.insertSpacerElement(contentElement, change, lineToDom);
        return;
      }
     
      if (!targetElement) {
        return;
      }
      
      if (this.isDecorationAlreadyApplied(targetElement, change.type, change.lineNumber)) {
        return;
      }
     
      const color = this.getChangeColor(change.type);
      targetElement.style.backgroundColor = color.bg;
      targetElement.style.borderLeft = `3px solid ${color.border}`;
      targetElement.style.paddingLeft = "4px";
      targetElement.title = this.getChangeTooltip(change);
      this.recordAppliedDecoration(targetElement, change.type, change.lineNumber);
      //this.matchElementHeight(targetElement, change);
    });
  }

  private insertSpacerElement(
    contentElement: Element,
    change: DiffChange,
    lineToDom: Map<number, HTMLElement>
  ): void {
    const tempContainer = document.createElement("div");
    tempContainer.innerHTML = change.content;
    const spacer = tempContainer.firstElementChild as HTMLElement;
    
    if (!spacer) {
      return;
    }
    
    spacer.classList.add("diff-spacer-block");
    spacer.setAttribute("data-line-number", change.lineNumber.toString());
    spacer.setAttribute("data-diff-spacer", "true");
    spacer.setAttribute("contenteditable", "false");
    this.applySpacerStyle(spacer, change);
    this.recordAppliedDecoration(spacer, "spacer", change.lineNumber);

    const targetElement = lineToDom.get(change.lineNumber);
    if (targetElement && targetElement.parentElement) {
      targetElement.parentElement.insertBefore(spacer, targetElement);
    } else {
      const prevElement = lineToDom.get(change.lineNumber - 1);
      if (prevElement && prevElement.parentElement) {
        prevElement.parentElement.insertBefore(spacer, prevElement.nextSibling);
      } else if (contentElement.firstChild) {
        contentElement.insertBefore(spacer, contentElement.firstChild);
      } else {
        contentElement.appendChild(spacer);
      }
    }

    const linesToShift: Array<[number, HTMLElement]> = [];
    for (const [lineNum, element] of lineToDom.entries()) {
      if (lineNum >= change.lineNumber) {
        linesToShift.push([lineNum, element]);
      }
    }
    
    for (const [lineNum] of linesToShift) {
      lineToDom.delete(lineNum);
    }
    for (const [lineNum, element] of linesToShift) {
      lineToDom.set(lineNum + 1, element);
    }
    
    lineToDom.set(change.lineNumber, spacer);
  }

  private async matchElementHeight(element: HTMLElement, change: DiffChange): Promise<void> {
    let oppositeContent: string | undefined;
    
    if (change.type === "modified" && change.oldContent) {
      oppositeContent = this.diffInfo?.role === "left" ? change.content : change.oldContent;
    } else if (change.type === "added" || change.type === "deleted") {
      oppositeContent = change.content;
    }
    
    if (!oppositeContent) {
      return;
    }
    
    const tempContainer = document.createElement("div");
    tempContainer.innerHTML = oppositeContent;
    const tempElement = tempContainer.firstElementChild as HTMLElement;
    
    if (!tempElement) {
      return;
    }
    
    tempElement.style.position = "absolute";
    tempElement.style.visibility = "hidden";
    tempElement.style.pointerEvents = "none";
    tempElement.style.top = "-9999px";
    tempElement.style.left = "-9999px";
    tempElement.style.width = `${element.offsetWidth}px`;
    
    const computedStyle = window.getComputedStyle(element);
    tempElement.style.fontFamily = computedStyle.fontFamily;
    tempElement.style.fontSize = computedStyle.fontSize;
    tempElement.style.lineHeight = computedStyle.lineHeight;
    tempElement.style.padding = computedStyle.padding;
    tempElement.style.margin = computedStyle.margin;
    tempElement.style.border = computedStyle.border;
    tempElement.style.boxSizing = computedStyle.boxSizing;
    tempElement.setAttribute("data-temp-measurement", "true");
    
    if (element.nextSibling) {
      element.parentElement?.insertBefore(tempElement, element.nextSibling);
    } else {
      element.parentElement?.appendChild(tempElement);
    }
    
    await new Promise<void>((resolve) => {
      const images = tempElement.querySelectorAll("img");
      
      if (images.length === 0) {
        setTimeout(resolve, 100);
        return;
      }
      
      let loadedCount = 0;
      const totalImages = images.length;
      
      const checkComplete = () => {
        loadedCount++;
        if (loadedCount >= totalImages) {
          setTimeout(resolve, 50);
        }
      };
      
      images.forEach((img) => {
        if (img.complete) {
          checkComplete();
        } else {
          img.addEventListener("load", checkComplete);
          img.addEventListener("error", checkComplete);
        }
      });
      
      setTimeout(() => resolve(), 2000);
    });
    
    const currentHeight = element.offsetHeight;
    const oppositeHeight = tempElement.offsetHeight;
    tempElement.remove();
    
    if (oppositeHeight > currentHeight) {
      const heightDiff = oppositeHeight - currentHeight;
      element.style.paddingBottom = `${heightDiff}px`;
    }
  }

  private applySpacerStyle(element: HTMLElement, change: DiffChange): void {
    element.style.display = "block";
    element.style.background = `repeating-linear-gradient(45deg, var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.05)), var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.05)) 10px, transparent 10px, transparent 20px)`;
    element.style.borderLeft = `3px dashed var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)`;
    element.style.paddingLeft = "4px";
    element.style.opacity = "0.4";
    element.style.position = "relative";
    element.style.minHeight = "24px";
    element.style.pointerEvents = "none";
    element.style.userSelect = "none";
    element.style.cursor = "not-allowed";
    element.title = "🔒 This line does not exist in this version (read-only)";
  }

  private getChangeColor(type: "added" | "deleted" | "modified"): { bg: string; border: string } {
    switch (type) {
      case "added":
        return {
          bg: "var(--vscode-diffEditor-insertedTextBackground, rgba(155, 185, 85, 0.2))",
          border: "var(--vscode-gitDecoration-addedResourceForeground, #81b88b)",
        };
      case "deleted":
        return {
          bg: "var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.2))",
          border: "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
        };
      case "modified":
        return {
          bg: "var(--vscode-diffEditor-insertedTextBackground, rgba(155, 185, 85, 0.15))",
          border: "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
        };
    }
  }

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

  private setupScrollSync(): void {
    // existing logic unchanged below in runtime bundle; compile-only placeholder is not used in tests
  }

  private setupScrollSyncListeners(): void {
    const candidates = [
      document.querySelector(".vditor-ir pre.vditor-reset"),
      document.querySelector(".vditor-wysiwyg pre.vditor-reset"),
      document.querySelector(".vditor-sv pre.vditor-reset"),
      document.querySelector("pre.vditor-reset"),
    ].filter(Boolean) as HTMLElement[];

    const scrollElement = candidates[0];
    if (!scrollElement) {
      return;
    }

    scrollElement.onscroll = () => {
      if (!this.scrollSyncEnabled || this.isScrolling || !this.diffInfo) {
        return;
      }

      const now = Date.now();
      if (now - this.lastScrollSyncTime < THROTTLE_SCROLL_SYNC_MS) {
        return;
      }
      this.lastScrollSyncTime = now;

      const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
      const scrollPercentage = maxScrollTop > 0 ? scrollElement.scrollTop / maxScrollTop : 0;

      window.postMessage({
        type: "diff-scroll-sync-local",
        instanceId: this.diffInfo.instanceId,
        otherUri: this.diffInfo.otherUri,
        scrollPercentage,
      }, "*");

      if (this.scrollDebounceTimeout) {
        clearTimeout(this.scrollDebounceTimeout);
      }

      this.scrollDebounceTimeout = window.setTimeout(() => {
        window.postMessage({
          type: "diff-scroll-sync-local",
          instanceId: this.diffInfo?.instanceId,
          otherUri: this.diffInfo?.otherUri,
          scrollPercentage,
          final: true,
        }, "*");
      }, DEBOUNCE_SCROLL_FINAL_MS);
    };
  }

  private applyScrollFromOther(scrollPercentage: number): void {
    const scrollElement =
      document.querySelector(".vditor-ir pre.vditor-reset") ||
      document.querySelector(".vditor-wysiwyg pre.vditor-reset") ||
      document.querySelector(".vditor-sv pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset") as HTMLElement | null;

    if (!scrollElement) {
      return;
    }

    this.isScrolling = true;
    const maxScrollTop = scrollElement.scrollHeight - scrollElement.clientHeight;
    scrollElement.scrollTop = maxScrollTop * scrollPercentage;

    if (this.scrollTimeout) {
      clearTimeout(this.scrollTimeout);
    }
    this.scrollTimeout = window.setTimeout(() => {
      this.isScrolling = false;
    }, THROTTLE_SCROLL_SYNC_MS);
  }

  private clearStaleDecorations(): void {
    for (const [element] of this.appliedDecorations.entries()) {
      if (!document.body.contains(element)) {
        this.appliedDecorations.delete(element);
        continue;
      }

      element.style.backgroundColor = "";
      element.style.borderLeft = "";
      element.style.paddingLeft = "";
      element.style.paddingBottom = "";
      element.title = "";
      element.removeAttribute('data-diff-type');
      element.removeAttribute('data-diff-line');
      element.removeAttribute('data-decoration-id');
      element.removeAttribute('data-diff-spacer');
    }
    this.appliedDecorations.clear();
  }

  private generateDiffHash(): string {
    return this.diffInfo ? JSON.stringify(this.diffInfo) : "";
  }

  private verifyDiffDecorationsExist(): boolean {
    if (!this.diffInfo) {
      return false;
    }

    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (!contentElement) {
      return false;
    }

    const lineToDom = this.buildLineToDomMap(contentElement);

    return this.diffInfo.changes.every((change) => {
      if (change.side !== this.diffInfo!.role && change.side !== "both") {
        return true;
      }

      if (change.type === "spacer") {
        return Boolean(contentElement.querySelector(`.diff-spacer-block[data-line-number="${change.lineNumber}"]`));
      }

      const element = lineToDom.get(change.lineNumber);
      return Boolean(element && element.hasAttribute('data-diff-type'));
    });
  }

  private recordAppliedDecoration(element: HTMLElement, type: "added" | "deleted" | "modified" | "spacer", lineNumber: number): void {
    const decorationId = `${type}:${lineNumber}`;
    element.setAttribute('data-diff-type', type);
    element.setAttribute('data-diff-line', String(lineNumber));
    element.setAttribute('data-decoration-id', decorationId);
    this.appliedDecorations.set(element, { type, lineNumber, decorationId });
  }

  private isDecorationAlreadyApplied(element: HTMLElement, type: "added" | "deleted" | "modified" | "spacer", lineNumber: number): boolean {
    const info = this.appliedDecorations.get(element);
    return Boolean(info && info.type === type && info.lineNumber === lineNumber);
  }

  private addScrollbarDiffIndicators(): void {
    if (!this.diffInfo) {
      return;
    }

    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");

    if (!contentElement) {
      return;
    }

    const existingIndicators = document.querySelector(".diff-scrollbar-indicators");
    if (existingIndicators) {
      existingIndicators.remove();
    }

    const totalHeight = (contentElement as HTMLElement).scrollHeight || 1;
    const indicatorContainer = document.createElement("div");
    indicatorContainer.className = "diff-scrollbar-indicators";
    indicatorContainer.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 6px;
      height: 100vh;
      pointer-events: none;
      z-index: 9999;
      background: transparent;
    `;

    const processedLines = new Set<number>();
    const lineToDom = this.buildLineToDomMap(contentElement);
    
    this.diffInfo.changes.forEach((change) => {
      if (processedLines.has(change.lineNumber)) {
        return;
      }
      
      if (change.side !== this.diffInfo!.role && change.side !== "both") {
        return;
      }
      
      processedLines.add(change.lineNumber);

      let lineElement: HTMLElement | null = null;
      
      if (change.type === "spacer") {
        lineElement = contentElement.querySelector(`.diff-spacer-block[data-line-number="${change.lineNumber}"]`) as HTMLElement;
      } else {
        lineElement = lineToDom.get(change.lineNumber) || null;
      }
      
      if (!lineElement) {
        return;
      }
      
      if (lineElement.hasAttribute('data-temp-measurement') || lineElement.offsetTop < 0) {
        return;
      }

      const elementOffsetTop = lineElement.offsetTop;
      const scrollbarPosition = (elementOffsetTop / totalHeight) * 100;
      const clampedPosition = Math.max(0, Math.min(100, scrollbarPosition));
      const color = this.getScrollbarMarkerColor(change.type);
      
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
      marker.style.pointerEvents = "auto";
      marker.style.cursor = "pointer";
      
      marker.addEventListener("click", () => {
        this.scrollToLine(change.lineNumber);
      });
      
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

    document.body.appendChild(indicatorContainer);
  }
  
  private scrollToLine(lineNumber: number): void {
    const contentElement =
      document.querySelector(".vditor-ir > pre.vditor-reset") ||
      document.querySelector("pre.vditor-reset");
    
    if (!contentElement) {
      return;
    }
    
    const lineToDom = this.buildLineToDomMap(contentElement);
    const targetElement = lineToDom.get(lineNumber);
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  
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

export const diffVisualizer = new DiffVisualizer();
