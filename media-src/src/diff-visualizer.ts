import { vscodeLogWarn, vscodeLogError } from './webview-logger';

/**
 * Handles diff visualization in the markdown editor webview
 */

interface DiffChange {
  type: 'added' | 'deleted' | 'modified';
  lineNumber: number;
  content: string;
  oldContent?: string;
  side: 'left' | 'right' | 'both';
}

interface DiffInfo {
  role: 'left' | 'right';
  otherUri: string;
  instanceId?: string; // Unique instance ID for this editor panel
  changes: DiffChange[];
  stats: {
    added: number;
    deleted: number;
    modified: number;
  };
  documentText?: string; // Full document text for accurate line mapping
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
    this.initialized = true;
  }

  private setupMessageListener(): void {
    
    window.addEventListener('message', (event) => {
      const message = event.data;
      
      if (message.type === 'diff-view-detected') {
        this.diffInfo = message.diffInfo;
        this.isInDiffView = true;
        
        // Clear existing spacers if requested (to prevent duplication)
        if (message.diffInfo.clearExistingSpacers) {
          this.clearSpacerBlocks();
        }
        
        this.applyDiffVisualizations();
        
        // Re-apply diagnostics if requested
        if (message.diffInfo.reapplyDiagnostics && (window as any).diagnosticVisualizer) {
          // Use setTimeout to ensure diff visualizations are applied first
          // Force re-application to bypass smart checks since DOM may have been modified
          setTimeout(() => {
            (window as any).diagnosticVisualizer.addSimpleDiagnostics(true);
          }, 50);
        }
      } else if (message.type === 'diff-view-cleared') {
        // Clear diff visualization
        this.clearDiffVisualizations();
      } else if (message.type === 'diff-scroll-sync') {
        // Receive scroll sync from other editor
        this.applyScrollFromOther(message.scrollPercentage);
      }
    });
    
  }

  /**
   * Apply diff visualizations to the editor
   */
  private applyDiffVisualizations(): void {    
    if (!this.diffInfo) {
      return;
    }

    // Add a header showing diff stats
    this.addDiffHeader();

    // Wait for Vditor to render, then apply line decorations and setup scroll sync
    setTimeout(() => {
      this.applyLineDecorations();
      
      // Setup scroll sync after visualizations are applied
      this.setupScrollSyncListeners();
    }, 1000);
  }

  /**
   * Clear all diff visualizations from the editor
   */
  private clearDiffVisualizations(): void {    
    // Reset state
    this.diffInfo = null;
    this.isInDiffView = false;
    
    // Remove diff header
    const existingHeader = document.querySelector('.diff-view-header');
    if (existingHeader) {
      existingHeader.remove();
    }
    
    // Remove all spacer blocks
    const spacers = document.querySelectorAll('.diff-spacer-block');
    spacers.forEach(spacer => spacer.remove());
    
    // Remove all diff decorations (background colors, borders)
    const contentElement = document.querySelector('.vditor-ir') || 
                          document.querySelector('.vditor-wysiwyg') ||
                          document.querySelector('.vditor-sv');
    
    if (contentElement) {
      const allElements = contentElement.querySelectorAll('[style*="background"]');
      let clearedCount = 0;
      allElements.forEach(el => {
        const element = el as HTMLElement;
        // Only clear if it looks like a diff decoration
        if (element.style.borderLeft && element.style.borderLeft.includes('3px solid')) {
          element.style.backgroundColor = '';
          element.style.borderLeft = '';
          element.style.paddingLeft = '';
          element.title = '';
          clearedCount++;
        }
      });
    }
  }

  /**
   * Clear only spacer blocks (used before re-applying to prevent duplication)
   */
  private clearSpacerBlocks(): void {
    const spacers = document.querySelectorAll('.diff-spacer-block');
    spacers.forEach(spacer => spacer.remove());
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
      const existingHeader = document.querySelector('.diff-view-header');
      if (existingHeader) {
        existingHeader.remove();
      }

      const vditorElement = document.querySelector('.vditor');
      
      if (!vditorElement || !vditorElement.parentElement) {
        if (attempt < 10) {
          setTimeout(() => tryAddHeader(attempt + 1), 300);
        } else {
        }
        return;
      }


      const header = document.createElement('div');
      header.className = 'diff-view-header';
      header.style.cssText = `
        position: sticky;
        top: 0;
        z-index: 1000;
        background: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-panel-border);
        padding: 8px 12px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: var(--vscode-font-family);
        font-size: 12px;
      `;

      const roleLabel = document.createElement('span');
      roleLabel.textContent = this.diffInfo!.role === 'left' ? '📄 Original' : '📝 Modified';
      roleLabel.style.cssText = `
        font-weight: 600;
        color: var(--vscode-foreground);
      `;

      const stats = document.createElement('span');
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

  /**
   * Apply line-level diff decorations
   */
  private applyLineDecorations(): void {
    
    if (!this.diffInfo) {
      return;
    }


    // Get the Vditor content container
    const contentElement = document.querySelector('.vditor-ir') || 
                          document.querySelector('.vditor-wysiwyg') ||
                          document.querySelector('.vditor-sv');
    
    if (!contentElement) {
      // vscodeLogWarn('⚠️ DIFF VISUALIZER: Could not find Vditor content element');
      return;
    }
    

    // Get all text-containing elements
    const allTextNodes: { element: HTMLElement; text: string }[] = [];
    const elements = contentElement.querySelectorAll('.vditor-ir__node, .vditor-wysiwyg__block, p, div, h1, h2, h3, h4, h5, h6, li, pre, blockquote');
    
    elements.forEach(el => {
      const text = (el as HTMLElement).textContent?.trim() || '';
      if (text.length > 0) {
        allTextNodes.push({ element: el as HTMLElement, text });
      }
    });
    
    
    // Build a mapping from source text lines to DOM elements
    // This accounts for Vditor's rendering (e.g., trimming empty lines)
    const sourceLines = this.diffInfo.documentText ? this.diffInfo.documentText.split('\n') : [];
    
    // Build line-to-DOM mapping by matching text content sequentially
    const lineToDom: Map<number, HTMLElement> = new Map();
    let domIndex = 0;
    
    for (let lineNum = 0; lineNum < sourceLines.length && domIndex < allTextNodes.length; lineNum++) {
      const sourceLine = sourceLines[lineNum].trim();
      
      // Skip empty lines in source (Vditor doesn't render them as separate elements)
      if (!sourceLine) {
        continue;
      }
      
      // Find the NEXT matching DOM element (not already mapped)
      let found = false;
      for (let i = domIndex; i < allTextNodes.length; i++) {
        const domNode = allTextNodes[i];
        const domText = domNode.text.trim();
        
        // Exact match is best
        if (domText === sourceLine) {
          lineToDom.set(lineNum, domNode.element);
          domIndex = i + 1; // Move past this node for next iteration
          found = true;
          break;
        }
      }
      
      // If no exact match found, the line might be part of a multi-line DOM node
      // Skip it for now - we'll handle via fallback matching
      if (!found) {
      }
    }
    
    
    // Add spacer blocks for missing lines BEFORE applying decorations
    this.addSpacerBlocks(lineToDom, sourceLines);
    
    // Filter changes to only highlight those relevant to THIS editor's side
    // Left editor highlights deletions (side: 'left'), Right editor highlights additions (side: 'right')
    const relevantChangesForHighlight = this.diffInfo.changes.filter(c => 
      c.side === this.diffInfo!.role || c.side === 'both'
    );
    
    
    // Match changes using the line-to-DOM mapping
    let matchedCount = 0;
    const alreadyMatched = new Set<HTMLElement>();
    
    relevantChangesForHighlight.forEach((change, index) => {
      const changeText = change.content.trim();
      
      if (!changeText) {
        return;
      }
      
      const targetLineNumber = change.lineNumber;
      
      
      // Try to find via line mapping first
      let targetElement = lineToDom.get(targetLineNumber);
      
      if (targetElement && !alreadyMatched.has(targetElement)) {
        // Verify the text matches
        const elementText = targetElement.textContent?.trim() || '';
        if (elementText === changeText || elementText.includes(changeText)) {
        } else {
          targetElement = null;
        }
      } else if (targetElement) {
        targetElement = null;
      }
      
      // Fallback: search for matching text near the target line
      if (!targetElement) {
        const matchingNodes = allTextNodes.filter(node => 
          !alreadyMatched.has(node.element) && node.text === changeText
        );
        
        if (matchingNodes.length === 1) {
          targetElement = matchingNodes[0].element;
        } else if (matchingNodes.length > 1) {
          // Multiple matches - use relative position as hint
          const relativePosition = targetLineNumber / Math.max(sourceLines.length, 1);
          const targetIndex = Math.floor(relativePosition * allTextNodes.length);
          
          targetElement = matchingNodes.reduce((closest, node) => {
            const nodeIndex = allTextNodes.indexOf(node);
            const closestIndex = allTextNodes.indexOf(allTextNodes.find(n => n.element === closest)!);
            return Math.abs(nodeIndex - targetIndex) < Math.abs(closestIndex - targetIndex)
              ? node.element
              : closest;
          }, matchingNodes[0].element);
          
        }
      }
      
      if (targetElement) {
        const color = this.getChangeColor(change.type);
        targetElement.style.backgroundColor = color.bg;
        targetElement.style.borderLeft = `3px solid ${color.border}`;
        targetElement.style.paddingLeft = '4px';
        targetElement.title = this.getChangeTooltip(change);
        
        alreadyMatched.add(targetElement);
        matchedCount++;
        
      } else {
      }
    });

  }

  /**
   * Calculate text similarity (0-1)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const longer = text1.length > text2.length ? text1 : text2;
    const shorter = text1.length > text2.length ? text2 : text1;
    
    if (longer.length === 0) return 1.0;
    
    // Check how much of the shorter string is in the longer one
    const matches = shorter.split('').filter((char, i) => longer[i] === char).length;
    return matches / longer.length;
  }

  /**
   * Get colors for different change types
   */
  private getChangeColor(type: 'added' | 'deleted' | 'modified'): { bg: string; border: string } {
    switch (type) {
      case 'added':
        return {
          bg: 'var(--vscode-diffEditor-insertedTextBackground, rgba(155, 185, 85, 0.2))',
          border: 'var(--vscode-gitDecoration-addedResourceForeground, #81b88b)'
        };
      case 'deleted':
        return {
          bg: 'var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.2))',
          border: 'var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)'
        };
      case 'modified':
        return {
          bg: 'var(--vscode-diffEditor-insertedTextBackground, rgba(155, 185, 85, 0.15))',
          border: 'var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)'
        };
    }
  }

  /**
   * Get tooltip text for a change
   */
  private getChangeTooltip(change: DiffChange): string {
    switch (change.type) {
      case 'added':
        return 'Added in this version';
      case 'deleted':
        return 'Deleted from original';
      case 'modified':
        return `Modified from: ${change.oldContent}`;
      default:
        return '';
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
      document.querySelector('.vditor-ir pre.vditor-reset'),
      document.querySelector('.vditor-wysiwyg pre.vditor-reset'),
      document.querySelector('.vditor-sv pre.vditor-reset'),
      document.querySelector('pre.vditor-reset'),
      document.documentElement  // Fallback only
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
    
    scrollableElement.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
    
    // Also add a direct window scroll listener as ultimate fallback
    const windowScrollHandler = () => {
      if (!this.scrollSyncEnabled || this.isScrolling) {
        return;
      }
      this.handleScroll(document.documentElement);
    };
    
    window.addEventListener('scroll', windowScrollHandler, { passive: true });
    
    
    // Log current scroll position to verify element
  }

  /**
   * Add spacer blocks for deleted/added lines to maintain alignment
   */
  private addSpacerBlocks(lineToDom: Map<number, HTMLElement>, sourceLines: string[]): void {
    if (!this.diffInfo) {
      return;
    }
    
    
    // Get the main content container - this should be pre.vditor-reset which is the scrollable element
    // NOT the outer containers (.vditor-ir, .vditor-wysiwyg, .vditor-sv)
    const contentElement = document.querySelector('.vditor-ir pre.vditor-reset') || 
                          document.querySelector('.vditor-wysiwyg pre.vditor-reset') ||
                          document.querySelector('.vditor-sv pre.vditor-reset') ||
                          document.querySelector('pre.vditor-reset');
    
    if (!contentElement) {
      // vscodeLogWarn('⚠️ DIFF VISUALIZER: Could not find pre.vditor-reset element for spacers');
      return;
    }
    
    // CRITICAL: Check if spacers already exist - if so, skip adding new ones
    const existingSpacers = document.querySelectorAll('.diff-spacer-block');
    if (existingSpacers.length > 0) {
      return;
    }
    
    // For spacers, we need OPPOSITE side changes:
    // - Left editor (original) needs spacers for what was ADDED on right (where lines don't exist in left)
    // - Right editor (modified) needs spacers for what was DELETED on left (where lines don't exist in right)
    // BUT we should NOT add spacers for 'modified' type changes - those are replacements where both sides have content
    
    // CRITICAL: Detect replacement pairs (delete + add at corresponding positions)
    // When left has deletion at line X and right has addition at line Y where Y ≈ X + offset, it's a replacement
    // Both the deletion AND the addition should be excluded from spacers
    
    const leftDeletions = this.diffInfo.changes.filter(c => c.side === 'left' && c.type === 'deleted');
    const rightAdditions = this.diffInfo.changes.filter(c => c.side === 'right' && c.type === 'added');
    
    // Build sets of replacement lines to exclude from BOTH sides
    const excludedRightLines = new Set<number>();  // Right additions that are replacements
    const excludedLeftLines = new Set<number>();   // Left deletions that have replacements
    
    // IMPROVED: For each deletion on left, check if there's a corresponding addition on right
    // Consider both position proximity AND content similarity
    for (const deletion of leftDeletions) {
      // Calculate expected line number on right accounting for all previous additions
      const previousAdditions = rightAdditions.filter(a => a.lineNumber < deletion.lineNumber).length;
      const previousDeletions = leftDeletions.filter(d => d.lineNumber < deletion.lineNumber).length;
      const offset = previousAdditions - previousDeletions;
      const expectedRightLine = deletion.lineNumber + offset;
      
      // Check if there's an addition within ±3 lines (increased tolerance)
      const nearbyAdditions = rightAdditions.filter(a => 
        Math.abs(a.lineNumber - expectedRightLine) <= 3 && !excludedRightLines.has(a.lineNumber)
      );
      
      if (nearbyAdditions.length > 0) {
        // If multiple candidates, prefer the one with most similar content or closest position
        let bestMatch = nearbyAdditions[0];
        let bestScore = 0;
        
        for (const addition of nearbyAdditions) {
          // Calculate similarity score (0-1) based on content
          const similarity = this.calculateSimilarity(deletion.content, addition.content);
          // Calculate position score (closer is better)
          const positionScore = 1 - Math.abs(addition.lineNumber - expectedRightLine) / 4;
          // Combined score (favor content similarity more)
          const score = similarity * 0.7 + positionScore * 0.3;
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = addition;
          }
        }
        
        // Only exclude if there's a reasonable match (similarity > 0.3 or very close position)
        const similarity = this.calculateSimilarity(deletion.content, bestMatch.content);
        const positionDiff = Math.abs(bestMatch.lineNumber - expectedRightLine);
        
        if (similarity > 0.3 || positionDiff <= 1) {
          excludedRightLines.add(bestMatch.lineNumber);  // Don't add spacer on left for this right addition
          excludedLeftLines.add(deletion.lineNumber);    // Don't add spacer on right for this left deletion
        }
      }
    }
    
    // Filter changes: get opposite side changes BUT exclude replacement pairs AND empty content
    const relevantChanges = this.diffInfo.role === 'left' 
      ? this.diffInfo.changes.filter(c => 
          c.side === 'right' && 
          c.type === 'added' && 
          !excludedRightLines.has(c.lineNumber) &&
          c.content.trim().length > 0  // Ignore empty lines
        )
      : this.diffInfo.changes.filter(c => 
          c.side === 'left' && 
          c.type === 'deleted' &&
          !excludedLeftLines.has(c.lineNumber) &&
          c.content.trim().length > 0  // Ignore empty lines
        );
    
    
    if (relevantChanges.length === 0) {
      return;
    }
    
    // Group consecutive line changes into blocks
    // Important: Only group lines that are truly consecutive (no gaps)
    const spacerBlocks: { startLine: number; endLine: number; lineCount: number }[] = [];
    const sortedChanges = [...relevantChanges].sort((a, b) => a.lineNumber - b.lineNumber);
    
    let currentBlock = { startLine: sortedChanges[0].lineNumber, endLine: sortedChanges[0].lineNumber, lineCount: 1 };
    
    for (let i = 1; i < sortedChanges.length; i++) {
      const change = sortedChanges[i];
      
      // If this line is consecutive to the current block, extend the block
      if (change.lineNumber === currentBlock.endLine + 1) {
        currentBlock.endLine = change.lineNumber;
        currentBlock.lineCount++;
      } else {
        // Save current block and start a new one
        spacerBlocks.push(currentBlock);
        currentBlock = { startLine: change.lineNumber, endLine: change.lineNumber, lineCount: 1 };
      }
    }
    
    // Don't forget the last block
    spacerBlocks.push(currentBlock);
    
    
    // Insert spacer blocks from bottom to top to maintain positioning
    for (let i = spacerBlocks.length - 1; i >= 0; i--) {
      const block = spacerBlocks[i];
      
      
      // Find a reference element for insertion
      // CRITICAL: block.startLine is from the OPPOSITE side (right for left editor, left for right editor)
      // We need to find where to insert in THIS editor's DOM
      
      let targetElement: HTMLElement | null = null;
      let targetLineNum: number;
      
      if (this.diffInfo.role === 'left') {
        // Left editor: inserting spacers for RIGHT side additions
        // block.startLine is the line number on the RIGHT where content was added
        // We want to insert BEFORE the line in LEFT that corresponds to this position
        // Since lines were ADDED on right, we need to subtract the cumulative additions before this point
        const additionsBeforeThis = rightAdditions.filter(a => a.lineNumber < block.startLine).length;
        targetLineNum = block.startLine - additionsBeforeThis;
        
      } else {
        // Right editor: inserting spacers for LEFT side deletions  
        // block.startLine is the line number on the LEFT where content was deleted
        // We want to insert at the corresponding position in RIGHT
        // Since lines were DELETED on left, we need to add the cumulative deletions before this point
        const deletionsBeforeThis = leftDeletions.filter(d => d.lineNumber < block.startLine && !excludedLeftLines.has(d.lineNumber)).length;
        const additionsBeforeThis = rightAdditions.filter(a => a.lineNumber < block.startLine).length;
        targetLineNum = block.startLine - deletionsBeforeThis + additionsBeforeThis;
        
      }
      
      // Try exact match first
      targetElement = lineToDom.get(targetLineNum) || null;
      
      if (!targetElement) {
        // Try nearby lines (prefer earlier lines for reference)
        for (let offset = 1; offset <= 5; offset++) {
          targetElement = lineToDom.get(targetLineNum - offset);
          if (targetElement) {
            break;
          }
        }
        
        // If still not found, try later lines
        if (!targetElement) {
          for (let offset = 1; offset <= 5; offset++) {
            targetElement = lineToDom.get(targetLineNum + offset);
            if (targetElement) {
              break;
            }
          }
        }
      }
      
      if (!targetElement) {
        // vscodeLogWarn(`⚠️ DIFF VISUALIZER: Could not find target element for block starting at line ${block.startLine}, skipping spacer`);
        continue;
      }
      
      
      // Verify that targetElement is a child of contentElement
      let parentElement = targetElement.parentElement;
      let insertionParent: Element | null = null;
      
      // Walk up the DOM tree to find if targetElement is inside contentElement
      while (parentElement) {
        if (parentElement === contentElement) {
          insertionParent = contentElement;
          break;
        }
        parentElement = parentElement.parentElement;
      }
      
      if (!insertionParent) {
        // vscodeLogWarn(`⚠️ DIFF VISUALIZER: Target element is not a child of content element, skipping spacer for block at line ${block.startLine}`);
        continue;
      }
      
      // Estimate line height and calculate total spacer height for the block
      const singleLineHeight = this.estimateLineHeight(targetElement);
      const totalHeight = singleLineHeight * block.lineCount;
      
      
      // Create spacer block
      const spacer = document.createElement('div');
      spacer.className = 'diff-spacer-block';
      spacer.setAttribute('data-line-start', block.startLine.toString());
      spacer.setAttribute('data-line-end', block.endLine.toString());
      spacer.style.cssText = `
        height: ${totalHeight}px;
        min-height: ${totalHeight}px;
        background: repeating-linear-gradient(
          45deg,
          var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.05)),
          var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.05)) 10px,
          transparent 10px,
          transparent 20px
        );
        border-left: 3px dashed var(--vscode-gitDecoration-deletedResourceForeground, #c74e39);
        margin: 0;
        margin-bottom: 16px;
        padding: 0;
        padding-bottom: 4px;
        position: relative;
        display: block;
        box-sizing: border-box;
        opacity: 0.6;
      `;
      
      // Add a subtle indicator
      spacer.innerHTML = `<span style="
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        opacity: 0.7;
        user-select: none;
        font-style: italic;
      ">⋯ ${block.lineCount} line${block.lineCount > 1 ? 's' : ''} not in this file</span>`;
      
      // Insert spacer - insert as a sibling of targetElement using its parent
      try {
        if (this.diffInfo.role === 'left') {
          // For original (left) editor, insert AFTER the target element (where added lines would be)
          if (targetElement.nextSibling) {
            targetElement.parentElement!.insertBefore(spacer, targetElement.nextSibling);
          } else {
            targetElement.parentElement!.appendChild(spacer);
          }
        } else {
          // For modified (right) editor, insert BEFORE the target element (where deleted lines were)
          targetElement.parentElement!.insertBefore(spacer, targetElement);
        }
      } catch (error) {
        // vscodeLogError(`❌ DIFF VISUALIZER: Failed to insert spacer for block ${block.startLine}-${block.endLine}:`, error);
      }
    }
    
  }

  /**
   * Estimate the height of a line element
   */
  private estimateLineHeight(element: HTMLElement): number {
    const computedStyle = window.getComputedStyle(element);
    
    // Try to get line-height from computed style
    const lineHeightStr = computedStyle.lineHeight;
    
    // If line-height is 'normal', calculate from font-size
    if (lineHeightStr === 'normal' || lineHeightStr === '') {
      const fontSize = parseFloat(computedStyle.fontSize);
      if (!isNaN(fontSize)) {
        // Normal line-height is typically 1.2 * font-size
        return Math.ceil(fontSize * 1.2);
      }
    } else {
      const lineHeight = parseFloat(lineHeightStr);
      if (!isNaN(lineHeight)) {
        return Math.ceil(lineHeight);
      }
    }
    
    // Fallback: use element's offsetHeight but cap it to reasonable line height
    // Sometimes elements have extra padding/margin that makes them too tall
    const elementHeight = element.offsetHeight;
    
    // A reasonable line height is usually between 16px and 40px
    // If element is taller, it might have multiple lines or extra spacing
    if (elementHeight > 40) {
      // Try to estimate single line height from font-size
      const fontSize = parseFloat(computedStyle.fontSize);
      if (!isNaN(fontSize)) {
        return Math.ceil(fontSize * 1.2);
      }
      // Default to a reasonable line height
      return 24;
    }
    
    return elementHeight || 24;
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
    const scrollPercentage = scrollableHeight > 0 ? scrollTop / scrollableHeight : 0;
    
    
    // Only send if we have a valid percentage
    if (isNaN(scrollPercentage)) {
      // vscodeLogWarn('⚠️ DIFF VISUALIZER: Invalid scroll percentage (NaN), skipping');
      return;
    }
    
    // THROTTLING: Send immediate message if enough time has passed (for smooth continuous scrolling)
    const now = Date.now();
    const timeSinceLastSync = now - this.lastScrollSyncTime;
    const THROTTLE_MS = 50; // Max 20 messages per second for smoother continuous scroll
    
    if (timeSinceLastSync >= THROTTLE_MS) {
      this.sendScrollSyncMessage(scrollPercentage);
      this.lastScrollSyncTime = now;
    }
    
    // DEBOUNCING: Always schedule a final message after scrolling stops (for accurate final position)
    if (this.scrollDebounceTimeout) {
      clearTimeout(this.scrollDebounceTimeout);
    }
    
    const DEBOUNCE_MS = 100; // Wait 100ms after scroll stops for final accurate position
    this.scrollDebounceTimeout = window.setTimeout(() => {
      this.sendScrollSyncMessage(scrollPercentage);
      this.lastScrollSyncTime = Date.now();
    }, DEBOUNCE_MS);
  }
  
  /**
   * Send scroll sync message to extension
   */
  private sendScrollSyncMessage(scrollPercentage: number): void {
    const vscode = (window as any).vscode;
    if (vscode) {
      vscode.postMessage({
        command: 'diff-scroll-sync',
        scrollPercentage: scrollPercentage,
        role: this.diffInfo?.role
      });
    } else {
      // vscodeLogWarn('⚠️ DIFF VISUALIZER: vscode object not available!');
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
    const scrollableElement = document.querySelector('.vditor-ir pre.vditor-reset') || 
                             document.querySelector('.vditor-wysiwyg pre.vditor-reset') ||
                             document.querySelector('.vditor-sv pre.vditor-reset') ||
                             document.querySelector('pre.vditor-reset') ||
                             document.documentElement;
    
    if (!scrollableElement) {
      // vscodeLogWarn('⚠️ DIFF VISUALIZER: No element found to apply scroll');
      return;
    }
    
    const element = scrollableElement as HTMLElement;
    
    
    // Prevent our own scroll from triggering sync
    this.isScrolling = true;
    
    const scrollableHeight = element.scrollHeight - element.clientHeight;
    
    if (scrollableHeight <= 0) {
      // vscodeLogWarn('⚠️ DIFF VISUALIZER: Element is not scrollable!', {
      //   scrollHeight: element.scrollHeight,
      //   clientHeight: element.clientHeight,
      //   element: element.tagName + '.' + element.className
      // });
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
    }, 100);
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
}

// Export singleton instance
export const diffVisualizer = new DiffVisualizer();
