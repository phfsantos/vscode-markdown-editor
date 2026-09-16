import { describe, expect, test } from "vitest";
import {
  getRendererDataDisplayFilename,
  getRendererDataFilePath,
  validateRendererIdentifier,
} from "../src/app/rendererDataPath";

const documentPath = "/workspace/notes/Project Plan.md";

describe("renderer data path policy", () => {
  test.each([
    ["empty", ""],
    ["dot", "."],
    ["dot-dot", ".."],
    ["posix separator", "board/escape"],
    ["windows separator", "board\\escape"],
    ["absolute path", "/tmp/escape"],
    ["windows absolute path", "C:\\tmp\\escape"],
    ["encoded posix separator", "board%2Fescape"],
    ["encoded windows separator", "board%5Cescape"],
    ["prototype key", "__proto__"],
    ["constructor key", "constructor"],
    ["prototype property", "prototype"],
    ["oversized", "a".repeat(129)],
  ])("rejects %s identifiers before path construction", (_label, value) => {
    expect(() => validateRendererIdentifier(value, "boardId")).toThrow(
      /invalid boardId/i,
    );
  });

  test.each([
    ["kanban-board", "kanban-board"],
    ["table-renderer", "table-renderer"],
    ["legacy board id", "board-2"],
    ["generated renderer id", "kanban-board-1720000000000-ab12"],
  ])("accepts %s", (_label, value) => {
    expect(validateRendererIdentifier(value, "rendererId")).toBe(value);
  });

  test("contains default and named data files in the document assets directory", () => {
    expect(
      getRendererDataFilePath(documentPath, "kanban-board", "default"),
    ).toBe("/workspace/notes/assets/Project Plan.kanban-board.json");
    expect(
      getRendererDataFilePath(documentPath, "table-renderer", "board-2"),
    ).toBe("/workspace/notes/assets/Project Plan.table-renderer.board-2.json");
  });

  test("returns safe relative display names without absolute paths", () => {
    expect(
      getRendererDataDisplayFilename(documentPath, "table-renderer", "board-2"),
    ).toBe("assets/Project Plan.table-renderer.board-2.json");
  });

  test.each([
    ["rendererId", "../outside", "default"],
    ["rendererId", "table/other", "default"],
    ["boardId", "table-renderer", "../outside"],
    ["boardId", "table-renderer", "board%2Fother"],
    ["boardId", "table-renderer", ""],
  ])("rejects unsafe %s values", (_label, rendererId, boardId) => {
    expect(() =>
      getRendererDataFilePath(documentPath, rendererId, boardId),
    ).toThrow();
  });
});
