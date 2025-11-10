import * as vscode from "vscode";
import * as NodePath from "path";
const KeyVditorOptions = "vditor.options";
import { showError, getWebviewOptions, debug } from "./_utils";
import { logger } from "../utils/Logger";

// Note: Virtual schemes (showModifications, git) are now rejected at the provider level
// in PreviewCustomEditorProvider.resolveCustomTextEditor(), so this code should
// only ever receive normal file schemes (file, vscode-remote, etc.)

/**
 * Manages cat coding webview panels
 */
export class EditorPanel {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: EditorPanel | undefined;

  /**
   * Track the currently editors. Allow many editors to exist at a time.
   */
  public static editors: EditorPanel[] | undefined;
  
  /**
   * Track diff panel pairs: when both sides have same URI, track which panels represent which side
   * Map structure: URI string -> { left: WebviewPanel, right: WebviewPanel }
   */
  private static _diffPanelTracking = new Map<vscode.Tab, { left?: EditorPanel, right?: EditorPanel }>();
  
  /**
   * Event emitter for active document changes in custom editor
   */
  private static _onDidChangeActiveDocument = new vscode.EventEmitter<vscode.TextDocument | undefined>();
  public static readonly onDidChangeActiveDocument = EditorPanel._onDidChangeActiveDocument.event;
  
  public static readonly viewType = "markdown-editor";
  private _disposables: vscode.Disposable[] = [];
  private _isEdit = false;
  private _lastCursorPosition: { line: number; character: number; timestamp: number } | null = null;
  private _lastWebviewEdit = 0;
  private _diffCheckTimeout: NodeJS.Timeout | undefined;
  private _diffApplied = false; // Track if diff has been applied to THIS webview instance
  private _lastDiffCheckVisible = false; // Track last visibility state for diff checking
  public readonly instanceId: string; // Unique identifier for debugging webview instances
  
  // Diff-related properties (set reactively after creation)
  private _isDiffView: boolean = false; // Will be detected reactively
  private _otherDiffUri: vscode.Uri | undefined; // The other file in the diff pair (if in diff view)
  private _diffRole: 'left' | 'right' | undefined; // Which side of the diff: left=original, right=modified

  /**
   * Create a new panel.
   */
  public static async createOrShow(
    context: vscode.ExtensionContext,
    docOrUri: vscode.Uri | vscode.TextDocument,
    tab?: vscode.Tab,
    webviewPanel?: vscode.WebviewPanel,
    savedContent?: string,
    isDiffView: boolean = false,
    diffChanges?: any[],
    readOnly?: boolean,
  ) {
    logger.debug(`🔵 EditorPanel.createOrShow called:`);
    logger.debug(`[createOrShow] has savedContent: ${savedContent !== undefined}`);
    logger.debug(`[createOrShow] isDiffView: ${isDiffView}`);
    logger.debug(`[createOrShow] webview docOrUri: ${typeof docOrUri === 'object' ? (docOrUri instanceof vscode.Uri ? docOrUri : docOrUri.uri) : 'unknown'}`);

    const { extensionUri } = context;
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    
    // For diff views, ALWAYS create a new panel (don't reuse existing)
    // This ensures both sides of the diff get separate editors
    if (!isDiffView) {
      //if (EditorPanel.currentPanel && uri !== EditorPanel.currentPanel?._uri) {
      if (EditorPanel.currentPanel) {
        EditorPanel.currentPanel.dispose();
      }
      // If we already have a panel, show it.
      if (EditorPanel.currentPanel) {
        EditorPanel.currentPanel._panel.reveal(column);
        return;
      }
    }

    let doc: vscode.TextDocument | undefined;
    let uri: vscode.Uri | undefined;

    if (docOrUri instanceof vscode.Uri) {
      uri = docOrUri;
      logger.debug(`  Called with URI: ${uri?.toString() || 'undefined'}`);
      
      // Try to open the document
      // Note: Virtual schemes are rejected at provider level, this should only see normal schemes
      try {
        doc = await vscode.workspace.openTextDocument(uri);
      } catch (err: unknown) {
        // Try to create the file if it doesn't exist (for normal file schemes)
        if (err instanceof Error && uri) {
          logger.warn(`  Failed to open document for URI ${uri.toString()}. Error: ${err.message}`);
          
          try {
            await vscode.workspace.fs.writeFile(vscode.Uri.file(uri.fsPath), new Uint8Array());
            doc = await vscode.workspace.openTextDocument(uri);
          } catch (writeErr) {
            showError(`Could not open or create document for URI: ${uri?.toString()}`);
            return;
          }
        } else {
          showError(`Could not open or create document for URI: ${uri?.toString()}`);
          return;
        }
      }
    } else {
      // We were given a document directly, use it!
      doc = docOrUri;
      uri = doc.uri;
      logger.debug(`  Called with TextDocument: ${uri?.toString() || 'undefined'}`);
    }

    if (!doc || !uri) {
      showError(`Cannot find or open markdown file!`);
      return;
    }
    
    logger.debug(`  Final URI: ${uri?.toString() || 'undefined'}`);
    logger.debug(`  Final Scheme: ${uri?.scheme || 'N/A'}`);
    logger.debug(`  Final Path: ${uri?.path || 'N/A'}`);
    logger.debug(`  Has webviewPanel: ${!!webviewPanel}`);

    // from command mode
    if (doc && doc.languageId !== "markdown") {
      showError(
        `Current file language is not markdown, got ${doc.languageId}`
      );
      return;
    }

    // Create a new web view panel in case we were not able passed one
    let panel = webviewPanel;
    if (!panel) {
      panel = vscode.window.createWebviewPanel(
        EditorPanel.viewType,
        "Markdown Editor",
        column || vscode.ViewColumn.One,
        getWebviewOptions(extensionUri)
      );
    }

    // Create the editor panel with isDiffView flag and diff changes
    logger.debug(`🔵 Creating EditorPanel for URI: ${uri?.toString()}, has savedContent: ${savedContent !== undefined}, isDiffView: ${isDiffView}, diffChanges: ${diffChanges?.length || 0}`);
    const editor = new EditorPanel(context, panel, extensionUri, doc, uri, !!webviewPanel, tab, savedContent, isDiffView, diffChanges, readOnly);
    
    // For diff views, always add to editors array (not currentPanel)
    if (isDiffView) {
      EditorPanel.editors = EditorPanel.editors || [];
      EditorPanel.editors.push(editor);
    } else if (!webviewPanel) {
      EditorPanel.currentPanel = editor;
    } else {
      EditorPanel.editors = EditorPanel.editors || [];
      EditorPanel.editors.push(editor);
    }

    return editor;
  }

  /**
   * Detect if the current editor is being created in a diff view context
   * Returns diff flag, other URI, and role (left=original, right=modified)
   * For same-URI scenarios (git self-diff), uses panel tracking to determine role
   */
  // private static isInDiffContext(uri: vscode.Uri | undefined, panel: vscode.WebviewPanel): { isDiffView: boolean, otherUri?: vscode.Uri, role?: 'left' | 'right' } {
  //   if (!uri) return { isDiffView: false };

  //   const fileName = uri.path.split('/').pop();
  //   const uriString = uri.toString();
  //   logger.debug(`🔍 DIFF-DETECT isInDiffContext: Checking "${fileName}"`);

  //   // Check all tab groups for diff tabs
  //   const groups = vscode.window.tabGroups.all;
  //   logger.debug(`🔍 DIFF-DETECT: Found ${groups.length} tab groups`);
    
  //   for (let i = 0; i < groups.length; i++) {
  //     const tabGroup = groups[i];
  //     logger.debug(`🔍 DIFF-DETECT: Group ${i}: ${tabGroup.tabs.length} tabs, active=${tabGroup.isActive}`);
      
  //     for (const tab of tabGroup.tabs) {
  //       const inputType = (tab.input as any)?.constructor?.name || 'unknown';
  //       logger.debug(`🔍 DIFF-DETECT:   Tab: "${tab.label}" | Type: ${inputType} | Active: ${tab.isActive}`);
        
  //       // Log detailed tab.input information
  //       if (tab.input) {
  //         logger.debug(`🔍 DIFF-DETECT:     Input type: ${typeof tab.input}`);
  //         logger.debug(`🔍 DIFF-DETECT:     Input constructor: ${(tab.input as any).constructor?.name}`);
  //         logger.debug(`🔍 DIFF-DETECT:     Is TextDiff: ${tab.input instanceof vscode.TabInputTextDiff}`);
          
  //         if (tab.input instanceof vscode.TabInputTextDiff) {
  //           logger.debug(`🔍 DIFF-DETECT:     Input URI: TextDiff`);
  //         } else {
  //           logger.debug(`🔍 DIFF-DETECT:     Input URI: ${(tab.input as any).uri?.toString() || 'N/A'}`);
  //         }
          
  //         // Log all properties of tab.input for debugging
  //         try {
  //           const inputProps = Object.keys(tab.input as object);
  //           logger.debug(`🔍 DIFF-DETECT:     Input properties: ${inputProps.join(', ')}`);
  //         } catch (e) {
  //           logger.debug(`🔍 DIFF-DETECT:     Could not enumerate input properties`);
  //         }
  //       } else {
  //         logger.debug(`🔍 DIFF-DETECT:     Input is undefined or null`);
  //       }
  //       // Check if this is a TextDiff tab
  //       if (tab.input instanceof vscode.TabInputTextDiff) {
  //         const diffInput = tab.input as vscode.TabInputTextDiff;
  //         // Check if either side matches our URI.
  //         // For "Compare with Saved", `modifiedUri` will have a special scheme like `showModifications`,
  //         // but `originalUri` will be a normal file URI. We should match against both.
  //         const originalMatches = diffInput.original.toString() === uri.toString();
  //         const modifiedMatches = diffInput.modified.toString() === uri.toString();

  //         if (originalMatches || modifiedMatches) {
  //           // CRITICAL: Handle same-URI scenario (git self-diff)
  //           if (diffInput.original.toString() === diffInput.modified.toString()) {
  //             logger.debug(`🔍 DIFF-DETECT: ⚠️  Same URI detected on both sides (git self-diff): ${uriString}`);
              
  //             // Use panel tracking to determine which side this panel represents
  //             let tracking = EditorPanel._diffPanelTracking.get(uriString);
  //             if (!tracking) {
  //               tracking = {};
  //               EditorPanel._diffPanelTracking.set(uriString, tracking);
  //             }
              
  //             // Assign role based on which side is missing
  //             if (!tracking.left) {
  //               tracking.left = panel;
  //               logger.debug(`🔍 DIFF-DETECT: ✅ Assigned LEFT role to this panel (first creation)`);
  //               return { isDiffView: true, otherUri: diffInput.modified, role: 'left' };
  //             } else if (!tracking.right) {
  //               tracking.right = panel;
  //               logger.debug(`🔍 DIFF-DETECT: ✅ Assigned RIGHT role to this panel (second creation)`);
  //               return { isDiffView: true, otherUri: diffInput.original, role: 'right' };
  //             } else {
  //               // Both already assigned - this shouldn't happen but fallback to panel object identity
  //               const isLeftPanel = tracking.left === panel;
  //               const role = isLeftPanel ? 'left' : 'right';
  //               logger.debug(`🔍 DIFF-DETECT: ⚠️  Both roles already assigned, using panel identity: ${role}`);
  //               return { isDiffView: true, otherUri: isLeftPanel ? diffInput.modified : diffInput.original, role };
  //             }
  //           }
            
  //           // Different URIs - this handles "Compare with Saved" and normal diffs
  //           if (originalMatches) {
  //             logger.debug(`🔍 DIFF-DETECT: Found diff tab for ${uriString} - LEFT side`);
  //             return { isDiffView: true, otherUri: diffInput.modified, role: 'left' };
  //           }
  //           if (modifiedMatches) {
  //             logger.debug(`🔍 DIFF-DETECT: Found diff tab for ${uriString} - RIGHT side`);
  //             return { isDiffView: true, otherUri: diffInput.original, role: 'right' };
  //           }
  //         }
  //       }
        
