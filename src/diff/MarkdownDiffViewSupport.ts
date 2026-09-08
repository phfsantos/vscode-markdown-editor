import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import { parseHTMLToLines, ParsedBlock } from './HtmlLineParser';

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
   * Calculate an aligned diff from raw text by converting each source line into
   * a simple HTML block first. This keeps the spacer-based diff pipeline usable
   * even when only document text is available.
   * This is a source-line approximation, not a rendered HTML line counter.
   * Use calculateDiffFromHTML with Vditor IR HTML for rendered diff targeting.
   */
  public calculateAlignedDiffFromContent(originalContent: string, modifiedContent: string): DiffResult {
    return this.calculateDiffFromHTML(
      this.convertContentToLineHtml(originalContent),
      this.convertContentToLineHtml(modifiedContent)
    );
  }

  /**
   * Calculate diff from HTML strings (for more accurate diff visualization)
   * HTML content should be the IR content from Vditor's rendering
   * 
   * NEW ALGORITHM: Process changes sequentially with offset tracking
   * This produces aligned changes with spacers included, ready for frontend display
   */
  public calculateDiffFromHTML(leftHtml: string, rightHtml: string): DiffResult {
    const leftBlocks = parseHTMLToLines(leftHtml);
    const rightBlocks = parseHTMLToLines(rightHtml);
    const leftLines = this.extractBlockHtml(leftBlocks);
    const rightLines = this.extractBlockHtml(rightBlocks);
    
    const rawChanges = this.computeLCSDiff(leftLines, rightLines);
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
      rightHtmlLines: rightLines,
      leftParsedLines: leftBlocks,
      rightParsedLines: rightBlocks
    };
  }

  private extractBlockHtml(blocks: ParsedBlock[]): string[] {
    return blocks.map(block => block.html);
  }

  private convertContentToLineHtml(content: string): string {
    return content
      .split('\n')
      .map((line) => {
        if (line.length === 0) {
          return '<p data-empty-line="true">&#8203;</p>';
        }

        return `<p>${this.escapeHtml(line)}</p>`;
      })
      .join('');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
    
    logger.debug('[computeLCSDiff] Raw changes from LCS:', JSON.stringify(changes.map(c => ({
      type: c.type,
      line: c.lineNumber,
      content: c.content.substring(0, 50)
    }))));
    
    const merged = this.mergeModifiedLines(changes, leftLines, rightLines);
    
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
    
    const deletions = rawChanges.filter(c => c.type === 'deleted').sort((a, b) => a.lineNumber - b.lineNumber);
    const additions = rawChanges.filter(c => c.type === 'added').sort((a, b) => a.lineNumber - b.lineNumber);
    
    let leftIndex = 0;
    let rightIndex = 0;
    let leftOffset = 0;
    let rightOffset = 0;
    
    let delIdx = 0;
    let addIdx = 0;
    
    logger.debug(`[alignChangesWithSpacers] Processing ${deletions.length} deletions and ${additions.length} additions`);
    logger.debug(`[alignChangesWithSpacers] Left lines: ${leftLines.length}, Right lines: ${rightLines.length}`);
    
    while (leftIndex < leftLines.length || rightIndex < rightLines.length) {
      const currentDeletion = delIdx < deletions.length ? deletions[delIdx] : null;
      const currentAddition = addIdx < additions.length ? additions[addIdx] : null;
      
      const leftHasChange = currentDeletion && currentDeletion.lineNumber === leftIndex;
      const rightHasChange = currentAddition && currentAddition.lineNumber === rightIndex;
      
      if (leftHasChange && rightHasChange) {
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
          content: currentDeletion!.content,
          side: 'right',
          leftLine: leftIndex,
          rightLine: -1
        });
        
        leftIndex++;
        delIdx++;
        rightOffset++;
      } else if (!leftHasChange && rightHasChange) {
        result.push({
          type: 'spacer',
          lineNumber: leftIndex + leftOffset,
          content: currentAddition!.content,
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- lazy require breaks the circular import with EditorPanel
    const EditorPanel = require('../app/EditorPanel').EditorPanel;

    if (EditorPanel.editors && EditorPanel.editors.length > 0) {
      const targetEditor = EditorPanel.editors.find((editor: any) => {
        const matchesUri = editor._uri && editor._uri.toString() === targetUri.toString();
        const isNotSource = !sourceInstanceId || editor._instanceId !== sourceInstanceId;
        return matchesUri && isNotSource;
      });

      if (targetEditor && targetEditor.sendScrollSync) {
        targetEditor.sendScrollSync(scrollPercentage);
      } else {
        if (retryCount < 3) {
          const retryDelay = 50 * Math.pow(2, retryCount);
          logger.warn(`[MarkdownDiffViewSupport] Target editor not found, retrying in ${retryDelay}ms (attempt ${retryCount + 1}/3)`);
          setTimeout(() => {
            this.handleScrollSync(sourceInstanceId, sourceUri, targetUri, scrollPercentage, retryCount + 1);
          }, retryDelay);
        } else {
          logger.warn(`[MarkdownDiffViewSupport] Target editor not found after 3 retries: ${targetUri.toString()}`);
        }
      }
    } else {
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
  leftLine?: number;
  rightLine?: number;
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
  leftHtmlLines?: string[];
  rightHtmlLines?: string[];
  leftParsedLines?: ParsedBlock[];
  rightParsedLines?: ParsedBlock[];
}
