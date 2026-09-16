import { validateRendererIdentifier } from "./rendererDataPath";

export const RENDERER_DATA_COMMANDS = [
  "kanban-save-data",
  "kanban-load-data",
  "kanban-migrate-data",
  "renderer-load-data",
  "renderer-save-data",
  "renderer-check-data",
  "requestInsertRenderer",
] as const;

export type RendererDataCommand = (typeof RENDERER_DATA_COMMANDS)[number];
export type SupportedRendererId = "kanban-board" | "table-renderer";
export type RendererInsertType = "kanban-board" | "table";

interface RendererMessageBase {
  requestId?: string;
}

interface BoardMessageBase extends RendererMessageBase {
  boardId?: string;
  instanceId?: string;
}

export interface RendererLoadDataMessage extends BoardMessageBase {
  command: "renderer-load-data";
  rendererId: SupportedRendererId;
}

export interface RendererSaveDataMessage extends BoardMessageBase {
  command: "renderer-save-data";
  rendererId: SupportedRendererId;
  data: unknown;
}

export interface RendererCheckDataMessage extends BoardMessageBase {
  command: "renderer-check-data";
  rendererId: SupportedRendererId;
}

export interface KanbanSaveDataMessage extends RendererMessageBase {
  command: "kanban-save-data";
  rendererId?: "kanban-board";
  boardId?: string;
  data: unknown;
}

export interface KanbanLoadDataMessage extends RendererMessageBase {
  command: "kanban-load-data";
  rendererId?: "kanban-board";
  boardId?: string;
  codeBlockData?: unknown;
  filename?: string;
}

export interface KanbanMigrateDataMessage extends RendererMessageBase {
  command: "kanban-migrate-data";
  boardId?: string;
  codeBlockData: unknown;
}

export interface InsertRendererMessage extends RendererMessageBase {
  command: "requestInsertRenderer";
  rendererType: RendererInsertType;
}

export type RendererDataMessage =
  | RendererLoadDataMessage
  | RendererSaveDataMessage
  | RendererCheckDataMessage
  | KanbanSaveDataMessage
  | KanbanLoadDataMessage
  | KanbanMigrateDataMessage
  | InsertRendererMessage;

