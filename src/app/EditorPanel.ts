import * as vscode from "vscode";
import * as NodePath from "path";
const KeyVditorOptions = "vditor.options";
import { showError, getWebviewOptions, debug } from "./_utils";

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
  public static readonly viewType = "markdown-editor";
  private _disposables: vscode.Disposable[] = [];
  private _isEdit = false;
  private _lastCursorPosition: { line: number; character: number; timestamp: number } | null = null;
  private _lastWebviewEdit = 0;

  /**
   * Create a new panel.
   */
  public static async createOrShow(
    context: vscode.ExtensionContext,
    uri?: vscode.Uri,
    webviewPanel?: vscode.WebviewPanel
  ) {
    const { extensionUri } = context;
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;
    //if (EditorPanel.currentPanel && uri !== EditorPanel.currentPanel?._uri) {
    if (EditorPanel.currentPanel) {
      EditorPanel.currentPanel.dispose();
    }
    // If we already have a panel, show it.
    if (EditorPanel.currentPanel) {
      EditorPanel.currentPanel._panel.reveal(column);
      return;
    }
    if (!vscode.window.activeTextEditor && !uri) {
      showError(`Did not open markdown file!`);
      return;
    }
    let doc: undefined | vscode.TextDocument;
    // from context menu : 从当前打开的 textEditor 中寻找 是否有当前 markdown 的 editor, 有的话则绑定 document
    if (uri) {
      try {
        // 从右键打开文件，先打开文档然后开启自动同步，不然没法保存文件和同步到已经打开的document
        doc = await vscode.workspace.openTextDocument(uri);
      } catch(err: unknown) {
        if (err instanceof Error) {
          if (uri) {
            // Create file
            await vscode.workspace.fs.writeFile(
              vscode.Uri.file(uri.fsPath),
              new Uint8Array()
            );
          }
        }
      } finally {
        // Try to read it now.
        doc = await vscode.workspace.openTextDocument(uri);
      }
    } else {
      doc = vscode.window.activeTextEditor?.document;
      // from command mode
      if (doc && doc.languageId !== "markdown") {
        showError(
          `Current file language is not markdown, got ${doc.languageId}`
        );
        return;
      }
    }

    if (!doc) {
      showError(`Cannot find markdown file!`);
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

    // Otherwise, create a new panel.
    const editor = new EditorPanel(context, panel, extensionUri, doc, uri, !!webviewPanel);
    if (!webviewPanel) {
      EditorPanel.currentPanel = editor;
    } else {
      EditorPanel.editors = EditorPanel.editors || [];
      EditorPanel.editors.push(editor);
    }

    return editor;
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
    public _isEditor: boolean = false // Mark if this is a markdown editor panel
  ) {
    let textEditTimer: NodeJS.Timeout | void;

    // Set the webview's initial html content
    this._init();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    
    // close EditorPanel when vsc editor is close
    vscode.workspace.onDidCloseTextDocument((e) => {
      if (e.fileName === this._fsPath) {
        this.dispose();
      }
    }, this._disposables);

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
            this._update({
              type: "init",
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
            });
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
              console.error(error);
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
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    if (!this._isEditor) {
      EditorPanel.currentPanel = undefined;
    }

    // If we already have editors, show it.
    if (this._isEditor && EditorPanel.editors?.length) {
      // Remove this editor from the list of editors
      EditorPanel.editors = EditorPanel.editors.filter(
        (editor) => this._uri?.path !==  editor._uri?.path
      );
    }

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
    } = { options: void 0 }
  ) {
    const md = this._document
      ? this._document.getText()
      : (await vscode.workspace.fs.readFile(this._uri)).toString();
    // const dir = NodePath.dirname(this._document.fileName)
    this._panel.webview.postMessage({
      command: "update",
      content: md,
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
      
      // Ensure assets directory exists
      await this._ensureAssetsDirectory();
      
      const kanbanFilePath = this._getKanbanFilePath(boardId);
      const displayFilename = this._getKanbanDisplayFilename(boardId);
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`🗂️ Saving kanban board '${boardId}' to: ${kanbanFilePath}`);
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
      
      // Ensure assets directory exists
      await this._ensureAssetsDirectory();
      
      const kanbanFilePath = this._getKanbanFilePath(boardId);
      const displayFilename = this._getKanbanDisplayFilename(boardId);
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

    return `<!DOCTYPE html>
			<html lang="en" style="height: 100vh; width: 100vw; margin: 0; padding: 0; overflow: hidden;">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
				<base href="${baseHref}" />
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
        <script src="https://unpkg.com/predictionary/dist/predictionary.min.js"></script>
        <script src="https://cdn.jsdelivr.net/gh/phfsantos/kanban-board@1.1.1/dist/index.js" type="module"></script>
				${JsFiles.map((f) => `<script src="${f}"></script>`).join("\n")}
			</body>
			</html>`;
  }
}
