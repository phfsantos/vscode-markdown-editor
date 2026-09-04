import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";

test("synchronized writes consume only their matching document change", async () => {
  let trackerModule: typeof import("../src/app/DocumentWriteOriginTracker") | null = null;
  try {
    trackerModule = await import("../src/app/DocumentWriteOriginTracker");
  } catch {
    // The assertion below is the expected red state until origin tracking exists.
  }
  assert.ok(trackerModule, "expected a document write origin tracker module");

  const tracker = trackerModule.createDocumentWriteOriginTracker();
  const pendingWrite = tracker.expect("local content");

  assert.strictEqual(tracker.consume("external content"), false);
  assert.strictEqual(tracker.consume("local content"), true);
  assert.strictEqual(tracker.consume("local content"), false);

  const cancelledWrite = tracker.expect("cancelled content");
  tracker.cancel(cancelledWrite);
  assert.strictEqual(tracker.consume("cancelled content"), false);

  tracker.cancel(pendingWrite);
});

test("synchronized LF writes remain internal when VS Code observes CRLF text", async () => {
  const { createDocumentWriteOriginTracker } = await import(
    "../src/app/DocumentWriteOriginTracker"
  );
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  const tracker = createDocumentWriteOriginTracker();
  const controller = createDocumentSyncController({
    applyContent: async () => {},
    saveDocument: async () => true,
  });
  const observeDocument = (content: string): boolean => {
    const isSynchronizedChange = tracker.consume(content);
    if (!isSynchronizedChange) {
      controller.acceptExternalContent(content);
    }
    return isSynchronizedChange;
  };

  tracker.expect("first line\nsecond line\n");
  assert.strictEqual(observeDocument("first line\r\nsecond line\r\n"), true);
  assert.strictEqual(controller.getGeneration(), 0);

  tracker.expect("first line\nsecond line\n");
  assert.strictEqual(observeDocument("first line\r\nchanged line\r\n"), false);
  assert.strictEqual(controller.getGeneration(), 1);
});

test("save waits for the highest accepted rapid revision", async () => {
  let controllerModule: typeof import("../src/app/DocumentSyncController") | null = null;
  try {
    controllerModule = await import("../src/app/DocumentSyncController");
  } catch {
    // The assertion below is the expected red state until the controller exists.
  }
  assert.ok(controllerModule, "expected a document synchronization controller module");

  const applied: string[] = [];
  const releases: Array<() => void> = [];
  let saves = 0;
  const controller = controllerModule.createDocumentSyncController({
    applyContent: async (content) => {
      applied.push(content);
      await new Promise<void>((resolve) => releases.push(resolve));
    },
    saveDocument: async () => {
      saves += 1;
    },
  });

  assert.strictEqual(controller.acceptEdit({ generation: 0, revision: 1, content: "one" }), true);
  assert.strictEqual(controller.acceptEdit({ generation: 0, revision: 2, content: "two" }), true);
  const saving = controller.save({ generation: 0, revision: 2, content: "two" });

  await Promise.resolve();
  assert.deepStrictEqual(applied, ["one"]);
  assert.strictEqual(saves, 0);

  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(applied, ["one", "two"]);
  assert.strictEqual(saves, 0);

  releases.shift()?.();
  assert.strictEqual(await saving, true);
  assert.strictEqual(saves, 1);
});

test("newer rapid edits coalesce while a replacement is in flight", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  const applied: string[] = [];
  const releases: Array<() => void> = [];
  const controller = createDocumentSyncController({
    applyContent: async (content) => {
      applied.push(content);
      await new Promise<void>((resolve) => releases.push(resolve));
    },
    saveDocument: async () => {},
  });

  controller.acceptEdit({ generation: 0, revision: 1, content: "one" });
  controller.acceptEdit({ generation: 0, revision: 2, content: "two" });
  controller.acceptEdit({ generation: 0, revision: 3, content: "three" });
  await Promise.resolve();
  assert.deepStrictEqual(applied, ["one"]);

  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(applied, ["one", "three"]);
  releases.shift()?.();
});

test("external generation rejects stale queued and future webview revisions", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  const releases: Array<() => void> = [];
  const controller = createDocumentSyncController({
    applyContent: async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
    },
    saveDocument: async () => {},
  });

  assert.strictEqual(controller.acceptEdit({ generation: 0, revision: 1, content: "old" }), true);
  assert.strictEqual(controller.advanceGeneration(), 1);
  assert.strictEqual(controller.acceptEdit({ generation: 0, revision: 2, content: "stale" }), false);
  assert.strictEqual(controller.acceptEdit({ generation: 1, revision: 1, content: "current" }), true);
  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  releases.shift()?.();
});

test("external content is queued behind an in-flight stale replacement", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  const applied: string[] = [];
  const releases: Array<() => void> = [];
  const controller = createDocumentSyncController({
    applyContent: async (content) => {
      applied.push(content);
      await new Promise<void>((resolve) => releases.push(resolve));
    },
    saveDocument: async () => true,
  });

  assert.strictEqual(
    typeof (controller as { acceptExternalContent?: unknown }).acceptExternalContent,
    "function",
  );
  controller.acceptEdit({ generation: 0, revision: 1, content: "stale local" });
  const generation = controller.acceptExternalContent("authoritative external");
  assert.strictEqual(generation, 1);
  assert.deepStrictEqual(applied, ["stale local"]);

  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(applied, ["stale local", "authoritative external"]);
  releases.shift()?.();
});

