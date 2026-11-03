import * as vscode from "vscode";
import * as NodePath from "path";
import { logger } from "../utils/Logger";
import { showError, debug } from "./_utils";
import type { EditorNavigationPreviewPort } from "../contracts/ports";
import { parseMarkdownPositionLink } from "../navigation/MarkdownLinkTarget";
import type { WebviewMessage, WebviewMessageRoutes } from "./webviewMessageRouter";
import {
  authorizeWidgetCommand,
  createVscodeWidgetCommandPolicyPorts,
  type WidgetCommandPolicyPorts,
} from "./widgetCommandPolicy";

const KeyVditorOptions = "vditor.options";

/**
 * The slice of an editor panel the general webview-command handlers need.
 * EditorPanel implements this. lastCursorPosition is owned by EditorPanel
 * (its external-change heuristics also read it); handlers update it through
 * this accessor.
 */
export interface HandlerHost {
  readonly document: vscode.TextDocument;
  readonly uri: vscode.Uri;
  readonly context: vscode.ExtensionContext;
  readonly config: vscode.WorkspaceConfiguration;
  lastCursorPosition:
    | { line: number; character: number; timestamp: number }
    | null;
  postMessage(message: unknown): void;
  readonly editorNavigation?: EditorNavigationPreviewPort;
}

/**
 * Webview command handlers that don't belong to a dedicated controller:
 * embeds, context menu, quick fixes, clipboard, cursor tracking, formatting,
 * find/replace, insertions, sharing, word wrap, wiki links, and file opening.
 *
 * Extracted from EditorPanel.
 */
export class EditorMessageHandlers {
  constructor(
    private readonly host: HandlerHost,
    private readonly commandPolicy: WidgetCommandPolicyPorts = createVscodeWidgetCommandPolicyPorts(),
  ) {}

  /** Native editor, link, and editor-option commands owned by these handlers. */
  public routes(): WebviewMessageRoutes {
    return {
      // Host notices and logging.
      info: (message) => { void vscode.window.showInformationMessage(message.content); },
      error: (message) => showError(message.content),
      log: (message) => logger.debug(`[Webview] ${message.message}`),

      // Editor options persisted in global state.
      "save-options": (message) => this.host.context.globalState.update(KeyVditorOptions, message.options),
      "reset-config": () => this.host.context.globalState.update(KeyVditorOptions, {}),

      // Assets, links, and embeds.
      upload: (message) => this.handleUpload(message),
      "open-link": (message) => this.handleOpenLink(message),
      requestEmbed: async (message) => {
        // User clicked preview button in webview - resolve the filename to a full path and open embed
        try {
          await this.handleRequestEmbed(message);
        } catch (err) {
          logger.error("EditorPanel: requestEmbed failed", err);
        }
      },
      resolveWikiLink: (message) => this.handleResolveWikiLink(message),
      navigateToWikiLink: (message) => this.handleNavigateToWikiLink(message),
      openFile: (message) => this.handleOpenFile(message),

      // Native VS Code integration.
      requestContextMenu: (message) => this.handleContextMenuRequest(message),
      requestQuickFix: (message) => this.handleQuickFixRequest(message),
      triggerQuickFix: (message) => this.handleTriggerQuickFix(message),
      cursorPosition: (message) => this.handleCursorPositionUpdate(message),
      clipboardWrite: (message) => this.handleClipboardWrite(message),
      clipboardRead: (message) => this.handleClipboardRead(message),
      clipboardWriteRequest: (message) => this.handleClipboardWrite(message),
      clipboardReadRequest: (message) => this.handleClipboardRead(message),
      selectAll: () => this.handleSelectAll(),
      formatDocument: () => this.handleFormatDocument(),
      formatSelection: () => this.handleFormatSelection(),
      showProblems: () => this.handleShowProblems(),
      openProblemsPanel: () => this.handleOpenProblemsPanel(),
      find: () => this.handleFind(),
      findAndReplace: () => this.handleFindAndReplace(),
      insertLink: () => this.handleInsertLink(),
      insertImage: () => this.handleInsertImage(),
      insertTable: () => this.handleInsertTable(),
      showCommandPalette: () => this.handleShowCommandPalette(),
      toggleWordWrap: () => this.handleToggleWordWrap(),
      shareMarkdown: (message) => this.handleShareMarkdown(message),
      shareHtml: (message) => this.handleShareHtml(message),
      openWithTextEditor: () => this.handleOpenWithTextEditor(),

      // Widgets.
      "widget-action": (message) => this.handleWidgetAction(message),
      insertChartWidget: () => this.handleInsertWidget("chart"),
      insertTableWidget: () => this.handleInsertWidget("table"),
      insertKanbanWidget: () => this.handleInsertWidget("kanban"),
      insertFormWidget: () => this.handleInsertWidget("form"),
      insertMapWidget: () => this.handleInsertWidget("map"),
    };
  }

