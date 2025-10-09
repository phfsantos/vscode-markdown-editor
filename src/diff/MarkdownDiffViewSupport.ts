import * as vscode from 'vscode';

/**
 * Detects and provides diff information when markdown editors are opened in VS Code's diff view
 */
export class MarkdownDiffViewSupport {
  private disposables: vscode.Disposable[] = [];
  private diffViewEditors: Map<string, DiffViewInfo> = new Map();

  constructor(private context: vscode.ExtensionContext) {
    this.setupDiffDetection();
    this.registerDiffCommands();
  }

  private registerDiffCommands(): void {
    // Command to manually trigger diff mode for two visible markdown editors
    this.disposables.push(
      vscode.commands.registerCommand('markdown-editor.enableDiffMode', () => {

        this.detectDiffViews();
        
        if (this.diffViewEditors.size === 0) {
          vscode.window.showInformationMessage(
            'Open two markdown files side-by-side to compare them'
          );
        } else {
          vscode.window.showInformationMessage(
            'Diff mode enabled for side-by-side markdown editors'
          );
        }
      })
    );
  }

  private setupDiffDetection(): void {
    // Monitor tab changes to detect diff views
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        // Delay to let VS Code stabilize the layout
        setTimeout(() => this.detectDiffViews(), 100);
      })
    );

    // Monitor active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        setTimeout(() => this.detectDiffViews(), 100);
      })
    );
    
    // Monitor when visible editors change (important for split view)
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        setTimeout(() => this.detectDiffViews(), 100);
      })
    );

    // Initial detection with delay
    setTimeout(() => this.detectDiffViews(), 500);
  }
  
  /**
   * Manually trigger diff detection (can be called by EditorPanel)
   */
  public triggerDetection(): void {

    setTimeout(() => this.detectDiffViews(), 100);
  }

  /**
   * Scans all tab groups to find markdown editors in diff views
   */
  private detectDiffViews(): void {


    const allEditors: { uri: vscode.Uri; tabGroup: vscode.TabGroup; tab: vscode.Tab; groupIndex: number }[] = [];
    
    // First, collect all markdown editors with their group info
    const groups = vscode.window.tabGroups.all;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const tabGroup = groups[groupIndex];

      for (const tab of tabGroup.tabs) {
        // Log ALL tab types to see what we're dealing with
        const inputType = (tab.input as any)?.constructor?.name || 'unknown';
        const hasArrow = tab.label.includes('↔');

        // Check for diff tabs by label pattern (test3.md ↔ test3 copy.md)
        if (hasArrow && tab.label.includes('.md')) {

          // Parse the file names from the label
          const parts = tab.label.split('↔').map(s => s.trim());
          if (parts.length === 2) {

            // Try to find these files in our markdown editors
            const file1Name = parts[0];
            const file2Name = parts[1];
            
            // Look through all editors to find matching URIs
            let uri1: vscode.Uri | undefined;
            let uri2: vscode.Uri | undefined;
            
            for (const otherTab of tabGroup.tabs) {
              if (otherTab.input instanceof vscode.TabInputCustom) {
                const customInput = otherTab.input as vscode.TabInputCustom;
                if (customInput.viewType === 'markdown-editor') {
                  const fileName = customInput.uri.path.split('/').pop();
                  if (fileName === file1Name) {
                    uri1 = customInput.uri;
                  } else if (fileName === file2Name) {
                    uri2 = customInput.uri;
                  }
                }
              }
            }
            
            if (uri1 && uri2) {

              this.registerDiffPair(uri1, uri2);
              return;
            } else {

            }
          }
        }
        
        // Check for TextDiff tabs (native VS Code diff with text editors)
        if (tab.input instanceof vscode.TabInputTextDiff) {
          const diffInput = tab.input as vscode.TabInputTextDiff;

          // Check if both are markdown files
          if (diffInput.original.path.endsWith('.md') && diffInput.modified.path.endsWith('.md')) {

            this.registerDiffPair(diffInput.original, diffInput.modified);
            return;
          }
        }
        
        // Check if this is a custom markdown editor
        if (tab.input instanceof vscode.TabInputCustom) {
          const customInput = tab.input as vscode.TabInputCustom;
          if (customInput.viewType === 'markdown-editor') {
            const fileName = customInput.uri.path.split('/').pop();

            allEditors.push({ uri: customInput.uri, tabGroup, tab, groupIndex });
          }
        }
      }
    }

    // Strategy 1: Look for exactly 2 groups with 1 active markdown editor each (side-by-side)
    if (groups.length >= 2) {
      const editorsInGroup: Map<number, typeof allEditors[0]> = new Map();
      
      // Find active editor in each group
      for (const editor of allEditors) {
        if (editor.tab.isActive) {
          editorsInGroup.set(editor.groupIndex, editor);
        }
      }

      // If we have exactly 2 groups with active markdown editors
      if (editorsInGroup.size === 2) {
        const editorsArray = Array.from(editorsInGroup.values());
        const [editor1, editor2] = editorsArray.sort((a, b) => a.groupIndex - b.groupIndex);

        this.registerDiffPair(editor1.uri, editor2.uri);
        return;
      }
    }
    
    // Strategy 2: Look for 2 active editors in different groups (fallback)
    const activeEditorsInDifferentGroups = allEditors.filter(e => e.tab.isActive);

    if (activeEditorsInDifferentGroups.length === 2) {
      const [editor1, editor2] = activeEditorsInDifferentGroups;
      
      if (editor1.groupIndex !== editor2.groupIndex) {

        if (editor1.groupIndex < editor2.groupIndex) {
          this.registerDiffPair(editor1.uri, editor2.uri);
        } else {
          this.registerDiffPair(editor2.uri, editor1.uri);
        }
        return;
      }
    }

  }
  
  /**
   * Get base file name without extension
   */
  private getBaseName(uri: vscode.Uri): string {
    const parts = uri.path.split('/');
    const fileName = parts[parts.length - 1];
    return fileName.replace(/\.[^.]+$/, '');
  }
  
  /**
   * Check if two filenames are similar (might be copies or versions)
   */
  private areFilesSimilar(name1: string, name2: string): boolean {
    // Remove common diff indicators
    const clean1 = name1.replace(/\s*(copy|Copy|COPY|\d+|backup|old|new|version|v\d+).*$/i, '').trim();
    const clean2 = name2.replace(/\s*(copy|Copy|COPY|\d+|backup|old|new|version|v\d+).*$/i, '').trim();
    
    // Check if base names match
    if (clean1 === clean2 && clean1.length > 0) {
      return true;
    }
    
    // Check if one contains the other
    if (name1.includes(name2) || name2.includes(name1)) {
      return true;
    }
    
    return false;
  }

  /**
   * Register a pair of editors that might be in a diff view
   */
  private registerDiffPair(uri1: vscode.Uri, uri2: vscode.Uri): void {
    const key1 = uri1.toString();
    const key2 = uri2.toString();
    
    this.diffViewEditors.set(key1, {
      thisUri: uri1,
      otherUri: uri2,
      role: 'left'
    });
    
    this.diffViewEditors.set(key2, {
      thisUri: uri2,
      otherUri: uri1,
      role: 'right'
    });

  }

  /**
   * Get diff info for a specific document
   */
  public getDiffInfo(uri: vscode.Uri): DiffViewInfo | undefined {
    return this.diffViewEditors.get(uri.toString());
  }

  /**
   * Check if a document is part of a diff view
   */
  public isInDiffView(uri: vscode.Uri): boolean {
    return this.diffViewEditors.has(uri.toString());
  }

  /**
   * Calculate line-by-line diff between two documents using LCS algorithm
   */
  public async calculateDiff(leftUri: vscode.Uri, rightUri: vscode.Uri): Promise<DiffResult> {

    const leftDoc = await vscode.workspace.openTextDocument(leftUri);
    const rightDoc = await vscode.workspace.openTextDocument(rightUri);
    
    const leftLines = leftDoc.getText().split('\n');
    const rightLines = rightDoc.getText().split('\n');
    
    // Use Longest Common Subsequence (LCS) to find actual differences
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
   * This properly handles insertions and deletions
   */
  private computeLCSDiff(leftLines: string[], rightLines: string[]): LineChange[] {
    const changes: LineChange[] = [];
    
    // Build LCS table
    const lcs = this.buildLCSTable(leftLines, rightLines);
    
    // Backtrack through the LCS table to find differences
    let i = leftLines.length;
    let j = rightLines.length;
    
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
        // Lines are the same, no change
        i--;
        j--;
      } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
        // Line added in right
        changes.unshift({
          type: 'added',
          lineNumber: j - 1,
          content: rightLines[j - 1],
          side: 'right'
        });
        j--;
      } else if (i > 0 && (j === 0 || lcs[i][j - 1] < lcs[i - 1][j])) {
        // Line deleted from left
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
   * Remove diff info when editor is closed
   */
  public removeDiffInfo(uri: vscode.Uri): void {
    const info = this.diffViewEditors.get(uri.toString());
    if (info) {
      // Remove both entries
      this.diffViewEditors.delete(uri.toString());
      this.diffViewEditors.delete(info.otherUri.toString());
    }
  }

  /**
   * Handle scroll sync message from webview
   */
  public handleScrollSync(sourceUri: vscode.Uri, scrollPercentage: number): void {

    const info = this.diffViewEditors.get(sourceUri.toString());
    if (!info) {
      return;
    }

    // Find the target EditorPanel for the other editor
    // EditorPanel stores all instances in EditorPanel.editors
    const EditorPanel = require('../app/EditorPanel').EditorPanel;


    if (EditorPanel.editors && EditorPanel.editors.length > 0) {
      const targetEditor = EditorPanel.editors.find((editor: any) => 
        editor._uri && editor._uri.toString() === info.otherUri.toString()
      );
      
      if (targetEditor) {

        targetEditor.sendScrollSync(scrollPercentage);
      } else {



      }
    } else {

    }
  }

  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.diffViewEditors.clear();
  }
}

interface DiffViewInfo {
  thisUri: vscode.Uri;
  otherUri: vscode.Uri;
  role: 'left' | 'right';
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
