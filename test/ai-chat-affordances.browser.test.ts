import { afterEach, expect, test, vi } from "vitest";
import { updateChatAnchorUI } from "../packages/media/src/chat-anchor-ui";
import { inlineSuggestionController } from "../packages/media/src/inline-suggestion-ui";

function addToChatButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="Add markdown file to chat"]');
}

afterEach(() => {
  updateChatAnchorUI(undefined, { postMessage: vi.fn() });
  inlineSuggestionController.updateEligibility({ enabled: false });
  document.querySelector(".vditor-ir")?.remove();
  delete (window as any).vditor;
  vi.useRealTimers();
});

test("add-to-chat button asks the host to add the file", () => {
  const target = { postMessage: vi.fn() };

  updateChatAnchorUI({ visible: true, relativePath: "notes.md" }, target);
  addToChatButton()!.click();

  expect(target.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "requestAddToChat" });
});

test("add-to-chat button disappears when the host hides it", () => {
  const target = { postMessage: vi.fn() };
  updateChatAnchorUI({ visible: true, relativePath: "notes.md" }, target);

  updateChatAnchorUI({ visible: false, relativePath: "notes.md" }, target);

  expect(addToChatButton()).toBeNull();
});

function editorWithCaret(text: string): void {
  const ir = document.createElement("div");
  ir.className = "vditor-ir";
  const reset = document.createElement("div");
  reset.className = "vditor-reset";
  reset.contentEditable = "true";
  reset.textContent = text;
  ir.appendChild(reset);
  document.body.appendChild(ir);
  const range = document.createRange();
  range.setStart(reset.firstChild!, text.length);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

async function showSuggestion(suggestion: string) {
  vi.useFakeTimers();
  const target = { postMessage: vi.fn() };
  const vditor = { insertValue: vi.fn() };
  (window as any).vditor = vditor;
  editorWithCaret("Hello wor");
  inlineSuggestionController.initialize(target);
  inlineSuggestionController.updateEligibility({ enabled: true });

  inlineSuggestionController.handleEditorInput({ content: "Hello wor" });
  await vi.advanceTimersByTimeAsync(400);
  const request = target.postMessage.mock.calls[0][0];
  inlineSuggestionController.handleSuggestionResponse({ requestId: request.requestId, suggestion });
  return { request, vditor };
}

function marker(): HTMLElement | null {
  return document.querySelector("[data-inline-suggestion-marker]");
}

test("debounced input requests a suggestion with the cursor context", async () => {
  const { request } = await showSuggestion("ld");

  expect(request).toMatchObject({
    command: "requestInlineSuggestion",
    content: "Hello wor",
    beforeCursor: "Hello wor",
    manual: false,
  });
  expect(marker()?.getAttribute("data-inline-suggestion")).toBe("ld");
});

test("Tab accepts the suggestion into the editor", async () => {
  const { vditor } = await showSuggestion("ld");

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));

  expect(vditor.insertValue).toHaveBeenCalledWith("ld");
  expect(marker()).toBeNull();
});

test("Escape dismisses the suggestion without inserting it", async () => {
  const { vditor } = await showSuggestion("ld");

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  expect(vditor.insertValue).not.toHaveBeenCalled();
  expect(marker()).toBeNull();
});

test("typing the next suggested character consumes it", async () => {
  await showSuggestion("ld");

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true }));
  await vi.advanceTimersToNextFrame();

  expect(marker()?.getAttribute("data-inline-suggestion")).toBe("d");
});

test("a stale response for an older request is ignored", async () => {
  const { request } = await showSuggestion("ld");

  inlineSuggestionController.handleSuggestionResponse({ requestId: `${request.requestId}-old`, suggestion: "xx" });

  expect(marker()?.getAttribute("data-inline-suggestion")).toBe("ld");
});
