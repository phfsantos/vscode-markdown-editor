import * as vscode from "vscode";
import * as NodePath from "path";
import { logger } from "../utils/Logger";

/**
 * Host-side context the store needs from its owning editor panel.
 */
export interface RendererDataStoreContext {
  /** Absolute filesystem path of the markdown document being edited. */
  getFsPath(): string;
  /** Post a message to the editor's webview. */
  postMessage(message: unknown): void;
}

/**
 * Persistence and data plumbing for kanban boards and custom block renderers
 * (dashboard, table, playground, widgets).
 *
 * Extracted from EditorPanel: owns the .assets JSON file layout next to the
 * markdown document, load/save/migrate flows, insertion of new renderer
 * blocks, and the workspace/related-file lookups the widget picker uses.
 */
export class RendererDataStore {
  constructor(private readonly ctx: RendererDataStoreContext) {}

  /**
   * Handle kanban data save with support for multiple boards
   */
  public async handleKanbanSaveData(message: any): Promise<void> {
    try {
      const kanbanData = message.data;
      const boardId = message.boardId || "default";

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📥 KANBAN SAVE REQUEST:`);
        (global as any).markdownEditorLog(
          `   rendererId: ${message.rendererId}`
        );
        (global as any).markdownEditorLog(`   boardId: ${boardId}`);
        (global as any).markdownEditorLog(`   requestId: ${message.requestId}`);
      }

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      const kanbanFilePath = this._getKanbanFilePath(boardId);
      const displayFilename = this._getKanbanDisplayFilename(boardId);

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `🗂️ Saving kanban board '${boardId}' to: ${kanbanFilePath}`
        );
        (global as any).markdownEditorLog(
          `   Display filename: ${displayFilename}`
        );
      }

      // Escape quotes in kanban data to prevent JSON parsing issues
      const escapedKanbanData = this._escapeKanbanQuotes(kanbanData);
      const content = Buffer.from(
        JSON.stringify(escapedKanbanData, null, 2),
        "utf8"
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(kanbanFilePath),
        content
      );

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `✅ Kanban board '${boardId}' saved successfully`
        );
      }

      // Send confirmation back to webview
      this.ctx.postMessage({
        command: "kanban-data-saved",
        success: true,
        rendererId: message.rendererId || "kanban-board",
        boardId: boardId,
        filename: displayFilename,
      });
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ Failed to save kanban data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "kanban-data-saved",
        success: false,
        rendererId: message.rendererId || "kanban-board",
        boardId: message.boardId || "default",
        filename: this._getKanbanDisplayFilename(message.boardId || "default"),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle kanban data load with support for multiple boards and backwards compatibility
   */
  public async handleKanbanLoadData(message: any): Promise<void> {
    try {
      const boardId = message.boardId || "default";
      const codeBlockData = message.codeBlockData; // For backwards compatibility
      const requestedFilename = message.filename; // Filename from code block

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(`📥 KANBAN LOAD REQUEST:`);
        (global as any).markdownEditorLog(
          `   rendererId: ${message.rendererId}`
        );
        (global as any).markdownEditorLog(`   boardId: ${boardId}`);
        (global as any).markdownEditorLog(`   requestId: ${message.requestId}`);
        (global as any).markdownEditorLog(
          `   codeBlockData: ${codeBlockData ? "present" : "none"}`
        );
        (global as any).markdownEditorLog(
          `   requestedFilename: ${requestedFilename}`
        );
      }

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      const kanbanFilePath = this._getKanbanFilePath(boardId);
      const displayFilename = this._getKanbanDisplayFilename(boardId);

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `   Calculated file path: ${kanbanFilePath}`
        );
        (global as any).markdownEditorLog(
          `   Display filename: ${displayFilename}`
        );
      }
      let kanbanData;
      let dataSource = "unknown";

      // First check if we have backwards compatibility data from code block
      if (
        codeBlockData &&
        codeBlockData.columns &&
        Array.isArray(codeBlockData.columns)
      ) {
        kanbanData = codeBlockData;
        dataSource = "code-block";

        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `🔄 Using legacy code block data for board '${boardId}', will migrate to JSON file`
          );
        }

        // Migrate the data to JSON file automatically with quote escaping
        try {
          const escapedKanbanData = this._escapeKanbanQuotes(kanbanData);
          const content = Buffer.from(
            JSON.stringify(escapedKanbanData, null, 2),
            "utf8"
          );
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(kanbanFilePath),
            content
          );
          dataSource = "migrated";

          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(
              `✅ Migrated legacy data to: ${kanbanFilePath}`
            );
          }
        } catch (migrateError) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(
              `⚠️ Failed to migrate data: ${migrateError}`
            );
          }
        }
      } else {
        // Try to load from JSON file
        try {
          const content = await vscode.workspace.fs.readFile(
            vscode.Uri.file(kanbanFilePath)
          );
          kanbanData = JSON.parse(content.toString());
          dataSource = "json-file";

          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(
              `✅ Loaded kanban board '${boardId}' from: ${kanbanFilePath}`
            );
          }
        } catch (fileError) {
          // File doesn't exist or was moved, create/recreate default data
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(
              `⚠️ Kanban file not found (${kanbanFilePath}), creating/recreating with default data`
            );
          }

          kanbanData = {
            columns: [
              { id: "1", title: "Todo", items: [] },
              { id: "2", title: "Doing", items: [] },
              { id: "3", title: "Done", items: [] },
            ],
          };
          dataSource = "recreated";

          // Create/recreate the JSON file with default data (with quote escaping)
          try {
            const escapedKanbanData = this._escapeKanbanQuotes(kanbanData);
            const content = Buffer.from(
              JSON.stringify(escapedKanbanData, null, 2),
              "utf8"
            );
            await vscode.workspace.fs.writeFile(
              vscode.Uri.file(kanbanFilePath),
              content
            );

            if ((global as any).markdownEditorLog) {
              (global as any).markdownEditorLog(
                `✅ Created/recreated kanban file: ${kanbanFilePath}`
              );
            }
          } catch (createError) {
            if ((global as any).markdownEditorLog) {
              (global as any).markdownEditorLog(
                `⚠️ Failed to create kanban file: ${createError}`
              );
            }
          }
        }
      }

      // Send data back to webview
      this.ctx.postMessage({
        command: "kanban-data-loaded",
        data: kanbanData,
        rendererId: message.rendererId || "kanban-board",
        boardId: boardId,
        filename: this._getKanbanDisplayFilename(boardId),
        dataSource: dataSource,
        requestId: message.requestId,
      });
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ Failed to load kanban data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "kanban-data-loaded",
        error: error instanceof Error ? error.message : String(error),
        rendererId: message.rendererId || "kanban-board",
        boardId: message.boardId || "default",
        filename: this._getKanbanDisplayFilename(message.boardId || "default"),
        requestId: message.requestId,
      });
    }
  }

  /**
   * Get the kanban file path based on the current markdown file and board ID
   * Files are stored in an 'assets' folder at the same level as the markdown file
   */
  private _getKanbanFilePath(boardId: string = "default"): string {
    const markdownPath = this.ctx.getFsPath();
    const dir = NodePath.dirname(markdownPath);
    const basename = NodePath.basename(
      markdownPath,
      NodePath.extname(markdownPath)
    );
    const assetsDir = NodePath.join(dir, "assets");

    if (boardId === "default") {
      return NodePath.join(assetsDir, `${basename}.kanban.json`);
    } else {
      // For named boards, include the board ID in the filename
      return NodePath.join(assetsDir, `${basename}.kanban.${boardId}.json`);
    }
  }

  /**
   * Get the relative filename to display in the code block
   */
  private _getKanbanDisplayFilename(boardId: string = "default"): string {
    const markdownPath = this.ctx.getFsPath();
    const basename = NodePath.basename(
      markdownPath,
      NodePath.extname(markdownPath)
    );

    if (boardId === "default") {
      return `assets/${basename}.kanban.json`;
    } else {
      return `assets/${basename}.kanban.${boardId}.json`;
    }
  }

  /**
   * Get the full file path for a generic renderer's data file
   * Format: <document>.<rendererId>.<boardId>.json
   */
  private _getRendererFilePath(
    rendererId: string,
    boardId: string = "default"
  ): string {
    const markdownPath = this.ctx.getFsPath();
    const dir = NodePath.dirname(markdownPath);
    const basename = NodePath.basename(
      markdownPath,
      NodePath.extname(markdownPath)
    );
    const assetsDir = NodePath.join(dir, "assets");

    if (boardId === "default") {
      return NodePath.join(assetsDir, `${basename}.${rendererId}.json`);
    } else {
      // For named boards, include the board ID in the filename
      return NodePath.join(
        assetsDir,
        `${basename}.${rendererId}.${boardId}.json`
      );
    }
  }

  /**
   * Get the relative filename to display in the code block for generic renderers
   */
  private _getRendererDisplayFilename(
    rendererId: string,
    boardId: string = "default"
  ): string {
    const markdownPath = this.ctx.getFsPath();
    const basename = NodePath.basename(
      markdownPath,
      NodePath.extname(markdownPath)
    );

    if (boardId === "default") {
      return `assets/${basename}.${rendererId}.json`;
    } else {
      return `assets/${basename}.${rendererId}.${boardId}.json`;
    }
  }

  /**
   * Ensure the assets directory exists
   */
  private async _ensureAssetsDirectory(): Promise<void> {
    const markdownPath = this.ctx.getFsPath();
    const dir = NodePath.dirname(markdownPath);
    const assetsDir = NodePath.join(dir, "assets");

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(assetsDir));
    } catch (error) {
      // Directory doesn't exist, create it
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `📁 Creating assets directory: ${assetsDir}`
        );
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(assetsDir));
    }
  }

  /**
   * Escape quotes in kanban data to prevent JSON parsing issues
   * Replaces both wrapped quotes and standalone quotes with Unicode equivalents
   */
  private _escapeKanbanQuotes(obj: any): any {
    if (typeof obj === "string") {
      // Replace quotes with curly quotes to avoid JSON conflicts
      return (
        obj
          // Handle quoted content: "word" -> "word"
          .replace(/"([^"]*)"/g, "\u201C$1\u201D")
          // Handle quoted content: 'word' -> 'word'
          .replace(/'([^']*)'/g, "\u2018$1\u2019")
          // Handle standalone double quotes
          .replace(/"/g, "\u201C")
          // Handle standalone single quotes/apostrophes
          .replace(/'/g, "\u2019")
      );
    } else if (Array.isArray(obj)) {
      return obj.map((item) => this._escapeKanbanQuotes(item));
    } else if (obj && typeof obj === "object") {
      const escaped: any = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
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
  public async handleKanbanMigrateData(message: any): Promise<void> {
    try {
      const { boardId, codeBlockData } = message;
      const actualBoardId = boardId || "default";

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      const kanbanFilePath = this._getKanbanFilePath(actualBoardId);
      const displayFilename = this._getKanbanDisplayFilename(actualBoardId);

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `🔄 Migrating kanban board '${actualBoardId}' from code block to: ${kanbanFilePath}`
        );
      }

      // Escape quotes in migrated data to prevent JSON parsing issues
      const escapedCodeBlockData = this._escapeKanbanQuotes(codeBlockData);
      const content = Buffer.from(
        JSON.stringify(escapedCodeBlockData, null, 2),
        "utf8"
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(kanbanFilePath),
        content
      );

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `✅ Migration completed for board '${actualBoardId}'`
        );
      }

      // Send confirmation back to webview
      this.ctx.postMessage({
        command: "kanban-data-migrated",
        success: true,
        boardId: actualBoardId,
        filename: displayFilename,
      });
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ Failed to migrate kanban data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "kanban-data-migrated",
        success: false,
        boardId: message.boardId || "default",
        filename: this._getKanbanDisplayFilename(message.boardId || "default"),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generic handler for renderer data loading
   * Wraps the existing kanban file operations for any renderer type
   */
  public async handleRendererLoadData(message: any): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, requestId } = message;

      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId = boardId || instanceId || "default";

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `📥 RENDERER LOAD: Renderer '${rendererId}' boardId '${actualBoardId}' requesting data`
        );
      }

      // For now, all renderers use the same file structure as kanban
      // Future: implement renderer-specific file handling

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      // Use renderer-specific file path (not kanban-specific)
      const rendererFilePath = this._getRendererFilePath(
        rendererId,
        actualBoardId
      );
      const displayFilename = this._getRendererDisplayFilename(
        rendererId,
        actualBoardId
      );
      let rendererData;
      let dataSource = "unknown";

      // Try to load from JSON file
      try {
        const content = await vscode.workspace.fs.readFile(
          vscode.Uri.file(rendererFilePath)
        );
        const parsedData = JSON.parse(content.toString());

        // Validate data structure matches renderer type
        const isValidData = this._validateRendererData(rendererId, parsedData);

        if (!isValidData) {
          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(
              `⚠️ RENDERER LOAD: Invalid data structure in ${rendererFilePath} for renderer '${rendererId}'`
            );
            (global as any).markdownEditorLog(
              `   File contains wrong renderer type data. Creating correct file with board ID: ${actualBoardId}`
            );
          }

          // IMPORTANT: Reuse the existing board ID from the code block
          // This maintains consistency when switching between renderer types
          const correctFilePath = this._getRendererFilePath(
            rendererId,
            actualBoardId
          );
          const correctDisplayFilename = this._getRendererDisplayFilename(
            rendererId,
            actualBoardId
          );

          // Create new file with default data for this renderer type
          const defaultData = this._getDefaultRendererData(rendererId);
          const newContent = Buffer.from(
            JSON.stringify(defaultData, null, 2),
            "utf8"
          );
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(correctFilePath),
            newContent
          );

          if ((global as any).markdownEditorLog) {
            (global as any).markdownEditorLog(
              `✅ RENDERER LOAD: Created correct file: ${correctFilePath}`
            );
          }

          // Send message to update code block with correct renderer-specific file reference
          this.ctx.postMessage({
            command: "renderer-update-code-block",
            rendererId: rendererId,
            boardId: actualBoardId,
            filename: correctDisplayFilename,
          });

          // Return the default data with same board ID
          rendererData = defaultData;
          dataSource = "new-file-created";

          // Update response to use same board ID
          this.ctx.postMessage({
            command: "renderer-data-loaded",
            success: true,
            rendererId: rendererId,
            boardId: actualBoardId,
            instanceId: actualBoardId,
            requestId: requestId,
            data: rendererData,
            filename: correctDisplayFilename,
            dataSource: dataSource,
          });
          return;
        }

        rendererData = parsedData;
        dataSource = "json-file";

        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `✅ RENDERER LOAD: Loaded '${rendererId}' data from: ${rendererFilePath}`
          );
        }
      } catch (fileError) {
        // File doesn't exist or is empty, create with default data based on renderer type
        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `⚠️ RENDERER LOAD: File not found or empty (${rendererFilePath}), creating with default data`
          );
        }

        // Create file with default data
        const defaultData = this._getDefaultRendererData(rendererId);
        const content = Buffer.from(
          JSON.stringify(defaultData, null, 2),
          "utf8"
        );
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(rendererFilePath),
          content
        );

        rendererData = defaultData;
        dataSource = "created-default";

        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `✅ RENDERER LOAD: Created default data file: ${rendererFilePath}`
          );
        }
      }

      // Send data back to webview
      this.ctx.postMessage({
        command: "renderer-data-loaded",
        success: true,
        rendererId: rendererId,
        boardId: actualBoardId,
        instanceId: actualBoardId, // For backwards compatibility
        requestId: requestId,
        data: rendererData,
        filename: displayFilename,
        dataSource: dataSource,
      });
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ RENDERER LOAD: Failed to load data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "renderer-data-loaded",
        success: false,
        rendererId: message.rendererId,
        instanceId: message.instanceId,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generic handler for renderer data saving
   * Wraps the existing kanban file operations for any renderer type
   */
  public async handleRendererSaveData(message: any): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, data, requestId } = message;

      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId = boardId || instanceId || "default";

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `💾 RENDERER SAVE: Renderer '${rendererId}' boardId '${actualBoardId}' saving data`
        );
      }

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      // Use renderer-specific file path
      const rendererFilePath = this._getRendererFilePath(
        rendererId,
        actualBoardId
      );
      const displayFilename = this._getRendererDisplayFilename(
        rendererId,
        actualBoardId
      );

      // Escape quotes in data to prevent JSON parsing issues
      const escapedData = this._escapeKanbanQuotes(data);
      const content = Buffer.from(JSON.stringify(escapedData, null, 2), "utf8");
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(rendererFilePath),
        content
      );

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `✅ RENDERER SAVE: Saved '${rendererId}' data to: ${rendererFilePath}`
        );
      }

      // Send confirmation back to webview
      this.ctx.postMessage({
        command: "renderer-data-saved",
        success: true,
        rendererId: rendererId,
        boardId: actualBoardId,
        instanceId: actualBoardId, // For backwards compatibility
        requestId: requestId,
        filename: displayFilename,
      });
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ RENDERER SAVE: Failed to save data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "renderer-data-saved",
        success: false,
        rendererId: message.rendererId,
        instanceId: message.instanceId,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generic handler for checking if renderer data file exists
   */
  public async handleRendererCheckData(message: any): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, requestId } = message;

      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId = boardId || instanceId || "default";

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `🔍 RENDERER CHECK: Checking if '${rendererId}' boardId '${actualBoardId}' data exists`
        );
      }

      const rendererFilePath = this._getRendererFilePath(
        rendererId,
        actualBoardId
      );
      const displayFilename = this._getRendererDisplayFilename(
        rendererId,
        actualBoardId
      );
      let exists = false;

      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(rendererFilePath));
        exists = true;

        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `✅ RENDERER CHECK: File exists at ${rendererFilePath}`
          );
        }
      } catch (error) {
        exists = false;

        if ((global as any).markdownEditorLog) {
          (global as any).markdownEditorLog(
            `ℹ️ RENDERER CHECK: File does not exist at ${rendererFilePath}`
          );
        }
      }

      // Send result back to webview
      this.ctx.postMessage({
        command: "renderer-data-checked",
        success: true,
        rendererId: rendererId,
        boardId: actualBoardId,
        instanceId: actualBoardId, // For backwards compatibility
        requestId: requestId,
        exists: exists,
        filename: displayFilename,
        filePath: rendererFilePath,
      });
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ RENDERER CHECK: Failed to check data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "renderer-data-checked",
        success: false,
        rendererId: message.rendererId,
        instanceId: message.instanceId,
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle insert custom renderer request
   * Creates the data file first, then inserts the code block with the filename reference
   */
  public async handleInsertRenderer(message: any): Promise<void> {
    try {
      const rendererType = message.rendererType;

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `📝 INSERT RENDERER: Request to insert ${rendererType}`
        );
      }

      // Generate unique board ID for this renderer instance
      const boardId = this._generateUniqueBoardId(rendererType);

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      // Create data file with default data
      let defaultData;
      let language;

      switch (rendererType) {
        case "kanban-board":
          language = "kanban-board";
          defaultData = {
            columns: [
              { id: "1", title: "Todo", items: [] },
              { id: "2", title: "Doing", items: [] },
              { id: "3", title: "Done", items: [] },
            ],
          };
          break;
        case "table":
          language = "table";
          defaultData = {
            columns: [
              { id: "col1", name: "Column 1", type: "text" },
              { id: "col2", name: "Column 2", type: "text" },
              { id: "col3", name: "Column 3", type: "text" },
            ],
            rows: [
              {
                id: "row1",
                cells: { col1: "Data 1", col2: "Data 2", col3: "Data 3" },
              },
              {
                id: "row2",
                cells: { col1: "Data 4", col2: "Data 5", col3: "Data 6" },
              },
            ],
          };
          break;
        default:
          throw new Error(`Unknown renderer type: ${rendererType}`);
      }

      // Get file path and create the file
      const filePath = this._getRendererFilePath(rendererType, boardId);
      const displayFilename = this._getRendererDisplayFilename(
        rendererType,
        boardId
      );

      const content = Buffer.from(JSON.stringify(defaultData, null, 2), "utf8");
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), content);

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `✅ INSERT RENDERER: Created data file at ${filePath}`
        );
      }

      // Create the code block markdown to insert
      let codeBlock = `\n\`\`\`${language}\n`;

      // Add comment with board ID and file reference for identification
      codeBlock += `<!-- file: ${displayFilename} -->\n`;

      if (boardId !== "default") {
        if (rendererType === "kanban-board") {
          codeBlock += `<!-- board: ${boardId} -->\n`;
        } else if (rendererType === "table") {
          codeBlock += `<!-- table: ${boardId} -->\n`;
        }
      }

      codeBlock += `\`\`\`\n`;

      // Send message to webview to insert the code block
      this.ctx.postMessage({
        command: "insertRendererCodeBlock",
        rendererType: rendererType,
        boardId: boardId,
        codeBlock: codeBlock,
        filename: displayFilename,
      });

      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `✅ INSERT RENDERER: Sent code block to webview for ${rendererType}`
        );
      }
    } catch (error) {
      if ((global as any).markdownEditorLog) {
        (global as any).markdownEditorLog(
          `❌ INSERT RENDERER: Failed - ${error}`
        );
      }
      vscode.window.showErrorMessage(
        `Failed to insert ${message.rendererType}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
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
  public async handleRequestWorkspaceFiles(message: any): Promise<void> {
    try {
      // Find all markdown files in workspace
      const files = await vscode.workspace.findFiles(
        "**/*.{md,markdown}",
        "**/node_modules/**"
      );

      // Convert to file info format
      const fileInfos = await Promise.all(
        files.map(async (file) => {
          const stat = await vscode.workspace.fs.stat(file);
          const relativePath = vscode.workspace.asRelativePath(file);
          const name = NodePath.basename(
            file.fsPath,
            NodePath.extname(file.fsPath)
          );

          return {
            name,
            path: file.fsPath,
            relativePath,
            mtime: stat.mtime,
          };
        })
      );

      // Send response back to webview
      this.ctx.postMessage({
        command: "wikilink-workspace-files",
        requestId: message.requestId,
        files: fileInfos,
      });
    } catch (error) {
      logger.error("Failed to get workspace files:", error);
      this.ctx.postMessage({
        command: "wikilink-workspace-files",
        requestId: message.requestId,
        files: [],
      });
    }
  }

  /**
   * Handle wiki-link related files request
   * Returns files related to the current document
   */
  public async handleRequestRelatedFiles(message: any): Promise<void> {
    try {
      const documentPath = message.documentPath;
      const documentUri = vscode.Uri.file(documentPath);

      // Use RelationshipAnalyzer to get related files
      const RelationshipAnalyzer = (
        await import("../services/RelationshipAnalyzer")
      ).RelationshipAnalyzer;
      const analyzer = RelationshipAnalyzer.getInstance();
      const relatedFiles = await analyzer.getRelatedFiles(documentUri);

      // Send response back to webview
      this.ctx.postMessage({
        command: "wikilink-related-files",
        requestId: message.requestId,
        files: relatedFiles.map((f) => f.path),
      });
    } catch (error) {
      logger.error("Failed to get related files:", error);
      this.ctx.postMessage({
        command: "wikilink-related-files",
        requestId: message.requestId,
        files: [],
      });
    }
  }

  /**
   * Validate that data structure matches the expected format for a renderer
   */
  private _validateRendererData(rendererId: string, data: any): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    switch (rendererId) {
      case "kanban-board":
        // Kanban should have columns array
        return (
          Array.isArray(data.columns) &&
          data.columns.length > 0 &&
          data.columns.every((col: any) => col.id && col.title !== undefined)
        );

      case "table-renderer":
        // Table should have columns and rows arrays
        return (
          Array.isArray(data.columns) &&
          Array.isArray(data.rows) &&
          data.columns.length > 0 &&
          data.columns.every((col: any) => col.id && col.name !== undefined)
        );

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
      case "kanban-board":
        return {
          columns: [
            { id: "1", title: "Todo", items: [] },
            { id: "2", title: "Doing", items: [] },
            { id: "3", title: "Done", items: [] },
          ],
        };

      case "table-renderer":
        return {
          columns: [
            { id: "col1", name: "Column 1", type: "text" },
            { id: "col2", name: "Column 2", type: "text" },
            { id: "col3", name: "Column 3", type: "text" },
          ],
          rows: [
            {
              id: "row1",
              cells: { col1: "Data 1", col2: "Data 2", col3: "Data 3" },
            },
            {
              id: "row2",
              cells: { col1: "Data 4", col2: "Data 5", col3: "Data 6" },
            },
          ],
        };

      default:
        return {};
    }
  }
}
