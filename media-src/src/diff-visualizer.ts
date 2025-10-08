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

  constructor() {
    this.setupMessageListener();
    this.setupScrollSync();
  }

  private setupMessageListener(): void {
    console.log('🎨 DIFF VISUALIZER: Setting up message listener');
    
    window.addEventListener('message', (event) => {
      const message = event.data;
      console.log('🎨 DIFF VISUALIZER: Received message', { type: message.type, data: message });
      
      if (message.type === 'diff-view-detected') {
        console.log('🎨 DIFF VISUALIZER: Received diff info from extension', message.diffInfo);
        this.diffInfo = message.diffInfo;
        this.isInDiffView = true;
        this.applyDiffVisualizations();
      } else if (message.type === 'diff-scroll-sync') {
        // Receive scroll sync from other editor
        console.log('� DIFF VISUALIZER: Received scroll sync from other editor', {
          percentage: message.scrollPercentage,
          myRole: this.diffInfo?.role,
          syncEnabled: this.scrollSyncEnabled
        });
        this.applyScrollFromOther(message.scrollPercentage);
      }
    });
    
    console.log('🎨 DIFF VISUALIZER: Message listener setup complete');
  }

  /**
   * Apply diff visualizations to the editor
   */
  private applyDiffVisualizations(): void {
    console.log('🎨 DIFF VISUALIZER: applyDiffVisualizations called', {
      hasDiffInfo: !!this.diffInfo,
      role: this.diffInfo?.role,
      changesCount: this.diffInfo?.changes.length
    });
    
    if (!this.diffInfo) {
      console.log('⚠️ DIFF VISUALIZER: No diff info, exiting');
      return;
    }

    console.log('🎨 DIFF VISUALIZER: Applying visualizations', {
      role: this.diffInfo.role,
      changes: this.diffInfo.changes.length,
      stats: this.diffInfo.stats
    });

    // Add a header showing diff stats
    this.addDiffHeader();

    // Wait for Vditor to render, then apply line decorations and setup scroll sync
    setTimeout(() => {
      console.log('🎨 DIFF VISUALIZER: Timeout elapsed, applying line decorations');
      this.applyLineDecorations();
      
      // Setup scroll sync after visualizations are applied
      console.log('🔄 DIFF VISUALIZER: Setting up scroll sync after visualizations');
      this.setupScrollSyncListeners();
    }, 1000);
  }

  /**
   * Add a header showing diff statistics
   */
  private addDiffHeader(): void {
    console.log('🎨 DIFF VISUALIZER: addDiffHeader called');
    
    if (!this.diffInfo) {
      console.log('⚠️ DIFF VISUALIZER: No diff info in addDiffHeader');
      return;
    }

    const tryAddHeader = (attempt: number = 1): void => {
      // Remove any existing diff header
      const existingHeader = document.querySelector('.diff-view-header');
      if (existingHeader) {
        console.log('🎨 DIFF VISUALIZER: Removing existing header');
        existingHeader.remove();
      }

      const vditorElement = document.querySelector('.vditor');
      
      if (!vditorElement || !vditorElement.parentElement) {
        if (attempt < 10) {
          console.log(`⚠️ DIFF VISUALIZER: Vditor not ready, retrying (attempt ${attempt}/10)...`);
          setTimeout(() => tryAddHeader(attempt + 1), 300);
        } else {
          console.log('⚠️ DIFF VISUALIZER: Vditor element not found after 10 attempts');
        }
        return;
      }

      console.log('✅ DIFF VISUALIZER: Found Vditor element, inserting header');

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
      
      console.log('✅ DIFF VISUALIZER: Header inserted successfully');
    };
    
    tryAddHeader();
  }

  /**
   * Apply line-level diff decorations
   */
  private applyLineDecorations(): void {
    console.log('🎨 DIFF VISUALIZER: applyLineDecorations called');
    
    if (!this.diffInfo) {
      console.log('⚠️ DIFF VISUALIZER: No diff info in applyLineDecorations');
      return;
    }

    console.log('🎨 DIFF VISUALIZER: Applying line decorations to', this.diffInfo.changes.length, 'changes');

    // Get the Vditor content container
    const contentElement = document.querySelector('.vditor-ir') || 
                          document.querySelector('.vditor-wysiwyg') ||
                          document.querySelector('.vditor-sv');
    
    if (!contentElement) {
      console.warn('⚠️ DIFF VISUALIZER: Could not find Vditor content element');
      return;
    }
    
    console.log('✅ DIFF VISUALIZER: Found content element:', contentElement.className);

    // Get all text-containing elements
    const allTextNodes: { element: HTMLElement; text: string }[] = [];
    const elements = contentElement.querySelectorAll('.vditor-ir__node, .vditor-wysiwyg__block, p, div, h1, h2, h3, h4, h5, h6, li, pre, blockquote');
    
    elements.forEach(el => {
      const text = (el as HTMLElement).textContent?.trim() || '';
      if (text.length > 0) {
        allTextNodes.push({ element: el as HTMLElement, text });
      }
    });
    
    console.log('🎨 DIFF VISUALIZER: Found', allTextNodes.length, 'text nodes');
    
    // Build a mapping from source text lines to DOM elements
    // This accounts for Vditor's rendering (e.g., trimming empty lines)
    const sourceLines = this.diffInfo.documentText ? this.diffInfo.documentText.split('\n') : [];
    console.log('🎨 DIFF VISUALIZER: Source document has', sourceLines.length, 'text lines');
    
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
        console.log(`⚠️ DIFF VISUALIZER: Could not map source line ${lineNum}: "${sourceLine.substring(0, 40)}..."`);
      }
    }
    
    console.log('🎨 DIFF VISUALIZER: Built line-to-DOM mapping with', lineToDom.size, 'entries');
    console.log('🎨 DIFF VISUALIZER: Mapping details:', Array.from(lineToDom.entries()).slice(0, 20).map(([line, el]) => ({
      line,
      text: el.textContent?.trim().substring(0, 30) + '...'
    })));
    
    // Add spacer blocks for missing lines BEFORE applying decorations
    this.addSpacerBlocks(lineToDom, sourceLines);
    
    // Filter changes to only highlight those relevant to THIS editor's side
    // Left editor highlights deletions (side: 'left'), Right editor highlights additions (side: 'right')
    const relevantChangesForHighlight = this.diffInfo.changes.filter(c => 
      c.side === this.diffInfo!.role || c.side === 'both'
    );
    
    console.log(`🎨 DIFF VISUALIZER: Highlighting ${relevantChangesForHighlight.length} changes for ${this.diffInfo.role} side`);
    
    // Match changes using the line-to-DOM mapping
    let matchedCount = 0;
    const alreadyMatched = new Set<HTMLElement>();
    
    relevantChangesForHighlight.forEach((change, index) => {
      const changeText = change.content.trim();
      
      if (!changeText) {
        console.log(`⚠️ DIFF VISUALIZER: Change ${index + 1} has empty content, skipping`);
        return;
      }
      
      const targetLineNumber = change.lineNumber;
      
      console.log(`🔍 DIFF VISUALIZER: Looking for change ${index + 1} (${change.type}) at line ${targetLineNumber}: "${changeText.substring(0, 40)}..."`);
      
      // Try to find via line mapping first
      let targetElement = lineToDom.get(targetLineNumber);
      
      if (targetElement && !alreadyMatched.has(targetElement)) {
        // Verify the text matches
        const elementText = targetElement.textContent?.trim() || '';
        if (elementText === changeText || elementText.includes(changeText)) {
          console.log(`✅ DIFF VISUALIZER: Found exact match via line mapping at line ${targetLineNumber}`);
        } else {
          console.log(`⚠️ DIFF VISUALIZER: Line mapping found element but text doesn't match. Looking for alternative...`);
          targetElement = null;
        }
      } else if (targetElement) {
        console.log(`⚠️ DIFF VISUALIZER: Line mapping found element but it's already matched. Looking for alternative...`);
        targetElement = null;
      }
      
      // Fallback: search for matching text near the target line
      if (!targetElement) {
        const matchingNodes = allTextNodes.filter(node => 
          !alreadyMatched.has(node.element) && node.text === changeText
        );
        
        if (matchingNodes.length === 1) {
          targetElement = matchingNodes[0].element;
          console.log(`✅ DIFF VISUALIZER: Found single text match`);
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
          
          console.log(`✅ DIFF VISUALIZER: Found ${matchingNodes.length} text matches, chose one using relative position (~${Math.floor(relativePosition * 100)}%)`);
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
        
        console.log(`✅ DIFF VISUALIZER: Applied ${change.type} decoration`);
      } else {
        console.log(`⚠️ DIFF VISUALIZER: No match for change ${index + 1}`);
      }
    });

    console.log(`✅ DIFF VISUALIZER: Applied ${matchedCount}/${relevantChangesForHighlight.length} decorations`);
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
    console.log('🔄 DIFF VISUALIZER: setupScrollSync called (initial setup)');
    // This method is called from constructor but doesn't do anything yet
    // Actual setup happens in setupScrollSyncListeners() after diff view is detected
  }

  /**
   * Setup scroll event listeners (called after diff view is confirmed)
   */
  private setupScrollSyncListeners(): void {
    console.log('🔄 DIFF VISUALIZER: Setting up scroll sync listeners');
    
    // In VS Code webviews, the scroll often happens on the html or body element
    // Let's check all possible scroll containers including document level
    const possibleContainers = [
      document.documentElement, // <html>
      document.body,            // <body>
      document.querySelector('.vditor'),
      document.querySelector('.vditor-content'),
      document.querySelector('.vditor-ir'),
      document.querySelector('.vditor-wysiwyg'),
      document.querySelector('.vditor-sv')
    ];
    
    let scrollableElement: HTMLElement | null = null;
    
    // Find which element is actually scrollable
    for (const element of possibleContainers) {
      if (element) {
        const el = element as HTMLElement;
        const hasScroll = el.scrollHeight > el.clientHeight;
        const overflowY = window.getComputedStyle(el).overflowY;
        const tagName = el.tagName || 'unknown';
        
        console.log(`🔍 DIFF VISUALIZER: Checking ${tagName}.${el.className}:`, {
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          hasScroll,
          overflowY,
          isScrollable: hasScroll || el === document.documentElement || el === document.body
        });
        
        // For document.documentElement and document.body, we always want to listen
        // even if scrollHeight === clientHeight at setup time
        if (el === document.documentElement || el === document.body) {
          scrollableElement = el;
          console.log(`✅ DIFF VISUALIZER: Using document-level scroll: ${tagName}`);
          break;
        }
        
        if (hasScroll && (overflowY === 'auto' || overflowY === 'scroll')) {
          scrollableElement = el;
          console.log(`✅ DIFF VISUALIZER: Found scrollable element: ${tagName}.${el.className}`);
          break;
        }
      }
    }
    
    if (!scrollableElement) {
      console.error('❌ DIFF VISUALIZER: Could not find any scroll element, defaulting to document.documentElement');
      scrollableElement = document.documentElement;
    }
    
    const elementName = scrollableElement.tagName || scrollableElement.className || 'unknown';
    console.log(`✅ DIFF VISUALIZER: Attaching scroll listener to: ${elementName}`);
    
    // Add scroll event listener with capture to catch it early
    const scrollHandler = (e: Event) => {
      if (!this.scrollSyncEnabled || this.isScrolling) {
        return;
      }
      
      const target = e.target as HTMLElement;
      console.log('🔄 DIFF VISUALIZER: Scroll event fired on:', target.tagName, target.className);
      
      // Use the actual element that scrolled, not the one we're listening on
      this.handleScroll(target);
    };
    
    scrollableElement.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
    
    // Also add a direct window scroll listener as ultimate fallback
    const windowScrollHandler = () => {
      if (!this.scrollSyncEnabled || this.isScrolling) {
        return;
      }
      console.log('🔄 DIFF VISUALIZER: Window scroll detected');
      this.handleScroll(document.documentElement);
    };
    
    window.addEventListener('scroll', windowScrollHandler, { passive: true });
    
    console.log('✅ DIFF VISUALIZER: Scroll listeners attached successfully');
    
    // Log current scroll position to verify element
    console.log('📍 DIFF VISUALIZER: Initial scroll position:', {
      scrollTop: scrollableElement.scrollTop,
      scrollHeight: scrollableElement.scrollHeight,
      clientHeight: scrollableElement.clientHeight
    });
  }

  /**
   * Add spacer blocks for deleted/added lines to maintain alignment
   */
  private addSpacerBlocks(lineToDom: Map<number, HTMLElement>, sourceLines: string[]): void {
    if (!this.diffInfo) {
      return;
    }
    
    console.log('📏 DIFF VISUALIZER: Adding spacer blocks for alignment');
    
    // Get the main content container
    const contentElement = document.querySelector('.vditor-ir') || 
                          document.querySelector('.vditor-wysiwyg') ||
                          document.querySelector('.vditor-sv');
    
    if (!contentElement) {
      console.warn('⚠️ DIFF VISUALIZER: Could not find content element for spacers');
      return;
    }
    
    console.log('✅ DIFF VISUALIZER: Found content element for spacers:', contentElement.className);
    
    // Get ALL changes from BOTH sides
    // Now we receive all changes and can filter appropriately for spacers and highlights
    
    console.log(`📏 DIFF VISUALIZER: Processing ${this.diffInfo.changes.length} total changes for ${this.diffInfo.role} editor`);
    console.log(`📏 DIFF VISUALIZER: Changes breakdown:`, this.diffInfo.changes.map(c => ({
      type: c.type,
      line: c.lineNumber,
      side: c.side,
      content: c.content.substring(0, 30) + '...'
    })));
    
    // Separate changes by side
    const leftSideChanges = this.diffInfo.changes.filter(c => c.side === 'left');
    const rightSideChanges = this.diffInfo.changes.filter(c => c.side === 'right');
    
    console.log(`📏 DIFF VISUALIZER: Left side (deletions): ${leftSideChanges.length}, Right side (additions): ${rightSideChanges.length}`);
    
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
    
    // For each deletion on left, check if there's a corresponding addition on right
    for (const deletion of leftDeletions) {
      // Calculate expected line number on right accounting for all previous additions
      const previousAdditions = rightAdditions.filter(a => a.lineNumber < deletion.lineNumber).length;
      const previousDeletions = leftDeletions.filter(d => d.lineNumber < deletion.lineNumber).length;
      const offset = previousAdditions - previousDeletions;
      const expectedRightLine = deletion.lineNumber + offset;
      
      // Check if there's an addition within ±2 lines (tolerance for offset calculation errors)
      const matchingAddition = rightAdditions.find(a => 
        Math.abs(a.lineNumber - expectedRightLine) <= 2
      );
      
      if (matchingAddition) {
        console.log(`📏 DIFF VISUALIZER: Detected replacement pair - left line ${deletion.lineNumber} ↔ right line ${matchingAddition.lineNumber} (both excluded)`);
        excludedRightLines.add(matchingAddition.lineNumber);  // Don't add spacer on left for this right addition
        excludedLeftLines.add(deletion.lineNumber);           // Don't add spacer on right for this left deletion
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
    
    console.log(`📏 DIFF VISUALIZER: Adding ${relevantChanges.length} spacer blocks for ${this.diffInfo.role} editor`);
    console.log(`📏 DIFF VISUALIZER: Excluded ${excludedRightLines.size} right lines (replacements):`, Array.from(excludedRightLines));
    console.log(`📏 DIFF VISUALIZER: Excluded ${excludedLeftLines.size} left lines (replacements):`, Array.from(excludedLeftLines));
    console.log(`📏 DIFF VISUALIZER: Relevant changes for spacers:`, relevantChanges.map(c => ({
      line: c.lineNumber,
      type: c.type,
      side: c.side,
      content: c.content.substring(0, 30)
    })));
    
    if (relevantChanges.length === 0) {
      console.log('📏 DIFF VISUALIZER: No spacers needed');
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
        console.log(`📏 DIFF VISUALIZER: Extended block to include line ${change.lineNumber}, block now ${currentBlock.startLine}-${currentBlock.endLine}`);
      } else {
        // Save current block and start a new one
        spacerBlocks.push(currentBlock);
        console.log(`📏 DIFF VISUALIZER: Completed block ${currentBlock.startLine}-${currentBlock.endLine} (${currentBlock.lineCount} lines)`);
        currentBlock = { startLine: change.lineNumber, endLine: change.lineNumber, lineCount: 1 };
      }
    }
    
    // Don't forget the last block
    spacerBlocks.push(currentBlock);
    console.log(`📏 DIFF VISUALIZER: Final block ${currentBlock.startLine}-${currentBlock.endLine} (${currentBlock.lineCount} lines)`);
    
    console.log(`📏 DIFF VISUALIZER: Grouped into ${spacerBlocks.length} spacer blocks:`, spacerBlocks);
    
    // Insert spacer blocks from bottom to top to maintain positioning
    for (let i = spacerBlocks.length - 1; i >= 0; i--) {
      const block = spacerBlocks[i];
      
      console.log(`📏 DIFF VISUALIZER: Processing spacer block for lines ${block.startLine}-${block.endLine} (${block.lineCount} lines)`);
      
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
        
        console.log(`📏 DIFF VISUALIZER: Left editor: block at right line ${block.startLine}, inserting at left line ~${targetLineNum}`);
      } else {
        // Right editor: inserting spacers for LEFT side deletions  
        // block.startLine is the line number on the LEFT where content was deleted
        // We want to insert at the corresponding position in RIGHT
        // Since lines were DELETED on left, we need to add the cumulative deletions before this point
        const deletionsBeforeThis = leftDeletions.filter(d => d.lineNumber < block.startLine && !excludedLeftLines.has(d.lineNumber)).length;
        const additionsBeforeThis = rightAdditions.filter(a => a.lineNumber < block.startLine).length;
        targetLineNum = block.startLine - deletionsBeforeThis + additionsBeforeThis;
        
        console.log(`📏 DIFF VISUALIZER: Right editor: block at left line ${block.startLine}, inserting at right line ~${targetLineNum}`);
      }
      
      // Try exact match first
      targetElement = lineToDom.get(targetLineNum) || null;
      
      if (!targetElement) {
        // Try nearby lines (prefer earlier lines for reference)
        for (let offset = 1; offset <= 5; offset++) {
          targetElement = lineToDom.get(targetLineNum - offset);
          if (targetElement) {
            console.log(`📏 DIFF VISUALIZER: Found nearby element at offset -${offset} (line ${targetLineNum - offset})`);
            break;
          }
        }
        
        // If still not found, try later lines
        if (!targetElement) {
          for (let offset = 1; offset <= 5; offset++) {
            targetElement = lineToDom.get(targetLineNum + offset);
            if (targetElement) {
              console.log(`📏 DIFF VISUALIZER: Found nearby element at offset +${offset} (line ${targetLineNum + offset})`);
              break;
            }
          }
        }
      }
      
      if (!targetElement) {
        console.warn(`⚠️ DIFF VISUALIZER: Could not find target element for block starting at line ${block.startLine}, skipping spacer`);
        continue;
      }
      
      console.log(`📏 DIFF VISUALIZER: Target element for spacer block:`, targetElement.tagName, targetElement.className);
      
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
        console.warn(`⚠️ DIFF VISUALIZER: Target element is not a child of content element, skipping spacer for block at line ${block.startLine}`);
        continue;
      }
      
      // Estimate line height and calculate total spacer height for the block
      const singleLineHeight = this.estimateLineHeight(targetElement);
      const totalHeight = singleLineHeight * block.lineCount;
      
      console.log(`📏 DIFF VISUALIZER: Estimated line height: ${singleLineHeight}px × ${block.lineCount} lines = ${totalHeight}px total`, {
        tag: targetElement.tagName,
        offsetHeight: targetElement.offsetHeight,
        computedLineHeight: window.getComputedStyle(targetElement).lineHeight,
        fontSize: window.getComputedStyle(targetElement).fontSize
      });
      
      // Create spacer block
      const spacer = document.createElement('div');
      spacer.className = 'diff-spacer-block';
      spacer.setAttribute('data-line-start', block.startLine.toString());
      spacer.setAttribute('data-line-end', block.endLine.toString());
      spacer.style.cssText = `
        height: ${totalHeight}px;
        min-height: ${totalHeight}px;
        background-color: var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.1));
        border-left: 3px solid var(--vscode-gitDecoration-deletedResourceForeground, #c74e39);
        margin: 0;
        padding: 0;
        position: relative;
        display: block;
        box-sizing: border-box;
      `;
      
      // Add a subtle indicator
      spacer.innerHTML = `<span style="
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
        opacity: 0.5;
        user-select: none;
      ">···</span>`;
      
      // Insert spacer - insert as a sibling of targetElement using its parent
      try {
        if (this.diffInfo.role === 'left') {
          // For original (left) editor, insert AFTER the target element (where added lines would be)
          if (targetElement.nextSibling) {
            targetElement.parentElement!.insertBefore(spacer, targetElement.nextSibling);
          } else {
            targetElement.parentElement!.appendChild(spacer);
          }
          console.log(`📏 DIFF VISUALIZER: ✅ Inserted spacer AFTER line ${targetLineNum} (left/original) for block ${block.startLine}-${block.endLine}`);
        } else {
          // For modified (right) editor, insert BEFORE the target element (where deleted lines were)
          targetElement.parentElement!.insertBefore(spacer, targetElement);
          console.log(`📏 DIFF VISUALIZER: ✅ Inserted spacer BEFORE line ${targetLineNum} (right/modified) for block ${block.startLine}-${block.endLine}`);
        }
      } catch (error) {
        console.error(`❌ DIFF VISUALIZER: Failed to insert spacer for block ${block.startLine}-${block.endLine}:`, error);
      }
    }
    
    console.log('📏 DIFF VISUALIZER: Spacer blocks insertion complete');
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
    console.log('🔄 DIFF VISUALIZER: handleScroll called');
    
    // Prevent infinite loop
    if (this.isScrolling) {
      console.log('🔄 DIFF VISUALIZER: Scroll ignored - isScrolling is true');
      return;
    }
    
    // Calculate scroll percentage
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;
    const scrollTop = element.scrollTop;
    
    // Prevent division by zero
    const scrollableHeight = scrollHeight - clientHeight;
    const scrollPercentage = scrollableHeight > 0 ? scrollTop / scrollableHeight : 0;
    
    console.log('🔄 DIFF VISUALIZER: Scroll detected', {
      element: element.tagName + '.' + element.className,
      scrollTop: scrollTop,
      scrollHeight: scrollHeight,
      clientHeight: clientHeight,
      scrollableHeight: scrollableHeight,
      percentage: scrollPercentage,
      hasVscode: !!(window as any).vscode,
      diffRole: this.diffInfo?.role
    });
    
    // Only send if we have a valid percentage
    if (isNaN(scrollPercentage)) {
      console.warn('⚠️ DIFF VISUALIZER: Invalid scroll percentage (NaN), skipping');
      return;
    }
    
    // Send scroll sync message to extension
    const vscode = (window as any).vscode;
    if (vscode) {
      console.log('🔄 DIFF VISUALIZER: Sending scroll sync message to extension', { percentage: scrollPercentage });
      vscode.postMessage({
        command: 'diff-scroll-sync',
        scrollPercentage: scrollPercentage,
        role: this.diffInfo?.role
      });
    } else {
      console.warn('⚠️ DIFF VISUALIZER: vscode object not available!');
    }
  }

  /**
   * Apply scroll from other editor
   */
  public applyScrollFromOther(scrollPercentage: number): void {
    if (!this.scrollSyncEnabled) {
      console.log('🔄 DIFF VISUALIZER: Scroll sync disabled, ignoring');
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
      console.warn('⚠️ DIFF VISUALIZER: No element found to apply scroll');
      return;
    }
    
    const element = scrollableElement as HTMLElement;
    
    console.log('🔄 DIFF VISUALIZER: Target element for scroll sync:', {
      tag: element.tagName,
      classes: element.className,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      currentScrollTop: element.scrollTop
    });
    
    // Prevent our own scroll from triggering sync
    this.isScrolling = true;
    
    const scrollableHeight = element.scrollHeight - element.clientHeight;
    
    if (scrollableHeight <= 0) {
      console.warn('⚠️ DIFF VISUALIZER: Element is not scrollable!', {
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        element: element.tagName + '.' + element.className
      });
      this.isScrolling = false;
      return;
    }
    
    const targetScrollTop = scrollPercentage * scrollableHeight;
    element.scrollTop = targetScrollTop;
    
    console.log('✅ DIFF VISUALIZER: Applied scroll sync', {
      element: element.tagName + '.' + element.className,
      percentage: scrollPercentage,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollableHeight: scrollableHeight,
      targetScrollTop: targetScrollTop,
      actualScrollTop: element.scrollTop
    });
    
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
    console.log('🔄 DIFF VISUALIZER: Scroll sync', this.scrollSyncEnabled ? 'enabled' : 'disabled');
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
console.log('🎨 DIFF VISUALIZER: Module loading, creating singleton instance');
export const diffVisualizer = new DiffVisualizer();
console.log('🎨 DIFF VISUALIZER: Singleton instance created');
