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
    
    return changes;
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
   * Finds the other editor in the diff pair by matching URIs
   */
  public handleScrollSync(sourceUri: vscode.Uri, targetUri: vscode.Uri, scrollPercentage: number, retryCount: number = 0): void {
    const EditorPanel = require('../app/EditorPanel').EditorPanel;

    if (EditorPanel.editors && EditorPanel.editors.length > 0) {
      // Find the target editor by matching its URI with the targetUri
      const targetEditor = EditorPanel.editors.find((editor: any) => 
        editor._uri && editor._uri.toString() === targetUri.toString()
      );

      if (targetEditor && targetEditor.sendScrollSync) {
        targetEditor.sendScrollSync(scrollPercentage);
      } else {
        // Target editor not found - retry up to 3 times with increasing delays
        if (retryCount < 3) {
          const retryDelay = 50 * Math.pow(2, retryCount); // 50ms, 100ms, 200ms
          console.warn(`[MarkdownDiffViewSupport] Target editor not found, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/3)`);
          setTimeout(() => {
            this.handleScrollSync(sourceUri, targetUri, scrollPercentage, retryCount + 1);
          }, retryDelay);
        } else {
          console.warn(`[MarkdownDiffViewSupport] Target editor not found after 3 retries: ${targetUri.toString()}`);
        }
      }
    } else {
      // No editors array - retry if this is an early attempt
      if (retryCount < 3) {
        const retryDelay = 50 * Math.pow(2, retryCount);
        console.warn(`[MarkdownDiffViewSupport] No editors available, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/3)`);
        setTimeout(() => {
          this.handleScrollSync(sourceUri, targetUri, scrollPercentage, retryCount + 1);
        }, retryDelay);
      } else {
        console.warn('[MarkdownDiffViewSupport] No editors available after 3 retries');
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
