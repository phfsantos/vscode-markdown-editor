import * as vscode from 'vscode';
import { logger } from '../utils/Logger';

/**
 * Pure diff calculation utility - instance-based diff management now happens in EditorPanel
 * This class only provides diff calculation and scroll sync functionality
 */
export class MarkdownDiffViewSupport {

  constructor(private context: vscode.ExtensionContext) {
    // No global state needed - each EditorPanel manages its own diff state
  }

  /**
   * Calculate line-by-line diff between two documents using LCS algorithm
   */
  public async calculateDiff(leftUri: vscode.Uri, rightUri: vscode.Uri): Promise<DiffResult> {
    const leftDoc = await vscode.workspace.openTextDocument(leftUri);
    const rightDoc = await vscode.workspace.openTextDocument(rightUri);
    
    const leftLines = leftDoc.getText().split('\n');
    const rightLines = rightDoc.getText().split('\n');
    
    const changes = this.computeLCSDiff(leftLines, rightLines);

    return {
      leftUri,
      rightUri,
      changes,
      stats: {
        added: changes.filter(c => c.type === 'added').length,
        deleted: changes.filter(c => c.type === 'deleted').length,
        modified: changes.filter(c => c.type === 'modified').length
      }
    };
  }

  /**
   * Calculate diff from content strings (for Compare with Saved where we have saved content vs current content)
   */
  public calculateDiffFromContent(originalContent: string, modifiedContent: string): LineChange[] {
    const originalLines = originalContent.split('\n');
    const modifiedLines = modifiedContent.split('\n');
    
    return this.computeLCSDiff(originalLines, modifiedLines);
  }

  /**
   * Calculate diff from HTML strings (for more accurate diff visualization)
   * HTML content should be the IR content from Vditor's rendering
   * 
   * NEW ALGORITHM: Process changes sequentially with offset tracking
   * This produces aligned changes with spacers included, ready for frontend display
   */
  public calculateDiffFromHTML(leftHtml: string, rightHtml: string): DiffResult {
    // Parse HTML into lines by splitting on block-level elements
    const leftLines = this.parseHTMLToLines(leftHtml);
    const rightLines = this.parseHTMLToLines(rightHtml);
    
    // Get raw LCS changes
    const rawChanges = this.computeLCSDiff(leftLines, rightLines);
    
    // Process changes with offset tracking to create aligned diff with spacers
    const alignedChanges = this.alignChangesWithSpacers(rawChanges, leftLines, rightLines);
    
    return {
      leftUri: vscode.Uri.parse('inmemory://left.html'),
      rightUri: vscode.Uri.parse('inmemory://right.html'),
      changes: alignedChanges,
      stats: {
        added: alignedChanges.filter(c => c.type === 'added').length,
        deleted: alignedChanges.filter(c => c.type === 'deleted').length,
        modified: alignedChanges.filter(c => c.type === 'modified').length,
        spacer: alignedChanges.filter(c => c.type === 'spacer').length
      },
      leftHtmlLines: leftLines,
      rightHtmlLines: rightLines
    };
  }

