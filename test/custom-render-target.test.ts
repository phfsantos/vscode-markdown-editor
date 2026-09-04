import assert from "node:assert/strict";
import { test } from "vitest";

test("direct custom-renderer code elements are normalized to their wrapper", async () => {
  const rendererModule = await import("../packages/media/src/renderers/init");
  assert.strictEqual(typeof rendererModule.normalizeCustomRenderTarget, "function");

  const wrapper = {
    matches: () => false,
    parentElement: null,
  } as unknown as HTMLElement;
  const code = {
    matches: (selector: string) => selector === "code.language-kanban-board",
    parentElement: wrapper,
  } as unknown as HTMLElement;

  assert.strictEqual(
    rendererModule.normalizeCustomRenderTarget(code, "kanban-board"),
    wrapper,
  );
});

test("wrapper and detached code inputs remain safe", async () => {
  const { normalizeCustomRenderTarget } = await import(
    "../packages/media/src/renderers/init"
  );
  const wrapper = {
    matches: () => false,
    parentElement: null,
  } as unknown as HTMLElement;
  const detachedCode = {
    matches: () => true,
    parentElement: null,
  } as unknown as HTMLElement;

  assert.strictEqual(normalizeCustomRenderTarget(wrapper, "table"), wrapper);
  assert.strictEqual(
    normalizeCustomRenderTarget(detachedCode, "table"),
    detachedCode,
  );
});
