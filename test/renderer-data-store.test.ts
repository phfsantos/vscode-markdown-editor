import { beforeEach, describe, expect, test, vi } from "vitest";

const fs = vi.hoisted(() => ({
  createDirectory: vi.fn(async () => undefined),
  readFile: vi.fn(async () => Buffer.from("{}", "utf8")),
  stat: vi.fn(async () => ({ mtime: 0 })),
  writeFile: vi.fn(async () => undefined),
}));

vi.mock("vscode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../test/mocks/vscode")>();
  return {
    ...actual,
    workspace: {
      ...actual.workspace,
      fs,
    },
  };
});

import { RendererDataStore } from "../src/app/RendererDataStore";
import {
  createRendererDataErrorResponse,
  parseRendererDataMessage,
} from "../src/app/rendererDataMessages";

describe("renderer data message boundary", () => {
  beforeEach(() => {
    fs.createDirectory.mockClear();
    fs.readFile.mockClear();
    fs.stat.mockClear();
    fs.writeFile.mockClear();
  });

  test.each([
    {
      command: "renderer-load-data",
      rendererId: "table-renderer",
      boardId: "default",
      requestId: "request-1",
    },
    {
      command: "renderer-save-data",
      rendererId: "kanban-board",
      instanceId: "board-1",
      data: { columns: [] },
    },
    {
      command: "renderer-check-data",
      rendererId: "table-renderer",
      boardId: "table-1",
    },
    {
      command: "kanban-load-data",
      boardId: "default",
      codeBlockData: { columns: [] },
      filename: "assets/Project.kanban.json",
    },
    {
      command: "kanban-load-data",
      filename: "assets/Project..legacy.kanban.json",
    },
    {
      command: "kanban-save-data",
      data: { columns: [] },
    },
    {
      command: "kanban-migrate-data",
      boardId: "board-1",
      codeBlockData: { columns: [] },
    },
    {
      command: "requestInsertRenderer",
      rendererType: "table",
    },
  ])("accepts valid $command messages", (message) => {
    expect(parseRendererDataMessage(message)).toEqual(message);
  });

  test.each([
    null,
    undefined,
    [],
    {},
    { command: "renderer-load-data" },
    { command: "renderer-load-data", rendererId: "../outside" },
    { command: "renderer-load-data", rendererId: "table-renderer", boardId: "" },
    { command: "renderer-save-data", rendererId: "table-renderer", data: undefined },
    { command: "renderer-check-data", rendererId: "table-renderer", requestId: {} },
    { command: "kanban-load-data", codeBlockData: undefined },
    { command: "kanban-migrate-data" },
    { command: "requestInsertRenderer", rendererType: "script" },
    { command: "renderer-load-data", rendererId: "constructor" },
  ])("rejects malformed privileged message %#", (message) => {
    expect(parseRendererDataMessage(message)).toBeNull();
  });

  test("creates a structured response without echoing untrusted message data", () => {
    expect(
      createRendererDataErrorResponse({
        command: "renderer-save-data",
        requestId: "request-1",
        boardId: "../outside",
      }),
    ).toEqual({
      command: "renderer-data-saved",
      success: false,
      requestId: "request-1",
      error: {
        code: "INVALID_RENDERER_MESSAGE",
        message: "Invalid renderer data request",
      },
    });
  });
});

describe("renderer data persistence boundary", () => {
  beforeEach(() => {
    fs.createDirectory.mockClear();
    fs.readFile.mockClear();
    fs.stat.mockClear();
    fs.writeFile.mockClear();
  });

  test("does not perform filesystem I/O for an unsafe renderer identifier", async () => {
    const messages: unknown[] = [];
    const store = new RendererDataStore({
      getFsPath: () => "/workspace/notes/Project Plan.md",
      postMessage: (message) => messages.push(message),
    });

    await store.handleRendererSaveData({
      command: "renderer-save-data",
      rendererId: "table-renderer",
      boardId: "../outside",
      data: { columns: [], rows: [] },
      requestId: "request-1",
    });

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatchObject({
      command: "renderer-data-saved",
      success: false,
    });
    expect(JSON.stringify(messages.at(-1))).not.toContain("/workspace");
  });

  test("uses the table renderer descriptor for inserted table data", async () => {
    const messages: unknown[] = [];
    const store = new RendererDataStore({
      getFsPath: () => "/workspace/notes/Project Plan.md",
      postMessage: (message) => messages.push(message),
    });

    await store.handleInsertRenderer({
      command: "requestInsertRenderer",
      rendererType: "table",
    });

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(fs.writeFile.mock.calls[0][0].fsPath).toMatch(
      /\/workspace\/notes\/assets\/Project Plan\.table-renderer\.table-\d+-[a-z0-9]+\.json$/,
    );
    expect(messages[0]).toMatchObject({
      command: "insertRendererCodeBlock",
      rendererType: "table",
    });
    expect((messages[0] as { filename: string }).filename).toMatch(
      /^assets\/Project Plan\.table-renderer\.table-\d+-[a-z0-9]+\.json$/,
    );
  });
});
