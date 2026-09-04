import * as vscode from "vscode";
import * as NodePath from "path";
const KeyVditorOptions = "vditor.options";
import { showError, getWebviewOptions, debug, showWarning } from "./_utils";
import { logger } from "../utils/Logger";
import { AIMarkdownWorkflowService } from "../services";
import { NativeNotificationService } from "./NativeNotificationService";
import { RendererDataStore } from "./RendererDataStore";
import { getHtmlForWebview } from "./webviewHtml";
import { CalendarMessageHandler } from "./CalendarMessageHandler";
import { DiffViewController } from "./DiffViewController";
import { AiMessageHandler } from "./AiMessageHandler";
import { EditorMessageHandlers } from "./EditorMessageHandlers";
import {
  createDocumentSyncController,
  type DocumentSyncController,
} from "./DocumentSyncController";
import { createDocumentWriteOriginTracker } from "./DocumentWriteOriginTracker";

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

  /**
   * Track ongoing diff calculations to prevent duplicate calculations
   * Map structure: tab -> Promise of ongoing calculation
   */

  /**
   * Event emitter for active document changes in custom editor
   */
  private static _onDidChangeActiveDocument = new vscode.EventEmitter<
    vscode.TextDocument | undefined
  >();
  public static readonly onDidChangeActiveDocument =
    EditorPanel._onDidChangeActiveDocument.event;

  public static readonly viewType = "markdown-editor";
  private _disposables: vscode.Disposable[] = [];
  private _isEdit = false;
  private _lastCursorPosition: {
    line: number;
    character: number;
    timestamp: number;
  } | null = null;
  private _lastWebviewEdit = 0;
  private _diffCheckTimeout: NodeJS.Timeout | undefined;
  private _webviewReady = false; // Track if webview has sent ready signal
  private _disposed = false;
  private readonly _documentSync: DocumentSyncController;
  private readonly _documentWriteOrigins = createDocumentWriteOriginTracker();
  public readonly instanceId: string; // Unique identifier for debugging webview instances
  private readonly _calendar = new CalendarMessageHandler((message) => {
    this._panel.webview.postMessage(message);
  });
  private readonly _rendererData = new RendererDataStore({
    getFsPath: () => this._fsPath,
    postMessage: (message) => {
      this._panel.webview.postMessage(message);
    },
  });
  private readonly _notifications = new NativeNotificationService(
    () => this._panel?.title || NodePath.basename(this._fsPath)
  );

  // Diff-related properties (set reactively after creation)

  /**
   * Create a new panel.
   */
  public static async createOrShow(
    context: vscode.ExtensionContext,
    docOrUri: vscode.Uri | vscode.TextDocument,
    tab?: vscode.Tab,
    webviewPanel?: vscode.WebviewPanel,
    isDiffView: boolean = false,
    readOnly?: boolean
  ) {
    logger.debug(`🔵 EditorPanel.createOrShow called:`);
    logger.debug(`[createOrShow] isDiffView: ${isDiffView}`);
    logger.debug(
      `[createOrShow] webview docOrUri: ${
        typeof docOrUri === "object"
          ? docOrUri instanceof vscode.Uri
            ? docOrUri
            : docOrUri.uri
          : "unknown"
      }`
    );

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
        if (EditorPanel.currentPanel.ai.canShowAddToChatButton()) {
          vscode.commands.executeCommand(
            "chat.inlineResourceAnchor.addFileToChat",
            EditorPanel.currentPanel._uri,
            true
          );
        }
        return;
      }
    }

    let doc: vscode.TextDocument | undefined;
    let uri: vscode.Uri | undefined;

    if (docOrUri instanceof vscode.Uri) {
      uri = docOrUri;
      logger.debug(`  Called with URI: ${uri?.toString() || "undefined"}`);

      // Try to open the document
      // Note: Virtual schemes are rejected at provider level, this should only see normal schemes
      try {
          doc = await vscode.workspace.openTextDocument(uri);
      } catch (err: unknown) {
        // Try to create the file if it doesn't exist (for normal file schemes)
        if (err instanceof Error && uri) {
          logger.warn(
            `  Failed to open document for URI ${uri.toString()}. Error: ${
              err.message
            }`
          );

          try {
            await vscode.workspace.fs.writeFile(
              vscode.Uri.file(uri.fsPath),
              new Uint8Array()
            );

            doc = await vscode.workspace.openTextDocument(uri);
          } catch (writeErr) {
            showError(
              `Could not open or create document for URI: ${uri?.toString()}`
            );
            return;
          }
        } else {
          showError(
            `Could not open or create document for URI: ${uri?.toString()}`
          );
          return;
        }
      }
    } else {
      // We were given a document directly, use it!
      doc = docOrUri;
      uri = doc.uri;

      logger.debug(
        `  Called with TextDocument: ${uri?.toString() || "undefined"}`
      );
    }

    if (!doc || !uri) {
      showError(`Cannot find or open markdown file!`);
      return;
    }

    logger.debug(`  Final URI: ${uri?.toString() || "undefined"}`);
    logger.debug(`  Final Scheme: ${uri?.scheme || "N/A"}`);
    logger.debug(`  Final Path: ${uri?.path || "N/A"}`);
    logger.debug(`  Has webviewPanel: ${!!webviewPanel}`);

    // from command mode
    const supportedLanguages = ["markdown", "chatagent", "skill", "prompt"];
    if (doc && !supportedLanguages.includes(doc.languageId)) {
      showWarning(`Current file language is not supported, got ${doc.languageId}`);
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

    // Create the editor panel with isDiffView and readOnly flags
    const editor = new EditorPanel(
      context,
      panel,
      extensionUri,
      doc,
      uri,
      !!webviewPanel,
      tab,
      isDiffView,
      readOnly
    );

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
   * Get this file path
   */
  private get _fsPath() {
    return this._uri.fsPath;
  }

  // ---- DiffHost implementation (consumed by DiffViewController) ----
  public readonly diff: DiffViewController = new DiffViewController(this);

  // ---- AiHost implementation (consumed by AiMessageHandler) ----
  public readonly ai: AiMessageHandler = new AiMessageHandler(this);

  // ---- HandlerHost implementation (consumed by EditorMessageHandlers) ----
  public readonly handlers: EditorMessageHandlers = new EditorMessageHandlers(this);

  public get context(): vscode.ExtensionContext {
    return this._context;
  }

  public get lastWebviewEdit(): number {
    return this._lastWebviewEdit;
  }

  public get lastCursorPosition():
    | { line: number; character: number; timestamp: number }
    | null {
    return this._lastCursorPosition;
  }

  public set lastCursorPosition(
    value: { line: number; character: number; timestamp: number } | null
  ) {
    this._lastCursorPosition = value;
  }

  public get config(): vscode.WorkspaceConfiguration {
    return this._config;
  }

  public get readOnly(): boolean {
    return this._readOnly ?? false;
  }

  public get isDiffView(): boolean {
    return this.diff.isDiffView;
  }

  public get pendingChatBaselineDocument(): vscode.TextDocument | undefined {
    return this.diff.pendingChatBaselineDocument;
  }

  public get uri(): vscode.Uri {
    return this._uri;
  }

  public get document(): vscode.TextDocument {
    return this._document;
  }

  public get tab(): vscode.Tab | undefined {
    return this._tab;
  }

  public get webviewReady(): boolean {
    return this._webviewReady;
  }

  public get panelVisible(): boolean {
    return this._panel?.visible ?? false;
  }

  public get panelActive(): boolean {
    return this._panel?.active ?? false;
  }

  public postInlineSuggestionEligibility(): void {
    this.ai.postInlineSuggestionEligibility();
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
    private readonly _isExplicitDiffView: boolean = false, // Explicitly marked as diff view by provider
    private readonly _readOnly?: boolean // Whether the editor is read-only
  ) {
    // Generate unique instance ID for debugging
    this.instanceId = `${NodePath.basename(
      this._fsPath
    )}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.debug(`🆔 Created EditorPanel instance: ${this.instanceId}`);

    this._documentSync = createDocumentSyncController({
      applyContent: async (content) => {
        const pendingWrite = this._documentWriteOrigins.expect(content);
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          this._document.uri,
          new vscode.Range(0, 0, this._document.lineCount, 0),
          content,
        );
        try {
          const applied = await vscode.workspace.applyEdit(edit);
          if (!applied) {
            throw new Error("VS Code rejected the synchronized Markdown edit");
          }
          this._updateEditTitle();
        } finally {
          this._documentWriteOrigins.cancel(pendingWrite);
        }
      },
      saveDocument: async () => {
        return this._document.save();
      },
    });

    this.diff.refreshPendingChatEditState();

    let textEditTimer: NodeJS.Timeout | void;

    // Set the webview's initial html content
    this._init();

    if (this._isExplicitDiffView && this._tab?.label) {
      const showModifications =
        this._document.uri.scheme === "showModifications";
      this.diff.registerExplicitDiffPanel(showModifications);
    }

    // DEFERRED DIFF DETECTION: Check for diff context after a short delay
    // This allows tabGroups to be populated with the new tab
    setTimeout(() => {
      if (!this._panel || this._panel.visible === false) {
        logger.debug(
          `[${this.instanceId}] ⏰ Deferred diff check skipped - panel not visible`
        );
        return;
      }
      logger.debug(
        `[${this.instanceId}] ⏰ Running deferred diff context check...`
      );
      void this.diff.checkDiffViewContextReactive();
    }, 200); // 200ms delay to allow tab creation

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programmatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Listen for panel view state changes (when panel becomes active/inactive)
    this._panel.onDidChangeViewState(
      (e) => {
        logger.debug(`[${this.instanceId}] 👁️  View state changed:`, {
          active: e.webviewPanel.active,
          visible: e.webviewPanel.visible,
          diffApplied: this.diff.diffApplied,
          lastCheckVisible: this.diff.lastDiffCheckVisible,
        });

        if (e.webviewPanel.active) {
          // Fire event when this custom editor becomes active
          logger.debug(
            `[${this.instanceId}] Panel is now ACTIVE, firing document change event`
          );
          EditorPanel._onDidChangeActiveDocument.fire(this._document);

          // CRITICAL: When panel becomes active, ALWAYS re-check diff context
          // This handles switching from individual tab → diff tab
          logger.debug(
            `[${this.instanceId}] 🔍 DIFF-DEBUG: Panel became active, re-checking diff context...`
          );
          this.diff.lastDiffCheckVisible = false; // Reset to allow re-check
          void this.diff.checkDiffViewContextReactive();
          this.diff.lastDiffCheckVisible = true;
        } else if (e.webviewPanel.visible && !this.diff.lastDiffCheckVisible) {
          // Panel visible but not active - only check if we haven't already
          logger.debug(
            `[${this.instanceId}] 🔍 DIFF-DEBUG: Panel visible (not active), checking diff context...`
          );
          void this.diff.checkDiffViewContextReactive();
          this.diff.lastDiffCheckVisible = true;
        } else if (!e.webviewPanel.visible) {
          // Panel no longer visible - reset BOTH flags so we check again when it becomes visible
          logger.debug(
            `[${this.instanceId}] Panel became INVISIBLE, resetting diff state`
          );
          this.diff.lastDiffCheckVisible = false;
          this.diff.diffApplied = false; // CRITICAL: Reset so diff can be re-evaluated when visible again
        }
      },
      null,
      this._disposables
    );

    // Fire initial event if this panel is currently active
    if (this._panel.active) {
      logger.debug(
        "Sidebar: EditorPanel created and is active, firing initial document change event"
      );
      EditorPanel._onDidChangeActiveDocument.fire(this._document);
    }

    // Listen for diagnostic changes and send to webview
    vscode.languages.onDidChangeDiagnostics((e) => {
      if (
        e.uris.some((uri) => uri.toString() === this._document.uri.toString())
      ) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `Diagnostics changed for document, updating webview`
          );
        }
        this._updateDiagnostics();
      }
    }, this._disposables);

    // update EditorPanel when vsc editor changes
    vscode.workspace.onDidChangeTextDocument((e) => {
      const isPrimaryDocument = e.document.fileName === this._document.fileName;
      const isRelevantChatEditingDocument =
        !isPrimaryDocument && this.diff.isRelevantChatEditingDocument(e.document);

      if (!isPrimaryDocument && !isRelevantChatEditingDocument) {
        return;
      }

      if (isRelevantChatEditingDocument) {
        this.diff.refreshPendingChatEditState();
        void this.diff.applyPendingChatDiffVisualization();
        return;
      }

      const isSynchronizedChange = this._documentWriteOrigins.consume(
        e.document.getText(),
      );
      const isExternalChange = !isSynchronizedChange;

      if ((global as any).markdownEditorLog) {
        const changeInfo = {
          changes: e.contentChanges.length,
          reason: e.reason,
          panelActive: this._panel.active,
          isExternal: isExternalChange,
          changeTypes: e.contentChanges.map((c) => ({
            rangeLength: c.rangeLength,
            textLength: c.text.length,
            range: `${c.range.start.line}:${c.range.start.character}-${c.range.end.line}:${c.range.end.character}`,
          })),
        };
        (global as any).markdownEditorLog(
          `Document change detected: ${JSON.stringify(changeInfo)}`
        );
      }

      // changes length
      if (e.contentChanges.length > 0) {
        this.diff.diffApplied = false;
        this.diff.singleViewDiffApplied = false;
      }

      // Handle external changes (like quick fixes, spell corrections) immediately
      if (isExternalChange) {
        this._documentSync.acceptExternalContent(e.document.getText());
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `🔄 EXTERNAL CHANGE DETECTED - Updating webview immediately`
          );
          (global as any).markdownEditorLog(
            `   • Source: VS Code panels (quick fix, spell checker, etc.)`
          );
          (global as any).markdownEditorLog(
            `   • Changes: ${e.contentChanges.length} modifications`
          );
          (global as any).markdownEditorLog(
            `   • Force updating webview content now`
          );
        }
        if (textEditTimer) {
          clearTimeout(textEditTimer);
        }

        // Force update the webview immediately for external changes
        this._update({ type: "update" });
        this._updateDiagnostics();

        // If this is a diff view instance, also recalculate diff
        if (this.diff.isDiffView && this.diff.otherDiffUri) {
          void this.diff.updateDiffVisualization();
        } else {
          void this.diff.applyPendingChatDiffVisualization();
        }
        return;
      }

      // 当 webview panel 激活时不将由 webview编辑导致的 vsc 编辑器更新同步回 webview
      // don't change webview panel when webview panel is focus
      if (this._panel.active) {
        // Update visualization or other UI elements if needed
        this._updateDiagnostics();

        // If this is a diff view instance, also recalculate diff
        if (this.diff.isDiffView && this.diff.otherDiffUri) {
          void this.diff.updateDiffVisualization();
        } else {
          void this.diff.applyPendingChatDiffVisualization();
        }

        return;
      }
      textEditTimer && clearTimeout(textEditTimer);
      textEditTimer = setTimeout(() => {
        this._update();
        this._updateEditTitle();

        // If this is a diff view instance, also recalculate diff
        if (this.diff.isDiffView && this.diff.otherDiffUri) {
          void this.diff.updateDiffVisualization();
        } else {
          void this.diff.applyPendingChatDiffVisualization();
        }
      }, 300);
    }, this._disposables);

    // Listen for configuration changes that might affect external change behavior
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("markdown-editor")) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            "Configuration changed, updating webview"
          );
        }
        this._update();
      }
    }, this._disposables);

    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!this.diff.isRelevantChatEditingDocument(document)) {
        return;
      }

      this.diff.refreshPendingChatEditState();
      void this.diff.applyPendingChatDiffVisualization();
    }, this._disposables);

    vscode.workspace.onDidCloseTextDocument((document) => {
      if (!this.diff.isRelevantChatEditingDocument(document)) {
        return;
      }

      this.diff.refreshPendingChatEditState();
      void this.diff.applyPendingChatDiffVisualization();
    }, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        debug("msg from webview review", message, this._panel.active);

        switch (message.command) {
          case "ready": {
            // Mark webview as ready
            this._webviewReady = true;
            logger.debug(`[${this.instanceId}] 📥 Webview ready signal received`);
            
            // REACTIVE DIFF CHECK: When webview is ready, check if we're in a diff view
            // This is a good time because the tab should be created by now
            void this.diff.checkDiffViewContextReactive();

            // Generate CDN base URI for Vditor to locate assets
            // Points to media/dist directory where all Vditor assets are bundled
            const mediaUri = this._panel.webview.asWebviewUri(
              vscode.Uri.joinPath(this._extensionUri, "out", "media")
            );
            const cdnBaseUri = mediaUri.toString();

            this._update({
              type: "init",
              documentPath: this._uri?.fsPath || "untitled",
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
              isReadOnly: this._readOnly || false, // Pass readOnly flag to webview
            });
            break;
          }
          case "vditorReady":
            // Vditor has initialized/reloaded - notify sidebar via document change event
            if (this._document) {
              logger.debug(
                "[EditorPanel] Vditor ready - emitting document change for sidebar update"
              );
              EditorPanel._onDidChangeActiveDocument.fire(this._document);
            }

            void this.diff.applyPendingChatDiffVisualization();
            this.ai.postInlineSuggestionEligibility();
            break;
          case "save-options":
            this._context.globalState.update(KeyVditorOptions, message.options);
            break;
          case "info":
            vscode.window.showInformationMessage(message.content);
            break;
          case "widget-notification":
            // Handle widget notifications with native OS notifications when possible.
            await this._notifications.handleWidgetNotification(message);
            break;
          case "widget-action":
            // Handle widget action events (button clicks, form submissions, etc.)
            await this.handlers.handleWidgetAction(message);
            break;
          case "error":
            showError(message.content);
            break;
          case "edit": {
            const accepted = this._documentSync.acceptEdit(message);
            if (accepted) {
              // Only accepted revisions should affect external-change classification.
              this._lastWebviewEdit = Date.now();
            }
            break;
          }
          case "requestInlineSuggestion": {
            await this.ai.handleInlineSuggestionRequest(message);
            break;
          }
          case "requestAddToChat": {
            await this.ai.handleAddToChatRequest();
            break;
          }
          case "diff-scroll-sync": {
            // Handle scroll synchronization in diff view

            if (this._uri && this.diff.otherDiffUri) {
              const diffSupport = (global as any).markdownDiffViewSupport;

              if (diffSupport) {
                // Pass instance ID to help identify source editor when URIs are identical
                diffSupport.handleScrollSync(
                  this.instanceId,
                  this._uri,
                  this.diff.otherDiffUri,
                  message.scrollPercentage
                );
              } else {
                logger.warn(
                  "⚠️ EDITOR PANEL: markdownDiffViewSupport not found on global"
                );
              }
            } else {
              logger.warn(
                "⚠️ EDITOR PANEL: No _uri or _otherDiffUri for scroll sync"
              );
            }
            break;
          }
          case "reset-config": {
            await this._context.globalState.update(KeyVditorOptions, {});
            break;
          }
          case "save": {
            const saved = await this._documentSync.save(message);
            if (!saved) {
              showError("Could not apply and save the latest Markdown revision.");
            } else {
              this._updateEditTitle();
            }
            break;
          }
          case "requestEmbed": {
            // User clicked preview button in webview - resolve the filename to a full path and open embed
            try {
              await this.handlers.handleRequestEmbed(message);
            } catch (err) {
              logger.error("EditorPanel: requestEmbed failed", err);
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
              logger.error("Failed to create image folder:", error);
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
          case "requestAiAction": {
            await this.ai.handleAIMarkdownAction(message);
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
            await this.handlers.handleContextMenuRequest(message);
            break;
          }
          case "requestQuickFix": {
            // Handle quick fix requests from webview
            await this.handlers.handleQuickFixRequest(message);
            break;
          }
          case "clipboardWrite": {
            // Handle clipboard write requests from webview
            await this.handlers.handleClipboardWrite(message);
            break;
          }
          case "clipboardRead": {
            // Handle clipboard read requests from webview
            await this.handlers.handleClipboardRead(message);
            break;
          }
          case "clipboardWriteRequest": {
            await this.handlers.handleClipboardWrite({ text: message.text, requestId: message.requestId });
            break;
          }
          case "clipboardReadRequest": {
            await this.handlers.handleClipboardRead({ requestId: message.requestId });
            break;
          }
          case "cursorPosition": {
            // Handle cursor position updates from webview
            await this.handlers.handleCursorPositionUpdate(message);
            break;
          }
          case "triggerQuickFix": {
            // Handle quick fix trigger requests from webview
            await this.handlers.handleTriggerQuickFix(message);
            break;
          }
          case "selectAll": {
            // Handle select all command
            await this.handlers.handleSelectAll();
            break;
          }
          case "formatDocument": {
            // Handle format document command
            await this.handlers.handleFormatDocument();
            break;
          }
          case "formatSelection": {
            // Handle format selection command
            await this.handlers.handleFormatSelection();
            break;
          }
          case "showProblems": {
            // Handle show problems command
            await this.handlers.handleShowProblems();
            break;
          }
          case "openProblemsPanel": {
            // Handle open problems panel command (from lightbulb clicks)
            await this.handlers.handleOpenProblemsPanel();
            break;
          }
          case "find": {
            // Handle find command
            await this.handlers.handleFind();
            break;
          }
          case "findAndReplace": {
            // Handle find and replace command
            await this.handlers.handleFindAndReplace();
            break;
          }
          case "insertLink": {
            // Handle insert link command
            await this.handlers.handleInsertLink();
            break;
          }
          case "insertImage": {
            // Handle insert image command
            await this.handlers.handleInsertImage();
            break;
          }
          case "insertTable": {
            // Handle insert table command
            await this.handlers.handleInsertTable();
            break;
          }
          case "showCommandPalette": {
            // Handle show command palette command
            await this.handlers.handleShowCommandPalette();
            break;
          }
          case "toggleWordWrap": {
            // Handle toggle word wrap command
            await this.handlers.handleToggleWordWrap();
            break;
          }
          case "shareMarkdown": {
            // Handle share markdown command
            await this.handlers.handleShareMarkdown(message);
            break;
          }
          case "shareHtml": {
            // Handle share html command
            await this.handlers.handleShareHtml(message);
            break;
          }
          case "openWithTextEditor": {
            await this.handlers.handleOpenWithTextEditor();
            break;
          }
          case "insertChartWidget":
          case "insertTableWidget":
          case "insertKanbanWidget":
          case "insertFormWidget":
          case "insertMapWidget": {
            // Handle widget insert commands from context menu
            // Map command to template type: insertChartWidget -> chart, insertKanbanWidget -> kanban
            const commandName = message.command;
            const widgetType = commandName
              .replace('insert', '')
              .replace('Widget', '')
              .toLowerCase();
            await vscode.commands.executeCommand(`markdown-editor.insert${widgetType}Widget`);
            break;
          }
          case "kanban-save-data": {
            // Handle kanban data save
            await this._rendererData.handleKanbanSaveData(message);
            break;
          }
          case "kanban-load-data": {
            // Handle kanban data load
            await this._rendererData.handleKanbanLoadData(message);
            break;
          }
          case "kanban-migrate-data": {
            // Handle kanban data migration
            await this._rendererData.handleKanbanMigrateData(message);
            break;
          }
          case "renderer-load-data": {
            // Generic renderer data load
            await this._rendererData.handleRendererLoadData(message);
            break;
          }
          case "renderer-save-data": {
            // Generic renderer data save
            await this._rendererData.handleRendererSaveData(message);
            break;
          }
          case "renderer-check-data": {
            // Generic renderer data check
            await this._rendererData.handleRendererCheckData(message);
            break;
          }
          case "requestInsertRenderer": {
            // Handle insert custom renderer request from webview
            await this._rendererData.handleInsertRenderer(message);
            break;
          }
          case "requestWorkspaceFiles": {
            // Handle wiki-link autocomplete workspace files request
            await this._rendererData.handleRequestWorkspaceFiles(message);
            break;
          }
          case "requestRelatedFiles": {
            // Handle wiki-link autocomplete related files request
            await this._rendererData.handleRequestRelatedFiles(message);
            break;
          }
          case "resolveWikiLink": {
            // Handle wiki-link path resolution request
            await this.handlers.handleResolveWikiLink(message);
            break;
          }
          case "navigateToWikiLink": {
            // Handle wiki-link navigation request
            await this.handlers.handleNavigateToWikiLink(message);
            break;
          }
          case "openFile": {
            // Handle file open request from webview (wiki-links, embeds, etc.)
            await this.handlers.handleOpenFile(message);
            break;
          }
          case "calendar-auth": {
            // Handle calendar authentication requests
            await this._calendar.handleCalendarAuth(message);
            break;
          }
          case "calendar-request": {
            // Handle calendar events request
            await this._calendar.handleCalendarRequest(message);
            break;
          }
          case "calendar-signout": {
            // Handle calendar sign out
            await this._calendar.handleCalendarSignOut(message);
            break;
          }
          case "openNativeToolSelector": {
            await this.ai.handleNativeToolSelector(message.selectedTools ?? []);
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
        type: "diff-scroll-sync",
        scrollPercentage: scrollPercentage,
      });
    }
  }

  /**
   * Navigate to a heading in the document
   */
  public navigateToHeading(heading: string): void {
    if (this._panel && this._panel.webview) {
      this._panel.webview.postMessage({
        command: "navigateToHeading",
        heading: heading,
      });
      logger.debug(
        `EditorPanel: Sent navigateToHeading message for: ${heading}`
      );
    }
  }

  /**
   * Post a message to the webview
   */
  public postMessage(message: any): void {
    if (this._panel && this._panel.webview) {
      this._panel.webview.postMessage(message);
    }
  }

  public dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    this._documentSync.dispose();

    logger.debug("Sidebar: EditorPanel being disposed");

    // Clear any pending diff check timeouts to prevent "Webview is disposed" errors
    if (this._diffCheckTimeout) {
      clearTimeout(this._diffCheckTimeout);
      this._diffCheckTimeout = undefined;
    }

    // Diff timers and tab tracking are owned by the controller
    this.diff.dispose();

    if (!this._isEditor) {
      EditorPanel.currentPanel = undefined;
    }

    // If we already have editors, show it.
    if (this._isEditor && EditorPanel.editors?.length) {
      // Remove this editor from the list of editors
      EditorPanel.editors = EditorPanel.editors.filter(
        (editor) => this.instanceId !== editor.instanceId
      );
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

    this._panel.webview.html = getHtmlForWebview(webview, {
      extensionUri: this._extensionUri,
      config: this._config,
      fsPath: this._fsPath,
    });
    this._panel.title = NodePath.basename(this._fsPath);

    // Send initial diagnostics to webview immediately after init
    setTimeout(() => {
      this._updateDiagnostics();
    }, 100); // Very short delay - diagnostics at first opportunity
  }

  /**
   * Request IR HTML content from a webview panel
   * Returns a promise that resolves when the webview responds
   */
  public async requestIRHtml(): Promise<string | null> {
    const requestId = `html-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Check if panel is ready
    if (!this._panel || !this._panel.webview) {
      logger.error(`[${this.instanceId}] Panel or webview not available for HTML request`);
      return null;
    }
    
    // Check if webview has signaled it's ready
    if (!this._webviewReady) {
      logger.warn(`[${this.instanceId}] Webview not ready yet for panel ${this.instanceId}, waiting...`);
      // Wait up to 2 seconds for webview to become ready
      let attempts = 0;
      while (!this._webviewReady && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      if (!this._webviewReady) {
        logger.error(`[${this.instanceId}] Webview still not ready after 2s for panel ${this.instanceId}`);
        return null;
      }
    }
    
    logger.debug(`[${this.instanceId}] Requesting HTML from panel ${this.instanceId} with requestId ${requestId}`);
    
    return new Promise((resolve) => {
      let resolved = false;
      
      // Set up one-time message listener for the response
      const listener = (message: any) => {
        if (message.command === 'irHtmlResponse' && message.requestId === requestId) {
          if (resolved) return; // Prevent double resolution
          resolved = true;
          
          logger.debug(`[${this.instanceId}] Received HTML response from panel ${this.instanceId}`);
          
          // Clean up listener
          disposable.dispose();
          
          if (message.error) {
            logger.error(`[${this.instanceId}] Error getting IR HTML from panel ${this.instanceId}: ${message.error}`);
            resolve(null);
          } else if (message.html == null) {
            logger.error(`[${this.instanceId}] No HTML content in response from panel ${this.instanceId}`);
            resolve(null);
          } else {
            logger.debug(`[${this.instanceId}] Successfully received ${message.html.length} characters of HTML from panel ${this.instanceId}`);
            resolve(message.html);
          }
        }
      };
      
      // IMPORTANT: Listen on the TARGET panel's webview, not this panel's
      const disposable = this._panel.webview.onDidReceiveMessage(listener, null, this._disposables);
      
      // Send request to webview
      this._panel.webview.postMessage({
        command: 'requestIRHtml',
        requestId: requestId
      });
      
      logger.debug(`[${this.instanceId}] Sent HTML request to panel ${this.instanceId}`);
      
      // Timeout after 5 seconds (increased from 3 for more reliable response)
      setTimeout(() => {
        if (resolved) return;
        disposable.dispose();
        resolved = true;
        logger.warn(`[${this.instanceId}] Timeout waiting for IR HTML response from panel ${this.instanceId}`);
        resolve(null);
      }, 5000);
    });
  }

  public async requestRenderedMarkdownHtml(
    markdown: string
  ): Promise<string | null> {
    const requestId = `rendered-html-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    if (!this._panel || !this._panel.webview) {
      logger.error(
        `[${this.instanceId}] Panel or webview not available for rendered HTML request`
      );
      return null;
    }

    if (!this._webviewReady) {
      logger.warn(
        `[${this.instanceId}] Webview not ready yet for rendered HTML request on panel ${this.instanceId}, waiting...`
      );
      let attempts = 0;
      while (!this._webviewReady && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
      if (!this._webviewReady) {
        logger.error(
          `[${this.instanceId}] Webview still not ready after 2s for rendered HTML request on panel ${this.instanceId}`
        );
        return null;
      }
    }

    return new Promise(resolve => {
      let resolved = false;

      const listener = (message: any) => {
        if (
          message.command === 'renderedMarkdownHtmlResponse' &&
          message.requestId === requestId
        ) {
          if (resolved) {
            return;
          }
          resolved = true;
          disposable.dispose();

          if (message.error) {
            logger.error(
              `[${this.instanceId}] Error getting rendered markdown HTML from panel ${this.instanceId}: ${message.error}`
            );
            resolve(null);
            return;
          }

          if (message.html == null) {
            logger.error(
              `[${this.instanceId}] No rendered HTML content in response from panel ${this.instanceId}`
            );
            resolve(null);
            return;
          }

          resolve(message.html);
        }
      };

      const disposable = this._panel.webview.onDidReceiveMessage(
        listener,
        null,
        this._disposables
      );

      this._panel.webview.postMessage({
        command: 'requestRenderedMarkdownHtml',
        requestId,
        markdown,
        documentFilename: this._document.fileName,
      });

      setTimeout(() => {
        if (resolved) {
          return;
        }
        disposable.dispose();
        resolved = true;
        logger.warn(
          `[${this.instanceId}] Timeout waiting for rendered markdown HTML response from panel ${this.instanceId}`
        );
        resolve(null);
      }, 5000);
    });
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
    let diffData:
      | { originalContent: string; modifiedContent: string; changes?: any[] }
      | undefined;

    logger.debug(`[_update] Updating webview content for: ${this._fsPath}`);
    logger.debug(`[_update] scheme: ${this._uri.scheme}`);

    // Get current document content
    const md: string = this._document
      ? this._document.getText()
      : (await vscode.workspace.fs.readFile(this._uri)).toString();

    // Get the actual document filename for renderer file naming
    const documentFilename = this._document
      ? NodePath.basename(
          this._document.fileName,
          NodePath.extname(this._document.fileName)
        )
      : NodePath.basename(this._fsPath, NodePath.extname(this._fsPath));

    // Get the full document path for wiki-link autocomplete
    const documentPath = this._uri?.fsPath || "untitled";
    const aiWorkflowService = AIMarkdownWorkflowService.getInstance();
    const aiMarkdown = aiWorkflowService.describeDocument(this._document, {
      hasPendingChatEdits: Boolean(this.diff.pendingChatBaselineDocument),
    });

    // const dir = NodePath.dirname(this._document.fileName)
    this._panel.webview.postMessage({
      command: "update",
      content: md,
      documentFilename: documentFilename, // Add document filename for renderer system
      documentPath: documentPath, // Add document path for wiki-link autocomplete
      diffData: diffData, // Send diff data if available (for Compare with Saved)
      isDiffView: this._isExplicitDiffView || this.diff.isDiffView, // Flag to indicate diff mode
      aiMarkdown,
      chatAnchor: {
        visible: this.ai.canShowAddToChatButton(),
        relativePath: aiMarkdown.relativePath,
      },
      inlineSuggestion: {
        enabled: this.ai.canShowInlineSuggestions(),
        languageId: this.ai.getInlineSuggestionLanguageId(),
      },
      ...props,
      generation: this._documentSync.getGeneration(),
    });
  }


  /**
   * Update diagnostics in the webview
   */
  private _updateDiagnostics(): void {
    const diagnostics = vscode.languages.getDiagnostics(this._document.uri);

    // Get the document text to provide context for line mapping
    const documentText = this._document.getText();
    const lines = documentText.split("\n");

    // Convert VS Code diagnostics to a format the webview can understand
    const serializedDiagnostics = diagnostics.map((diagnostic, index) => {
      const lineText = lines[diagnostic.range.start.line] || "";

      return {
        message: diagnostic.message,
        severity: diagnostic.severity,
        range: {
          start: {
            line: diagnostic.range.start.line,
            character: diagnostic.range.start.character,
          },
          end: {
            line: diagnostic.range.end.line,
            character: diagnostic.range.end.character,
          },
        },
        source: diagnostic.source,
        code: diagnostic.code,
        lineText: lineText, // Add the actual line text for better matching
        relatedInformation: diagnostic.relatedInformation?.map((info) => ({
          message: info.message,
          location: {
            uri: info.location.uri.toString(),
            range: info.location.range,
          },
        })),
      };
    });

    // Send diagnostics to webview

    this._panel.webview.postMessage({
      command: "diagnostics",
      diagnostics: serializedDiagnostics,
      documentText: documentText, // Send full document text for line mapping
      documentLines: lines.length,
    });

    // Also log to VS Code output channel
    const logMessage = `Diagnostics sent to webview: ${serializedDiagnostics.length} items`;
    if ((global as any).markdownEditorLog) {
      (global as any).markdownEditorLog(logMessage);
      serializedDiagnostics.forEach((diag, i) => {
        (global as any).markdownEditorLog(
          `  ${i + 1}. [${diag.source}] Line ${diag.range.start.line}: ${
            diag.message
          }`
        );
      });
    }
  }





























}