  /** Context-menu widget insertions run the matching registered widget command. */
  public async handleInsertWidget(widgetType: "chart" | "table" | "kanban" | "form" | "map"): Promise<void> {
    await vscode.commands.executeCommand(`markdown-editor.insert${widgetType}Widget`);
  }

  /**
   * Save pasted or dropped files into the configured asset folder and tell the
   * webview the document-relative paths to insert.
   */
  public async handleUpload(message: WebviewMessage<"upload">): Promise<void> {
    const fsPath = this.host.uri.fsPath;
    const imageSaveFolder = (this.host.config.get<string>("imageSaveFolder") || "assets")
      .replace(
        "${projectRoot}",
        vscode.workspace.getWorkspaceFolder(this.host.uri)?.uri.fsPath || ""
      )
      .replace("${file}", fsPath)
      .replace(
        "${fileBasenameNoExtension}",
        NodePath.basename(fsPath, NodePath.extname(fsPath))
      )
      .replace("${dir}", NodePath.dirname(fsPath));
    const assetsFolder = NodePath.resolve(NodePath.dirname(fsPath), imageSaveFolder);
    try {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(assetsFolder));
    } catch (error) {
      logger.error("Failed to create image folder:", error);
      showError(`Invalid image folder: ${assetsFolder}`);
    }
    await Promise.all(
      message.files.map(async (file) => {
        const content = Buffer.from(file.base64, "base64");
        return vscode.workspace.fs.writeFile(
          vscode.Uri.file(NodePath.join(assetsFolder, file.name)),
          content
        );
      })
    );
    const files = message.files.map((file) =>
      NodePath.relative(
        NodePath.dirname(fsPath),
        NodePath.join(assetsFolder, file.name)
      ).replace(/\\/g, "/")
    );
    this.host.postMessage({
      command: "uploaded",
      files,
    });
  }

  public async handleOpenLink(message: { href?: unknown }): Promise<void> {
    if (typeof message.href !== "string" || message.href.length === 0) return;
    const positioned = parseMarkdownPositionLink(message.href, this.host.uri);
    if (positioned && this.host.editorNavigation) {
      await this.host.editorNavigation.openEditor(positioned.uri, {
        navigationTarget: positioned.target,
      });
      return;
    }

    let url = message.href;
    if (!/^http/.test(url)) {
      url = NodePath.resolve(this.host.uri.fsPath, "..", url);
    }
    if (url.endsWith(".md") || url.endsWith(".markdown")) {
      if (this.host.editorNavigation) {
        await this.host.editorNavigation.openEditor(vscode.Uri.parse(url));
      } else {
        await vscode.commands.executeCommand("markdown-editor.openEditor", vscode.Uri.parse(url));
      }
      return;
    }
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(url));
  }

  /**
   * Handle a request from the webview to preview an embed originating from a wiki-link
   * The webview sends { command: 'requestEmbed', filename, currentDocument }
   */
  public async handleRequestEmbed(message: WebviewMessage<"requestEmbed">): Promise<void> {
    const { filename } = message;
    if (!filename) return;

    try {
      // Resolve the filename to an absolute path using LinkResolver
      const LinkResolver = (await import("../services/LinkResolver"))
        .LinkResolver;
      const resolver = LinkResolver.getInstance();
      const currentUri = this.host.uri;
      if (!currentUri) return;

      const target = await resolver.resolveWikiLink(filename, currentUri);
      if (target) {
        // Read the file and prepare embed data
        const fileUri = vscode.Uri.file(target.fsPath);
        const fileName = NodePath.basename(target.fsPath);
        const ext = NodePath.extname(target.fsPath).toLowerCase();

        // Determine mime type
        const mimeTypes: { [key: string]: string } = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".gif": "image/gif",
          ".svg": "image/svg+xml",
          ".md": "text/markdown",
          ".txt": "text/plain",
          ".json": "application/json",
        };
        const mimeType = mimeTypes[ext] || "application/octet-stream";

        const embedData: any = {
          fileName: fileName,
          path: target.fsPath,
          mimeType: mimeType,
        };

        try {
          const fileContent = await vscode.workspace.fs.readFile(fileUri);
          const fileSizeKB = fileContent.byteLength / 1024;

          // For small text files, include the text content
          if (mimeType.startsWith("text/") && fileSizeKB < 500) {
            embedData.text = Buffer.from(fileContent).toString("utf-8");
          }
          // For images, include data URL if not too large
          else if (mimeType.startsWith("image/") && fileSizeKB < 1000) {
            const base64 = Buffer.from(fileContent).toString("base64");
            embedData.dataUrl = `data:${mimeType};base64,${base64}`;
          }
          // For larger files, just provide path and note
          else {
            embedData.note = `File is ${fileSizeKB.toFixed(
              1
            )}KB - use Open button to view`;
          }
        } catch (readError) {
          logger.error("EditorPanel: Error reading embed file:", readError);
          embedData.note = "Could not read file content";
        }

        // Send embed preview to webview
        this.host.postMessage({
          command: "openEmbedPreview",
          embed: embedData,
        });
      }
    } catch (err) {
      logger.error("EditorPanel: handleRequestEmbed error", err);
    }
  }

  /**
   * Handle context menu requests from webview
   */
  public async handleContextMenuRequest(message: WebviewMessage<"requestContextMenu">): Promise<void> {
    try {
      if (logger.debug) {
        logger.debug(
          `🔧 Context menu requested at position: ${JSON.stringify(
            message.position
          )}`
        );
      }

      // Get code actions for the current position
      const document = this.host.document;
      if (!document) return;

      const line = Math.max(
        0,
        Math.min(message.position?.line || 0, document.lineCount - 1)
      );
      const character = Math.max(0, message.position?.character || 0);
      const position = new vscode.Position(line, character);
      const range = new vscode.Range(position, position);

      // Execute VS Code's context menu command
      await vscode.commands.executeCommand("editor.action.showContextMenu");

      // Also get available code actions and send them to webview
      const codeActions =
        (await vscode.commands.executeCommand<vscode.CodeAction[]>(
          "vscode.executeCodeActionProvider",
          document.uri,
          range
        )) || [];

      // Send available actions back to webview
      this.host.postMessage({
        command: "contextMenuActions",
        actions: codeActions.map((action) => ({
          title: action.title,
          kind: action.kind?.value,
          command: action.command?.command,
          arguments: action.command?.arguments,
        })),
      });
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Context menu request failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle quick fix requests from webview
   */
  public async handleQuickFixRequest(message: WebviewMessage<"requestQuickFix">): Promise<void> {
    try {
      if (logger.debug) {
        logger.debug(
          `🔧 Quick fix requested: ${message.actionTitle}`
        );
      }

      const document = this.host.document;
      if (!document) return;

      const line = Math.max(
        0,
        Math.min(message.position?.line || 0, document.lineCount - 1)
      );
      const character = Math.max(0, message.position?.character || 0);
      const position = new vscode.Position(line, character);
      const range = new vscode.Range(position, position);

      // Get available code actions
      const codeActions =
        (await vscode.commands.executeCommand<vscode.CodeAction[]>(
          "vscode.executeCodeActionProvider",
          document.uri,
          range
        )) || [];

      // Find the requested action
      const targetAction = codeActions.find(
        (action) =>
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

        if (logger.debug) {
          logger.debug(
            `✅ Quick fix applied: ${targetAction.title}`
          );
        }
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Quick fix request failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle clipboard write requests from webview
   */
  public async handleClipboardWrite(message: { text?: string; requestId?: string }): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(message.text || "");

      // Send success confirmation back to webview
      this.host.postMessage({
        command: "clipboardWriteResult",
        success: true,
        requestId: message.requestId,
      });

      if (logger.debug) {
        logger.debug(
          `📋 Clipboard write successful: ${message.text?.length || 0} chars`
        );
      }
    } catch (error) {
      // Send error back to webview
      this.host.postMessage({
        command: "clipboardWriteResult",
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: message.requestId,
      });

      if (logger.debug) {
        logger.debug(
          `❌ Clipboard write failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle clipboard read requests from webview
   */
  public async handleClipboardRead(message: { requestId?: string }): Promise<void> {
    try {
      const text = await vscode.env.clipboard.readText();

      // Send clipboard content back to webview
      this.host.postMessage({
        command: "clipboardReadResult",
        text: text,
        success: true,
        requestId: message.requestId,
      });

      if (logger.debug) {
        logger.debug(
          `📋 Clipboard read successful: ${text.length} chars`
        );
      }
    } catch (error) {
      // Send error back to webview
      this.host.postMessage({
        command: "clipboardReadResult",
        text: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
        requestId: message.requestId,
      });

      if (logger.debug) {
        logger.debug(`❌ Clipboard read failed: ${error}`);
      }
    }
  }

  /**
   * Handle cursor position updates from webview
   */
  public async handleCursorPositionUpdate(message: WebviewMessage<"cursorPosition">): Promise<void> {
    try {
      // Store cursor position for potential restoration
      this.host.lastCursorPosition = {
        line: message.line || 0,
        character: message.character || 0,
        timestamp: Date.now(),
      };

      if (logger.debug) {
        logger.debug(
          `🎯 Cursor position updated: line ${message.line}, char ${message.character}`
        );
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Cursor position update failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle quick fix trigger requests from webview
   */
  public async handleTriggerQuickFix(message: WebviewMessage<"triggerQuickFix">): Promise<void> {
    try {
      if (!this.host.document) {
        if (logger.debug) {
          logger.debug(
            `❌ Cannot trigger quick fix: no document available`
          );
        }
        return;
      }

      // Get current cursor position or use the line from message
      const line = message.line || this.host.lastCursorPosition?.line || 0;
      const character =
        message.character || this.host.lastCursorPosition?.character || 0;

      const position = new vscode.Position(line, character);
      const range = new vscode.Range(position, position);

      // Try to trigger VS Code's quick fix command
      await vscode.commands.executeCommand("editor.action.quickFix", {
        uri: this.host.document.uri,
        range: range,
      });

      if (logger.debug) {
        logger.debug(
          `🔧 Quick fix triggered at line ${line}, character ${character}`
        );
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Quick fix trigger failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle select all command
   */
  public async handleSelectAll(): Promise<void> {
    try {
      await vscode.commands.executeCommand("editor.action.selectAll");
      if (logger.debug) {
        logger.debug(`✅ Select All executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(`❌ Select All failed: ${error}`);
      }
    }
  }

  /**
   * Handle format document command
   */
  public async handleFormatDocument(): Promise<void> {
    try {
      await vscode.commands.executeCommand("editor.action.formatDocument");
      if (logger.debug) {
        logger.debug(`✅ Format Document executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Format Document failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle format selection command
   */
  public async handleFormatSelection(): Promise<void> {
    try {
      await vscode.commands.executeCommand("editor.action.formatSelection");
      if (logger.debug) {
        logger.debug(`✅ Format Selection executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Format Selection failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle show problems command
   */
  public async handleShowProblems(): Promise<void> {
    try {
      await vscode.commands.executeCommand("workbench.actions.view.problems");
      if (logger.debug) {
        logger.debug(`✅ Show Problems executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(`❌ Show Problems failed: ${error}`);
      }
    }
  }

  /**
   * Handle open problems panel command (triggered by lightbulb clicks)
   */
  public async handleOpenProblemsPanel(): Promise<void> {
    try {
      await vscode.commands.executeCommand("workbench.actions.view.problems");
      if (logger.debug) {
        logger.debug(
          `💡 Problems panel opened from lightbulb click`
        );
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Open Problems Panel failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle widget action events from button widgets and other interactive widgets
   * Supports:
   * - vscode-command: Execute VS Code commands (e.g., workbench.action.openSettings)
   * - widget-action: Trigger inter-widget communication
   * - value: Simple value actions (logged and available for extensions)
   * - data: JSON data actions (logged and available for extensions)
   */
  public async handleWidgetAction(message: WebviewMessage<"widget-action">): Promise<void> {
    try {
      const { actionType, action, value, targetWidget, widgetId } = message;
      
      // Handle data which might be wrapped in a 'raw' property if JSON parsing failed in ButtonWidget
      let data: unknown = message.data;
      if (isRecord(data) && data.raw !== undefined) {
        // Try to parse the raw value as JSON
        if (typeof data.raw === 'string') {
          try {
            data = JSON.parse(data.raw);
          } catch {
            // Keep original data if parsing fails
          }
        } else {
          data = data.raw;
        }
      }
      
      if (logger.debug) {
        logger.debug(
          `🔘 Widget action received: ${action} (${actionType}) data: ${JSON.stringify(data)}`
        );
      }
      
      // Handle VS Code command execution
      if (actionType === 'vscode-command') {
        const dataRecord = isRecord(data) ? data : undefined;
        const commandToExecute = typeof dataRecord?.command === 'string' ? dataRecord.command : undefined;
        const commandArgs = Array.isArray(dataRecord?.args) ? dataRecord.args : [];
        
        if (commandToExecute) {
          const decision = await authorizeWidgetCommand(commandToExecute, commandArgs, this.commandPolicy);
          if (decision !== 'allowed') {
            logger.debug(`🚫 Widget command ${commandToExecute} not run: ${decision}`);
            if (decision === 'untrusted') {
              void vscode.window.showWarningMessage(
                `Widget commands are disabled in untrusted workspaces ("${commandToExecute}" was not run).`
              );
            }
            return;
          }
          try {
            await vscode.commands.executeCommand(commandToExecute, ...commandArgs);
            
            if (logger.debug) {
              logger.debug(
                `✅ VS Code command executed: ${commandToExecute}`
              );
            }
            
            // Send success notification back to webview
            vscode.window.showInformationMessage(`Command executed: ${commandToExecute}`);
          } catch (cmdError) {
            if (logger.debug) {
              logger.debug(
                `❌ VS Code command failed: ${commandToExecute} - ${cmdError}`
              );
            }
            vscode.window.showErrorMessage(`Failed to execute command: ${commandToExecute}`);
          }
        }
        return;
      }
      
      // Handle widget-to-widget actions
      if (actionType === 'widget-action' && targetWidget) {
        // Forward to webview for inter-widget communication
        this.host.postMessage({
          command: 'widget-to-widget-action',
          targetWidget,
          action,
          data,
          value,
          sourceWidgetId: widgetId,
        });
        
        if (logger.debug) {
          logger.debug(
            `📤 Widget action forwarded to target: ${targetWidget}`
          );
        }
        return;
      }
      
      // Log value/data actions for extension API consumption
      if (logger.debug) {
        logger.debug(
          `📋 Widget action logged: ${action} = ${JSON.stringify(value || data)}`
        );
      }
      
      // Show feedback for simple actions
      if (actionType === 'value' && value !== undefined) {
        vscode.window.setStatusBarMessage(`Button: ${action} = ${value}`, 3000);
      } else if (actionType === 'data' && data) {
        vscode.window.setStatusBarMessage(`Button: ${action} triggered`, 3000);
      }
      
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Widget action failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle find command - Use Vditor's integrated find widget
   */
  public async handleFind(): Promise<void> {
    try {
      // Use our custom FindReplaceManager via webview
      this.host.postMessage({
        command: "showFind",
      });
      if (logger.debug) {
        logger.debug(`✅ Find widget shown`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(`❌ Find failed: ${error}`);
      }
    }
  }

  /**
   * Handle find and replace command - Use Vditor's integrated find and replace widget
   */
  public async handleFindAndReplace(): Promise<void> {
    try {
      // Use our custom FindReplaceManager via webview
      this.host.postMessage({
        command: "showFindReplace",
      });
      if (logger.debug) {
        logger.debug(`✅ Find and Replace widget shown`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Find and Replace failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle insert link command
   */
  public async handleInsertLink(): Promise<void> {
    try {
      // Use Vditor's insert link functionality via webview
      this.host.postMessage({
        command: "insertLink",
      });
      if (logger.debug) {
        logger.debug(`✅ Insert Link executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(`❌ Insert Link failed: ${error}`);
      }
    }
  }

  /**
   * Handle insert image command
   */
  public async handleInsertImage(): Promise<void> {
    try {
      // Use Vditor's insert image functionality via webview
      this.host.postMessage({
        command: "insertImage",
      });
      if (logger.debug) {
        logger.debug(`✅ Insert Image executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(`❌ Insert Image failed: ${error}`);
      }
    }
  }

  /**
   * Handle insert table command
   */
  public async handleInsertTable(): Promise<void> {
    try {
      // Use Vditor's insert table functionality via webview
      this.host.postMessage({
        command: "insertTable",
      });
      if (logger.debug) {
        logger.debug(`✅ Insert Table executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(`❌ Insert Table failed: ${error}`);
      }
    }
  }

  /**
   * Handle show command palette command
   */
  public async handleShowCommandPalette(): Promise<void> {
    try {
      await vscode.commands.executeCommand("workbench.action.showCommands");
      if (logger.debug) {
        logger.debug(`✅ Show Command Palette executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Show Command Palette failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle toggle word wrap command
   */
  public async handleToggleWordWrap(): Promise<void> {
    try {
      await vscode.commands.executeCommand("editor.action.toggleWordWrap");
      if (logger.debug) {
        logger.debug(`✅ Toggle Word Wrap executed`);
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ Toggle Word Wrap failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle share markdown command
   * Strategy:
    * 1) Webview uses Web Share API when available for native OS share sheet.
    * 2) If unavailable/fails, extension falls back to OS mail handler via mailto.
    * 3) Full markdown is always copied to clipboard as a reliable backup.
   */
  public async handleShareMarkdown(message: WebviewMessage<"shareMarkdown">): Promise<void> {
    const fullText =
      typeof message?.content === "string"
        ? message.content
        : this.host.document?.getText() || "";

    if (!fullText) {
      vscode.window.showWarningMessage("Nothing to share: markdown content is empty.");
      return;
    }

    try {
      await vscode.env.clipboard.writeText(fullText);

      const fileName =
        this.host.document?.uri
          ? NodePath.basename(this.host.document.uri.fsPath || this.host.document.uri.path)
          : "Markdown";

      const maxMailBodyChars = 1800;
      const truncatedBody =
        fullText.length > maxMailBodyChars
          ? `${fullText.slice(0, maxMailBodyChars)}\n\n... (truncated for URI length, full text copied to clipboard)`
          : fullText;

      const subject = encodeURIComponent(`Shared from ${fileName}`);
      const body = encodeURIComponent(truncatedBody);
      const mailtoUri = vscode.Uri.parse(`mailto:?subject=${subject}&body=${body}`);

      const opened = await vscode.env.openExternal(mailtoUri);

      if (opened) {
        vscode.window.showInformationMessage(
          "Opened your OS mail handler. Full markdown is copied to clipboard."
        );
      } else {
        vscode.window.showInformationMessage(
          "Could not open mail handler. Markdown text was copied to clipboard."
        );
      }

      if (logger.debug) {
        logger.debug(
          `✅ Share fallback used (mailto + clipboard): ${fullText.length} chars`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Share failed: ${error instanceof Error ? error.message : String(error)}`
      );

      if (logger.debug) {
        logger.debug(`❌ Share markdown failed: ${error}`);
      }
    }
  }

  /**
   * Handle share html command
   * Strategy:
   * 1) Webview uses Web Share API when available for native OS share sheet.
   * 2) If unavailable/fails, extension falls back to OS mail handler via mailto.
   * 3) Full HTML is always copied to clipboard as a reliable backup.
   */
  public async handleShareHtml(message: WebviewMessage<"shareHtml">): Promise<void> {
    const fullHtml =
      typeof message?.content === "string"
        ? message.content
        : this.host.document?.getText() || "";

    if (!fullHtml) {
      vscode.window.showWarningMessage("Nothing to share: HTML content is empty.");
      return;
    }

    try {
      await vscode.env.clipboard.writeText(fullHtml);

      const fileName =
        this.host.document?.uri
          ? NodePath.basename(this.host.document.uri.fsPath || this.host.document.uri.path)
          : "Document";

      const maxMailBodyChars = 1800;
      const truncatedBody =
        fullHtml.length > maxMailBodyChars
          ? `${fullHtml.slice(0, maxMailBodyChars)}\n\n... (truncated for URI length, full HTML copied to clipboard)`
          : fullHtml;

      const subject = encodeURIComponent(`Shared HTML from ${fileName}`);
      const body = encodeURIComponent(truncatedBody);
      const mailtoUri = vscode.Uri.parse(`mailto:?subject=${subject}&body=${body}`);

      const opened = await vscode.env.openExternal(mailtoUri);

      if (opened) {
        vscode.window.showInformationMessage(
          "Opened your OS mail handler. Full HTML is copied to clipboard."
        );
      } else {
        vscode.window.showInformationMessage(
          "Could not open mail handler. HTML text was copied to clipboard."
        );
      }

      if (logger.debug) {
        logger.debug(
          `✅ Share HTML fallback used (mailto + clipboard): ${fullHtml.length} chars`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Share HTML failed: ${error instanceof Error ? error.message : String(error)}`
      );

      if (logger.debug) {
        logger.debug(`❌ Share HTML failed: ${error}`);
      }
    }
  }

  /**
   * Reopen the current resource with VS Code's built-in text editor.
   */
  public async handleOpenWithTextEditor(): Promise<void> {
    const resource = this.host.document?.uri || this.host.uri;

    if (!resource) {
      showError("Cannot reopen this document in the text editor.");
      return;
    }

    try {
      await vscode.commands.executeCommand("workbench.action.reopenTextEditor");
    } catch (error) {
      showError(
        `Failed to reopen in text editor: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Handle wiki-link path resolution request from webview
   */
  public async handleResolveWikiLink(message: WebviewMessage<"resolveWikiLink">): Promise<void> {
    const { filename, requestId } = message;

    try {
      const LinkResolver = (await import("../services/LinkResolver"))
        .LinkResolver;
      const resolver = LinkResolver.getInstance();

      const currentUri = this.host.uri;
      if (!currentUri) {
        return;
      }

      const resolvedUri = await resolver.resolveWikiLink(filename, currentUri);

      if (resolvedUri) {
        const relativePath = resolver.getRelativePath(currentUri, resolvedUri);

        // Send resolved path back to webview
        this.host.postMessage({
          command: "wikilink-resolved",
          requestId,
          filename,
          resolvedPath: relativePath,
          fullPath: resolvedUri.fsPath,
        });
      }
    } catch (error) {
      logger.error("[EditorPanel] Error resolving wiki-link:", error);
    }
  }

  /**
   * Handle wiki-link navigation request from webview
   */
  public async handleNavigateToWikiLink(message: WebviewMessage<"navigateToWikiLink">): Promise<void> {
    const { filename, heading } = message;

    try {
      const LinkResolver = (await import("../services/LinkResolver"))
        .LinkResolver;
      const resolver = LinkResolver.getInstance();

      const currentUri = this.host.uri;
      if (!currentUri) {
        return;
      }

      await resolver.navigateToWikiLink(filename, heading, currentUri);

      debug(
        `[EditorPanel] Navigated to wiki-link: ${filename || "current"}${
          heading ? "#" + heading : ""
        }`
      );
    } catch (error) {
      logger.error("[EditorPanel] Error navigating to wiki-link:", error);
      vscode.window.showErrorMessage(
        `Failed to navigate to wiki-link: ${error}`
      );
    }
  }

  /**
   * Handle file open request from webview (wiki-links, embeds, sidebar)
   */
  public async handleOpenFile(message: WebviewMessage<"openFile">): Promise<void> {
    const { filename, heading, filePath, path } = message;

    try {
      // If we have a direct file path (from sidebar or embed modal), use it
      const directPath = filePath || path;
      if (directPath) {
        const uri = vscode.Uri.file(directPath);
        const ext = NodePath.extname(uri.fsPath).toLowerCase();

        // For markdown files, use our custom editor
        if (ext === ".md") {
          if (this.host.editorNavigation) {
            await this.host.editorNavigation.openEditor(uri);
          } else {
            await vscode.commands.executeCommand("vscode.open", uri);
          }
        } else {
          // For other files, use default editor
          await vscode.commands.executeCommand("vscode.open", uri);
        }
        return;
      }

      // Otherwise, resolve wiki-link filename
      if (filename) {
        const LinkResolver = (await import("../services/LinkResolver"))
          .LinkResolver;
        const resolver = LinkResolver.getInstance();

        const currentUri = this.host.uri;
        if (!currentUri) {
          return;
        }

        await resolver.navigateToWikiLink(filename, heading, currentUri);
        debug(
          `[EditorPanel] Opened file via wiki-link: ${filename}${
            heading ? "#" + heading : ""
          }`
        );
      }
    } catch (error) {
      logger.error("[EditorPanel] Error opening file:", error);
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
