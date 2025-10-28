import * as vscode from 'vscode';
import { logger } from '../utils/Logger';

/**
 * Detects and provides diff information when markdown editors are opened in VS Code's diff view
 */
export class MarkdownDiffViewSupport {
  private disposables: vscode.Disposable[] = [];
  private diffViewEditors: Map<string, DiffViewInfo> = new Map();
  
  // Performance optimizations
  private detectionDebounceTimer: NodeJS.Timeout | undefined;
  private isDetecting = false; // Prevent overlapping detection runs
  private fileCache: Map<string, vscode.Uri> = new Map(); // Cache filename -> URI mappings
  private cacheBuilt = false;
  
  // Document change tracking
  private documentChangeDebounceTimer: NodeJS.Timeout | undefined;

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
    // Use debouncing to prevent excessive calls
    this.disposables.push(
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        this.scheduleDetection(300); // Debounced
      })
    );

    // Monitor active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.scheduleDetection(200); // Faster response for active editor changes
      })
    );
    
    // Monitor when visible editors change (important for split view)
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.scheduleDetection(300); // Debounced
      })
    );
    
    // Monitor document content changes to update diff when files are edited
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        this.handleDocumentChange(event.document);
      })
    );

    // Initial detection with delay
    setTimeout(() => this.detectDiffViews(), 500);
  }
  
  /**
   * Schedule detection with debouncing to prevent excessive calls
   */
  private scheduleDetection(delay: number): void {
    if (this.detectionDebounceTimer) {
      clearTimeout(this.detectionDebounceTimer);
    }
    this.detectionDebounceTimer = setTimeout(() => this.detectDiffViews(), delay);
  }
  
  /**
   * Manually trigger diff detection (can be called by EditorPanel)
   */
  public triggerDetection(): void {
    this.scheduleDetection(100); // Fast response for manual triggers
  }
  
  /**
   * Handle document content changes to update diff visualization
   * Debounced to avoid excessive recalculations during typing
   */
  private handleDocumentChange(document: vscode.TextDocument): void {
    // Only process markdown files
    if (document.languageId !== 'markdown') {
      return;
    }
    
    // Check if this document is part of an active diff view
    const diffInfo = this.diffViewEditors.get(document.uri.toString());
    if (!diffInfo) {
      return;
    }
    
    // Debounce to avoid recalculating on every keystroke
    if (this.documentChangeDebounceTimer) {
      clearTimeout(this.documentChangeDebounceTimer);
    }
    
    this.documentChangeDebounceTimer = setTimeout(async () => {
      logger.debug('🔄 DIFF-UPDATE: Document changed, recalculating diff for:', document.uri.path);
      
      // Get both diff infos to determine their roles
      const thisInfo = this.diffViewEditors.get(diffInfo.thisUri.toString());
      const otherInfo = this.diffViewEditors.get(diffInfo.otherUri.toString());
      
      if (!thisInfo || !otherInfo) {
        logger.warn('🔄 DIFF-UPDATE: Could not find diff info for both editors');
        return;
      }
      
      // Calculate diff in the correct direction (left -> right)
      // We need to figure out which URI is left and which is right based on roles
      const leftUri = thisInfo.role === 'left' ? thisInfo.thisUri : thisInfo.otherUri;
      const rightUri = thisInfo.role === 'left' ? thisInfo.otherUri : thisInfo.thisUri;
      
      const diffResult = await this.calculateDiff(leftUri, rightUri);
      
      // IMPORTANT: Update BOTH files in the diff view, not just the one that changed
      // This ensures both sides stay synchronized and spacer blocks are correct
      logger.debug('🔄 DIFF-UPDATE: Updating both diff editors');
      await this.updateDiffVisualization(thisInfo.thisUri, diffResult, true);
      await this.updateDiffVisualization(otherInfo.thisUri, diffResult, true);
    }, 800); // 800ms debounce - good balance between responsiveness and performance
  }
  
  /**
   * Update diff visualization in a specific webview
   * @param uri - The URI of the editor to update
   * @param diffResult - The calculated diff result
   * @param reapplyDiagnostics - Whether to also trigger diagnostics re-application
   */
  private async updateDiffVisualization(uri: vscode.Uri, diffResult: DiffResult, reapplyDiagnostics: boolean = false): Promise<void> {
    const EditorPanel = require('../app/EditorPanel').EditorPanel;
    
    if (EditorPanel.editors && EditorPanel.editors.length > 0) {
      const targetEditor = EditorPanel.editors.find((editor: any) => 
        editor._uri && editor._uri.toString() === uri.toString()
      );
      
      if (targetEditor && targetEditor._panel?.visible) {
        const diffInfo = this.diffViewEditors.get(uri.toString());
        if (!diffInfo) {
          return;
        }
        
        // Send updated diff data to webview
        const documentText = await vscode.workspace.openTextDocument(uri).then(doc => doc.getText());
        
        // Get ALL changes (not filtered by side) for webview to handle filtering
        const allChanges = diffResult.changes;
        
        targetEditor._panel.webview.postMessage({
          type: 'diff-view-detected',
          diffInfo: {
            role: diffInfo.role,
            otherUri: diffInfo.otherUri.toString(),
            changes: allChanges,
            stats: diffResult.stats,
            documentText: documentText,
            clearExistingSpacers: true,
            reapplyDiagnostics: reapplyDiagnostics
          }
        });
        
        logger.debug(`🔄 DIFF-UPDATE: Sent updated diff to ${diffInfo.role} editor:`, uri.path);
      }
    }
  }

  /**
   * Scans all tab groups to find markdown editors in diff views
   */
  private async detectDiffViews(): Promise<void> {
    // Prevent overlapping detection runs
    if (this.isDetecting) {
      logger.debug('🔍 DIFF-DEBUG: ⏭️ Detection already in progress, skipping');
      return;
    }
    
    this.isDetecting = true;
    logger.debug('🔍 DIFF-DEBUG: ====== detectDiffViews() START ======');
    
    // Clear existing diff registrations first
    // This ensures that when tabs are rearranged or editors are no longer in diff mode,
    // the diff visualization is removed
    const previousSize = this.diffViewEditors.size;
    this.diffViewEditors.clear();
    logger.debug(`🔍 DIFF-DEBUG: Cleared ${previousSize} previous diff registrations`);

    const allEditors: { uri: vscode.Uri; tabGroup: vscode.TabGroup; tab: vscode.Tab; groupIndex: number }[] = [];
    
    // First, collect all markdown editors with their group info
    const groups = vscode.window.tabGroups.all;
    logger.debug(`🔍 DIFF-DEBUG: Scanning ${groups.length} tab groups`);
    
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const tabGroup = groups[groupIndex];
      logger.debug(`🔍 DIFF-DEBUG: Group ${groupIndex}: ${tabGroup.tabs.length} tabs`);

      for (const tab of tabGroup.tabs) {
        // Log ALL tab types to see what we're dealing with
        const inputType = (tab.input as any)?.constructor?.name || 'unknown';
        const hasArrow = tab.label.includes('↔');
        logger.debug(`🔍 DIFF-DEBUG:   Tab: "${tab.label}" | Type: ${inputType} | HasArrow: ${hasArrow} | Active: ${tab.isActive}`);

        // Check for diff tabs by label pattern (test3.md ↔ test3 copy.md)
        if (hasArrow && tab.label.includes('.md')) {
          logger.debug('🔍 DIFF-DEBUG:   ✓ Found diff tab with ↔ arrow!');

          // Log the actual tab.input properties to see what we're dealing with
          logger.debug('🔍 DIFF-DEBUG:   Tab input details:', {
            isTextDiff: tab.input instanceof vscode.TabInputTextDiff,
            hasOriginal: !!(tab.input as any)?.original,
            hasModified: !!(tab.input as any)?.modified,
            inputKeys: tab.input ? Object.keys(tab.input as any) : []
          });

          // FIRST: Check if this is a native TextDiff tab (it already has both URIs!)
          // Try both instanceof check AND duck-typing (check for original/modified properties)
          const possibleDiffInput = tab.input as any;
          if (tab.input instanceof vscode.TabInputTextDiff || 
              (possibleDiffInput?.original && possibleDiffInput?.modified)) {
            logger.debug('🔍 DIFF-DEBUG:   ✓ Tab is native TextDiff - extracting URIs directly');
            const original = possibleDiffInput.original;
            const modified = possibleDiffInput.modified;
            logger.debug(`🔍 DIFF-DEBUG:     Original: ${original?.toString?.()}`);
            logger.debug(`🔍 DIFF-DEBUG:     Modified: ${modified?.toString?.()}`);

            // Check if both URIs exist and are markdown files
            if (original && modified && 
                original.path?.endsWith('.md') && modified.path?.endsWith('.md')) {
              logger.debug('🔍 DIFF-DEBUG:   ✅ Both are markdown files! Registering diff pair...');
              
              this.registerDiffPair(original, modified);
              
              // Notify all editor panels to recheck their diff state
              this.notifyEditorPanelsToRecheckDiff();
              logger.debug('🔍 DIFF-DEBUG: ====== detectDiffViews() END (Found TextDiff) ======');
              return;
            } else {
              logger.debug('🔍 DIFF-DEBUG:   ⚠️ Diff input found but not both markdown files, skipping');
            }
          }

          // SECOND: If not TextDiff, try to find URIs from individual tabs OR workspace files
          // Parse the file names from the label
          const parts = tab.label.split('↔').map(s => s.trim());
          if (parts.length === 2) {
            logger.debug(`🔍 DIFF-DEBUG:   Parsing: "${parts[0]}" vs "${parts[1]}"`);

            // Try to find these files in our markdown editors
            const file1Name = parts[0];
            const file2Name = parts[1];
            
            // Look through all editors to find matching URIs
            let uri1: vscode.Uri | undefined;
            let uri2: vscode.Uri | undefined;
            
            logger.debug(`🔍 DIFF-DEBUG:   Searching for URIs in ${tabGroup.tabs.length} tabs...`);
            for (const otherTab of tabGroup.tabs) {
              if (otherTab.input instanceof vscode.TabInputCustom) {
                const customInput = otherTab.input as vscode.TabInputCustom;
                const tabInputType = customInput.viewType;
                const tabFileName = customInput.uri.path.split('/').pop();
                logger.debug(`🔍 DIFF-DEBUG:     Checking tab: "${otherTab.label}" | ViewType: ${tabInputType} | FileName: ${tabFileName}`);
                
                if (customInput.viewType === 'markdown-editor') {
                  const fileName = customInput.uri.path.split('/').pop();
                  if (fileName === file1Name) {
                    uri1 = customInput.uri;
                    logger.debug(`🔍 DIFF-DEBUG:     ✓ Found URI1: ${uri1.toString()}`);
                  } else if (fileName === file2Name) {
                    uri2 = customInput.uri;
                    logger.debug(`🔍 DIFF-DEBUG:     ✓ Found URI2: ${uri2.toString()}`);
                  }
                }
              }
            }
            
            // If URIs not found in tabs, search workspace files using cache
            if (!uri1 || !uri2) {
              logger.debug(`🔍 DIFF-DEBUG:   URIs not in tabs, searching workspace files...`);
              
              // Build cache on first use
              if (!this.cacheBuilt) {
                await this.buildFileCache();
              }
              
              // Use cache for fast lookup
              if (!uri1) {
                uri1 = this.fileCache.get(file1Name);
                if (uri1) logger.debug(`🔍 DIFF-DEBUG:     ✓ Found URI1 in cache: ${uri1.toString()}`);
              }
              if (!uri2) {
                uri2 = this.fileCache.get(file2Name);
                if (uri2) logger.debug(`🔍 DIFF-DEBUG:     ✓ Found URI2 in cache: ${uri2.toString()}`);
              }
            }
            
            if (uri1 && uri2) {
              logger.debug('🔍 DIFF-DEBUG:   ✅ Both URIs found! Registering diff pair...');
              logger.debug(`🔍 DIFF-DEBUG:     Left (${file1Name}):  ${uri1.toString()}`);
              logger.debug(`🔍 DIFF-DEBUG:     Right (${file2Name}): ${uri2.toString()}`);

              this.registerDiffPair(uri1, uri2);
              
              // Notify all editor panels to recheck their diff state
              this.notifyEditorPanelsToRecheckDiff();
              this.isDetecting = false; // Release lock
              logger.debug('🔍 DIFF-DEBUG: ====== detectDiffViews() END (Found diff) ======');
              return;
            } else {
              logger.debug(`🔍 DIFF-DEBUG:   ❌ Could not find both URIs: uri1=${!!uri1}, uri2=${!!uri2}`);
            }
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

    // REMOVED: Strategy 1 and Strategy 2
    // These were too aggressive and treated ANY two side-by-side markdown editors as diff mode
    // Diff mode should ONLY be activated when:
    // 1. There's an explicit TabInputTextDiff (native diff viewer)
    // 2. Tab label contains ↔ (diff comparison mode)
    // 3. User manually enables it via the command

    // If we reach here, no explicit diff view was found
    // The diffViewEditors map remains empty (was cleared at the start)
    logger.debug('🔍 DIFF-DEBUG: ❌ No diff views detected');
    logger.debug('🔍 DIFF-DEBUG: ====== detectDiffViews() END (No diff) ======');
    
    // Notify all editor panels to recheck (they will clear diff if not in active diff tab)
    this.notifyEditorPanelsToRecheckDiff();
    
    this.isDetecting = false; // Release lock
  }
  
  /**
   * Build cache of markdown files in workspace for fast lookup
   * This prevents expensive workspace searches on every detection
   */
  private async buildFileCache(): Promise<void> {
    logger.debug('🔍 DIFF-DEBUG: 📦 Building file cache...');
    const startTime = Date.now();
    
    try {
      // Find all markdown files in workspace (excluding node_modules)
      const files = await vscode.workspace.findFiles('**/*.md', '**/node_modules/**', 1000);
      
      // Build filename -> URI map
      this.fileCache.clear();
      for (const uri of files) {
        const fileName = uri.path.split('/').pop();
        if (fileName) {
          this.fileCache.set(fileName, uri);
        }
      }
      
      this.cacheBuilt = true;
      const duration = Date.now() - startTime;
      logger.debug(`🔍 DIFF-DEBUG: ✅ Cache built: ${this.fileCache.size} files in ${duration}ms`);
    } catch (error) {
      logger.error('🔍 DIFF-DEBUG: ❌ Failed to build cache:', error);
      this.cacheBuilt = false; // Allow retry
    }
  }
  
  /**
   * Notify all EditorPanel instances to recheck their diff view status
   * CRITICAL: Only notify visible panels to avoid applying diff to invisible individual tab instances
   */
  private notifyEditorPanelsToRecheckDiff(): void {
    const EditorPanel = require('../app/EditorPanel').EditorPanel;
    if (EditorPanel.editors && EditorPanel.editors.length > 0) {
      logger.debug(`🔍 DIFF-DEBUG: notifyEditorPanelsToRecheckDiff() - ${EditorPanel.editors.length} total editors`);
      
      for (const editor of EditorPanel.editors) {
        // CRITICAL: Only notify VISIBLE panels
        // This prevents invisible individual tab instances from receiving diff notifications
        // when the diff tab is active
        const isVisible = editor._panel?.visible || false;
        const fileName = editor._uri?.path?.split('/').pop() || 'unknown';
        
        logger.debug(`🔍 DIFF-DEBUG:   Editor "${fileName}": visible=${isVisible}`);
        
        if (isVisible && editor._checkDiffViewContext) {
          logger.debug(`🔍 DIFF-DEBUG:     ✅ Triggering diff check for visible editor "${fileName}"`);
          // Trigger diff check for each visible panel
          setTimeout(() => editor._checkDiffViewContext(), 50);
        } else if (!isVisible) {
          logger.debug(`🔍 DIFF-DEBUG:     ⏭️  Skipping invisible editor "${fileName}"`);
        }
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
   * Check if a document is part of a diff view AND currently visible in a diff tab
   * This prevents individual file tabs from showing diff visualization
   */
  public isInActiveDiffView(uri: vscode.Uri): boolean {
    const fileName = uri.path.split('/').pop();
    logger.debug(`🔍 DIFF-DEBUG: isInActiveDiffView("${fileName}")`);
    
    // First check if this URI is registered as part of a diff pair
    if (!this.diffViewEditors.has(uri.toString())) {
      logger.debug(`🔍 DIFF-DEBUG:   ❌ URI not registered in diffViewEditors`);
      return false;
    }
    logger.debug(`🔍 DIFF-DEBUG:   ✓ URI is registered in diffViewEditors`);

    // CRITICAL: Check if the ACTIVE editor panel is showing this URI in a diff context
    // We need to verify that:
    // 1. There's a diff tab containing this file
    // 2. The webview asking is actually being displayed IN that diff tab (not in a separate individual tab)
    
    // Find all webview panels currently visible
    const groups = vscode.window.tabGroups.all;
    logger.debug(`🔍 DIFF-DEBUG:   Checking ${groups.length} groups for active diff tab...`);
    
    // Look for the active tab in each group
    for (const tabGroup of groups) {
      const activeTab = tabGroup.activeTab;
      if (!activeTab) {
        logger.debug(`🔍 DIFF-DEBUG:     Group has no active tab, skipping`);
        continue;
      }
      
      logger.debug(`🔍 DIFF-DEBUG:     Active tab: "${activeTab.label}" | Active: ${activeTab.isActive}`);
      
      // Check if the ACTIVE tab is a diff tab containing this file
      const hasArrow = activeTab.label.includes('↔');
      if (hasArrow && activeTab.label.includes('.md')) {
        logger.debug(`🔍 DIFF-DEBUG:     Active tab IS diff tab: "${activeTab.label}"`);
        const parts = activeTab.label.split('↔').map(s => s.trim());
        if (parts.length === 2 && parts.includes(fileName || '')) {
          logger.debug(`🔍 DIFF-DEBUG:       ✅ File "${fileName}" IS in ACTIVE diff tab!`);
          return true;
        } else {
          logger.debug(`🔍 DIFF-DEBUG:       ❌ File "${fileName}" NOT in this diff tab (has: ${parts.join(', ')})`);
        }
      }
      
      // Check if active tab is a TextDiff tab containing this URI
      if (activeTab.input instanceof vscode.TabInputTextDiff) {
        const diffInput = activeTab.input as vscode.TabInputTextDiff;
        logger.debug(`🔍 DIFF-DEBUG:     Active tab IS TextDiff tab`);
        if (diffInput.original.toString() === uri.toString() || 
            diffInput.modified.toString() === uri.toString()) {
          logger.debug(`🔍 DIFF-DEBUG:       ✅ URI IS in ACTIVE TextDiff tab!`);
          return true;
        }
      }
    }

    // URI is registered for diff but not currently in an ACTIVE diff tab
    logger.debug(`🔍 DIFF-DEBUG:   ❌ File "${fileName}" is registered but NOT in ACTIVE diff tab`);
    return false;
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
    // Clear debounce timers
    if (this.detectionDebounceTimer) {
      clearTimeout(this.detectionDebounceTimer);
      this.detectionDebounceTimer = undefined;
    }
    
    if (this.documentChangeDebounceTimer) {
      clearTimeout(this.documentChangeDebounceTimer);
      this.documentChangeDebounceTimer = undefined;
    }
    
    this.disposables.forEach(d => d.dispose());
    this.diffViewEditors.clear();
    this.fileCache.clear();
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