  /**
   * Parse HTML into logical lines using ONLY top-level block elements
   * Each top-level block = one logical line with FULL HTML structure preserved
   * This ensures accurate rendering (images, formatting, etc.) in diff visualizations
   */
  private parseHTMLToLines(html: string): string[] {
    const lines: string[] = [];
    
    // Strategy: Parse ONLY top-level block elements (not nested ones)
    // We need to track depth to identify top-level elements
    
    let depth = 0;
    let currentElement = '';
    let currentTag = '';
    let inElement = false;
    
    // Regex to match opening and closing tags
    const tagRegex = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;
    
    let lastIndex = 0;
    let match;
    
    while ((match = tagRegex.exec(html)) !== null) {
      const fullTag = match[0];
      const tagName = match[1].toLowerCase();
      const isClosing = fullTag.startsWith('</');
      const isSelfClosing = fullTag.endsWith('/>') || ['img', 'br', 'hr', 'input', 'meta', 'link'].includes(tagName);
      
      // Block-level elements that we care about
      const isBlockElement = ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table'].includes(tagName);
      
      if (!isBlockElement) {
        continue;
      }
      
      if (!inElement && !isClosing && depth === 0) {
        // Start of a new top-level element
        inElement = true;
        currentTag = tagName;
        currentElement = html.substring(lastIndex, match.index);
        lastIndex = match.index;
      }
      
      if (inElement) {
        if (!isClosing && !isSelfClosing && tagName === currentTag) {
          depth++;
        } else if (isClosing && tagName === currentTag) {
          depth--;
          
          if (depth === 0) {
            // End of the top-level element
            currentElement = html.substring(lastIndex, tagRegex.lastIndex);
            
            // Check if element has content or images
            const textContent = currentElement.replace(/<[^>]+>/g, '').trim();
            if (textContent.length > 0 || currentElement.includes('<img')) {
              lines.push(currentElement);
            }
            
            inElement = false;
            currentElement = '';
            currentTag = '';
            lastIndex = tagRegex.lastIndex;
          }
        }
      }
    }
    
    // If no elements found (shouldn't happen with valid Vditor output), fallback
    if (lines.length === 0) {
      logger.warn('[parseHTMLToLines] No top-level elements found, using fallback');
      // Simple fallback: split by common block patterns (greedy match for first level)
      const blockPattern = /<(div|p|h[1-6]|ul|ol|pre|blockquote|table)[^>]*>[\s\S]*?<\/\1>/gi;
      let fallbackMatch;
      while ((fallbackMatch = blockPattern.exec(html)) !== null) {
        lines.push(fallbackMatch[0]);
      }
    }
    
    return lines;
  }

