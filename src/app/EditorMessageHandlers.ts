import * as vscode from "vscode";
import * as NodePath from "path";
import { logger } from "../utils/Logger";
import { showError, debug } from "./_utils";

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
  lastCursorPosition:
    | { line: number; character: number; timestamp: number }
    | null;
  postMessage(message: unknown): void;
}

/**
 * Webview command handlers that don't belong to a dedicated controller:
 * embeds, context menu, quick fixes, clipboard, cursor tracking, formatting,
 * find/replace, insertions, sharing, word wrap, wiki links, and file opening.
 *
 * Extracted from EditorPanel.
 */
export class EditorMessageHandlers {
  constructor(private readonly host: HandlerHost) {}

  /**
   * Handle a request from the webview to preview an embed originating from a wiki-link
   * The webview sends { command: 'requestEmbed', filename, currentDocument }
   */
  public async handleRequestEmbed(message: any): Promise<void> {
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
  public async handleContextMenuRequest(message: any): Promise<void> {
    try {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ Context menu request failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle quick fix requests from webview
   */
  public async handleQuickFixRequest(message: any): Promise<void> {
    try {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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

        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `✅ Quick fix applied: ${targetAction.title}`
          );
        }
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ Quick fix request failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle clipboard write requests from webview
   */
  public async handleClipboardWrite(message: any): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(message.text || "");

      // Send success confirmation back to webview
      this.host.postMessage({
        command: "clipboardWriteResult",
        success: true,
        requestId: message.requestId,
      });

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ Clipboard write failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle clipboard read requests from webview
   */
  public async handleClipboardRead(message: any): Promise<void> {
    try {
      const text = await vscode.env.clipboard.readText();

      // Send clipboard content back to webview
      this.host.postMessage({
        command: "clipboardReadResult",
        text: text,
        success: true,
        requestId: message.requestId,
      });

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Clipboard read failed: ${error}`);
      }
    }
  }

  /**
   * Handle cursor position updates from webview
   */
  public async handleCursorPositionUpdate(message: any): Promise<void> {
    try {
      // Store cursor position for potential restoration
      this.host.lastCursorPosition = {
        line: message.line || 0,
        character: message.character || 0,
        timestamp: Date.now(),
      };

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `🎯 Cursor position updated: line ${message.line}, char ${message.character}`
        );
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ Cursor position update failed: ${error}`
        );
      }
    }
  }

  /**
   * Handle quick fix trigger requests from webview
   */
  public async handleTriggerQuickFix(message: any): Promise<void> {
    try {
      if (!this.host.document) {
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
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

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `🔧 Quick fix triggered at line ${line}, character ${character}`
        );
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
  public async handleFormatDocument(): Promise<void> {
    try {
      await vscode.commands.executeCommand("editor.action.formatDocument");
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Format Document executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Format Selection executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
  public async handleOpenProblemsPanel(): Promise<void> {
    try {
      await vscode.commands.executeCommand("workbench.actions.view.problems");
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `💡 Problems panel opened from lightbulb click`
        );
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
  public async handleWidgetAction(message: any): Promise<void> {
    try {
      const { actionType, action, value, targetWidget, widgetId, vscodeCommand } = message;
      
      // Handle data which might be wrapped in a 'raw' property if JSON parsing failed in ButtonWidget
      let data = message.data;
      if (data && typeof data === 'object' && data.raw !== undefined) {
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
      
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `🔘 Widget action received: ${action} (${actionType}) data: ${JSON.stringify(data)}`
        );
      }
      
      // Handle VS Code command execution
      if (actionType === 'vscode-command') {
        const commandToExecute = vscodeCommand || data?.command;
        const commandArgs = data?.args || [];
        
        if (commandToExecute) {
          try {
            if (Array.isArray(commandArgs) && commandArgs.length > 0) {
              await vscode.commands.executeCommand(commandToExecute, ...commandArgs);
            } else {
              await vscode.commands.executeCommand(commandToExecute);
            }
            
            if ((global as any).markdownEditorLog) {
              (global as any).markdownEditorLog(
                `✅ VS Code command executed: ${commandToExecute}`
              );
            }
            
            // Send success notification back to webview
            vscode.window.showInformationMessage(`Command executed: ${commandToExecute}`);
          } catch (cmdError) {
            if ((global as any).markdownEditorLog) {
              (global as any).markdownEditorLog(
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
        
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `📤 Widget action forwarded to target: ${targetWidget}`
          );
        }
        return;
      }
      
      // Log value/data actions for extension API consumption
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
  public async handleFindAndReplace(): Promise<void> {
    try {
      // Use our custom FindReplaceManager via webview
      this.host.postMessage({
        command: "showFindReplace",
      });
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Find and Replace widget shown`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
  public async handleInsertImage(): Promise<void> {
    try {
      // Use Vditor's insert image functionality via webview
      this.host.postMessage({
        command: "insertImage",
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
  public async handleInsertTable(): Promise<void> {
    try {
      // Use Vditor's insert table functionality via webview
      this.host.postMessage({
        command: "insertTable",
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
  public async handleShowCommandPalette(): Promise<void> {
    try {
      await vscode.commands.executeCommand("workbench.action.showCommands");
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Show Command Palette executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`✅ Toggle Word Wrap executed`);
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
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
  public async handleShareMarkdown(message: any): Promise<void> {
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

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `✅ Share fallback used (mailto + clipboard): ${fullText.length} chars`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Share failed: ${error instanceof Error ? error.message : String(error)}`
      );

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Share markdown failed: ${error}`);
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
  public async handleShareHtml(message: any): Promise<void> {
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

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `✅ Share HTML fallback used (mailto + clipboard): ${fullHtml.length} chars`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Share HTML failed: ${error instanceof Error ? error.message : String(error)}`
      );

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`❌ Share HTML failed: ${error}`);
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
  public async handleResolveWikiLink(message: any): Promise<void> {
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
  public async handleNavigateToWikiLink(message: any): Promise<void> {
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
  public async handleOpenFile(message: any): Promise<void> {
    const { filename, heading, filePath, path } = message;

    try {
      // If we have a direct file path (from sidebar or embed modal), use it
      if (filePath || path) {
        const uri = vscode.Uri.file(filePath || path);
        const ext = NodePath.extname(uri.fsPath).toLowerCase();

        // For markdown files, use our custom editor
        if (ext === ".md") {
          // Dynamic import breaks the circular dependency with EditorPanel.
          const { EditorPanel } = await import("./EditorPanel");
          await EditorPanel.createOrShow(this.host.context, uri);
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
