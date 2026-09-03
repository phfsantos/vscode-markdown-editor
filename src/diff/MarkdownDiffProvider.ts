import * as vscode from 'vscode';
import { logger } from '../utils/Logger';

/**
 * Provides markdown file comparison with synchronized scrolling and difference highlights
 */
export class MarkdownDiffProvider {
  private disposables: vscode.Disposable[] = [];
  private scrollSyncMap: Map<string, vscode.TextEditor> = new Map();
  private syncDecorations: Map<string, vscode.TextEditorDecorationType[]> = new Map();

  // Decoration types for diff highlighting
  private readonly addedLineDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  private readonly deletedLineDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  private readonly modifiedLineDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });

  private readonly addedTextDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
  });

  private readonly deletedTextDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
    textDecoration: 'line-through',
  });

  constructor(private context: vscode.ExtensionContext) {

    (global as any).markdownEditorLog?.('🔍 DIFF PROVIDER: Constructor called');
    this.registerCommands();
    this.setupEventHandlers();

    (global as any).markdownEditorLog?.('✅ DIFF PROVIDER: Initialization complete');
  }

  private registerCommands(): void {

    (global as any).markdownEditorLog?.('🔍 DIFF PROVIDER: Registering commands...');
    
    // Command to compare current file with another file
    this.disposables.push(
      vscode.commands.registerCommand(
        'markdown-editor.compareWithFile',
        this.compareWithFile,
        this
      )
    );

    (global as any).markdownEditorLog?.('✅ DIFF: Registered command: markdown-editor.compareWithFile');

    // Command to compare with clipboard content
    this.disposables.push(
      vscode.commands.registerCommand(
        'markdown-editor.compareWithClipboard',
        this.compareWithClipboard,
        this
      )
    );

    (global as any).markdownEditorLog?.('✅ DIFF: Registered command: markdown-editor.compareWithClipboard');

    // Command to use native VS Code diff editor
    this.disposables.push(
      vscode.commands.registerCommand(
        'markdown-editor.openInDiffEditor',
        this.openInDiffEditor,
        this
      )
    );

    (global as any).markdownEditorLog?.('✅ DIFF: Registered command: markdown-editor.openInDiffEditor');

    // Command to compare with previous version (git)
    this.disposables.push(
      vscode.commands.registerCommand(
        'markdown-editor.compareWithPrevious',
        this.compareWithPrevious,
        this
      )
    );

    (global as any).markdownEditorLog?.('✅ DIFF: Registered command: markdown-editor.compareWithPrevious');

    // Command to toggle scroll sync
    this.disposables.push(
      vscode.commands.registerCommand(
        'markdown-editor.toggleScrollSync',
        this.toggleScrollSync,
        this
      )
    );

    (global as any).markdownEditorLog?.('✅ DIFF: Registered command: markdown-editor.toggleScrollSync');

    (global as any).markdownEditorLog?.('✅ DIFF PROVIDER: All 5 commands registered successfully');
  }

  private setupEventHandlers(): void {
    // Listen to scroll events for synchronized scrolling
    this.disposables.push(
      vscode.window.onDidChangeTextEditorVisibleRanges(
        this.handleVisibleRangeChange,
        this
      )
    );

    // Clean up when editors are closed
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.cleanupClosedEditors();
        }
      })
    );
  }

  /**
   * Compare current markdown file with another file
   */
  private async compareWithFile(): Promise<void> {

    (global as any).markdownEditorLog?.('🔍 DIFF: compareWithFile() called');
    
    const currentEditor = vscode.window.activeTextEditor;
    if (!currentEditor) {

      (global as any).markdownEditorLog?.('❌ DIFF: No active editor found');
      vscode.window.showErrorMessage('No active editor found');
      return;
    }

    (global as any).markdownEditorLog?.('📄 DIFF: Current editor: ' + currentEditor.document.uri.toString());

    // Show file picker
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Markdown files': ['md', 'markdown', 'mdown', 'mkd'],
        'All files': ['*'],
      },
      title: 'Select file to compare with',
    });

    if (!fileUri || fileUri.length === 0) {

      (global as any).markdownEditorLog?.('⚠️ DIFF: No file selected');
      return;
    }

    (global as any).markdownEditorLog?.('📄 DIFF: Selected file: ' + fileUri[0].toString());
    
    await this.performComparison(currentEditor.document.uri, fileUri[0]);
  }

  /**
   * Compare with clipboard content
   */
  private async compareWithClipboard(): Promise<void> {

    (global as any).markdownEditorLog?.('🔍 DIFF: compareWithClipboard() called');
    
    const currentEditor = vscode.window.activeTextEditor;
    if (!currentEditor) {
      vscode.window.showErrorMessage('No active editor found');
      return;
    }

    const clipboardText = await vscode.env.clipboard.readText();
    if (!clipboardText) {
      vscode.window.showErrorMessage('Clipboard is empty');
      return;
    }

    // Create temporary file for clipboard content
    const tempUri = vscode.Uri.parse(
      `untitled:Clipboard-${Date.now()}.md`
    );
    await vscode.workspace.openTextDocument(tempUri);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(tempUri, new vscode.Position(0, 0), clipboardText);
    await vscode.workspace.applyEdit(edit);

    await this.performComparison(currentEditor.document.uri, tempUri);
  }

  /**
   * Open files in VS Code's native diff editor
   */
  private async openInDiffEditor(leftUri?: vscode.Uri): Promise<void> {
    let leftFile = leftUri;
    
    if (!leftFile) {
      const currentEditor = vscode.window.activeTextEditor;
      if (!currentEditor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
      }
      leftFile = currentEditor.document.uri;
    }

    // Show file picker for right side
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        'Markdown files': ['md', 'markdown', 'mdown', 'mkd'],
        'All files': ['*'],
      },
      title: 'Select file to compare with',
    });

    if (!fileUri || fileUri.length === 0) {
      return;
    }

    // Use VS Code's native diff command
    await vscode.commands.executeCommand(
      'vscode.diff',
      leftFile,
      fileUri[0],
      `${this.getFileName(leftFile)} ↔ ${this.getFileName(fileUri[0])}`
    );
  }

  /**
   * Compare with previous git version
   */
  private async compareWithPrevious(): Promise<void> {
    const currentEditor = vscode.window.activeTextEditor;
    if (!currentEditor) {
      vscode.window.showErrorMessage('No active editor found');
      return;
    }

    try {
      // Use git extension API to get previous version
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        vscode.window.showErrorMessage('Git extension not found');
        return;
      }

      const git = gitExtension.exports.getAPI(1);
      const repo = git.repositories[0];
      
      if (!repo) {
        vscode.window.showErrorMessage('No git repository found');
        return;
      }

      const currentUri = currentEditor.document.uri;

      // Get HEAD version
      const headUri = currentUri.with({
        scheme: 'git',
        path: currentUri.path,
        query: 'HEAD',
      });

      await vscode.commands.executeCommand(
        'vscode.diff',
        headUri,
        currentUri,
        `${this.getFileName(currentUri)} (HEAD) ↔ ${this.getFileName(currentUri)} (Working Tree)`
      );
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to compare with previous version: ${error}`
      );
    }
  }

  /**
   * Perform side-by-side comparison with custom diff highlighting
   */
  private async performComparison(
    leftUri: vscode.Uri,
    rightUri: vscode.Uri
  ): Promise<void> {
    try {

      // Open both documents
      const leftDoc = await vscode.workspace.openTextDocument(leftUri);
      const rightDoc = await vscode.workspace.openTextDocument(rightUri);

      // Show documents side by side
      const leftEditor = await vscode.window.showTextDocument(leftDoc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
        preview: false, // Don't use preview mode - open as regular editor
      });

      const rightEditor = await vscode.window.showTextDocument(rightDoc, {
        viewColumn: vscode.ViewColumn.Two,
        preserveFocus: false,
        preview: false, // Don't use preview mode - open as regular editor
      });

      // Wait a bit for editors to fully render
      await new Promise(resolve => setTimeout(resolve, 100));

      // Calculate and apply diff decorations
      await this.applyDiffDecorations(leftEditor, rightEditor);

      // Enable scroll synchronization
      this.enableScrollSync(leftEditor, rightEditor);

      const selection = await vscode.window.showInformationMessage(
        `✅ Comparing: ${this.getFileName(leftUri)} ↔ ${this.getFileName(rightUri)}`,
        'Toggle Scroll Sync',
        'Close'
      );
      
      if (selection === 'Toggle Scroll Sync') {
        this.toggleScrollSync();
      } else if (selection === 'Close') {
        // Clear decorations when closing
        leftEditor.setDecorations(this.deletedLineDecoration, []);
        leftEditor.setDecorations(this.modifiedLineDecoration, []);
        rightEditor.setDecorations(this.addedLineDecoration, []);
        rightEditor.setDecorations(this.modifiedLineDecoration, []);
        this.scrollSyncMap.clear();
      }
    } catch (error) {
      logger.error(`❌ Comparison failed:`, error);
      vscode.window.showErrorMessage(`Comparison failed: ${error}`);
    }
  }

  /**
   * Apply diff decorations to both editors
   */
  private async applyDiffDecorations(
    leftEditor: vscode.TextEditor,
    rightEditor: vscode.TextEditor
  ): Promise<void> {
    const leftText = leftEditor.document.getText();
    const rightText = rightEditor.document.getText();

    // Calculate diff using simple line-by-line comparison
    const diff = this.calculateDiff(leftText, rightText);

    // Apply decorations to left editor (deletions and modifications)
    const leftRanges: vscode.Range[] = [];
    const leftDeletedRanges: vscode.Range[] = [];

    diff.leftChanges.forEach((change) => {
      const lineText = leftEditor.document.lineAt(change.lineNumber).text;
      const range = new vscode.Range(
        new vscode.Position(change.lineNumber, 0),
        new vscode.Position(change.lineNumber, lineText.length || 1)
      );
      
      if (change.type === 'deleted') {
        leftDeletedRanges.push(range);

      } else {
        leftRanges.push(range);

      }
    });

    leftEditor.setDecorations(this.deletedLineDecoration, leftDeletedRanges);
    leftEditor.setDecorations(this.modifiedLineDecoration, leftRanges);

    // Apply decorations to right editor (additions and modifications)
    const rightRanges: vscode.Range[] = [];
    const rightAddedRanges: vscode.Range[] = [];

    diff.rightChanges.forEach((change) => {
      const lineText = rightEditor.document.lineAt(change.lineNumber).text;
      const range = new vscode.Range(
        new vscode.Position(change.lineNumber, 0),
        new vscode.Position(change.lineNumber, lineText.length || 1)
      );
      
      if (change.type === 'added') {
        rightAddedRanges.push(range);

      } else {
        rightRanges.push(range);

      }
    });

    rightEditor.setDecorations(this.addedLineDecoration, rightAddedRanges);
    rightEditor.setDecorations(this.modifiedLineDecoration, rightRanges);

    // Store decorations for cleanup
    const leftKey = leftEditor.document.uri.toString();
    const rightKey = rightEditor.document.uri.toString();
    
    this.syncDecorations.set(leftKey, [
      this.deletedLineDecoration,
      this.modifiedLineDecoration,
    ]);
    this.syncDecorations.set(rightKey, [
      this.addedLineDecoration,
      this.modifiedLineDecoration,
    ]);

  }

  /**
   * Simple diff calculation (line-by-line)
   * For production, consider using a library like 'diff' or 'fast-diff'
   */
  private calculateDiff(leftText: string, rightText: string): {
    leftChanges: Array<{ lineNumber: number; lineText: string; type: 'deleted' | 'modified' }>;
    rightChanges: Array<{ lineNumber: number; lineText: string; type: 'added' | 'modified' }>;
  } {
    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');

    const leftChanges: Array<{ lineNumber: number; lineText: string; type: 'deleted' | 'modified' }> = [];
    const rightChanges: Array<{ lineNumber: number; lineText: string; type: 'added' | 'modified' }> = [];

    // Simple LCS-based diff
    const maxLen = Math.max(leftLines.length, rightLines.length);
    
    for (let i = 0; i < maxLen; i++) {
      const leftLine = leftLines[i] || '';
      const rightLine = rightLines[i] || '';

      if (leftLine !== rightLine) {
        if (i < leftLines.length && leftLine.trim() !== '') {
          if (i >= rightLines.length) {
            leftChanges.push({ lineNumber: i, lineText: leftLine, type: 'deleted' });

          } else {
            leftChanges.push({ lineNumber: i, lineText: leftLine, type: 'modified' });

          }
        }

        if (i < rightLines.length && rightLine.trim() !== '') {
          if (i >= leftLines.length) {
            rightChanges.push({ lineNumber: i, lineText: rightLine, type: 'added' });

          } else {
            rightChanges.push({ lineNumber: i, lineText: rightLine, type: 'modified' });

          }
        }
      }
    }

    return { leftChanges, rightChanges };
  }

  /**
   * Enable synchronized scrolling between two editors
   */
  private enableScrollSync(
    leftEditor: vscode.TextEditor,
    rightEditor: vscode.TextEditor
  ): void {
    const leftKey = leftEditor.document.uri.toString();
    const rightKey = rightEditor.document.uri.toString();

    this.scrollSyncMap.set(leftKey, rightEditor);
    this.scrollSyncMap.set(rightKey, leftEditor);




  }

  /**
   * Handle visible range changes for scroll synchronization
   */
  private handleVisibleRangeChange(
    event: vscode.TextEditorVisibleRangesChangeEvent
  ): void {
    const sourceEditor = event.textEditor;
    const sourceKey = sourceEditor.document.uri.toString();
    const targetEditor = this.scrollSyncMap.get(sourceKey);

    if (!targetEditor || targetEditor === sourceEditor) {
      return;
    }

    // Check if target editor is still valid
    const isTargetVisible = vscode.window.visibleTextEditors.includes(targetEditor);
    if (!isTargetVisible) {
      this.scrollSyncMap.delete(sourceKey);
      return;
    }

    // Prevent infinite loop by temporarily removing reverse sync
    const targetKey = targetEditor.document.uri.toString();
    const reverseSync = this.scrollSyncMap.get(targetKey);
    this.scrollSyncMap.delete(targetKey);

    try {
      // Calculate scroll percentage
      const sourceRange = event.visibleRanges[0];
      if (!sourceRange) {
        return;
      }

      const sourceLineCount = sourceEditor.document.lineCount;
      const scrollPercent = sourceRange.start.line / Math.max(sourceLineCount, 1);

      // Apply to target editor
      const targetLineCount = targetEditor.document.lineCount;
      const targetLine = Math.floor(scrollPercent * targetLineCount);
      const visibleLines = sourceRange.end.line - sourceRange.start.line;

      const targetRange = new vscode.Range(
        new vscode.Position(targetLine, 0),
        new vscode.Position(Math.min(targetLine + visibleLines, targetLineCount - 1), 0)
      );

      targetEditor.revealRange(targetRange, vscode.TextEditorRevealType.AtTop);

    } finally {
      // Restore reverse sync after a small delay to prevent immediate triggering
      setTimeout(() => {
        if (reverseSync && this.scrollSyncMap.has(sourceKey)) {
          this.scrollSyncMap.set(targetKey, reverseSync);
        }
      }, 50);
    }
  }

  /**
   * Toggle scroll synchronization on/off
   */
  private toggleScrollSync(): void {
    if (this.scrollSyncMap.size > 0) {
      this.scrollSyncMap.clear();
      vscode.window.showInformationMessage('Scroll synchronization disabled');
    } else {
      const editors = vscode.window.visibleTextEditors;
      if (editors.length >= 2) {
        this.enableScrollSync(editors[0], editors[1]);
        vscode.window.showInformationMessage('Scroll synchronization enabled');
      } else {
        vscode.window.showWarningMessage('Need at least 2 visible editors for scroll sync');
      }
    }
  }

  /**
   * Clean up editors that have been closed
   */
  private cleanupClosedEditors(): void {
    const openEditorUris = new Set(
      vscode.window.visibleTextEditors.map((e) => e.document.uri.toString())
    );

    // Remove closed editors from sync map
    const toRemove: string[] = [];
    this.scrollSyncMap.forEach((_, key) => {
      if (!openEditorUris.has(key)) {
        toRemove.push(key);
      }
    });

    toRemove.forEach((key) => {
      this.scrollSyncMap.delete(key);
      this.syncDecorations.delete(key);
    });
  }

  /**
   * Get file name from URI
   */
  private getFileName(uri: vscode.Uri): string {
    const parts = uri.path.split('/');
    return parts[parts.length - 1] || 'untitled';
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.scrollSyncMap.clear();
    this.syncDecorations.clear();
    
    this.addedLineDecoration.dispose();
    this.deletedLineDecoration.dispose();
    this.modifiedLineDecoration.dispose();
    this.addedTextDecoration.dispose();
    this.deletedTextDecoration.dispose();
  }
}
