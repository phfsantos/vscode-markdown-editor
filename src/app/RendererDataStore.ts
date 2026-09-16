import * as vscode from "vscode";
import * as NodePath from "path";
import { logger } from "../utils/Logger";
import {
  getRendererAssetsDirectory,
  getRendererDataDisplayFilename,
  getRendererDataFilePath,
} from "./rendererDataPath";
import {
  type InsertRendererMessage,
  type KanbanLoadDataMessage,
  type KanbanMigrateDataMessage,
  type KanbanSaveDataMessage,
  type RendererCheckDataMessage,
  type RendererLoadDataMessage,
  type RendererSaveDataMessage,
  type SupportedRendererId,
} from "./rendererDataMessages";
import {
  getRendererDataDescriptor,
  getRendererInsertDescriptor,
} from "./rendererDataDescriptors";

/**
 * Host-side context the store needs from its owning editor panel.
 */
export interface RendererDataStoreContext {
  /** Absolute filesystem path of the markdown document being edited. */
  getFsPath(): string;
  /** Post a message to the editor's webview. */
  postMessage(message: unknown): void;
}

const RENDERER_OPERATION_ERROR = {
  code: "RENDERER_DATA_OPERATION_FAILED",
  message: "Renderer data operation failed",
};

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
  public async handleKanbanSaveData(message: KanbanSaveDataMessage): Promise<void> {
    try {
      const descriptor = getRendererDataDescriptor("kanban-board");
      const kanbanData = message.data;
      const boardId = message.boardId === undefined ? "default" : message.boardId;

      if (!descriptor.validateData(kanbanData)) {
        throw new Error("Invalid renderer data");
      }

      if (logger.debug) {
        logger.debug(`📥 KANBAN SAVE REQUEST:`);
        logger.debug(
          `   rendererId: ${message.rendererId}`
        );
        logger.debug(`   boardId: ${boardId}`);
        logger.debug(`   requestId: ${message.requestId}`);
      }

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      const kanbanFilePath = this._getKanbanFilePath(boardId);
      const displayFilename = this._getKanbanDisplayFilename(boardId);

      if (logger.debug) {
        logger.debug(
          `🗂️ Saving kanban board '${boardId}' to: ${kanbanFilePath}`
        );
        logger.debug(
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

      if (logger.debug) {
        logger.debug(
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
      if (logger.debug) {
        logger.debug(
          `❌ Failed to save kanban data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "kanban-data-saved",
        success: false,
        rendererId: message.rendererId || "kanban-board",
        boardId: message.boardId || "default",
        error: { ...RENDERER_OPERATION_ERROR },
      });
    }
  }

  /**
   * Handle kanban data load with support for multiple boards and backwards compatibility
   */
  public async handleKanbanLoadData(message: KanbanLoadDataMessage): Promise<void> {
    try {
      const descriptor = getRendererDataDescriptor("kanban-board");
      const boardId = message.boardId === undefined ? "default" : message.boardId;
      const codeBlockData = message.codeBlockData; // For backwards compatibility
      const requestedFilename = message.filename; // Filename from code block

      if (logger.debug) {
        logger.debug(`📥 KANBAN LOAD REQUEST:`);
        logger.debug(
          `   rendererId: ${message.rendererId}`
        );
        logger.debug(`   boardId: ${boardId}`);
        logger.debug(`   requestId: ${message.requestId}`);
        logger.debug(
          `   codeBlockData: ${codeBlockData ? "present" : "none"}`
        );
        logger.debug(
          `   requestedFilename: ${requestedFilename}`
        );
      }

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      const kanbanFilePath = this._getKanbanFilePath(boardId);
      const displayFilename = this._getKanbanDisplayFilename(boardId);

      if (logger.debug) {
        logger.debug(
          `   Calculated file path: ${kanbanFilePath}`
        );
        logger.debug(
          `   Display filename: ${displayFilename}`
        );
      }
      let kanbanData;
      let dataSource = "unknown";

      // First check if we have backwards compatibility data from code block
      if (
        descriptor.validateData(codeBlockData)
      ) {
        kanbanData = codeBlockData;
        dataSource = "code-block";

        if (logger.debug) {
          logger.debug(
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

          if (logger.debug) {
            logger.debug(
              `✅ Migrated legacy data to: ${kanbanFilePath}`
            );
          }
        } catch (migrateError) {
          if (logger.debug) {
            logger.debug(
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

          if (logger.debug) {
            logger.debug(
              `✅ Loaded kanban board '${boardId}' from: ${kanbanFilePath}`
            );
          }
        } catch (fileError) {
          // File doesn't exist or was moved, create/recreate default data
          if (logger.debug) {
            logger.debug(
              `⚠️ Kanban file not found (${kanbanFilePath}), creating/recreating with default data`
            );
          }

          kanbanData = descriptor.createDefaultData();
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

            if (logger.debug) {
              logger.debug(
                `✅ Created/recreated kanban file: ${kanbanFilePath}`
              );
            }
          } catch (createError) {
            if (logger.debug) {
              logger.debug(
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
      if (logger.debug) {
        logger.debug(
          `❌ Failed to load kanban data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "kanban-data-loaded",
        rendererId: message.rendererId || "kanban-board",
        boardId: message.boardId || "default",
        requestId: message.requestId,
        error: { ...RENDERER_OPERATION_ERROR },
      });
    }
  }

  /**
   * Get the kanban file path based on the current markdown file and board ID
   * Files are stored in an 'assets' folder at the same level as the markdown file
   */
  private _getKanbanFilePath(boardId: string = "default"): string {
    return getRendererDataFilePath(
      this.ctx.getFsPath(),
      "kanban-board",
      boardId,
    );
  }

  /**
   * Get the relative filename to display in the code block
   */
  private _getKanbanDisplayFilename(boardId: string = "default"): string {
    return getRendererDataDisplayFilename(
      this.ctx.getFsPath(),
      "kanban-board",
      boardId,
    );
  }

  /**
   * Get the full file path for a generic renderer's data file
   * Format: <document>.<rendererId>.<boardId>.json
   */
  private _getRendererFilePath(
    rendererId: SupportedRendererId,
    boardId: string = "default"
  ): string {
    const descriptor = getRendererDataDescriptor(rendererId);
    return getRendererDataFilePath(
      this.ctx.getFsPath(),
      descriptor.fileSuffix,
      boardId,
    );
  }

  /**
   * Get the relative filename to display in the code block for generic renderers
   */
  private _getRendererDisplayFilename(
    rendererId: SupportedRendererId,
    boardId: string = "default"
  ): string {
    const descriptor = getRendererDataDescriptor(rendererId);
    return getRendererDataDisplayFilename(
      this.ctx.getFsPath(),
      descriptor.fileSuffix,
      boardId,
    );
  }

  /**
   * Ensure the assets directory exists
   */
  private async _ensureAssetsDirectory(): Promise<void> {
    const assetsDir = getRendererAssetsDirectory(this.ctx.getFsPath());

    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(assetsDir));
    } catch (error) {
      // Directory doesn't exist, create it
      if (logger.debug) {
        logger.debug(
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
      const escaped: Record<string, unknown> = Object.create(null);
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
  public async handleKanbanMigrateData(message: KanbanMigrateDataMessage): Promise<void> {
    try {
      const descriptor = getRendererDataDescriptor("kanban-board");
      const { boardId, codeBlockData } = message;
      const actualBoardId = boardId === undefined ? "default" : boardId;

      if (!descriptor.validateData(codeBlockData)) {
        throw new Error("Invalid renderer data");
      }

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      const kanbanFilePath = this._getKanbanFilePath(actualBoardId);
      const displayFilename = this._getKanbanDisplayFilename(actualBoardId);

      if (logger.debug) {
        logger.debug(
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

      if (logger.debug) {
        logger.debug(
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
      if (logger.debug) {
        logger.debug(
          `❌ Failed to migrate kanban data: ${error}`
        );
      }

      // Send error back to webview
      this.ctx.postMessage({
        command: "kanban-data-migrated",
        success: false,
        boardId: message.boardId || "default",
        error: { ...RENDERER_OPERATION_ERROR },
      });
    }
  }

  /**
   * Generic handler for renderer data loading
   * Wraps the existing kanban file operations for any renderer type
   */
  public async handleRendererLoadData(message: RendererLoadDataMessage): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, requestId } = message;
      const descriptor = getRendererDataDescriptor(rendererId);

      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId =
        boardId !== undefined
          ? boardId
          : instanceId !== undefined
            ? instanceId
            : "default";

      if (logger.debug) {
        logger.debug(
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
        const isValidData = descriptor.validateData(parsedData);

        if (!isValidData) {
          if (logger.debug) {
            logger.debug(
              `⚠️ RENDERER LOAD: Invalid data structure in ${rendererFilePath} for renderer '${rendererId}'`
            );
            logger.debug(
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
          const defaultData = descriptor.createDefaultData();
          const newContent = Buffer.from(
            JSON.stringify(defaultData, null, 2),
            "utf8"
          );
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(correctFilePath),
            newContent
          );

          if (logger.debug) {
            logger.debug(
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

        if (logger.debug) {
          logger.debug(
            `✅ RENDERER LOAD: Loaded '${rendererId}' data from: ${rendererFilePath}`
          );
        }
      } catch (fileError) {
        // File doesn't exist or is empty, create with default data based on renderer type
        if (logger.debug) {
          logger.debug(
            `⚠️ RENDERER LOAD: File not found or empty (${rendererFilePath}), creating with default data`
          );
        }

        // Create file with default data
        const defaultData = descriptor.createDefaultData();
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

        if (logger.debug) {
          logger.debug(
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
      if (logger.debug) {
        logger.debug(
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
        error: { ...RENDERER_OPERATION_ERROR },
      });
    }
  }

  /**
   * Generic handler for renderer data saving
   * Wraps the existing kanban file operations for any renderer type
   */
  public async handleRendererSaveData(message: RendererSaveDataMessage): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, data, requestId } = message;
      const descriptor = getRendererDataDescriptor(rendererId);

      if (!descriptor.validateData(data)) {
        throw new Error("Invalid renderer data");
      }

      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId =
        boardId !== undefined
          ? boardId
          : instanceId !== undefined
            ? instanceId
            : "default";

      if (logger.debug) {
        logger.debug(
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

      if (logger.debug) {
        logger.debug(
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
      if (logger.debug) {
        logger.debug(
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
        error: { ...RENDERER_OPERATION_ERROR },
      });
    }
  }

  /**
   * Generic handler for checking if renderer data file exists
   */
  public async handleRendererCheckData(message: RendererCheckDataMessage): Promise<void> {
    try {
      const { rendererId, boardId, instanceId, requestId } = message;

      // Use boardId (new protocol) or fallback to instanceId (old protocol)
      const actualBoardId =
        boardId !== undefined
          ? boardId
          : instanceId !== undefined
            ? instanceId
            : "default";

      if (logger.debug) {
        logger.debug(
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

        if (logger.debug) {
          logger.debug(
            `✅ RENDERER CHECK: File exists at ${rendererFilePath}`
          );
        }
      } catch (error) {
        exists = false;

        if (logger.debug) {
          logger.debug(
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
      });
    } catch (error) {
      if (logger.debug) {
        logger.debug(
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
        error: { ...RENDERER_OPERATION_ERROR },
      });
    }
  }

  /**
   * Handle insert custom renderer request
   * Creates the data file first, then inserts the code block with the filename reference
   */
  public async handleInsertRenderer(message: InsertRendererMessage): Promise<void> {
    try {
      const rendererType = message.rendererType;
      const descriptor = getRendererInsertDescriptor(rendererType);

      if (logger.debug) {
        logger.debug(
          `📝 INSERT RENDERER: Request to insert ${rendererType}`
        );
      }

      // Generate unique board ID for this renderer instance
      const boardId = this._generateUniqueBoardId(rendererType);

      // Ensure assets directory exists
      await this._ensureAssetsDirectory();

      // Create data file with default data
      const defaultData = descriptor.createDefaultData();
      const language = descriptor.language;

      // Get file path and create the file
      const filePath = getRendererDataFilePath(
        this.ctx.getFsPath(),
        descriptor.fileSuffix,
        boardId,
      );
      const displayFilename = getRendererDataDisplayFilename(
        this.ctx.getFsPath(),
        descriptor.fileSuffix,
        boardId
      );

      const content = Buffer.from(JSON.stringify(defaultData, null, 2), "utf8");
      await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), content);

      if (logger.debug) {
        logger.debug(
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

      if (logger.debug) {
        logger.debug(
          `✅ INSERT RENDERER: Sent code block to webview for ${rendererType}`
        );
      }
    } catch (error) {
      if (logger.debug) {
        logger.debug(
          `❌ INSERT RENDERER: Failed - ${error}`
        );
      }
      vscode.window.showErrorMessage(
        "Failed to insert renderer data."
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

}