  //       // Also check for duck-typed diff inputs (fallback)
  //       const possibleDiff = tab.input as any;
  //       if (possibleDiff?.original && possibleDiff?.modified) {
  //         if (possibleDiff.original?.toString() === uri.toString()) {
  //           logger.debug(`🔍 DIFF-DETECT: Found duck-typed diff tab for ${uri.toString()} - LEFT side`);
  //           return { isDiffView: true, otherUri: possibleDiff.modified, role: 'left' };
  //         }
  //         if (possibleDiff.modified?.toString() === uri.toString()) {
  //           logger.debug(`🔍 DIFF-DETECT: Found duck-typed diff tab for ${uri.toString()} - RIGHT side`);
  //           return { isDiffView: true, otherUri: possibleDiff.original, role: 'right' };
  //         }
  //       }
  //     }
  //   }

  //   // STRATEGY 2: Check for side-by-side custom markdown editors
  //   // When user opens two markdown files in split view, they appear as separate TabInputCustom editors
  //   logger.debug(`🔍 DIFF-DETECT: Checking for side-by-side custom editors...`);
    
  //   if (groups.length >= 2) {
  //     // Look for our custom editor in each group
  //     const customEditors: { uri: vscode.Uri; group: number; tab: vscode.Tab }[] = [];
      
  //     for (let i = 0; i < groups.length; i++) {
  //       for (const tab of groups[i].tabs) {
  //         if (tab.input instanceof vscode.TabInputCustom) {
  //           const customInput = tab.input as vscode.TabInputCustom;
  //           if (customInput.viewType === 'markdown-editor' && customInput.uri.path.endsWith('.md')) {
  //             customEditors.push({ uri: customInput.uri, group: i, tab });
  //             logger.debug(`🔍 DIFF-DETECT:   Found custom markdown editor: ${customInput.uri.path} in group ${i}`);
  //           }
  //         }
  //       }
  //     }
      
  //     // If we have exactly 2 markdown editors in different groups, treat as diff view
  //     if (customEditors.length === 2 && customEditors[0].group !== customEditors[1].group) {
  //       const [editor1, editor2] = customEditors;
        
  //       // Check if THIS uri is one of them
  //       if (editor1.uri.toString() === uri.toString() || editor2.uri.toString() === uri.toString()) {
  //         logger.debug(`🔍 DIFF-DETECT: ✅ Found side-by-side custom editors!`);
  //         logger.debug(`🔍 DIFF-DETECT:   Left: ${editor1.uri.path}`);
  //         logger.debug(`🔍 DIFF-DETECT:   Right: ${editor2.uri.path}`);
          
  //         // Determine which is the other URI and role
  //         const otherUri = editor1.uri.toString() === uri.toString() ? editor2.uri : editor1.uri;
  //         const role = editor1.uri.toString() === uri.toString() ? 'left' : 'right';
  //         return { isDiffView: true, otherUri, role };
  //       }
  //     }
  //   }

  //   logger.debug(`🔍 DIFF-DETECT: ❌ No diff context found for "${fileName}"`);
  //   return { isDiffView: false };
  // }

