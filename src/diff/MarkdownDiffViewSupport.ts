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
    
    // Post-process to detect modified lines (delete+add pairs)
    return this.mergeModifiedLines(changes);
  }

  /**
   * Merge consecutive delete+add pairs into modified changes
   * This detects line modifications by finding deletions followed by additions at nearby positions
   */
  private mergeModifiedLines(changes: LineChange[]): LineChange[] {
    const result: LineChange[] = [];
    const deletions = changes.filter(c => c.type === 'deleted' && c.side === 'left');
    const additions = changes.filter(c => c.type === 'added' && c.side === 'right');
    const usedAdditions = new Set<number>();
    const usedDeletions = new Set<number>();

    // For each deletion, try to find a matching addition
    for (let i = 0; i < deletions.length; i++) {
      const deletion = deletions[i];
      
      // Calculate expected line number on right, accounting for all previous additions/deletions
      const previousAdditions = additions.filter(a => a.lineNumber < deletion.lineNumber).length;
      const previousDeletions = deletions.filter(d => d.lineNumber < deletion.lineNumber).length;
      const offset = previousAdditions - previousDeletions;
      const expectedRightLine = deletion.lineNumber + offset;
      
      // Find nearby additions within ±3 lines
      const nearbyAdditions = additions.filter((a, idx) => {
        if (usedAdditions.has(idx)) return false;
        const positionDiff = Math.abs(a.lineNumber - expectedRightLine);
        return positionDiff <= 3;
      });
      
      if (nearbyAdditions.length > 0) {
        // Find best match based on content similarity and position
        let bestMatch: LineChange | null = null;
        let bestScore = 0;
        let bestMatchIdx = -1;
        
        for (const addition of nearbyAdditions) {
          const additionIdx = additions.indexOf(addition);
          const similarity = this.calculateSimilarity(deletion.content, addition.content);
          const positionScore = 1 - Math.abs(addition.lineNumber - expectedRightLine) / 4;
          const score = similarity * 0.7 + positionScore * 0.3;
          
          if (score > bestScore) {
            bestScore = score;
            bestMatch = addition;
            bestMatchIdx = additionIdx;
          }
        }
        
        // Only merge if similarity is reasonable (>30% similar OR within 1 line)
        if (bestMatch) {
          const similarity = this.calculateSimilarity(deletion.content, bestMatch.content);
          const positionDiff = Math.abs(bestMatch.lineNumber - expectedRightLine);
          
          if (similarity > 0.3 || positionDiff <= 1) {
            // Merge into a modified change
            result.push({
              type: 'modified',
              lineNumber: bestMatch.lineNumber, // Use the line number from the modified version
              content: bestMatch.content,        // New content
              oldContent: deletion.content,      // Old content
              side: 'both'                       // Affects both sides
            });
            
            usedDeletions.add(i);
            usedAdditions.add(bestMatchIdx);
            continue;
          }
        }
      }
    }
    
    // Add all changes: merged modifications + unused deletions + unused additions
    for (let i = 0; i < deletions.length; i++) {
      if (!usedDeletions.has(i)) {
        result.push(deletions[i]);
      }
    }
    
    for (let i = 0; i < additions.length; i++) {
      if (!usedAdditions.has(i)) {
        result.push(additions[i]);
      }
    }
    
    // Sort by line number for consistent output
    return result.sort((a, b) => a.lineNumber - b.lineNumber);
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
  type: 'added' | 'deleted' | 'modified';
  lineNumber: number;
  content: string;
  oldContent?: string;
  side: 'left' | 'right' | 'both';
}

interface DiffResult {
  leftUri: vscode.Uri;
  rightUri: vscode.Uri;
  changes: LineChange[];
  stats: {
    added: number;
    deleted: number;
    modified: number;
  };
}
