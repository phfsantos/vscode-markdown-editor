import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DiagnosticVisualizer } from "../packages/media/src/diagnostic-visualizer";

let host: HTMLDivElement;
let editor: HTMLElement;
let visualizer: DiagnosticVisualizer;
let source = "";
const listeners: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
const originalAdd = document.addEventListener.bind(document);
const originalVscode = (window as any).vscode;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  window.getSelection()?.removeAllRanges();
  host = document.createElement("div");
  host.innerHTML = '<div class="vditor-ir"><pre class="vditor-reset" contenteditable="true"></pre></div>';
  document.body.appendChild(host);
  editor = host.querySelector("pre")!;
  // The production API has no dispose method. Record only constructor-installed
  // document handlers so each case can release them without reaching into state.
  const addSpy = vi.spyOn(document, "addEventListener").mockImplementation((type, listener, options) => {
    listeners.push([type, listener, options]);
    originalAdd(type, listener, options);
  });
  visualizer = new DiagnosticVisualizer({ getValue: () => source });
  addSpy.mockRestore();
});
afterEach(() => {
  listeners.splice(0).forEach(([type, listener, options]) => document.removeEventListener(type, listener, options));
  window.getSelection()?.removeAllRanges();
  visualizer.cleanupTransientUI();
  host.remove();
  (window as any).vscode = originalVscode;
  vi.clearAllTimers();
  vi.useRealTimers();
});

function mount(lines: string[]): void {
  source = lines.join("\n");
  editor.replaceChildren(...lines.map(line => {
    const p = document.createElement("p");
    p.textContent = line;
    return p;
  }));
}
function diagnostic(line: number, lineText: string, message = '"wrng": Unknown word', source = "cSpell") {
  const character = lineText.indexOf("wrng");
  return { message, source, severity: 2, lineText, range: { start: { line, character }, end: { line, character: character + 4 } } };
}
async function apply(diagnostics: ReturnType<typeof diagnostic>[]): Promise<void> {
  visualizer.updateDiagnostics(diagnostics, { documentText: source }, true);
  await vi.advanceTimersByTimeAsync(200);
}

test("trusted diagnostics target repeated words on their own rendered lines", async () => {
  const lines = ["wrng first", "wrng second", "wrng third"];
  mount(lines);
  await apply([diagnostic(1, lines[1])]);
  expect(editor.children[0].querySelector(".vscode-diagnostic-span")).toBeNull();
  expect(editor.children[1].querySelector(".vscode-diagnostic-span")?.textContent).toBe("wrng");
  expect(editor.children[2].querySelector(".vscode-diagnostic-span")).toBeNull();
  expect(editor.textContent).toBe(lines.join(""));
});

test("tooltip and quick fix remain separate from document content and cleanup removes transient UI", async () => {
  mount(["wrng word"]);
  await apply([diagnostic(0, source)]);
  const span = editor.querySelector<HTMLElement>(".vscode-diagnostic-span")!;
  expect(span.getAttribute("data-has-lightbulb")).toBe("true");
  span.dispatchEvent(new MouseEvent("mouseenter"));
  await vi.advanceTimersByTimeAsync(300);
  const tooltip = document.querySelector(".vscode-diagnostic-tooltip-hoverable")!;
  expect(tooltip.textContent).toContain('"wrng": Unknown word');
  expect(tooltip.textContent).toContain("cSpell");
  expect(editor.contains(tooltip)).toBe(false);
  const postMessage = vi.fn();
  (window as any).vscode = { postMessage };
  const rect = span.getBoundingClientRect();
  span.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.right - rect.width * 0.1 }));
  expect(postMessage).toHaveBeenCalledWith({ command: "openProblemsPanel" });
  visualizer.cleanupQuickFixUI();
  expect(document.querySelector('[data-diagnostic-ui="true"]')).toBeNull();
  expect(editor.querySelector('[data-has-lightbulb="true"]')).toBeNull();
  expect(editor.textContent).toBe(source);
});

for (const collapsed of [false, true]) {
  test(`typing cleanup preserves ${collapsed ? "the caret" : "selected text"} inside a decorated token`, async () => {
    mount(["prefix wrng suffix"]);
    await apply([diagnostic(0, source)]);
    const token = editor.querySelector(".vscode-diagnostic-span")!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(token, 1);
    range.setEnd(token, collapsed ? 1 : 3);
    selection.removeAllRanges();
    selection.addRange(range);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    expect(editor.querySelector(".vscode-diagnostic-span")).toBeNull();
    expect(editor.textContent).toBe(source);
    expect(selection.isCollapsed).toBe(collapsed);
    expect(selection.toString()).toBe(collapsed ? "" : "rn");
    const prefix = document.createRange();
    prefix.selectNodeContents(editor.children[0]);
    prefix.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
    expect(prefix.toString()).toBe("prefix w");
  });
}

