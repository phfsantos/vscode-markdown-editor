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
            } else {
              // Fallback to console if global logging not available
              console.log(`MD Editor: ${webviewMessage}`);
            }
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
    
    console.log(`EditorPanel: Found ${diagnostics.length} diagnostics for ${this._document.uri.toString()}`);
    
    // Get the document text to provide context for line mapping
    const documentText = this._document.getText();
    const lines = documentText.split('\n');
    
    // Convert VS Code diagnostics to a format the webview can understand
    const serializedDiagnostics = diagnostics.map((diagnostic, index) => {
      const lineText = lines[diagnostic.range.start.line] || '';
      
      // Enhanced logging for each diagnostic
      console.log(`EditorPanel: Diagnostic ${index}:`, {
        message: diagnostic.message,
        source: diagnostic.source,
        severity: diagnostic.severity,
        range: diagnostic.range,
        lineText: lineText,
        relatedInformation: diagnostic.relatedInformation?.length || 0
      });
      
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

    console.log('EditorPanel: Sending diagnostics to webview:', {
      count: serializedDiagnostics.length,
      diagnostics: serializedDiagnostics,
      documentLines: lines.length
    });

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
    
    // Heuristics for detecting external changes
    for (const change of e.contentChanges) {
      // Large replacements often indicate external modifications
      if (change.rangeLength > 50 && change.text.length > 50) {
        return true;
      }
      
      // Multiple line changes when panel is not active
      if (!this._panel.active && change.range.end.line - change.range.start.line > 2) {
        return true;
      }
      
      // Specific patterns that suggest external tools
      const text = change.text.toLowerCase();
      if (text.includes('markdownlint') || 
          text.includes('spell') || 
          text.includes('quickfix') ||
          change.text.match(/^[\w\s]+$/)) { // Simple word replacements (spell fixes)
        return true;
      }
      
      // Changes when webview is not focused
      if (!this._panel.active && change.text.trim() !== '') {
        return true;
      }
    }
    
    return false;
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
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<base href="${baseHref}" />


				${CssFiles.map((f) => `<link href="${f}" rel="stylesheet">`).join("\n")}

				<title>markdown editor</title>
				<style>` + this._config.get<string>('customCss') + `</style>
			</head>
			<body>
				<div id="app"></div>

        <script src="https://unpkg.com/predictionary/dist/predictionary.min.js"></script>
        <script src="https://cdn.jsdelivr.net/gh/phfsantos/kanban-board@1.1.1/dist/index.js" type="module"></script>
				${JsFiles.map((f) => `<script src="${f}"></script>`).join("\n")}
			</body>
			</html>`;
  }
}