  /**
   * Compute diff using Longest Common Subsequence algorithm
   */
  private computeLCSDiff(leftLines: string[], rightLines: string[]): LineChange[] {
    const changes: LineChange[] = [];
    
    const lcs = this.buildLCSTable(leftLines, rightLines);
    
    let i = leftLines.length;
    let j = rightLines.length;
    
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
        i--;
        j--;
      } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
        changes.unshift({
          type: 'added',
          lineNumber: j - 1,
          content: rightLines[j - 1],
          side: 'right'
        });
        j--;
      } else if (i > 0 && (j === 0 || lcs[i][j - 1] < lcs[i - 1][j])) {
        changes.unshift({
          type: 'deleted',
          lineNumber: i - 1,
          content: leftLines[i - 1],
          side: 'left'
        });
        i--;
      }
    }
    
    // Debug: log raw changes before merge
    logger.debug('[computeLCSDiff] Raw changes from LCS:', JSON.stringify(changes.map(c => ({
      type: c.type,
      line: c.lineNumber,
      content: c.content.substring(0, 50)
    }))));
    
    // Post-process to detect modified lines (delete+add pairs)
    const merged = this.mergeModifiedLines(changes, leftLines, rightLines);
    
    // Debug: log merged changes
    logger.debug('[computeLCSDiff] Merged changes:', JSON.stringify(merged.map(c => ({
      type: c.type,
      line: c.lineNumber,
      content: c.content.substring(0, 50),
      old: c.oldContent?.substring(0, 50)
    }))));
    
    return merged;
  }

  /**
   * Merge delete+add pairs into modified changes ONLY when they truly represent replacements
   * Strategy: Don't merge at all - let additions and deletions stand on their own
   * The visualization layer will handle displaying them appropriately
   */
  private mergeModifiedLines(changes: LineChange[], leftLines: string[], rightLines: string[]): LineChange[] {
    logger.debug('[computeLCSDiff mergeModifiedLines] NOT merging - keeping all changes as-is (additions and deletions separate)');
    logger.debug('[computeLCSDiff mergeModifiedLines] Result: modified=0, deleted=' + 
                 changes.filter(r => r.type === 'deleted').length + 
                 ', added=' + changes.filter(r => r.type === 'added').length);
    
    // Return changes as-is, sorted by line number
    return changes.sort((a, b) => a.lineNumber - b.lineNumber);
  }

  /**
   * NEW ALGORITHM: Align changes with spacers for perfect left-right synchronization
   * 
   * Process changes sequentially, tracking offsets for both sides.
   * When one side has a change but the other doesn't, insert a spacer.
   * When both sides have changes at the same position (after offset), combine them as modified.
   * 
   * This produces a complete aligned diff where line numbers directly correspond to display positions.
   */
  private alignChangesWithSpacers(rawChanges: LineChange[], leftLines: string[], rightLines: string[]): LineChange[] {
    const result: LineChange[] = [];
    
    // Separate changes by type and sort
    const deletions = rawChanges.filter(c => c.type === 'deleted').sort((a, b) => a.lineNumber - b.lineNumber);
    const additions = rawChanges.filter(c => c.type === 'added').sort((a, b) => a.lineNumber - b.lineNumber);
    
    // Track current position in each document and offset counters
    let leftIndex = 0;
    let rightIndex = 0;
    let leftOffset = 0;  // How many spacers added to left
    let rightOffset = 0; // How many spacers added to right
    
    let delIdx = 0;
    let addIdx = 0;
    
    // Determine which document has more lines (after changes applied)
    const maxLines = Math.max(leftLines.length, rightLines.length);
    
    logger.debug(`[alignChangesWithSpacers] Processing ${deletions.length} deletions and ${additions.length} additions`);
    logger.debug(`[alignChangesWithSpacers] Left lines: ${leftLines.length}, Right lines: ${rightLines.length}`);
    
    // Process all lines
    while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
      const currentDeletion = delIdx < deletions.length ? deletions[delIdx] : null;
      const currentAddition = addIdx < additions.length ? additions[addIdx] : null;
      
      const leftHasChange = currentDeletion && currentDeletion.lineNumber === leftIndex;
      const rightHasChange = currentAddition && currentAddition.lineNumber === rightIndex;
      
      if (leftHasChange && rightHasChange) {
        // Both sides have changes at the same position - combine as modified
        result.push({
          type: 'modified',
          lineNumber: leftIndex + leftOffset,
          content: currentAddition!.content,
          oldContent: currentDeletion!.content,
          side: 'both',
          leftLine: leftIndex,
          rightLine: rightIndex
        });
        
        leftIndex++;
        rightIndex++;
        delIdx++;
        addIdx++;
      } else if (leftHasChange && !rightHasChange) {
        // Left has deletion, right doesn't - add deletion to left and spacer to right
        result.push({
          type: 'deleted',
          lineNumber: leftIndex + leftOffset,
          content: currentDeletion!.content,
          side: 'left',
          leftLine: leftIndex,
          rightLine: -1
        });
        
        result.push({
          type: 'spacer',
          lineNumber: rightIndex + rightOffset,
          content: currentDeletion!.content, // Content from opposite side for height matching
          side: 'right',
          leftLine: leftIndex,
          rightLine: -1
        });
        
        leftIndex++;
        delIdx++;
        rightOffset++;
      } else if (!leftHasChange && rightHasChange) {
        // Right has addition, left doesn't - add addition to right and spacer to left
        result.push({
          type: 'spacer',
          lineNumber: leftIndex + leftOffset,
          content: currentAddition!.content, // Content from opposite side for height matching
          side: 'left',
          leftLine: -1,
          rightLine: rightIndex
        });
        
        result.push({
          type: 'added',
          lineNumber: rightIndex + rightOffset,
          content: currentAddition!.content,
          side: 'right',
          leftLine: -1,
          rightLine: rightIndex
        });
        
        rightIndex++;
        addIdx++;
        leftOffset++;
      } else {
        // Neither side has changes - common line, advance both
        leftIndex++;
        rightIndex++;
      }
    }
    
    logger.debug(`[alignChangesWithSpacers] Generated ${result.length} aligned changes (leftOffset: ${leftOffset}, rightOffset: ${rightOffset})`);
    
    return result;
  }

  /**
   * Calculate text similarity between two strings (0-1 scale)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const longer = text1.length > text2.length ? text1 : text2;
    const shorter = text1.length > text2.length ? text2 : text1;
    
    if (longer.length === 0) return 1.0;
    
    // Count matching characters at corresponding positions
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (longer[i] === shorter[i]) {
        matches++;
      }
    }
    
    return matches / longer.length;
  }

  /**
   * Build the LCS (Longest Common Subsequence) table
   */
  private buildLCSTable(leftLines: string[], rightLines: string[]): number[][] {
    const m = leftLines.length;
    const n = rightLines.length;
    const lcs: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (leftLines[i - 1] === rightLines[j - 1]) {
          lcs[i][j] = lcs[i - 1][j - 1] + 1;
        } else {
          lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
        }
      }
    }
    
    return lcs;
  }

  /**
   * Handle scroll sync message from webview
   * Finds the other editor in the diff pair by matching instance ID (primary) or URI (fallback)
   */
  public handleScrollSync(sourceInstanceId: string | undefined, sourceUri: vscode.Uri, targetUri: vscode.Uri, scrollPercentage: number, retryCount: number = 0): void {
    const EditorPanel = require('../app/EditorPanel').EditorPanel;

    if (EditorPanel.editors && EditorPanel.editors.length > 0) {
      // Find the target editor by matching its URI with the targetUri
      // When URIs are the same (git self-diff), instance ID would help but we match by URI and exclude source
      const targetEditor = EditorPanel.editors.find((editor: any) => {
        const matchesUri = editor._uri && editor._uri.toString() === targetUri.toString();
        // Exclude the source editor by instance ID if available
        const isNotSource = !sourceInstanceId || editor._instanceId !== sourceInstanceId;
        return matchesUri && isNotSource;
      });

      if (targetEditor && targetEditor.sendScrollSync) {
        targetEditor.sendScrollSync(scrollPercentage);
      } else {
        // Target editor not found - retry up to 3 times with increasing delays
        if (retryCount < 3) {
          const retryDelay = 50 * Math.pow(2, retryCount); // 50ms, 100ms, 200ms
          logger.warn(`[MarkdownDiffViewSupport] Target editor not found, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/3)`);
          setTimeout(() => {
            this.handleScrollSync(sourceInstanceId, sourceUri, targetUri, scrollPercentage, retryCount + 1);
          }, retryDelay);
        } else {
          logger.warn(`[MarkdownDiffViewSupport] Target editor not found after 3 retries: ${targetUri.toString()}`);
        }
      }
    } else {
      // No editors array - retry if this is an early attempt
      if (retryCount < 3) {
        const retryDelay = 50 * Math.pow(2, retryCount);
        logger.warn(`[MarkdownDiffViewSupport] No editors available, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/3)`);
        setTimeout(() => {
          this.handleScrollSync(sourceInstanceId, sourceUri, targetUri, scrollPercentage, retryCount + 1);
        }, retryDelay);
      } else {
        logger.warn('[MarkdownDiffViewSupport] No editors available after 3 retries');
      }
    }
  }

  public dispose(): void {
    // No disposables needed - all state management happens in EditorPanel instances
  }
}

interface LineChange {
  type: 'added' | 'deleted' | 'modified' | 'spacer';
  lineNumber: number;
  content: string;
  oldContent?: string;
  side: 'left' | 'right' | 'both';
  leftLine?: number;  // Original line number in left document (-1 if not applicable)
  rightLine?: number; // Original line number in right document (-1 if not applicable)
}

interface DiffResult {
  leftUri: vscode.Uri;
  rightUri: vscode.Uri;
  changes: LineChange[];
  stats: {
    added: number;
    deleted: number;
    modified: number;
    spacer?: number;
  };
  leftHtmlLines?: string[];  // HTML lines from left side (for HTML-based diff)
  rightHtmlLines?: string[]; // HTML lines from right side (for HTML-based diff)
}