test("save retries a failed replacement before persisting", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  let applyAttempts = 0;
  let saves = 0;
  const controller = createDocumentSyncController({
    applyContent: async () => {
      applyAttempts += 1;
      if (applyAttempts === 1) {
        throw new Error("transient apply failure");
      }
    },
    saveDocument: async () => {
      saves += 1;
      return true;
    },
  });
  const revision = { generation: 0, revision: 1, content: "complete" };

  assert.strictEqual(controller.acceptEdit(revision), true);
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(await controller.save(revision), true);
  assert.strictEqual(applyAttempts, 2);
  assert.strictEqual(saves, 1);
});

test("edits accepted after a save barrier wait until saving finishes", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  const events: string[] = [];
  let releaseSave: (() => void) | undefined;
  const controller = createDocumentSyncController({
    applyContent: async (content) => {
      events.push(`apply:${content}`);
    },
    saveDocument: async () => {
      events.push("save:start");
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      events.push("save:end");
      return true;
    },
  });

  controller.acceptEdit({ generation: 0, revision: 1, content: "one" });
  await Promise.resolve();
  const saving = controller.save({ generation: 0, revision: 1, content: "one" });
  await Promise.resolve();
  controller.acceptEdit({ generation: 0, revision: 2, content: "two" });
  assert.deepStrictEqual(events, ["apply:one", "save:start"]);

  releaseSave?.();
  assert.strictEqual(await saving, true);
  await Promise.resolve();
  assert.deepStrictEqual(events, ["apply:one", "save:start", "save:end", "apply:two"]);
});

test("disposing revokes queued and future document writes", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  const applied: string[] = [];
  const releases: Array<() => void> = [];
  let saves = 0;
  const controller = createDocumentSyncController({
    applyContent: async (content) => {
      applied.push(content);
      await new Promise<void>((resolve) => releases.push(resolve));
    },
    saveDocument: async () => {
      saves += 1;
      return true;
    },
  });

  controller.acceptEdit({ generation: 0, revision: 1, content: "active" });
  controller.acceptEdit({ generation: 0, revision: 2, content: "queued" });
  const saving = controller.save({ generation: 0, revision: 2, content: "queued" });
  await Promise.resolve();
  assert.deepStrictEqual(applied, ["active"]);

  controller.dispose();
  assert.strictEqual(await saving, false);
  assert.strictEqual(
    controller.acceptEdit({ generation: 0, revision: 3, content: "future" }),
    false,
  );
  assert.strictEqual(
    await controller.save({ generation: 0, revision: 3, content: "future" }),
    false,
  );
  assert.strictEqual(controller.acceptExternalContent("external"), 0);

  releases.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepStrictEqual(applied, ["active"]);
  assert.strictEqual(saves, 0);
});

test("disposing invalidates an in-flight save result", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  let signalSaveStarted: (() => void) | undefined;
  let releaseSave: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => {
    signalSaveStarted = resolve;
  });
  const controller = createDocumentSyncController({
    applyContent: async () => {},
    saveDocument: async () => {
      signalSaveStarted?.();
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      return true;
    },
  });

  const saving = controller.save({ generation: 0, revision: 0, content: "initial" });
  await saveStarted;
  controller.dispose();
  releaseSave?.();

  assert.strictEqual(await saving, false);
});

test("a save reports failure when an external generation supersedes it", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  let signalSaveStarted: (() => void) | undefined;
  let releaseSave: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => {
    signalSaveStarted = resolve;
  });
  const controller = createDocumentSyncController({
    applyContent: async () => {},
    saveDocument: async () => {
      signalSaveStarted?.();
      await new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      return true;
    },
  });

  const saving = controller.save({ generation: 0, revision: 0, content: "initial" });
  await saveStarted;
  controller.acceptExternalContent("external");
  releaseSave?.();

  assert.strictEqual(await saving, false);
});

test("invalid revisions are rejected at the controller boundary", async () => {
  const { createDocumentSyncController } = await import(
    "../src/app/DocumentSyncController"
  );
  const controller = createDocumentSyncController({
    applyContent: async () => {},
    saveDocument: async () => true,
  });

  assert.strictEqual(
    controller.acceptEdit({ generation: 0, revision: Number.POSITIVE_INFINITY, content: "bad" }),
    false,
  );
  assert.strictEqual(
    await controller.save({ generation: Number.NaN, revision: 0, content: "bad" }),
    false,
  );
});

test("EditorPanel routes revisions and saves through one document controller", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "EditorPanel.ts"),
    "utf8",
  );

  assert.match(source, /createDocumentSyncController/);
  assert.match(source, /const accepted = this\._documentSync\.acceptEdit\(message\)/);
  assert.match(source, /if \(accepted\) \{[\s\S]{0,200}this\._lastWebviewEdit = Date\.now\(\)/);
  assert.match(source, /const saved = await this\._documentSync\.save\(message\)/);
  assert.match(source, /if \(!saved\) \{[\s\S]*?showError\(/);
  assert.match(source, /generation: this\._documentSync\.getGeneration\(\)/);
  assert.match(source, /this\._documentSync\.acceptExternalContent\(e\.document\.getText\(\)\)/);
  assert.match(source, /this\._documentWriteOrigins\.expect\(content\)/);
  assert.match(
    source,
    /this\._documentWriteOrigins\.consume\(\s*e\.document\.getText\(\),?\s*\)/,
  );
  assert.match(source, /const isExternalChange = !isSynchronizedChange/);
  assert.match(source, /dispose\(\)[\s\S]{0,500}this\._documentSync\.dispose\(\)/);
  assert.doesNotMatch(source, /detectExternalChange\(this, e\)/);
  assert.doesNotMatch(source, /const syncToEditor = async/);
});