  /**
   * Handle a request from the webview to preview an embed originating from a wiki-link
   * The webview sends { command: 'requestEmbed', filename, currentDocument }
   */
  private async handleRequestEmbed(message: any): Promise<void> {
    const { filename, currentDocument } = message;
    if (!filename) return;

    try {
      // Resolve the filename to an absolute path using LinkResolver
      const LinkResolver = (await import('../services/LinkResolver')).LinkResolver;
      const resolver = LinkResolver.getInstance();
      const currentUri = this._uri;
      if (!currentUri) return;

      const target = await resolver.resolveWikiLink(filename, currentUri);
      if (target) {
        // Read the file and prepare embed data
        const fileUri = vscode.Uri.file(target.fsPath);
        const fileName = NodePath.basename(target.fsPath);
        const ext = NodePath.extname(target.fsPath).toLowerCase();
        
        // Determine mime type
        const mimeTypes: { [key: string]: string } = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml',
          '.md': 'text/markdown',
          '.txt': 'text/plain',
          '.json': 'application/json'
        };
        const mimeType = mimeTypes[ext] || 'application/octet-stream';
        
        let embedData: any = {
          fileName: fileName,
          path: target.fsPath,
          mimeType: mimeType
        };
        
        try {
          const fileContent = await vscode.workspace.fs.readFile(fileUri);
          const fileSizeKB = fileContent.byteLength / 1024;
          
          // For small text files, include the text content
          if (mimeType.startsWith('text/') && fileSizeKB < 500) {
            embedData.text = Buffer.from(fileContent).toString('utf-8');
          }
          // For images, include data URL if not too large
          else if (mimeType.startsWith('image/') && fileSizeKB < 1000) {
            const base64 = Buffer.from(fileContent).toString('base64');
            embedData.dataUrl = `data:${mimeType};base64,${base64}`;
          }
          // For larger files, just provide path and note
          else {
            embedData.note = `File is ${fileSizeKB.toFixed(1)}KB - use Open button to view`;
          }
        } catch (readError) {
          logger.error('EditorPanel: Error reading embed file:', readError);
          embedData.note = 'Could not read file content';
        }
        
        // Send embed preview to webview
        this._panel.webview.postMessage({
          command: 'openEmbedPreview',
          embed: embedData
        });
      }
    } catch (err) {
      logger.error('EditorPanel: handleRequestEmbed error', err);
    }
  }

  /**
   * Get this file path
   */
  private get _fsPath() {
    return this._uri.fsPath;
  }

  /**
   * Get this extension configuration
   */
  private get _config() {
    return vscode.workspace.getConfiguration("markdown-editor");
  }

  private constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly _panel: vscode.WebviewPanel,
    private readonly _extensionUri: vscode.Uri,
    public _document: vscode.TextDocument, // 当前有 markdown 编辑器
    public _uri = _document.uri, // 从资源管理器打开，只有 uri 没有 _document
    public _isEditor: boolean = false, // Mark if this is a markdown editor panel
    private readonly _tab?: vscode.Tab, // Associated VS Code tab
    private readonly _savedContent?: string, // Saved content from disk for diff computation
    private readonly _isExplicitDiffView: boolean = false, // Explicitly marked as diff view by provider
    private readonly _diffChanges?: any[], // LCS-based diff changes from MarkdownDiffViewSupport
    private readonly _readOnly?: boolean, // Whether the editor is read-only
  ) {
    // Generate unique instance ID for debugging
    this.instanceId = `${NodePath.basename(this._fsPath)}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.debug(`🆔 Created EditorPanel instance: ${this.instanceId}`);
    
    let textEditTimer: NodeJS.Timeout | void;

    // Set the webview's initial html content
    this._init();

    if (this._isExplicitDiffView && this._tab?.label) {
      this._isDiffView = true;
      const tracking = EditorPanel._diffPanelTracking.get(this._tab);
      if (!tracking) {
        EditorPanel._diffPanelTracking.set(this._tab, {
          right: this
        });
      } else {
        EditorPanel._diffPanelTracking.set(this._tab, {
          ...tracking,
          left: this
        });
      }
    }

    // DEFERRED DIFF DETECTION: Check for diff context after a short delay
    // This allows tabGroups to be populated with the new tab
    setTimeout(() => {
      if (!this._panel || this._panel.visible === false) {
        logger.debug(`[${this.instanceId}] ⏰ Deferred diff check skipped - panel not visible`);
        return;
      }
      logger.debug(`[${this.instanceId}] ⏰ Running deferred diff context check...`);
      this._checkDiffViewContextReactive();
    }, 200); // 200ms delay to allow tab creation

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    // Listen for panel view state changes (when panel becomes active/inactive)
    this._panel.onDidChangeViewState(
      e => {
        logger.debug(`[${this.instanceId}] 👁️  View state changed:`, {
          active: e.webviewPanel.active,
          visible: e.webviewPanel.visible,
          diffApplied: this._diffApplied,
          lastCheckVisible: this._lastDiffCheckVisible
        });
        
        if (e.webviewPanel.active) {
          // Fire event when this custom editor becomes active
          logger.debug(`[${this.instanceId}] Panel is now ACTIVE, firing document change event`);
          EditorPanel._onDidChangeActiveDocument.fire(this._document);
          
          // CRITICAL: When panel becomes active, ALWAYS re-check diff context
          // This handles switching from individual tab → diff tab
          logger.debug(`[${this.instanceId}] 🔍 DIFF-DEBUG: Panel became active, re-checking diff context...`);
          this._lastDiffCheckVisible = false; // Reset to allow re-check
          this._checkDiffViewContextReactive();
          this._lastDiffCheckVisible = true;
        } else if (e.webviewPanel.visible && !this._lastDiffCheckVisible) {
          // Panel visible but not active - only check if we haven't already
          logger.debug(`[${this.instanceId}] 🔍 DIFF-DEBUG: Panel visible (not active), checking diff context...`);
          this._checkDiffViewContextReactive();
          this._lastDiffCheckVisible = true;
        } else if (!e.webviewPanel.visible) {
          // Panel no longer visible - reset BOTH flags so we check again when it becomes visible
          logger.debug(`[${this.instanceId}] Panel became INVISIBLE, resetting diff state`);
          this._lastDiffCheckVisible = false;
          this._diffApplied = false; // CRITICAL: Reset so diff can be re-evaluated when visible again
        }
      },
      null,
      this._disposables
    );
    
    // Fire initial event if this panel is currently active
    if (this._panel.active) {
      logger.debug('Sidebar: EditorPanel created and is active, firing initial document change event');
      EditorPanel._onDidChangeActiveDocument.fire(this._document);
    }

    // Listen for diagnostic changes and send to webview
    vscode.languages.onDidChangeDiagnostics((e) => {
      if (e.uris.some(uri => uri.toString() === this._document.uri.toString())) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`Diagnostics changed for document, updating webview`);
        }
        this._updateDiagnostics();
      }
    }, this._disposables);

    // update EditorPanel when vsc editor changes
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.fileName !== this._document.fileName) {
        return;
      }
      
      // Enhanced external change detection
      const isExternalChange = this.detectExternalChange(e);
      
      if ((global as any).markdownEditorLog) {
        const changeInfo = {
          changes: e.contentChanges.length,
          reason: e.reason,
          panelActive: this._panel.active,
          isExternal: isExternalChange,
          changeTypes: e.contentChanges.map(c => ({
            rangeLength: c.rangeLength,
            textLength: c.text.length,
            range: `${c.range.start.line}:${c.range.start.character}-${c.range.end.line}:${c.range.end.character}`
          }))
        };
        (global as any).markdownEditorLog(`Document change detected: ${JSON.stringify(changeInfo)}`);
      }
      
      // Handle external changes (like quick fixes, spell corrections) immediately
      if (isExternalChange) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`🔄 EXTERNAL CHANGE DETECTED - Updating webview immediately`);
          (global as any).markdownEditorLog(`   • Source: VS Code panels (quick fix, spell checker, etc.)`);
          (global as any).markdownEditorLog(`   • Changes: ${e.contentChanges.length} modifications`);
          (global as any).markdownEditorLog(`   • Force updating webview content now`);
        }
        if (textEditTimer) {
          clearTimeout(textEditTimer);
        }
        
        // Force update the webview immediately for external changes
        this._update({ type: "update" });
        this._updateDiagnostics();
        
        // If this is a diff view instance, also recalculate diff
        if (this._isDiffView && this._otherDiffUri) {
          this._updateDiffVisualization();
        }
        return;
      }
      
      // 当 webview panel 激活时不将由 webview编辑导致的 vsc 编辑器更新同步回 webview
      // don't change webview panel when webview panel is focus
      if (this._panel.active) {
        return;
      }
      textEditTimer && clearTimeout(textEditTimer);
      textEditTimer = setTimeout(() => {
        this._update();
        this._updateEditTitle();
        
        // If this is a diff view instance, also recalculate diff
        if (this._isDiffView && this._otherDiffUri) {
          this._updateDiffVisualization();
        }
      }, 300);
    }, this._disposables);

    // Listen for configuration changes that might affect external change behavior
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('markdown-editor')) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog('Configuration changed, updating webview');
        }
        this._update();
      }
    }, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        debug("msg from webview review", message, this._panel.active);

        const syncToEditor = async () => {
          debug("sync to editor", this._document, this._uri);
          if (this._document) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
              this._document.uri,
              new vscode.Range(0, 0, this._document.lineCount, 0),
              message.content
            );
            await vscode.workspace.applyEdit(edit);
          } else if (this._uri) {
            await vscode.workspace.fs.writeFile(this._uri, message.content);
          } else {
            showError(`Cannot find original file to save!`);
          }
        };
        switch (message.command) {
          case "ready":
            // REACTIVE DIFF CHECK: When webview is ready, check if we're in a diff view
            // This is a good time because the tab should be created by now
            logger.debug(`[${this.instanceId}] 📥 Webview ready - checking diff context...`);
            this._checkDiffViewContextReactive();
            
            // Generate CDN base URI for Vditor to locate assets
            // Points to media/dist directory where all Vditor assets are bundled
            const mediaUri = this._panel.webview.asWebviewUri(
              vscode.Uri.joinPath(this._extensionUri, 'media')
            );
            const cdnBaseUri = mediaUri.toString();
            
            this._update({
              type: "init",
              documentPath: this._uri?.fsPath || 'untitled',
              cdnBaseUri: cdnBaseUri,
              options: {
                useVscodeThemeColor: this._config.get<boolean>(
                  "useVscodeThemeColor"
                ),
                ...this._context.globalState.get(KeyVditorOptions),
              },
              theme:
                vscode.window.activeColorTheme.kind ===
                vscode.ColorThemeKind.Dark
                  ? "dark"
                  : "light",
              isReadOnly: false, // Both sides of diff should be editable
            });
            break;
          case "vditorReady":
            // Vditor has initialized/reloaded - notify sidebar via document change event
            if (this._document) {
              logger.debug('[EditorPanel] Vditor ready - emitting document change for sidebar update');
              EditorPanel._onDidChangeActiveDocument.fire(this._document);
            }
            break;
          case "save-options":
            this._context.globalState.update(KeyVditorOptions, message.options);
            break;
          case "info":
            vscode.window.showInformationMessage(message.content);
            break;
          case "error":
            showError(message.content);
            break;
          case "edit": {
            // Track that this change originates from webview
            this._lastWebviewEdit = Date.now();
            
            // 只有当 webview 处于编辑状态时才同步到 vsc 编辑器，避免重复刷新
            if (this._panel.active) {
              await syncToEditor();
              this._updateEditTitle();
            }
            break;
          }
          case "diff-scroll-sync": {
            // Handle scroll synchronization in diff view
            
            if (this._uri && this._otherDiffUri) {
              const diffSupport = (global as any).markdownDiffViewSupport;

              if (diffSupport) {
                // Pass instance ID to help identify source editor when URIs are identical
                diffSupport.handleScrollSync(this.instanceId, this._uri, this._otherDiffUri, message.scrollPercentage);
              } else {
                logger.warn('⚠️ EDITOR PANEL: markdownDiffViewSupport not found on global');
              }
            } else {
              logger.warn('⚠️ EDITOR PANEL: No _uri or _otherDiffUri for scroll sync');
            }
            break;
          }
          case "reset-config": {
            await this._context.globalState.update(KeyVditorOptions, {});
            break;
          }
          case "save": {
            await syncToEditor();
            await this._document.save();
            this._updateEditTitle();
            break;
          }
          case 'requestEmbed': {
            // User clicked preview button in webview - resolve the filename to a full path and open embed
            try {
              await this.handleRequestEmbed(message);
            } catch (err) {
              logger.error('EditorPanel: requestEmbed failed', err);
            }
            break;
          }
          case "upload": {
            const imageSaveFolder = (
              this._config.get<string>("imageSaveFolder") || "assets"
            )
              .replace(
                "${projectRoot}",
                vscode.workspace.getWorkspaceFolder(this._uri)?.uri.fsPath || ""
              )
              .replace("${file}", this._fsPath)
              .replace(
                "${fileBasenameNoExtension}",
                NodePath.basename(this._fsPath, NodePath.extname(this._fsPath))
              )
              .replace("${dir}", NodePath.dirname(this._fsPath));
            const assetsFolder = NodePath.resolve(
              NodePath.dirname(this._fsPath),
              imageSaveFolder
            );
            try {
              await vscode.workspace.fs.createDirectory(
                vscode.Uri.file(assetsFolder)
              );
            } catch (error) {
              logger.error('Failed to create image folder:', error);
              showError(`Invalid image folder: ${assetsFolder}`);
            }
            await Promise.all(
              message.files.map(async (f: any) => {
                const content = Buffer.from(f.base64, "base64");
                return vscode.workspace.fs.writeFile(
                  vscode.Uri.file(NodePath.join(assetsFolder, f.name)),
                  content
                );
              })
            );
            const files = message.files.map((f: any) =>
              NodePath.relative(
                NodePath.dirname(this._fsPath),
                NodePath.join(assetsFolder, f.name)
              ).replace(/\\/g, "/")
            );
            this._panel.webview.postMessage({
              command: "uploaded",
              files,
            });
            break;
          }
          case "open-link": {
            let url = message.href;
            if (!/^http/.test(url)) {
              url = NodePath.resolve(this._fsPath, "..", url);
            }

            // if the href is a relative path to a md file, vscode will open it in the editor
            if (url.endsWith(".md") || url.endsWith(".markdown")) {
              vscode.commands.executeCommand(
                "markdown-editor.openEditor",
                vscode.Uri.parse(url)
              );
              break;
            }

            vscode.commands.executeCommand(
              "vscode.open",
              vscode.Uri.parse(url)
            );
            break;
          }
          case "log": {
            // Handle log messages from webview and show in VS Code output
            const webviewMessage = `[Webview] ${message.message}`;
            if ((global as any).markdownEditorLog) {
              (global as any).markdownEditorLog(webviewMessage);
            }
            break;
          }
          case "requestContextMenu": {
            // Handle context menu requests from webview
            await this.handleContextMenuRequest(message);
            break;
          }
          case "requestQuickFix": {
            // Handle quick fix requests from webview
            await this.handleQuickFixRequest(message);
            break;
          }
          case "clipboardWrite": {
            // Handle clipboard write requests from webview
            await this.handleClipboardWrite(message);
            break;
          }
          case "clipboardRead": {
            // Handle clipboard read requests from webview
            await this.handleClipboardRead(message);
            break;
          }
          case "cursorPosition": {
            // Handle cursor position updates from webview
            await this.handleCursorPositionUpdate(message);
            break;
          }
          case "triggerQuickFix": {
            // Handle quick fix trigger requests from webview
            await this.handleTriggerQuickFix(message);
            break;
          }
          case "selectAll": {
            // Handle select all command
            await this.handleSelectAll();
            break;
          }
          case "formatDocument": {
            // Handle format document command
            await this.handleFormatDocument();
            break;
          }
          case "formatSelection": {
            // Handle format selection command
            await this.handleFormatSelection();
            break;
          }
          case "showProblems": {
            // Handle show problems command
            await this.handleShowProblems();
            break;
          }
          case "openProblemsPanel": {
            // Handle open problems panel command (from lightbulb clicks)
            await this.handleOpenProblemsPanel();
            break;
          }
          case "find": {
            // Handle find command
            await this.handleFind();
            break;
          }
          case "findAndReplace": {
            // Handle find and replace command
            await this.handleFindAndReplace();
            break;
          }
          case "insertLink": {
            // Handle insert link command
            await this.handleInsertLink();
            break;
          }
          case "insertImage": {
            // Handle insert image command
            await this.handleInsertImage();
            break;
          }
          case "insertTable": {
            // Handle insert table command
            await this.handleInsertTable();
            break;
          }
          case "showCommandPalette": {
            // Handle show command palette command
            await this.handleShowCommandPalette();
            break;
          }
          case "toggleWordWrap": {
            // Handle toggle word wrap command
            await this.handleToggleWordWrap();
            break;
          }
          case "kanban-save-data": {
            // Handle kanban data save
            await this.handleKanbanSaveData(message);
            break;
          }
          case "kanban-load-data": {
            // Handle kanban data load
            await this.handleKanbanLoadData(message);
            break;
          }
          case "kanban-migrate-data": {
            // Handle kanban data migration
            await this.handleKanbanMigrateData(message);
            break;
          }
          case "renderer-load-data": {
            // Generic renderer data load
            await this.handleRendererLoadData(message);
            break;
          }
          case "renderer-save-data": {
            // Generic renderer data save
            await this.handleRendererSaveData(message);
            break;
          }
          case "renderer-check-data": {
            // Generic renderer data check
            await this.handleRendererCheckData(message);
            break;
          }
          case "requestInsertRenderer": {
            // Handle insert custom renderer request from webview
            await this.handleInsertRenderer(message);
            break;
          }
          case "requestWorkspaceFiles": {
            // Handle wiki-link autocomplete workspace files request
            await this.handleRequestWorkspaceFiles(message);
            break;
          }
          case "requestRelatedFiles": {
            // Handle wiki-link autocomplete related files request
            await this.handleRequestRelatedFiles(message);
            break;
          }
          case "resolveWikiLink": {
            // Handle wiki-link path resolution request
            await this.handleResolveWikiLink(message);
            break;
          }
          case "navigateToWikiLink": {
            // Handle wiki-link navigation request
            await this.handleNavigateToWikiLink(message);
            break;
          }
          case "openFile": {
            // Handle file open request from webview (wiki-links, embeds, etc.)
            await this.handleOpenFile(message);
            break;
          }
        }
      },
      null,
      this._disposables
    );
  }

  /**
   * Send scroll sync message to this editor's webview
   */
  public sendScrollSync(scrollPercentage: number): void {
    if (this._panel) {
      this._panel.webview.postMessage({
        type: 'diff-scroll-sync',
        scrollPercentage: scrollPercentage
      });
    }
  }

  /**
   * Navigate to a heading in the document
   */
  public navigateToHeading(heading: string): void {
    if (this._panel && this._panel.webview) {
      this._panel.webview.postMessage({
        command: 'navigateToHeading',
        heading: heading
      });
      logger.debug(`EditorPanel: Sent navigateToHeading message for: ${heading}`);
    }
  }

  public dispose() {
    logger.debug('Sidebar: EditorPanel being disposed');
    
    // Clear any pending diff check timeouts to prevent "Webview is disposed" errors
    if (this._diffCheckTimeout) {
      clearTimeout(this._diffCheckTimeout);
      this._diffCheckTimeout = undefined;
    }
    
    if (!this._isEditor) {
      EditorPanel.currentPanel = undefined;
    }

    // If we already have editors, show it.
    if (this._isEditor && EditorPanel.editors?.length) {
      // Remove this editor from the list of editors
      EditorPanel.editors = EditorPanel.editors.filter(
        (editor) => this.instanceId !==  editor.instanceId
      );
    }

    // lets remove the tracking for this tab
    if (this._tab) {
      EditorPanel._diffPanelTracking.delete(this._tab);
    }

    // Fire event that active document is now undefined
    EditorPanel._onDidChangeActiveDocument.fire(undefined);

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _init() {
    const webview = this._panel.webview;

    this._panel.webview.html = this._getHtmlForWebview(webview);
    this._panel.title = NodePath.basename(this._fsPath);
    
    // Send initial diagnostics to webview after a short delay to ensure webview is ready
    setTimeout(() => {
      this._updateDiagnostics();
    }, 500);
  }

  /**
   * Reactively check if this editor is part of a diff view and send diff information to webview
   * Called multiple times: on setTimeout delay, on webview ready, and on viewState changes
   * This reactive approach works around the fact that tabGroups is not populated at creation time
   */
  private async _checkDiffViewContextReactive(): Promise<void> {
    const fileName = NodePath.basename(this._fsPath);
    logger.debug(`[${this.instanceId}] 🔍 DIFF-DEBUG: _checkDiffViewContextReactive() for "${fileName}"`);
    logger.debug(`[${this.instanceId}]   State: diffApplied=${this._diffApplied}, visible=${this._panel.visible}, active=${this._panel.active}`);
    
    // OPTIMIZATION: If diff already applied to THIS webview instance, don't re-apply
    if (this._diffApplied && this._panel.visible) {
      logger.debug(`[${this.instanceId}]   ⏭️  Diff already applied to this instance AND panel still visible, skipping`);
      return;
    }

    if (!this._tab) {
      logger.debug(`[${this.instanceId}]   ⏭️  Not a diff view missing tab info, skipping`);
      return;
    }

    // REACTIVE DETECTION: Check tabGroups NOW (should be populated by this point)
    const isInDiffContext = this._isDiffView;
    const diffPanels = EditorPanel._diffPanelTracking.get(this._tab);
    const diffContext = {
      role: diffPanels?.left?.instanceId === this.instanceId ? 'left' : 'right',
      otherUri: diffPanels?.left?.instanceId === this.instanceId ? diffPanels?.right?._uri : diffPanels?.left?._uri
    }

    if (isInDiffContext && diffContext?.otherUri) {
      logger.debug(`[${this.instanceId}]   ✅ Detected diff view! Updating instance state...`);
      
      // Update instance state dynamically since we started with false
      (this as any)._isDiffView = true;
      (this as any)._otherDiffUri = diffContext.otherUri;
      (this as any)._diffRole = diffContext.role;

      const diffSupport = (global as any).markdownDiffViewSupport;
      if (!diffSupport) {
        logger.debug(`[${this.instanceId}]   ❌ No diffSupport available for diff calculation`);
        return;
      }

      // Calculate diff using detected URIs
      const leftUri = this._uri;
      const rightUri = diffContext.otherUri;
      
      const diffResult = await diffSupport.calculateDiff(leftUri, rightUri);
      logger.debug(`[${this.instanceId}]   Diff calculated: ${diffResult.changes.length} changes`);
      
      // Send ALL changes to webview - it needs both sides for spacer blocks
      // The webview will filter what to highlight vs what to add spacers for
      const allChanges = diffResult.changes;
      
      // Also send the full document text so the webview can build proper line mapping
      const thisDoc = await vscode.workspace.openTextDocument(this._uri);
      const documentText = thisDoc.getText();
      
      logger.debug(`[${this.instanceId}]   Sending diff-view-detected to webview for "${fileName}"`);
      
      // Send diff information to webview with ALL changes
      this._panel.webview.postMessage({
        type: 'diff-view-detected',
        diffInfo: {
          role: diffContext.role || 'left', // Use detected role, fallback to left
          otherUri: diffContext.otherUri.toString(),
          instanceId: this.instanceId, // Include instance ID for unique identification
          changes: allChanges, // Send all changes, not filtered
          stats: diffResult.stats,
          documentText: documentText // Send full text for accurate line mapping
        }
      });

      // Mark as applied to THIS instance - won't re-apply on subsequent visibility changes
      this._diffApplied = true;
      logger.debug(`[${this.instanceId}]   ✅ Diff applied and marked for "${fileName}"`);

    } else {
      logger.debug(`[${this.instanceId}]   ℹ️  Not in diff view (_isDiffView=${this._isDiffView}, _otherDiffUri=${this._otherDiffUri?.toString() || 'undefined'})`);
      // If we're NOT in a diff view but diff was previously applied, we need to clear it
      if (this._diffApplied) {
        logger.debug(`[${this.instanceId}]   🧹 Diff was applied but no longer in diff view, sending clear message`);
        this._panel.webview.postMessage({
          type: 'diff-view-cleared'
        });
        this._diffApplied = false;
      }
    }
  }

  /**
   * Update diff visualization for this instance when document changes
   * This is called when the document content changes and this editor is in diff view
   */
  private async _updateDiffVisualization(): Promise<void> {
    if (!this._isDiffView || !this._otherDiffUri) {
      logger.debug(`[${this.instanceId}] ⚠️  _updateDiffVisualization called but not in diff view`);
      return;
    }

    const diffSupport = (global as any).markdownDiffViewSupport;
    if (!diffSupport) {
      logger.debug(`[${this.instanceId}] ❌ No diffSupport available for diff update`);
      return;
    }

    logger.debug(`[${this.instanceId}] 🔄 Updating diff visualization after document change`);

    // Calculate diff using this instance's URIs
    const leftUri = this._uri;
    const rightUri = this._otherDiffUri;
    
    const diffResult = await diffSupport.calculateDiff(leftUri, rightUri);
    
    // Get the updated document text
    const thisDoc = await vscode.workspace.openTextDocument(this._uri);
    const documentText = thisDoc.getText();
    
    // Send updated diff information to webview
    this._panel.webview.postMessage({
      type: 'diff-view-detected',
      diffInfo: {
        role: this._diffRole || 'left', // Use detected role, fallback to left
        otherUri: this._otherDiffUri.toString(),
        instanceId: this.instanceId, // Include instance ID for unique identification
        changes: diffResult.changes,
        stats: diffResult.stats,
        documentText: documentText
      }
    });

    logger.debug(`[${this.instanceId}] ✅ Diff visualization updated with ${diffResult.changes.length} changes`);
  }

  private _updateEditTitle() {
    const isEdit = this._document.isDirty;
    if (isEdit !== this._isEdit) {
      this._isEdit = isEdit;
      this._panel.title = `${isEdit ? `[edit]` : ""}${NodePath.basename(
        this._fsPath
      )}`;
    }
  }

  // private fileToWebviewUri = (f: string) => {
  //   return this._panel.webview.asWebviewUri(vscode.Uri.file(f)).toString()
  // }

  private async _update(
    props: {
      type?: "init" | "update";
      options?: any;
      theme?: "dark" | "light";
      documentPath?: string;
      cdnBaseUri?: string;
      isReadOnly?: boolean;
    } = { options: void 0 }
  ) {
    let md: string;
    let diffData: { originalContent: string; modifiedContent: string; changes?: any[] } | undefined;
    
    logger.debug(`[_update] Updating webview content for: ${this._fsPath}`);
    logger.debug(`[_update] has savedContent: ${this._savedContent !== undefined}, scheme: ${this._uri.scheme}`);
    
    // Get current document content
    md = this._document
      ? this._document.getText()
      : (await vscode.workspace.fs.readFile(this._uri)).toString();
    
    // If we have saved content, prepare diff data
    if (this._savedContent !== undefined) {
      diffData = {
        originalContent: this._savedContent, // Saved version from disk
        modifiedContent: md, // Current document content with changes
        changes: this._diffChanges // LCS-based structured changes
      };
      logger.debug(`[_update] Computed diff: saved=${this._savedContent.length} chars, current=${md.length} chars, changes=${this._diffChanges?.length || 0}`);
    }
    
    // Get the actual document filename for renderer file naming
    const documentFilename = this._document 
      ? NodePath.basename(this._document.fileName, NodePath.extname(this._document.fileName))
      : NodePath.basename(this._fsPath, NodePath.extname(this._fsPath));
    
    // Get the full document path for wiki-link autocomplete
    const documentPath = this._uri?.fsPath || 'untitled';
    
    // const dir = NodePath.dirname(this._document.fileName)
    this._panel.webview.postMessage({
      command: "update",
      content: md,
      documentFilename: documentFilename, // Add document filename for renderer system
      documentPath: documentPath, // Add document path for wiki-link autocomplete
      diffData: diffData, // Send diff data if available (for Compare with Saved)
      isDiffView: this._isExplicitDiffView || (this._savedContent !== undefined), // Flag to indicate diff mode
      ...props,
    });
  }

  /**
   * Update diagnostics in the webview
   */
  private _updateDiagnostics(): void {
    const diagnostics = vscode.languages.getDiagnostics(this._document.uri);
    
    // Get the document text to provide context for line mapping
    const documentText = this._document.getText();
    const lines = documentText.split('\n');
    
    // Convert VS Code diagnostics to a format the webview can understand
    const serializedDiagnostics = diagnostics.map((diagnostic, index) => {
      const lineText = lines[diagnostic.range.start.line] || '';
      
      return {
        message: diagnostic.message,
        severity: diagnostic.severity,
        range: {
          start: {
            line: diagnostic.range.start.line,
            character: diagnostic.range.start.character
          },
          end: {
            line: diagnostic.range.end.line,
            character: diagnostic.range.end.character
          }
        },
        source: diagnostic.source,
        code: diagnostic.code,
        lineText: lineText, // Add the actual line text for better matching
        relatedInformation: diagnostic.relatedInformation?.map(info => ({
          message: info.message,
          location: {
            uri: info.location.uri.toString(),
            range: info.location.range
          }
        }))
      };
    });

    // Send diagnostics to webview

    this._panel.webview.postMessage({
      command: "diagnostics",
      diagnostics: serializedDiagnostics,
      documentText: documentText, // Send full document text for line mapping
      documentLines: lines.length
    });
    
    // Also log to VS Code output channel
    const logMessage = `Diagnostics sent to webview: ${serializedDiagnostics.length} items`;
    if ((global as any).markdownEditorLog) {
      (global as any).markdownEditorLog(logMessage);
      serializedDiagnostics.forEach((diag, i) => {
        (global as any).markdownEditorLog(`  ${i + 1}. [${diag.source}] Line ${diag.range.start.line}: ${diag.message}`);
      });
    }
  }

  /**
   * Detect if a document change is from external source (quick fixes, spell checker, etc.)
   */
  private detectExternalChange(e: vscode.TextDocumentChangeEvent): boolean {
    // VS Code 1.44+ includes reason property for change events
    if (e.reason) {
      // Reason 1 = Redo, 2 = Undo, undefined = Normal edit
      return e.reason === 1 || e.reason === 2;
    }
    
    // Track recent webview edits to avoid false positives
    const now = Date.now();
    
    // ENHANCED: Increased time window for webview edit tracking to handle post-newline typing
    // This prevents cursor jumping after Enter key followed by typing
    if (this._lastWebviewEdit && (now - this._lastWebviewEdit) < 3000) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`⏰ Recent webview edit detected (${now - this._lastWebviewEdit}ms ago) - not external`);
      }
      return false;
    }
    
    // ENHANCED: Increased time window for cursor position tracking to handle typing sequences
    if (this._lastCursorPosition && (now - this._lastCursorPosition.timestamp) < 2000) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`⏰ Recent cursor update detected (${now - this._lastCursorPosition.timestamp}ms ago) - not external`);
      }
      return false;
    }
    
    // ENHANCED: Detailed logging for debugging cursor jumping issue
    for (const change of e.contentChanges) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🔍 CURSOR DEBUG - Change detected:`);
        (global as any).markdownEditorLog(`   • Text: "${change.text}" (length: ${change.text.length})`);
        (global as any).markdownEditorLog(`   • Range: ${change.range.start.line}:${change.range.start.character}-${change.range.end.line}:${change.range.end.character}`);
        (global as any).markdownEditorLog(`   • Range length: ${change.rangeLength}`);
        (global as any).markdownEditorLog(`   • Panel state: active=${this._panel.active}, visible=${this._panel.visible}`);
        (global as any).markdownEditorLog(`   • Last webview edit: ${this._lastWebviewEdit ? (now - this._lastWebviewEdit) + 'ms ago' : 'never'}`);
        (global as any).markdownEditorLog(`   • Last cursor update: ${this._lastCursorPosition ? (now - this._lastCursorPosition.timestamp) + 'ms ago' : 'never'}`);
      }
    }
    
    // Enhanced heuristics for detecting external changes
    for (const change of e.contentChanges) {
      const text = change.text.toLowerCase();
      const originalText = e.document.getText(change.range).toLowerCase();
      
      // ENHANCED: VS Code Quick Fix Signature Detection
      // Detect replacement patterns characteristic of VS Code quick fixes
      const isReplacementPattern = change.rangeLength > 0 && 
                                 change.text.length > 0 && 
                                 change.rangeLength !== change.text.length;
      
      const hasSignificantTimeGap = !this._lastWebviewEdit || (now - this._lastWebviewEdit) > 10000;
      
      if (isReplacementPattern && hasSignificantTimeGap) {
        // Check for markdown syntax patterns (markdownlint fixes)
        const hasMarkdownSyntax = change.text.match(/!\[.*?\]\(.*?\)|^\s*[\-\*\+]|\[.*?\]\(.*?\)|^\s*#{1,6}\s|```/) ||
                                 originalText.match(/!\[.*?\]\(.*?\)|^\s*[\-\*\+]|\[.*?\]\(.*?\)|^\s*#{1,6}\s|```/);
        
        if (hasMarkdownSyntax) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`✅ External change detected: Markdown syntax replacement (likely markdownlint fix)`);
          }
          return true;
        }
        
        // Check for focused single-line changes (typical of quick fixes)
        const isFocusedChange = change.range.start.line === change.range.end.line && 
                               change.rangeLength < 100 && // Not a large block change
                               change.text.length < 100;
        
        if (isFocusedChange) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`✅ External change detected: Focused replacement pattern (likely quick fix)`);
          }
          return true;
        }
      }
      
      // High-confidence external change indicators
      if (text.includes('markdownlint-disable') || 
          text.includes('spellcheck') || 
          text.includes('quickfix') ||
          text.includes('markdownlint') ||
          originalText.includes('typo') ||
          (change.rangeLength > 0 && change.text.length > 0 && 
           change.rangeLength !== change.text.length && 
           (text.match(/^[a-zA-Z\s\-']+$/) || text.match(/^[a-zA-Z]+$/)))) { // Enhanced pattern for words with spaces and hyphens
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ External change detected: Quick fix/spell check pattern`);
        }
        return true;
      }
      
      // Multi-word replacements (likely spell corrections or quick fixes)
      const isMultiWordReplacement = change.rangeLength > 5 && 
                                   change.text.length > 5 && 
                                   change.text.trim().includes(' ') &&
                                   !this._panel.active;
      if (isMultiWordReplacement) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ External change detected: Multi-word replacement`);
        }
        return true;
      }
      
      // Document-wide changes (formatters, linters)
      if (change.rangeLength > 100 && change.text.length > 100 && 
          change.range.start.line === 0 && change.range.end.line > 10) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ External change detected: Document-wide change`);
        }
        return true;
      }
      
      // Multi-line changes when panel is not focused (likely external tools)
      if (!this._panel.active && !this._panel.visible && 
          change.range.end.line - change.range.start.line > 1) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ External change detected: Multi-line change while panel inactive`);
        }
        return true;
      }
      
      // Enhanced word-level replacements (spell corrections)
      const isWordReplacement = change.rangeLength > 2 && 
                               change.text.length > 2 && 
                               change.text.match(/^[a-zA-Z'-]+$/) && 
                               !change.text.includes('\n') &&
                               change.rangeLength !== 1; // Not single character edits
      if (isWordReplacement && !this._panel.active) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ External change detected: Word replacement (spell check likely)`);
        }
        return true;
      }
      
      // ENHANCED: More sophisticated panel state and typing detection
      // Panel visibility alone is not sufficient to determine internal vs external changes
      // Quick fixes and spell corrections can happen while panel is visible
      
      // Only reject based on panel state if there are RECENT webview edits indicating active user typing
      const hasVeryRecentWebviewActivity = this._lastWebviewEdit && (now - this._lastWebviewEdit) < 1000; // Very recent activity
      const hasVeryRecentCursorActivity = this._lastCursorPosition && (now - this._lastCursorPosition.timestamp) < 1000;
      
      if ((this._panel.active || this._panel.visible) && (hasVeryRecentWebviewActivity || hasVeryRecentCursorActivity)) {
        // Additional check: if it's a clear replacement pattern, still consider it external
        const isClearReplacement = change.rangeLength > 0 && 
                                 change.text.length > 0 && 
                                 Math.abs(change.rangeLength - change.text.length) > 2; // Significant difference
        
        if (isClearReplacement && (!hasVeryRecentWebviewActivity && !hasVeryRecentCursorActivity)) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`✅ Clear replacement pattern overrides panel visibility - treating as external`);
          }
          return true;
        }
        
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`❌ Panel active/visible with recent activity - treating as internal change`);
        }
        return false;
      }
      
      // ENHANCED: Better detection of normal typing sequences
      // Single character changes are virtually always user typing when recent activity detected
      if (change.text.length <= 1 && change.rangeLength <= 1) {
        // Check for recent webview activity indicating active typing session
        const hasRecentWebviewActivity = this._lastWebviewEdit && (now - this._lastWebviewEdit) < 5000;
        const hasRecentCursorActivity = this._lastCursorPosition && (now - this._lastCursorPosition.timestamp) < 5000;
        
        if (hasRecentWebviewActivity || hasRecentCursorActivity) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`❌ Single character change with recent activity - treating as internal`);
          }
          return false;
        }
        
        // Only treat single chars as external if panel is completely inactive for extended period
        const hasExternalIndicators = !this._panel.visible && 
                                    (now - this._lastWebviewEdit) > 10000; // Increased from 3000ms
        if (!hasExternalIndicators) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`❌ Single character change without strong external indicators - treating as internal`);
          }
          return false;
        }
      }
      
      // ENHANCED: Better handling of small typing sequences (common after newlines)
      if (change.text.length <= 5 && change.rangeLength <= 5 && 
          change.text.match(/^[a-zA-Z0-9\s.,!?'"()-]*$/) && // Normal typing characters
          !change.text.includes('markdownlint') && !change.text.includes('spell')) {
        
        const hasRecentActivity = (this._lastWebviewEdit && (now - this._lastWebviewEdit) < 8000) ||
                                 (this._lastCursorPosition && (now - this._lastCursorPosition.timestamp) < 8000);
        
        if (hasRecentActivity) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`❌ Small typing sequence with recent activity - treating as internal`);
          }
          return false;
        }
      }
      
      // Pure whitespace changes - be more permissive for external changes
      if (change.text.match(/^\s*$/) && change.rangeLength > 0) {
        // Could be external formatting
        if (!this._panel.visible && (now - this._lastWebviewEdit) > 2000) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`✅ External change detected: Whitespace change while panel not visible`);
          }
          return true;
        }
      }
    }
    
    // ENHANCED: Default to internal change with detailed reasoning
    if ((global as any).markdownEditorLog) {
      (global as any).markdownEditorLog(`❌ EXTERNAL CHANGE DEBUG - Final decision: INTERNAL CHANGE`);
      (global as any).markdownEditorLog(`   • Reason: No clear external indicators found`);
      (global as any).markdownEditorLog(`   • Panel state: active=${this._panel.active}, visible=${this._panel.visible}`);
      (global as any).markdownEditorLog(`   • Recent webview activity: ${this._lastWebviewEdit ? (now - this._lastWebviewEdit) + 'ms ago' : 'never'}`);
      (global as any).markdownEditorLog(`   • Recent cursor activity: ${this._lastCursorPosition ? (now - this._lastCursorPosition.timestamp) + 'ms ago' : 'never'}`);
      (global as any).markdownEditorLog(`   • This should NOT trigger webview update`);
    }
    return false;
  }

  /**
   * Handle context menu requests from webview
   */
  private async handleContextMenuRequest(message: any): Promise<void> {
    try {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🔧 Context menu requested at position: ${JSON.stringify(message.position)}`);
      }

      // Get code actions for the current position
      const document = this._document;
      if (!document) return;

      const line = Math.max(0, Math.min(message.position?.line || 0, document.lineCount - 1));
      const character = Math.max(0, message.position?.character || 0);
      const position = new vscode.Position(line, character);
      const range = new vscode.Range(position, position);

      // Execute VS Code's context menu command
      await vscode.commands.executeCommand('editor.action.showContextMenu');
      
      // Also get available code actions and send them to webview
      const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        document.uri,
        range
      ) || [];

      // Send available actions back to webview
      this._panel.webview.postMessage({
        command: 'contextMenuActions',
        actions: codeActions.map(action => ({
          title: action.title,
          kind: action.kind?.value,
          command: action.command?.command,
          arguments: action.command?.arguments
        }))
      });

    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Context menu request failed: ${error}`);
      }
    }
  }

  /**
   * Handle quick fix requests from webview
   */
  private async handleQuickFixRequest(message: any): Promise<void> {
    try {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🔧 Quick fix requested: ${message.actionTitle}`);
      }

      const document = this._document;
      if (!document) return;

      const line = Math.max(0, Math.min(message.position?.line || 0, document.lineCount - 1));
      const character = Math.max(0, message.position?.character || 0);
      const position = new vscode.Position(line, character);
      const range = new vscode.Range(position, position);

      // Get available code actions
      const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        document.uri,
        range
      ) || [];

      // Find the requested action
      const targetAction = codeActions.find(action => 
        action.title === message.actionTitle || 
        action.command?.command === message.command
      );

      if (targetAction) {
        // Execute the code action
        if (targetAction.edit) {
          await vscode.workspace.applyEdit(targetAction.edit);
        }
        if (targetAction.command) {
          await vscode.commands.executeCommand(
            targetAction.command.command,
            ...(targetAction.command.arguments || [])
          );
        }

        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ Quick fix applied: ${targetAction.title}`);
        }
      }

    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Quick fix request failed: ${error}`);
      }
    }
  }

  /**
   * Handle clipboard write requests from webview
   */
  private async handleClipboardWrite(message: any): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(message.text || '');
      
      // Send success confirmation back to webview
      this._panel.webview.postMessage({
        command: 'clipboardWriteResult',
        success: true,
        requestId: message.requestId
      });

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📋 Clipboard write successful: ${message.text?.length || 0} chars`);
      }

    } catch (error) {
      // Send error back to webview
      this._panel.webview.postMessage({
        command: 'clipboardWriteResult',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: message.requestId
      });

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Clipboard write failed: ${error}`);
      }
    }
  }

  /**
   * Handle clipboard read requests from webview
   */
  private async handleClipboardRead(message: any): Promise<void> {
    try {
      const text = await vscode.env.clipboard.readText();
      
      // Send clipboard content back to webview
      this._panel.webview.postMessage({
        command: 'clipboardReadResult',
        text: text,
        success: true,
        requestId: message.requestId
      });

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📋 Clipboard read successful: ${text.length} chars`);
      }

    } catch (error) {
      // Send error back to webview
      this._panel.webview.postMessage({
        command: 'clipboardReadResult',
        text: '',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: message.requestId
      });

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Clipboard read failed: ${error}`);
      }
    }
  }

  /**
   * Handle cursor position updates from webview
   */
  private async handleCursorPositionUpdate(message: any): Promise<void> {
    try {
      // Store cursor position for potential restoration
      this._lastCursorPosition = {
        line: message.line || 0,
        character: message.character || 0,
        timestamp: Date.now()
      };

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🎯 Cursor position updated: line ${message.line}, char ${message.character}`);
      }

    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Cursor position update failed: ${error}`);
      }
    }
  }

  /**
   * Handle quick fix trigger requests from webview
   */
  private async handleTriggerQuickFix(message: any): Promise<void> {
    try {
      if (!this._document) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`❌ Cannot trigger quick fix: no document available`);
        }
        return;
      }

      // Get current cursor position or use the line from message
      const line = message.line || this._lastCursorPosition?.line || 0;
      const character = message.character || this._lastCursorPosition?.character || 0;
      
      const position = new vscode.Position(line, character);
      const range = new vscode.Range(position, position);

      // Try to trigger VS Code's quick fix command
      await vscode.commands.executeCommand('editor.action.quickFix', {
        uri: this._document.uri,
        range: range
      });

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🔧 Quick fix triggered at line ${line}, character ${character}`);
      }

    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Quick fix trigger failed: ${error}`);
      }
    }
  }

  /**
   * Handle select all command
   */
  private async handleSelectAll(): Promise<void> {
    try {
      await vscode.commands.executeCommand('editor.action.selectAll');
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Select All executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Select All failed: ${error}`);
      }
    }
  }

  /**
   * Handle format document command
   */
  private async handleFormatDocument(): Promise<void> {
    try {
      await vscode.commands.executeCommand('editor.action.formatDocument');
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Format Document executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Format Document failed: ${error}`);
      }
    }
  }

  /**
   * Handle format selection command
   */
  private async handleFormatSelection(): Promise<void> {
    try {
      await vscode.commands.executeCommand('editor.action.formatSelection');
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Format Selection executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Format Selection failed: ${error}`);
      }
    }
  }

  /**
   * Handle show problems command
   */
  private async handleShowProblems(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Show Problems executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Show Problems failed: ${error}`);
      }
    }
  }

  /**
   * Handle open problems panel command (triggered by lightbulb clicks)
   */
  private async handleOpenProblemsPanel(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.actions.view.problems');
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`💡 Problems panel opened from lightbulb click`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Open Problems Panel failed: ${error}`);
      }
    }
  }

  /**
   * Handle find command - Use Vditor's integrated find widget
   */
  private async handleFind(): Promise<void> {
    try {
      // Use our custom FindReplaceManager via webview
      this._panel.webview.postMessage({
        command: 'showFind'
      });
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Find widget shown`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Find failed: ${error}`);
      }
    }
  }

  /**
   * Handle find and replace command - Use Vditor's integrated find and replace widget
   */
  private async handleFindAndReplace(): Promise<void> {
    try {
      // Use our custom FindReplaceManager via webview
      this._panel.webview.postMessage({
        command: 'showFindReplace'
      });
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Find and Replace widget shown`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Find and Replace failed: ${error}`);
      }
    }
  }

  /**
   * Handle insert link command
   */
  private async handleInsertLink(): Promise<void> {
    try {
      // Use Vditor's insert link functionality via webview
      this._panel.webview.postMessage({
        command: 'insertLink'
      });
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Insert Link executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Insert Link failed: ${error}`);
      }
    }
  }

  /**
   * Handle insert image command
   */
  private async handleInsertImage(): Promise<void> {
    try {
      // Use Vditor's insert image functionality via webview
      this._panel.webview.postMessage({
        command: 'insertImage'
      });
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Insert Image executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Insert Image failed: ${error}`);
      }
    }
  }

  /**
   * Handle insert table command
   */
  private async handleInsertTable(): Promise<void> {
    try {
      // Use Vditor's insert table functionality via webview
      this._panel.webview.postMessage({
        command: 'insertTable'
      });
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Insert Table executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Insert Table failed: ${error}`);
      }
    }
  }

  /**
   * Handle show command palette command
   */
  private async handleShowCommandPalette(): Promise<void> {
    try {
      await vscode.commands.executeCommand('workbench.action.showCommands');
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Show Command Palette executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Show Command Palette failed: ${error}`);
      }
    }
  }

  /**
   * Handle toggle word wrap command
   */
  private async handleToggleWordWrap(): Promise<void> {
    try {
      await vscode.commands.executeCommand('editor.action.toggleWordWrap');
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Toggle Word Wrap executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Toggle Word Wrap failed: ${error}`);
      }
    }
  }

  /**
   * Handle kanban data save with support for multiple boards
   */
  private async handleKanbanSaveData(message: any): Promise<void> {
    try {
      const kanbanData = message.data;
      const boardId = message.boardId || 'default';
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📥 KANBAN SAVE REQUEST:`);
        (global as any).markdownEditorLog(`   rendererId: ${message.rendererId}`);
        (global as any).markdownEditorLog(`   boardId: ${boardId}`);
        (global as any).markdownEditorLog(`   requestId: ${message.requestId}`);
      }
      
      // Ensure assets directory exists
      await this._ensureAssetsDirectory();
      
      const kanbanFilePath = this._getKanbanFilePath(boardId);
      const displayFilename = this._getKanbanDisplayFilename(boardId);
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🗂️ Saving kanban board '${boardId}' to: ${kanbanFilePath}`);
        (global as any).markdownEditorLog(`   Display filename: ${displayFilename}`);
      }

      // Escape quotes in kanban data to prevent JSON parsing issues
      const escapedKanbanData = this._escapeKanbanQuotes(kanbanData);
      const content = Buffer.from(JSON.stringify(escapedKanbanData, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(kanbanFilePath), content);

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Kanban board '${boardId}' saved successfully`);
      }

      // Send confirmation back to webview
      this._panel.webview.postMessage({
        command: "kanban-data-saved",
        success: true,
        rendererId: message.rendererId || 'kanban-board',
        boardId: boardId,
        filename: displayFilename
      });
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Failed to save kanban data: ${error}`);
      }

      // Send error back to webview
      this._panel.webview.postMessage({
        command: "kanban-data-saved",
        success: false,
        rendererId: message.rendererId || 'kanban-board',
        boardId: message.boardId || 'default',
        filename: this._getKanbanDisplayFilename(message.boardId || 'default'),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle kanban data load with support for multiple boards and backwards compatibility
   */
  private async handleKanbanLoadData(message: any): Promise<void> {
    try {
      const boardId = message.boardId || 'default';
      const codeBlockData = message.codeBlockData; // For backwards compatibility
      const requestedFilename = message.filename; // Filename from code block
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📥 KANBAN LOAD REQUEST:`);
        (global as any).markdownEditorLog(`   rendererId: ${message.rendererId}`);
        (global as any).markdownEditorLog(`   boardId: ${boardId}`);
        (global as any).markdownEditorLog(`   requestId: ${message.requestId}`);
        (global as any).markdownEditorLog(`   codeBlockData: ${codeBlockData ? 'present' : 'none'}`);
        (global as any).markdownEditorLog(`   requestedFilename: ${requestedFilename}`);
      }
      
      // Ensure assets directory exists
      await this._ensureAssetsDirectory();
      
      const kanbanFilePath = this._getKanbanFilePath(boardId);
      const displayFilename = this._getKanbanDisplayFilename(boardId);
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`   Calculated file path: ${kanbanFilePath}`);
        (global as any).markdownEditorLog(`   Display filename: ${displayFilename}`);
      }
      let kanbanData;
      let dataSource = 'unknown';

      // First check if we have backwards compatibility data from code block
      if (codeBlockData && codeBlockData.columns && Array.isArray(codeBlockData.columns)) {
        kanbanData = codeBlockData;
        dataSource = 'code-block';
        
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`🔄 Using legacy code block data for board '${boardId}', will migrate to JSON file`);
        }

        // Migrate the data to JSON file automatically with quote escaping
        try {
          const escapedKanbanData = this._escapeKanbanQuotes(kanbanData);
          const content = Buffer.from(JSON.stringify(escapedKanbanData, null, 2), 'utf8');
          await vscode.workspace.fs.writeFile(vscode.Uri.file(kanbanFilePath), content);
          dataSource = 'migrated';
          
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`✅ Migrated legacy data to: ${kanbanFilePath}`);
          }
        } catch (migrateError) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`⚠️ Failed to migrate data: ${migrateError}`);
          }
        }
      } else {
        // Try to load from JSON file
        try {
          const content = await vscode.workspace.fs.readFile(vscode.Uri.file(kanbanFilePath));
          kanbanData = JSON.parse(content.toString());
          dataSource = 'json-file';
          
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`✅ Loaded kanban board '${boardId}' from: ${kanbanFilePath}`);
          }
        } catch (fileError) {
          // File doesn't exist or was moved, create/recreate default data
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`⚠️ Kanban file not found (${kanbanFilePath}), creating/recreating with default data`);
          }
          
          kanbanData = {
            columns: [
              { id: "1", title: "Todo", items: [] },
              { id: "2", title: "Doing", items: [] },
              { id: "3", title: "Done", items: [] }
            ]
          };
          dataSource = 'recreated';

          // Create/recreate the JSON file with default data (with quote escaping)
          try {
            const escapedKanbanData = this._escapeKanbanQuotes(kanbanData);
            const content = Buffer.from(JSON.stringify(escapedKanbanData, null, 2), 'utf8');
            await vscode.workspace.fs.writeFile(vscode.Uri.file(kanbanFilePath), content);
            
            if ((global as any).markdownEditorLog) {
              (global as any).markdownEditorLog(`✅ Created/recreated kanban file: ${kanbanFilePath}`);
            }
          } catch (createError) {
            if ((global as any).markdownEditorLog) {
              (global as any).markdownEditorLog(`⚠️ Failed to create kanban file: ${createError}`);
            }
          }
        }
      }

      // Send data back to webview
      this._panel.webview.postMessage({
        command: "kanban-data-loaded",
        data: kanbanData,
        rendererId: message.rendererId || 'kanban-board',
        boardId: boardId,
        filename: this._getKanbanDisplayFilename(boardId),
        dataSource: dataSource,
        requestId: message.requestId
      });

    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Failed to load kanban data: ${error}`);
      }

      // Send error back to webview
      this._panel.webview.postMessage({
        command: "kanban-data-loaded",
        error: error instanceof Error ? error.message : String(error),
        rendererId: message.rendererId || 'kanban-board',
        boardId: message.boardId || 'default',
        filename: this._getKanbanDisplayFilename(message.boardId || 'default'),
        requestId: message.requestId
      });
    }
  }

  /**
   * Get the kanban file path based on the current markdown file and board ID
   * Files are stored in an 'assets' folder at the same level as the markdown file
   */
  private _getKanbanFilePath(boardId: string = 'default'): string {
    const markdownPath = this._fsPath;
    const dir = NodePath.dirname(markdownPath);
    const basename = NodePath.basename(markdownPath, NodePath.extname(markdownPath));
    const assetsDir = NodePath.join(dir, 'assets');
    
    if (boardId === 'default') {
      return NodePath.join(assetsDir, `${basename}.kanban.json`);
    } else {
      // For named boards, include the board ID in the filename
      return NodePath.join(assetsDir, `${basename}.kanban.${boardId}.json`);
    }
  }

  /**
   * Get the relative filename to display in the code block
   */
  private _getKanbanDisplayFilename(boardId: string = 'default'): string {
    const markdownPath = this._fsPath;
    const basename = NodePath.basename(markdownPath, NodePath.extname(markdownPath));
    
    if (boardId === 'default') {
      return `assets/${basename}.kanban.json`;
    } else {
      return `assets/${basename}.kanban.${boardId}.json`;
    }
  }

  /**
   * Get the full file path for a generic renderer's data file
   * Format: <document>.<rendererId>.<boardId>.json
   */
  private _getRendererFilePath(rendererId: string, boardId: string = 'default'): string {
    const markdownPath = this._fsPath;
    const dir = NodePath.dirname(markdownPath);
    const basename = NodePath.basename(markdownPath, NodePath.extname(markdownPath));
    const assetsDir = NodePath.join(dir, 'assets');
    
    if (boardId === 'default') {
      return NodePath.join(assetsDir, `${basename}.${rendererId}.json`);
    } else {
      // For named boards, include the board ID in the filename
      return NodePath.join(assetsDir, `${basename}.${rendererId}.${boardId}.json`);
    }
  }

  /**
   * Get the relative filename to display in the code block for generic renderers
   */
  private _getRendererDisplayFilename(rendererId: string, boardId: string = 'default'): string {
    const markdownPath = this._fsPath;
    const basename = NodePath.basename(markdownPath, NodePath.extname(markdownPath));
    
    if (boardId === 'default') {
      return `assets/${basename}.${rendererId}.json`;
    } else {
      return `assets/${basename}.${rendererId}.${boardId}.json`;
    }
  }

  /**
   * Ensure the assets directory exists
   */
  private async _ensureAssetsDirectory(): Promise<void> {
    const markdownPath = this._fsPath;
    const dir = NodePath.dirname(markdownPath);
    const assetsDir = NodePath.join(dir, 'assets');
    
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(assetsDir));
    } catch (error) {
      // Directory doesn't exist, create it
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📁 Creating assets directory: ${assetsDir}`);
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(assetsDir));
    }
  }

  /**
   * Escape quotes in kanban data to prevent JSON parsing issues
   * Replaces both wrapped quotes and standalone quotes with Unicode equivalents
   */
  private _escapeKanbanQuotes(obj: any): any {
    if (typeof obj === 'string') {
      // Replace quotes with curly quotes to avoid JSON conflicts
      return obj
        // Handle quoted content: "word" -> "word"
        .replace(/"([^"]*)"/g, '\u201C$1\u201D')
        // Handle quoted content: 'word' -> 'word' 
        .replace(/'([^']*)'/g, '\u2018$1\u2019')
        // Handle standalone double quotes
        .replace(/"/g, '\u201C')
        // Handle standalone single quotes/apostrophes
        .replace(/'/g, '\u2019');
    } else if (Array.isArray(obj)) {
      return obj.map(item => this._escapeKanbanQuotes(item));
    } else if (obj && typeof obj === 'object') {
      const escaped: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          escaped[key] = this._escapeKanbanQuotes(obj[key]);
        }
      }
      return escaped;
    }
    return obj;
  }

  /**
   * Handle kanban data migration from code blocks to JSON files
   */
  private async handleKanbanMigrateData(message: any): Promise<void> {
    try {
      const { boardId, codeBlockData } = message;
      const actualBoardId = boardId || 'default';
      
      // Ensure assets directory exists
      await this._ensureAssetsDirectory();
      
      const kanbanFilePath = this._getKanbanFilePath(actualBoardId);
      const displayFilename = this._getKanbanDisplayFilename(actualBoardId);
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🔄 Migrating kanban board '${actualBoardId}' from code block to: ${kanbanFilePath}`);
      }

      // Escape quotes in migrated data to prevent JSON parsing issues
      const escapedCodeBlockData = this._escapeKanbanQuotes(codeBlockData);
      const content = Buffer.from(JSON.stringify(escapedCodeBlockData, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(kanbanFilePath), content);

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Migration completed for board '${actualBoardId}'`);
      }

      // Send confirmation back to webview
      this._panel.webview.postMessage({
        command: "kanban-data-migrated",
        success: true,
        boardId: actualBoardId,
        filename: displayFilename
      });
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Failed to migrate kanban data: ${error}`);
      }

      // Send error back to webview
      this._panel.webview.postMessage({
        command: "kanban-data-migrated",
        success: false,
        boardId: message.boardId || 'default',
        filename: this._getKanbanDisplayFilename(message.boardId || 'default'),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Generic handler for renderer data loading
   * Wraps the existing kanban file operations for any renderer type
   */
  private async handleRendererLoadData(message: any): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, requestId } = message;
      
      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId = boardId || instanceId || 'default';
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📥 RENDERER LOAD: Renderer '${rendererId}' boardId '${actualBoardId}' requesting data`);
      }

      // For now, all renderers use the same file structure as kanban
      // Future: implement renderer-specific file handling
      
      // Ensure assets directory exists
      await this._ensureAssetsDirectory();
      
      // Use renderer-specific file path (not kanban-specific)
      const rendererFilePath = this._getRendererFilePath(rendererId, actualBoardId);
      const displayFilename = this._getRendererDisplayFilename(rendererId, actualBoardId);
      let rendererData;
      let dataSource = 'unknown';

      // Try to load from JSON file
      try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(rendererFilePath));
        const parsedData = JSON.parse(content.toString());
        
        // Validate data structure matches renderer type
        const isValidData = this._validateRendererData(rendererId, parsedData);
        
        if (!isValidData) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`⚠️ RENDERER LOAD: Invalid data structure in ${rendererFilePath} for renderer '${rendererId}'`);
            (global as any).markdownEditorLog(`   File contains wrong renderer type data. Creating correct file with board ID: ${actualBoardId}`);
          }
          
          // IMPORTANT: Reuse the existing board ID from the code block
          // This maintains consistency when switching between renderer types
          const correctFilePath = this._getRendererFilePath(rendererId, actualBoardId);
          const correctDisplayFilename = this._getRendererDisplayFilename(rendererId, actualBoardId);
          
          // Create new file with default data for this renderer type
          const defaultData = this._getDefaultRendererData(rendererId);
          const newContent = Buffer.from(JSON.stringify(defaultData, null, 2), 'utf8');
          await vscode.workspace.fs.writeFile(vscode.Uri.file(correctFilePath), newContent);
          
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(`✅ RENDERER LOAD: Created correct file: ${correctFilePath}`);
          }
          
          // Send message to update code block with correct renderer-specific file reference
          this._panel.webview.postMessage({
            command: "renderer-update-code-block",
            rendererId: rendererId,
            boardId: actualBoardId,
            filename: correctDisplayFilename
          });
          
          // Return the default data with same board ID
          rendererData = defaultData;
          dataSource = 'new-file-created';
          
          // Update response to use same board ID
          this._panel.webview.postMessage({
            command: "renderer-data-loaded",
            success: true,
            rendererId: rendererId,
            boardId: actualBoardId,
            instanceId: actualBoardId,
            requestId: requestId,
            data: rendererData,
            filename: correctDisplayFilename,
            dataSource: dataSource
          });
          return;
        }
        
        rendererData = parsedData;
        dataSource = 'json-file';
        
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ RENDERER LOAD: Loaded '${rendererId}' data from: ${rendererFilePath}`);
        }
      } catch (fileError) {
        // File doesn't exist or is empty, create with default data based on renderer type
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`⚠️ RENDERER LOAD: File not found or empty (${rendererFilePath}), creating with default data`);
        }
        
        // Create file with default data
        const defaultData = this._getDefaultRendererData(rendererId);
        const content = Buffer.from(JSON.stringify(defaultData, null, 2), 'utf8');
        await vscode.workspace.fs.writeFile(vscode.Uri.file(rendererFilePath), content);
        
        rendererData = defaultData;
        dataSource = 'created-default';
        
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ RENDERER LOAD: Created default data file: ${rendererFilePath}`);
        }
      }

      // Send data back to webview
      this._panel.webview.postMessage({
        command: "renderer-data-loaded",
        success: true,
        rendererId: rendererId,
        boardId: actualBoardId,
        instanceId: actualBoardId, // For backwards compatibility
        requestId: requestId,
        data: rendererData,
        filename: displayFilename,
        dataSource: dataSource
      });

    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ RENDERER LOAD: Failed to load data: ${error}`);
      }

      // Send error back to webview
      this._panel.webview.postMessage({
        command: "renderer-data-loaded",
        success: false,
        rendererId: message.rendererId,
        instanceId: message.instanceId,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Generic handler for renderer data saving
   * Wraps the existing kanban file operations for any renderer type
   */
  private async handleRendererSaveData(message: any): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, data, requestId } = message;
      
      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId = boardId || instanceId || 'default';
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`💾 RENDERER SAVE: Renderer '${rendererId}' boardId '${actualBoardId}' saving data`);
      }

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();
      
      // Use renderer-specific file path
      const rendererFilePath = this._getRendererFilePath(rendererId, actualBoardId);
      const displayFilename = this._getRendererDisplayFilename(rendererId, actualBoardId);

      // Escape quotes in data to prevent JSON parsing issues
      const escapedData = this._escapeKanbanQuotes(data);
      const content = Buffer.from(JSON.stringify(escapedData, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(rendererFilePath), content);

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ RENDERER SAVE: Saved '${rendererId}' data to: ${rendererFilePath}`);
      }

      // Send confirmation back to webview
      this._panel.webview.postMessage({
        command: "renderer-data-saved",
        success: true,
        rendererId: rendererId,
        boardId: actualBoardId,
        instanceId: actualBoardId, // For backwards compatibility
        requestId: requestId,
        filename: displayFilename
      });

    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ RENDERER SAVE: Failed to save data: ${error}`);
      }

      // Send error back to webview
      this._panel.webview.postMessage({
        command: "renderer-data-saved",
        success: false,
        rendererId: message.rendererId,
        instanceId: message.instanceId,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Generic handler for checking if renderer data file exists
   */
  private async handleRendererCheckData(message: any): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, requestId } = message;
      
      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId = boardId || instanceId || 'default';
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🔍 RENDERER CHECK: Checking if '${rendererId}' boardId '${actualBoardId}' data exists`);
      }

      const rendererFilePath = this._getRendererFilePath(rendererId, actualBoardId);
      const displayFilename = this._getRendererDisplayFilename(rendererId, actualBoardId);
      let exists = false;

      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(rendererFilePath));
        exists = true;
        
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`✅ RENDERER CHECK: File exists at ${rendererFilePath}`);
        }
      } catch (error) {
        exists = false;
        
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(`ℹ️ RENDERER CHECK: File does not exist at ${rendererFilePath}`);
        }
      }

      // Send result back to webview
      this._panel.webview.postMessage({
        command: "renderer-data-checked",
        success: true,
        rendererId: rendererId,
        boardId: actualBoardId,
        instanceId: actualBoardId, // For backwards compatibility
        requestId: requestId,
        exists: exists,
        filename: displayFilename,
        filePath: rendererFilePath
      });

    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ RENDERER CHECK: Failed to check data: ${error}`);
      }

      // Send error back to webview
      this._panel.webview.postMessage({
        command: "renderer-data-checked",
        success: false,
        rendererId: message.rendererId,
        instanceId: message.instanceId,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle insert custom renderer request
   * Creates the data file first, then inserts the code block with the filename reference
   */
  private async handleInsertRenderer(message: any): Promise<void> {
    try {
      const rendererType = message.rendererType;
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📝 INSERT RENDERER: Request to insert ${rendererType}`);
      }

      // Generate unique board ID for this renderer instance
      const boardId = this._generateUniqueBoardId(rendererType);
      
      // Ensure assets directory exists
      await this._ensureAssetsDirectory();
      
      // Create data file with default data
      let defaultData;
      let language;
      
      switch (rendererType) {
        case 'kanban-board':
          language = 'kanban-board';
          defaultData = {
            columns: [
              { id: "1", title: "Todo", items: [] },
              { id: "2", title: "Doing", items: [] },
              { id: "3", title: "Done", items: [] }
            ]
          };
          break;
        case 'table':
          language = 'table';
          defaultData = {
            columns: [
              { id: 'col1', name: 'Column 1', type: 'text' },
              { id: 'col2', name: 'Column 2', type: 'text' },
              { id: 'col3', name: 'Column 3', type: 'text' }
            ],
            rows: [
              { id: 'row1', cells: { col1: 'Data 1', col2: 'Data 2', col3: 'Data 3' } },
              { id: 'row2', cells: { col1: 'Data 4', col2: 'Data 5', col3: 'Data 6' } }
            ]
          };
          break;
        default:
          throw new Error(`Unknown renderer type: ${rendererType}`);
      }
      
      // Get file path and create the file
      const filePath = this._getRendererFilePath(rendererType, boardId);
      const displayFilename = this._getRendererDisplayFilename(rendererType, boardId);
      
      const content = Buffer.from(JSON.stringify(defaultData, null, 2), 'utf8');
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), content);
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ INSERT RENDERER: Created data file at ${filePath}`);
      }
      
      // Create the code block markdown to insert
      let codeBlock = `\n\`\`\`${language}\n`;
      
      // Add comment with board ID and file reference for identification
      codeBlock += `<!-- file: ${displayFilename} -->\n`;
      
      if (boardId !== 'default') {
        if (rendererType === 'kanban-board') {
          codeBlock += `<!-- board: ${boardId} -->\n`;
        } else if (rendererType === 'table') {
          codeBlock += `<!-- table: ${boardId} -->\n`;
        }
      }
      
      codeBlock += `\`\`\`\n`;
      
      // Send message to webview to insert the code block
      this._panel.webview.postMessage({
        command: "insertRendererCodeBlock",
        rendererType: rendererType,
        boardId: boardId,
        codeBlock: codeBlock,
        filename: displayFilename
      });
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ INSERT RENDERER: Sent code block to webview for ${rendererType}`);
      }
      
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ INSERT RENDERER: Failed - ${error}`);
      }
      vscode.window.showErrorMessage(`Failed to insert ${message.rendererType}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a unique board ID for a renderer
   */
  private _generateUniqueBoardId(rendererType: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 7);
    return `${rendererType}-${timestamp}-${random}`;
  }

  /**
   * Handle wiki-link workspace files request
   * Returns all markdown files in the workspace for autocomplete
   */
  private async handleRequestWorkspaceFiles(message: any): Promise<void> {
    try {
      // Find all markdown files in workspace
      const files = await vscode.workspace.findFiles(
        '**/*.{md,markdown}',
        '**/node_modules/**'
      );

      // Convert to file info format
      const fileInfos = await Promise.all(
        files.map(async (file) => {
          const stat = await vscode.workspace.fs.stat(file);
          const relativePath = vscode.workspace.asRelativePath(file);
          const name = NodePath.basename(file.fsPath, NodePath.extname(file.fsPath));

          return {
            name,
            path: file.fsPath,
            relativePath,
            mtime: stat.mtime,
          };
        })
      );

      // Send response back to webview
      this._panel.webview.postMessage({
        command: 'wikilink-workspace-files',
        requestId: message.requestId,
        files: fileInfos,
      });
    } catch (error) {
      logger.error('Failed to get workspace files:', error);
      this._panel.webview.postMessage({
        command: 'wikilink-workspace-files',
        requestId: message.requestId,
        files: [],
      });
    }
  }

  /**
   * Handle wiki-link related files request
   * Returns files related to the current document
   */
  private async handleRequestRelatedFiles(message: any): Promise<void> {
    try {
      const documentPath = message.documentPath;
      const documentUri = vscode.Uri.file(documentPath);

      // Use RelationshipAnalyzer to get related files
      const RelationshipAnalyzer = (await import('../services/RelationshipAnalyzer')).RelationshipAnalyzer;
      const analyzer = RelationshipAnalyzer.getInstance();
      const relatedFiles = await analyzer.getRelatedFiles(documentUri);

      // Send response back to webview
      this._panel.webview.postMessage({
        command: 'wikilink-related-files',
        requestId: message.requestId,
        files: relatedFiles.map(f => f.path),
      });
    } catch (error) {
      logger.error('Failed to get related files:', error);
      this._panel.webview.postMessage({
        command: 'wikilink-related-files',
        requestId: message.requestId,
        files: [],
      });
    }
  }

  /**
   * Validate that data structure matches the expected format for a renderer
   */
  private _validateRendererData(rendererId: string, data: any): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }
    
    switch (rendererId) {
      case 'kanban-board':
        // Kanban should have columns array
        return Array.isArray(data.columns) && 
               data.columns.length > 0 &&
               data.columns.every((col: any) => col.id && col.title !== undefined);
      
      case 'table-renderer':
        // Table should have columns and rows arrays
        return Array.isArray(data.columns) && 
               Array.isArray(data.rows) &&
               data.columns.length > 0 &&
               data.columns.every((col: any) => col.id && col.name !== undefined);
      
      default:
        // Unknown renderer, accept any object
        return true;
    }
  }

  /**
   * Get default data structure for a renderer type
   */
  private _getDefaultRendererData(rendererId: string): any {
    switch (rendererId) {
      case 'kanban-board':
        return {
          columns: [
            { id: "1", title: "Todo", items: [] },
            { id: "2", title: "Doing", items: [] },
            { id: "3", title: "Done", items: [] }
          ]
        };
      
      case 'table-renderer':
        return {
          columns: [
            { id: 'col1', name: 'Column 1', type: 'text' },
            { id: 'col2', name: 'Column 2', type: 'text' },
            { id: 'col3', name: 'Column 3', type: 'text' }
          ],
          rows: [
            { id: 'row1', cells: { col1: 'Data 1', col2: 'Data 2', col3: 'Data 3' } },
            { id: 'row2', cells: { col1: 'Data 4', col2: 'Data 5', col3: 'Data 6' } }
          ]
        };
      
      default:
        return {};
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const toUri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, f));
    const baseHref =
      NodePath.dirname(
        webview.asWebviewUri(vscode.Uri.file(this._fsPath)).toString()
      ) + "/";
    const toMediaPath = (f: string) => `media/dist/${f}`;
    const JsFiles = ["main.js"].map(toMediaPath).map(toUri);
    const CssFiles = ["main.css"].map(toMediaPath).map(toUri);
    
    // Add Vditor dependencies that need to execute before main.js
    // These set window.VditorI18n and insert SVG icons into the DOM
    const VditorDepsFiles = [
      "js/i18n/en_US.js",
      "js/icons/ant.js",
      "js/icons/material.js"
    ].map(toMediaPath).map(toUri);
    
    // Add codicon CSS from sidebar-dist (same as sidebar)
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'sidebar-dist', 'codicon.css')
    );

    return `<!DOCTYPE html>
            <html lang="en" style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden;">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval'; img-src ${webview.cspSource} https: data: blob:; font-src ${webview.cspSource} data:; media-src ${webview.cspSource} https: data:; connect-src ${webview.cspSource} https:;">
                <base href="${baseHref}" />
                <link href="${codiconsUri}" rel="stylesheet">
                ${CssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join("\n")}
                <title>markdown editor</title>
                <style>
                    /* Inline critical styles for immediate effect */
                    html, body {
                        height: 100vh !important;
                        width: 100vw !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        overflow: hidden !important;
                        position: fixed !important;
                        top: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                    }
                    #app {
                        height: 100vh !important;
                        width: 100vw !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        overflow: hidden !important;
                        position: absolute !important;
                        top: 0 !important;
                        left: 0 !important;
                        right: 0 !important;
                        bottom: 0 !important;
                    }
                    ${this._config.get<string>('customCss') || ''}
                </style>
            </head>
            <body style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden; position: fixed; top: 0; left: 0; right: 0; bottom: 0;">
                <div id="app" style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden; position: absolute; top: 0; left: 0; right: 0; bottom: 0;"></div>
                <!-- Load Vditor dependencies first (i18n and icons) -->
                ${VditorDepsFiles.map((f) => `<script src="${f}"></script>`).join("\n")}
                <!-- Load main application bundle -->
                ${JsFiles.map((f) => `<script src="${f}"></script>`).join("\n")}

                <!-- Inline handler for openEmbedPreview so overlay works without rebuilding the bundle -->
                <script>
                (function(){
                  window.addEventListener('message', function(e){
                    var msg = e.data || {};
                    if (msg.command !== 'openEmbedPreview') return;
                    try {
                      var embed = msg.embed || {};
                      var overlay = document.getElementById('vscode-embed-preview-overlay');
                      if (!overlay) {
                        overlay = document.createElement('div');
                        overlay.id = 'vscode-embed-preview-overlay';
                        overlay.style.position = 'fixed';
                        overlay.style.right = '20px';
                        overlay.style.bottom = '20px';
                        overlay.style.zIndex = '20000';
                        overlay.style.maxWidth = '40vw';
                        overlay.style.maxHeight = '60vh';
                        overlay.style.overflow = 'auto';
                        overlay.style.background = 'rgba(0,0,0,0.85)';
                        overlay.style.border = '1px solid #333';
                        overlay.style.borderRadius = '6px';
                        overlay.style.padding = '8px';
                        overlay.style.boxShadow = '0 8px 32px rgba(0,0,0,0.6)';
                        overlay.style.color = '#ddd';
                        document.body.appendChild(overlay);
                      }
                      overlay.innerHTML = '';
                      var hdr = document.createElement('div');
                      hdr.style.display = 'flex';
                      hdr.style.justifyContent = 'space-between';
                      hdr.style.alignItems = 'center';
                      hdr.style.marginBottom = '6px';
                      var title = document.createElement('div');
                      title.textContent = embed.fileName || (embed.path ? embed.path.split('/').slice(-1)[0] : 'Embed');
                      title.style.fontWeight = '600';
                      var closeBtn = document.createElement('button');
                      closeBtn.textContent = 'Close';
                      closeBtn.className = 'vscode-quickfix-button';
                      closeBtn.addEventListener('click', function(){ overlay && overlay.remove(); });
                      hdr.appendChild(title);
                      hdr.appendChild(closeBtn);
                      overlay.appendChild(hdr);

                      if (embed.dataUrl && (embed.mimeType || '').startsWith('image/')) {
                        var img = document.createElement('img');
                        img.src = embed.dataUrl;
                        img.style.maxWidth = '100%';
                        img.style.height = 'auto';
                        overlay.appendChild(img);
                      } else if (embed.text) {
                        var pre = document.createElement('pre');
                        pre.style.whiteSpace = 'pre-wrap';
                        pre.style.wordBreak = 'break-word';
                        pre.textContent = embed.text.substring(0, 20000);
                        overlay.appendChild(pre);
                      } else if (embed.dataUrl) {
                        var link = document.createElement('a');
                        link.href = embed.dataUrl;
                        link.textContent = embed.fileName || 'Download';
                        link.target = '_blank';
                        overlay.appendChild(link);
                      } else if (embed.path) {
                        var info = document.createElement('div');
                        info.textContent = 'Path: ' + embed.path;
                        overlay.appendChild(info);
                      } else {
                        var info2 = document.createElement('div');
                        info2.textContent = 'No preview available for this embed';
                        overlay.appendChild(info2);
                      }
                      // If we have an inline dataUrl, add a Download link
                      if (embed.dataUrl) {
                        var dlRow2 = document.createElement('div');
                        dlRow2.style.display = 'flex';
                        dlRow2.style.justifyContent = 'flex-end';
                        dlRow2.style.marginTop = '8px';
                        var dlLink2 = document.createElement('a');
                        dlLink2.href = embed.dataUrl;
                        dlLink2.textContent = 'Download';
                        dlLink2.target = '_blank';
                        dlLink2.className = 'vscode-quickfix-button';
                        dlLink2.style.marginRight = '8px';
                        dlRow2.appendChild(dlLink2);
                        overlay.appendChild(dlRow2);
                      }
                      // If the extension chose not to embed the file (too large), show the note and Open button
                      if (embed.note) {
                        var note = document.createElement('div');
                        note.style.marginTop = '8px';
                        note.style.fontSize = '12px';
                        note.style.opacity = '0.9';
                        note.textContent = embed.note;
                        overlay.appendChild(note);
                      }

                      if (embed.path) {
                        var openRow = document.createElement('div');
                        openRow.style.display = 'flex';
                        openRow.style.justifyContent = 'flex-end';
                        openRow.style.marginTop = '8px';
                        var openBtn = document.createElement('button');
                        openBtn.textContent = 'Open';
                        openBtn.className = 'vscode-quickfix-button';
                        openBtn.addEventListener('click', function(){
                          try {
                            // Use acquireVsCodeApi if available, else fallback to vscode global
                            var api = (window as any).acquireVsCodeApi ? (window as any).acquireVsCodeApi() : (window as any).vscode;
                            if (api && api.postMessage) {
                              api.postMessage({ command: 'openFile', path: embed.path });
                            } else if (window && window.postMessage) {
                              // last resort
                              window.postMessage({ command: 'openFile', path: embed.path }, '*');
                            }
                          } catch (err) {
                            // Note: This is in HTML template, errors logged in browser console
                            if (window.console) window.console.error('Open button failed', err);
                          }
                        });
                        openRow.appendChild(openBtn);
                        overlay.appendChild(openRow);
                      }
                    } catch (err) {
                      // Note: This is in HTML template, errors logged in browser console
                      if (window.console) window.console.error('openEmbedPreview overlay failed', err);
                    }
                  });
                })();
                </script>
            </body>
            </html>`;
  }

  /**
   * Handle wiki-link path resolution request from webview
   */
  private async handleResolveWikiLink(message: any): Promise<void> {
    const { filename, currentDocument, requestId } = message;
    
    try {
      const LinkResolver = (await import('../services/LinkResolver')).LinkResolver;
      const resolver = LinkResolver.getInstance();
      
      const currentUri = this._uri;
      if (!currentUri) {
        return;
      }

      const resolvedUri = await resolver.resolveWikiLink(filename, currentUri);
      
      if (resolvedUri) {
        const relativePath = resolver.getRelativePath(currentUri, resolvedUri);
        
        // Send resolved path back to webview
        this._panel?.webview.postMessage({
          command: 'wikilink-resolved',
          requestId,
          filename,
          resolvedPath: relativePath,
          fullPath: resolvedUri.fsPath
        });
      }
    } catch (error) {
      logger.error('[EditorPanel] Error resolving wiki-link:', error);
    }
  }

  /**
   * Handle wiki-link navigation request from webview
   */
  private async handleNavigateToWikiLink(message: any): Promise<void> {
    const { filename, heading, currentDocument } = message;
    
    try {
      const LinkResolver = (await import('../services/LinkResolver')).LinkResolver;
      const resolver = LinkResolver.getInstance();
      
      const currentUri = this._uri;
      if (!currentUri) {
        return;
      }

      await resolver.navigateToWikiLink(filename, heading, currentUri);
      
      debug(`[EditorPanel] Navigated to wiki-link: ${filename || 'current'}${heading ? '#' + heading : ''}`);
    } catch (error) {
      logger.error('[EditorPanel] Error navigating to wiki-link:', error);
      vscode.window.showErrorMessage(`Failed to navigate to wiki-link: ${error}`);
    }
  }

  /**
   * Handle file open request from webview (wiki-links, embeds, sidebar)
   */
  private async handleOpenFile(message: any): Promise<void> {
    const { filename, heading, filePath, path } = message;
    
    try {
      // If we have a direct file path (from sidebar or embed modal), use it
      if (filePath || path) {
        const uri = vscode.Uri.file(filePath || path);
        const ext = NodePath.extname(uri.fsPath).toLowerCase();
        
        // For markdown files, use our custom editor
        if (ext === '.md') {
          await EditorPanel.createOrShow(this._context, uri);
        } else {
          // For other files, use default editor
          await vscode.commands.executeCommand('vscode.open', uri);
        }
        return;
      }
      
      // Otherwise, resolve wiki-link filename
      if (filename) {
        const LinkResolver = (await import('../services/LinkResolver')).LinkResolver;
        const resolver = LinkResolver.getInstance();
        
        const currentUri = this._uri;
        if (!currentUri) {
          return;
        }

        await resolver.navigateToWikiLink(filename, heading, currentUri);
        debug(`[EditorPanel] Opened file via wiki-link: ${filename}${heading ? '#' + heading : ''}`);
      }
    } catch (error) {
      logger.error('[EditorPanel] Error opening file:', error);
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }
}