test("external DOM replacement reapplies diagnostics without duplicating spans", async () => {
  mount(["wrng word"]);
  await apply([diagnostic(0, source)]);
  const previousSpan = editor.querySelector(".vscode-diagnostic-span");
  mount(["wrng word"]);
  visualizer.handleExternalChange();
  await vi.advanceTimersByTimeAsync(300);
  expect(previousSpan!.isConnected).toBe(false);
  expect(editor.querySelectorAll(".vscode-diagnostic-span")).toHaveLength(1);
  visualizer.handleExternalChange();
  await vi.advanceTimersByTimeAsync(300);
  expect(editor.querySelectorAll(".vscode-diagnostic-span")).toHaveLength(1);
  expect(editor.textContent).toBe(source);
});

test("untrusted sources are ignored", async () => {
  mount(["wrng word"]);
  await apply([diagnostic(0, source, "Untrusted report", "unknown-provider")]);
  expect(editor.querySelector(".vscode-diagnostic-span")).toBeNull();
  expect(editor.textContent).toBe(source);
});

test("overlapping diagnostics currently expose only the first message on a token", async () => {
  mount(["wrng word"]);
  await apply([
    diagnostic(0, source),
    diagnostic(0, source, "Expected a different word", "textlint"),
  ]);
  const spans = editor.querySelectorAll<HTMLElement>(".vscode-diagnostic-span");
  expect(spans).toHaveLength(1);
  spans[0].dispatchEvent(new MouseEvent("mouseenter"));
  await vi.advanceTimersByTimeAsync(300);
  // Characterizes current overlap suppression before extraction. Combining
  // both messages is a separate behavior change, not an extraction requirement.
  const tooltip = document.querySelector(".vscode-diagnostic-tooltip-content")!;
  expect(tooltip.textContent).toBe('"wrng": Unknown word (cSpell)');
});

test("extension scheduling restores existing diagnostics after transient cleanup", async () => {
  mount(["wrng word"]);
  await apply([diagnostic(0, source)]);
  visualizer.cleanupTransientUI();
  expect(editor.querySelector(".vscode-diagnostic-span")).toBeNull();
  visualizer.updateFromExtension([diagnostic(0, source)]);
  await vi.advanceTimersByTimeAsync(300);
  expect(editor.querySelectorAll(".vscode-diagnostic-span")).toHaveLength(1);
  expect(editor.textContent).toBe(source);
});

test("content fallback finds a whole-word match when the source line is outside the rendered map", async () => {
  mount(["wrngsuffix", "prefixwrng", "A wrng token remains."]);
  // Source line 10 has no corresponding DOM line, forcing content matching.
  await apply([diagnostic(10, "Different source context for wrng here")]);
  expect(editor.children[0].querySelector(".vscode-diagnostic-span")).toBeNull();
  expect(editor.children[1].querySelector(".vscode-diagnostic-span")).toBeNull();
  expect(editor.children[2].querySelector(".vscode-diagnostic-span")?.textContent).toBe("wrng");
  expect(editor.querySelectorAll(".vscode-diagnostic-span")).toHaveLength(1);
});

test("content fallback refuses matches embedded inside larger words", async () => {
  mount(["wrngsuffix", "prefixwrng"]);
  await apply([diagnostic(10, "A wrng token")]);
  expect(editor.querySelector(".vscode-diagnostic-span")).toBeNull();
  expect(editor.textContent).toBe("wrngsuffixprefixwrng");
});

test("content fallback decorates the repeated occurrence nearest the source character offset", async () => {
  const line = "wrng first, then wrng last";
  mount([line]);
  const report = diagnostic(10, line);
  const character = line.lastIndexOf("wrng");
  report.range.start.character = character;
  report.range.end.character = character + 4;
  await apply([report]);
  const span = editor.querySelector(".vscode-diagnostic-span")!;
  expect(span.textContent).toBe("wrng");
  const preceding = document.createRange();
  preceding.selectNodeContents(editor.children[0]);
  preceding.setEndBefore(span);
  expect(preceding.toString()).toBe("wrng first, then ");
  expect(editor.querySelectorAll(".vscode-diagnostic-span")).toHaveLength(1);
  expect(editor.textContent).toBe(line);
});
