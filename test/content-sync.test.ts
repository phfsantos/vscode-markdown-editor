import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";

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

test("Vditor input wiring uses callback markdown without reserializing the DOM", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "media", "src", "init-vditor.ts"),
    "utf8",
  );
  const inputCallback = source.match(/input\(value: string\) \{([\s\S]*?)\n\s*upload:/)?.[1] ?? "";

  assert.match(
    inputCallback,
    /synchronizeVditorInput\(contentSync, value\)/,
  );
  assert.doesNotMatch(inputCallback, /vditor\.getValue\(/);
  assert.doesNotMatch(inputCallback, /vditor\.setValue\(/);
});

test("toolbar save uses the authoritative synchronized revision", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "media", "src", "toolbar.ts"),
    "utf8",
  );
  const saveAction = source.match(/name: "save",([\s\S]*?)\n\s*\},\n\s*\{/)?.[1] ?? "";

  assert.match(saveAction, /getWebviewContentSync\(\)\.createSaveRequest\(\)/);
  assert.doesNotMatch(saveAction, /vditor\.getValue\(/);
});

test("find and replace relies on Vditor's input callback for serialization", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "media", "src", "find-replace.ts"),
    "utf8",
  );
  const updateMethod =
    source.match(/private updateVditorContent\(\): void \{([\s\S]*?)\n\s*\}\n\n\s*\/\*\*/)?.[1] ?? "";

  assert.match(updateMethod, /dispatchEvent\(inputEvent\)/);
  assert.doesNotMatch(updateMethod, /getValue\(/);
  assert.doesNotMatch(updateMethod, /acceptProgrammaticUpdate\(/);
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

test("external and DOM-mutating updates use authoritative synchronization boundaries", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "media", "src", "main.ts"),
    "utf8",
  );

  assert.match(source, /contentSync\.acceptExternalUpdate\(/);
  assert.match(source, /dispatchVditorInput\(vditor\)/);
  assert.doesNotMatch(source, /acceptProgrammaticUpdate\(rawContent\)/);
});

test("a stale external update does not arm the diagnostic refresh flag", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "media", "src", "main.ts"),
    "utf8",
  );
  const acceptedCheck = source.indexOf("if (!accepted)");
  const flagAssignment = source.indexOf("justReceivedExternalChange = true");

  assert.ok(acceptedCheck >= 0, "expected stale external updates to be rejected");
  assert.ok(
    flagAssignment > acceptedCheck,
    "the diagnostic refresh flag must only be armed after an update is accepted",
  );
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

test("DOM-mutating edit producers re-enter the authoritative input path", () => {
  const relativeFiles = [
    "cursor-manager.ts",
    "main.ts",
    path.join("renderers", "builtin", "DashboardRenderer.ts"),
    path.join("renderers", "builtin", "WidgetRenderer.ts"),
  ];

  for (const relativeFile of relativeFiles) {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "packages", "media", "src", relativeFile),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /command:\s*["']edit["']/,
      `${relativeFile} bypasses content synchronization`,
    );
    assert.match(source, /dispatchVditorInput\(/);
    assert.doesNotMatch(
      source,
      /acceptProgrammaticUpdate\((?:rawContent|content)\)/,
      `${relativeFile} promotes a live DOM serialization`,
    );
  }
});

test("tool selection transforms the canonical synchronized Markdown", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "packages", "media", "src", "tool-selector.ts"),
    "utf8",
  );
  const applySelectedTools =
    source.match(/export function applySelectedTools[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(applySelectedTools, /getWebviewContentSync\(\)\.getContent\(\)/);
  assert.doesNotMatch(applySelectedTools, /vditor\.getValue\(\)/);
  assert.match(applySelectedTools, /acceptProgrammaticUpdate\(updated\)/);
});
