import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, test, vi } from "vitest";

test("Vditor callback markdown remains authoritative when the DOM snapshot is truncated", async () => {
  let contentSyncModule: typeof import("../packages/media/src/content-sync") | null = null;
  try {
    contentSyncModule = await import("../packages/media/src/content-sync");
  } catch {
    // The assertion below is the expected red state until the synchronizer exists.
  }

  assert.ok(contentSyncModule, "expected a webview content synchronizer module");

  const fixture = fs.readFileSync(
    path.join(__dirname, "fixtures", "custom-block-save.md"),
    "utf8",
  );
  const truncatedDomSnapshot = fixture.slice(0, fixture.indexOf("MIDDLE") + 2);
  const messages: unknown[] = [];
  const sync = contentSyncModule.createWebviewContentSync((message) => messages.push(message));

  const edit = sync.acceptInput(fixture);

  assert.notStrictEqual(truncatedDomSnapshot, fixture);
  assert.strictEqual(edit.content, fixture);
  assert.deepStrictEqual(messages, [edit]);
});

test("external generations reset revisions and cannot move backward", async () => {
  const { createWebviewContentSync } = await import(
    "../packages/media/src/content-sync"
  );
  const messages: unknown[] = [];
  const sync = createWebviewContentSync((message) => messages.push(message), "initial", 4);

  assert.strictEqual(sync.acceptInput("local edit").revision, 1);
  assert.strictEqual(sync.acceptExternalUpdate("external", 5), true);
  assert.strictEqual(sync.acceptInput("after external").revision, 1);
  assert.strictEqual(sync.acceptExternalUpdate("stale external", 4), false);
  assert.strictEqual(sync.getContent(), "after external");
});

test("DOM mutations re-enter the authoritative Vditor input callback", async () => {
  const contentSyncModule = await import("../packages/media/src/content-sync");
  const dispatchVditorInput = (
    contentSyncModule as typeof contentSyncModule & {
      dispatchVditorInput?: (vditor: unknown) => boolean;
    }
  ).dispatchVditorInput;
  let dispatchedEvent: Event | undefined;
  let getValueCalls = 0;
  const vditor = {
    getValue: () => {
      getValueCalls += 1;
      return "unsafe live DOM snapshot";
    },
    vditor: {
      ir: {
        element: {
          dispatchEvent(event: Event) {
            dispatchedEvent = event;
            return true;
          },
        },
      },
    },
  };

  assert.strictEqual(typeof dispatchVditorInput, "function");
  assert.strictEqual(dispatchVditorInput(vditor), true);
  assert.strictEqual(dispatchedEvent?.type, "input");
  assert.strictEqual(dispatchedEvent?.bubbles, true);
  assert.strictEqual(getValueCalls, 0);
});

test("equal or older external generations cannot reset authoritative content", async () => {
  const { createWebviewContentSync } = await import(
    "../packages/media/src/content-sync"
  );
  const sync = createWebviewContentSync(() => {}, "initial", 3);
  sync.acceptInput("local revision");

  assert.strictEqual(sync.acceptExternalUpdate("equal stale", 3), false);
  assert.strictEqual(sync.acceptExternalUpdate("older stale", 2), false);
  assert.strictEqual(sync.getContent(), "local revision");
});

// ---- Host update and diagnostics routes ------------------------------------

import { createDocumentSyncRoutes } from "../packages/media/src/document-sync-routes";
import { createWebviewContentSync } from "../packages/media/src/content-sync";

function documentSyncRoutes(initialContent = "local", initialGeneration = 3) {
  const contentSync = createWebviewContentSync(() => {}, initialContent, initialGeneration);
  const timers: Array<() => void> = [];
  const editor = {
    replaced: [] as string[],
    initialized: [] as unknown[],
    afterUpdates: 0,
    diagnostics: [] as boolean[],
  };
  const routes = createDocumentSyncRoutes({
    getContentSync: () => contentSync,
    recordDocumentState: () => {},
    initializeEditor: (message) => editor.initialized.push(message),
    replaceEditorContent: (content) => editor.replaced.push(content),
    afterExternalUpdate: () => { editor.afterUpdates += 1; },
    applyDiagnostics: (_message, forceApply) => editor.diagnostics.push(forceApply),
    setTimeout: (callback) => timers.push(callback),
  });
  const update = (message: Record<string, unknown>) =>
    routes.update!({ command: "update", content: "", ...message } as never);
  const diagnostics = () => routes.diagnostics!({ command: "diagnostics", diagnostics: [] });
  return { contentSync, editor, update, diagnostics, expireWindow: () => timers.splice(0).forEach((t) => t()) };
}

