import * as NodePath from "path";

export const DEFAULT_RENDERER_BOARD_ID = "default";
export const MAX_RENDERER_IDENTIFIER_LENGTH = 128;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FORBIDDEN_IDENTIFIERS = new Set(["__proto__", "prototype", "constructor"]);

export class RendererDataPathError extends Error {
  readonly code = "INVALID_RENDERER_DATA_PATH";

  constructor(message: string) {
    super(message);
    this.name = "RendererDataPathError";
  }
}

/**
 * Validate an identifier before it can participate in a renderer filename.
 * The grammar intentionally excludes all separators, percent escapes, and
 * object-prototype keys.
 */
export function validateRendererIdentifier(
  value: unknown,
  fieldName = "identifier",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RENDERER_IDENTIFIER_LENGTH ||
    value === "." ||
    value === ".." ||
    FORBIDDEN_IDENTIFIERS.has(value) ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new RendererDataPathError(`Invalid ${fieldName}`);
  }

  return value;
}

function validateDocumentPath(documentPath: unknown): string {
  if (typeof documentPath !== "string" || !NodePath.isAbsolute(documentPath)) {
    throw new RendererDataPathError("Invalid document path");
  }

  return NodePath.resolve(documentPath);
}

export function getRendererAssetsDirectory(documentPath: string): string {
  const normalizedDocumentPath = validateDocumentPath(documentPath);
  return NodePath.resolve(NodePath.dirname(normalizedDocumentPath), "assets");
}

function resolveContainedPath(assetsDirectory: string, filename: string): string {
  const normalizedAssetsDirectory = NodePath.resolve(assetsDirectory);
  const candidate = NodePath.resolve(normalizedAssetsDirectory, filename);
  const relative = NodePath.relative(normalizedAssetsDirectory, candidate);

  if (
    candidate === normalizedAssetsDirectory ||
    NodePath.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${NodePath.sep}`)
  ) {
    throw new RendererDataPathError("Renderer data path escapes assets directory");
  }

  return candidate;
}

function getRendererDataParts(
  documentPath: string,
  rendererId: unknown,
  boardId: unknown,
): { assetsDirectory: string; filename: string; displayFilename: string } {
  const safeRendererId = validateRendererIdentifier(rendererId, "rendererId");
  const safeBoardId =
    boardId === undefined
      ? DEFAULT_RENDERER_BOARD_ID
      : validateRendererIdentifier(boardId, "boardId");
  const normalizedDocumentPath = validateDocumentPath(documentPath);
  const basename = NodePath.basename(
    normalizedDocumentPath,
    NodePath.extname(normalizedDocumentPath),
  );
  const assetsDirectory = getRendererAssetsDirectory(normalizedDocumentPath);
  const boardSuffix =
    safeBoardId === DEFAULT_RENDERER_BOARD_ID ? "" : `.${safeBoardId}`;
  const filename = `${basename}.${safeRendererId}${boardSuffix}.json`;

  // Keep the containment check next to filename construction so every caller
  // gets the same normalized-path guarantee even if the grammar changes.
  resolveContainedPath(assetsDirectory, filename);

  return {
    assetsDirectory,
    filename,
    displayFilename: `assets/${filename}`,
  };
}

export function getRendererDataFilePath(
  documentPath: string,
  rendererId: unknown,
  boardId?: unknown,
): string {
  const parts = getRendererDataParts(documentPath, rendererId, boardId);
  return resolveContainedPath(parts.assetsDirectory, parts.filename);
}

export function getRendererDataDisplayFilename(
  documentPath: string,
  rendererId: unknown,
  boardId?: unknown,
): string {
  return getRendererDataParts(documentPath, rendererId, boardId).displayFilename;
}