const rendererDataCommandSet = new Set<string>(RENDERER_DATA_COMMANDS);
const supportedRendererIds = new Set<SupportedRendererId>([
  "kanban-board",
  "table-renderer",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function optionalString(
  message: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  if (!hasOwn(message, key)) return undefined;
  const value = message[key];
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

function optionalIdentifier(
  message: Record<string, unknown>,
  key: "boardId" | "instanceId",
): string | undefined {
  if (!hasOwn(message, key)) return undefined;
  return validateRendererIdentifier(message[key], key);
}

function optionalRequestId(message: Record<string, unknown>): string | undefined {
  return optionalString(message, "requestId", 256);
}

function optionalBoardFields(message: Record<string, unknown>): BoardMessageBase {
  return {
    boardId: optionalIdentifier(message, "boardId"),
    instanceId: optionalIdentifier(message, "instanceId"),
    requestId: optionalRequestId(message),
  };
}

function rendererId(message: Record<string, unknown>): SupportedRendererId {
  const value = validateRendererIdentifier(message.rendererId, "rendererId");
  if (!supportedRendererIds.has(value as SupportedRendererId)) {
    throw new Error("Unsupported rendererId");
  }
  return value as SupportedRendererId;
}

function optionalKanbanRendererId(
  message: Record<string, unknown>,
): "kanban-board" | undefined {
  if (!hasOwn(message, "rendererId")) return undefined;
  const value = validateRendererIdentifier(message.rendererId, "rendererId");
  if (value !== "kanban-board") throw new Error("Unsupported rendererId");
  return value;
}

function requiredData(message: Record<string, unknown>): unknown {
  if (!hasOwn(message, "data") || message.data === undefined) {
    throw new Error("Missing data");
  }
  return message.data;
}

function requiredCodeBlockData(message: Record<string, unknown>): unknown {
  if (!hasOwn(message, "codeBlockData") || message.codeBlockData === undefined) {
    throw new Error("Missing codeBlockData");
  }
  return message.codeBlockData;
}

function optionalFilename(message: Record<string, unknown>): string | undefined {
  const filename = optionalString(message, "filename", 512);
  if (
    filename &&
    (!filename.startsWith("assets/") ||
      filename.includes("\\") ||
      filename.split("/").some((segment) => segment === "." || segment === ".."))
  ) {
    throw new Error("Invalid filename");
  }
  return filename;
}

export function isRendererDataCommand(
  command: unknown,
): command is RendererDataCommand {
  return typeof command === "string" && rendererDataCommandSet.has(command);
}

const rendererDataResponseCommands: Record<RendererDataCommand, string> = {
  "kanban-save-data": "kanban-data-saved",
  "kanban-load-data": "kanban-data-loaded",
  "kanban-migrate-data": "kanban-data-migrated",
  "renderer-load-data": "renderer-data-loaded",
  "renderer-save-data": "renderer-data-saved",
  "renderer-check-data": "renderer-data-checked",
  requestInsertRenderer: "renderer-data-request-rejected",
};

export function createRendererDataErrorResponse(
  value: unknown,
): {
  command: string;
  success: false;
  requestId?: string;
  error: { code: "INVALID_RENDERER_MESSAGE"; message: string };
} {
  const message = isRecord(value) ? value : {};
  const command = isRendererDataCommand(message.command)
    ? rendererDataResponseCommands[message.command]
    : "renderer-data-request-rejected";
  const requestId =
    typeof message.requestId === "string" &&
    message.requestId.length > 0 &&
    message.requestId.length <= 256
      ? message.requestId
      : undefined;

  return {
    command,
    success: false,
    ...(requestId ? { requestId } : {}),
    error: {
      code: "INVALID_RENDERER_MESSAGE",
      message: "Invalid renderer data request",
    },
  };
}

/**
 * Parse the subset of webview messages that can reach renderer persistence.
 * Unknown commands return null so the general EditorPanel router can continue;
 * malformed known commands also return null and must be rejected by the host.
 */
export function parseRendererDataMessage(
  value: unknown,
): RendererDataMessage | null {
  if (!isRecord(value) || !isRendererDataCommand(value.command)) return null;

  try {
    switch (value.command) {
      case "renderer-load-data":
        return {
          command: value.command,
          rendererId: rendererId(value),
          ...optionalBoardFields(value),
        };
      case "renderer-save-data":
        return {
          command: value.command,
          rendererId: rendererId(value),
          data: requiredData(value),
          ...optionalBoardFields(value),
        };
      case "renderer-check-data":
        return {
          command: value.command,
          rendererId: rendererId(value),
          ...optionalBoardFields(value),
        };
      case "kanban-save-data":
        return {
          command: value.command,
          rendererId: optionalKanbanRendererId(value),
          boardId: optionalIdentifier(value, "boardId"),
          data: requiredData(value),
          requestId: optionalRequestId(value),
        };
      case "kanban-load-data":
        if (hasOwn(value, "codeBlockData") && value.codeBlockData === undefined) {
          return null;
        }
        return {
          command: value.command,
          rendererId: optionalKanbanRendererId(value),
          boardId: optionalIdentifier(value, "boardId"),
          codeBlockData: hasOwn(value, "codeBlockData")
            ? value.codeBlockData
            : undefined,
          filename: optionalFilename(value),
          requestId: optionalRequestId(value),
        };
      case "kanban-migrate-data":
        return {
          command: value.command,
          boardId: optionalIdentifier(value, "boardId"),
          codeBlockData: requiredCodeBlockData(value),
          requestId: optionalRequestId(value),
        };
      case "requestInsertRenderer": {
        if (value.rendererType !== "kanban-board" && value.rendererType !== "table") {
          return null;
        }
        return {
          command: value.command,
          rendererType: value.rendererType,
          requestId: optionalRequestId(value),
        };
      }
    }
  } catch {
    return null;
  }
}