describe("host document update routes", () => {
  test("an accepted external update replaces the editor content and force-applies the next diagnostics", () => {
    const { editor, update, diagnostics, contentSync } = documentSyncRoutes();

    update({ content: "external", generation: 4 });
    diagnostics();

    assert.deepStrictEqual(editor.replaced, ["external"]);
    assert.strictEqual(editor.afterUpdates, 1);
    assert.deepStrictEqual(editor.diagnostics, [true]);
    assert.strictEqual(contentSync.getContent(), "external");
  });

  test("a stale external update leaves the editor alone and does not arm diagnostics", () => {
    const { editor, update, diagnostics, contentSync } = documentSyncRoutes();

    update({ content: "stale", generation: 3 });
    diagnostics();

    assert.deepStrictEqual(editor.replaced, []);
    assert.deepStrictEqual(editor.diagnostics, [false]);
    assert.strictEqual(contentSync.getContent(), "local");
  });

  test("the diagnostic force window closes after it expires", () => {
    const { editor, update, diagnostics, expireWindow } = documentSyncRoutes();

    update({ content: "external", generation: 4 });
    expireWindow();
    diagnostics();

    assert.deepStrictEqual(editor.diagnostics, [false]);
  });

  test("an update without a generation advances to the next generation", () => {
    const { update, contentSync } = documentSyncRoutes("local", 3);

    update({ content: "external" });

    assert.strictEqual(contentSync.getGeneration(), 4);
  });

  test("an init update boots the editor instead of replacing content", () => {
    const { editor, update } = documentSyncRoutes();

    update({ type: "init", content: "boot", generation: 9 });

    assert.strictEqual(editor.initialized.length, 1);
    assert.deepStrictEqual(editor.replaced, []);
  });
});

// ---- Toolbar save and tool selection use the canonical revision -------------

vi.mock("../packages/media/src/utils", () => ({ cleanContentForSave: (value: string) => value }));
vi.mock("../packages/media/src/lang", () => ({ t: (key: string) => key }));

describe("webview edit producers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("toolbar save requests the synchronized revision, never a DOM snapshot", async () => {
    const { initializeWebviewContentSync } = await import("../packages/media/src/content-sync");
    const { toolbar } = await import("../packages/media/src/toolbar");
    const posted: unknown[] = [];
    const contentSync = initializeWebviewContentSync((message) => posted.push(message), "canonical", 2);
    contentSync.acceptInput("canonical edit");
    const getValue = vi.fn(() => "truncated DOM");
    vi.stubGlobal("window", { vditor: { getValue } });

    const save = toolbar.find((item) => typeof item === "object" && item.name === "save") as { click(): void };
    save.click();

    assert.deepStrictEqual(posted.at(-1), { command: "save", content: "canonical edit", generation: 2, revision: 1 });
    assert.strictEqual(getValue.mock.calls.length, 0);
  });

  test("tool selection rewrites the canonical Markdown and emits it as an edit", async () => {
    vi.useFakeTimers();
    const { initializeWebviewContentSync } = await import("../packages/media/src/content-sync");
    const { applySelectedTools } = await import("../packages/media/src/tool-selector");
    const { updateFrontmatterTools } = await import("../packages/media/src/tool-selector-modal");
    const canonical = "---\ntools: []\n---\n# Agent";
    const posted: Array<{ command: string; content?: string }> = [];
    initializeWebviewContentSync((message) => posted.push(message), canonical, 1);
    const vditor = { getValue: vi.fn(() => "truncated DOM"), setValue: vi.fn() };
    vi.stubGlobal("window", { vditor });

    applySelectedTools(["search"]);

    const expected = updateFrontmatterTools(canonical, ["search"]);
    assert.deepStrictEqual(posted.at(-1), { command: "edit", content: expected, generation: 1, revision: 1 });
    assert.deepStrictEqual(vditor.setValue.mock.calls, [[expected]]);
    assert.strictEqual(vditor.getValue.mock.calls.length, 0);
  });
});
