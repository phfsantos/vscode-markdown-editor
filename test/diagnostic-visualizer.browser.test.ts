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

test("exact-token diagnostics expose both messages on one token", async () => {
  mount(["wrng word"]);
  await apply([
    diagnostic(0, source),
    diagnostic(0, source, "Expected a different word", "textlint"),
  ]);
  const spans = editor.querySelectorAll<HTMLElement>(".vscode-diagnostic-span");
  expect(spans).toHaveLength(1);
  spans[0].dispatchEvent(new MouseEvent("mouseenter"));
  await vi.advanceTimersByTimeAsync(300);
  const tooltip = document.querySelector(".vscode-diagnostic-tooltip-content")!;
  expect(tooltip.textContent).toBe('"wrng": Unknown word (cSpell)\nExpected a different word (textlint)');
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

for (const line of [0, 10]) {
  test(`exact-token aggregation survives updates and cleanup on source line ${line}`, async () => {
    mount(["wrng word"]);
    const style = diagnostic(line, source, "Style advice", "textlint");
    const spelling = diagnostic(line, source);
    const reports = [style, spelling, { ...spelling }];
    const expected = 'Style advice (textlint)\n"wrng": Unknown word (cSpell)';
    for (let update = 0; update < 2; update++) {
      await apply(reports);
      const spans = editor.querySelectorAll<HTMLElement>(".vscode-diagnostic-span");
      expect(spans).toHaveLength(1);
      expect(spans[0].dataset.diagnosticMessage).toBe(expected);
      expect(spans[0].dataset.diagnosticSource).toBe("textlint, cSpell");
      expect(spans[0].dataset.hasLightbulb).toBe("true");
      spans[0].dispatchEvent(new MouseEvent("mouseenter"));
      await vi.advanceTimersByTimeAsync(300);
      expect(document.querySelector(".vscode-diagnostic-tooltip-content")?.textContent).toBe(expected);
      const postMessage = vi.fn();
      (window as any).vscode = { postMessage };
      const rect = spans[0].getBoundingClientRect();
      spans[0].dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.right - rect.width * 0.1 }));
      expect(postMessage).toHaveBeenCalledExactlyOnceWith({ command: "openProblemsPanel" });
      expect(editor.textContent).toBe(source);
    }
    visualizer.cleanupTransientUI();
    expect(editor.querySelector(".vscode-diagnostic-span")).toBeNull();
    expect(document.querySelector('[data-diagnostic-ui="true"]')).toBeNull();
    expect(editor.textContent).toBe(source);
    await apply(reports);
    expect(editor.querySelectorAll(".vscode-diagnostic-span")).toHaveLength(1);
    expect(editor.querySelector<HTMLElement>(".vscode-diagnostic-span")?.dataset.diagnosticMessage).toBe(expected);
    visualizer.cleanupTransientUI();
    await apply([style]);
    expect(editor.querySelector<HTMLElement>(".vscode-diagnostic-span")?.dataset.diagnosticMessage).toBe("Style advice (textlint)");
    expect(editor.querySelector('[data-has-lightbulb="true"]')).toBeNull();
    expect(editor.textContent).toBe(source);
  });
}

test("identical messages from distinct trusted sources are preserved", async () => {
  mount(["wrng word"]);
  await apply([
    diagnostic(0, source, "Style advice", "textlint"),
    diagnostic(0, source, "Style advice", "remark-lint"),
    diagnostic(0, source, "Ignored", "unknown-provider"),
  ]);
  expect(editor.querySelectorAll(".vscode-diagnostic-span")).toHaveLength(1);
  expect(editor.querySelector<HTMLElement>(".vscode-diagnostic-span")?.dataset.diagnosticMessage)
    .toBe("Style advice (textlint)\nStyle advice (remark-lint)");
});

for (const force of [false, true]) {
  test(`empty reports clear existing decorations (force=${force})`, async () => {
    mount(["wrng word"]);
    await apply([diagnostic(0, source)]);
    visualizer.updateDiagnostics([], { documentText: source }, force);
    await vi.advanceTimersByTimeAsync(200);
    expect(editor.querySelector(".vscode-diagnostic-span")).toBeNull();
    expect(editor.querySelector('[data-has-lightbulb="true"]')).toBeNull();
    expect(document.querySelector('[data-diagnostic-ui="true"]')).toBeNull();
    expect(editor.textContent).toBe(source);
    await apply([diagnostic(0, source)]);
    expect(editor.querySelectorAll(".vscode-diagnostic-span")).toHaveLength(1);
  });

  test(`replacing reports removes obsolete messages and quick fixes (force=${force})`, async () => {
    mount(["wrng word"]);
    const style = diagnostic(0, source, "Style advice", "textlint");
    await apply([style, diagnostic(0, source)]);
    visualizer.updateDiagnostics([style], { documentText: source }, force);
    await vi.advanceTimersByTimeAsync(200);
    const spans = editor.querySelectorAll<HTMLElement>(".vscode-diagnostic-span");
    expect(spans).toHaveLength(1);
    expect(spans[0].dataset.diagnosticMessage).toBe("Style advice (textlint)");
    expect(editor.querySelector('[data-has-lightbulb="true"]')).toBeNull();
    spans[0].dispatchEvent(new MouseEvent("mouseenter"));
    await vi.advanceTimersByTimeAsync(300);
    expect(document.querySelector(".vscode-diagnostic-tooltip-content")?.textContent).toBe("Style advice (textlint)");
    expect(editor.textContent).toBe(source);
  });
}

for (const collapsed of [false, true]) {
  test(`report replacement preserves ${collapsed ? "caret" : "selection"} on the active line`, async () => {
    mount(["prefix wrng suffix", "wrng elsewhere"]);
    await apply([diagnostic(0, "prefix wrng suffix"), diagnostic(1, "wrng elsewhere")]);
    editor.focus();
    const token = editor.querySelector(".vscode-diagnostic-span")!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(token, 1);
    range.setEnd(token, collapsed ? 1 : 3);
    selection.removeAllRanges();
    selection.addRange(range);
    await apply([diagnostic(1, "wrng elsewhere", "Replacement advice", "textlint")]);
    expect(document.activeElement).toBe(editor);
    expect(selection.anchorNode).toBe(token);
    expect(selection.anchorOffset).toBe(1);
    expect(selection.isCollapsed).toBe(collapsed);
    expect(selection.toString()).toBe(collapsed ? "" : "rn");
    expect(editor.children[1].querySelector<HTMLElement>(".vscode-diagnostic-span")?.dataset.diagnosticMessage)
      .toBe("Replacement advice (textlint)");
    expect(editor.textContent).toBe("prefix wrng suffixwrng elsewhere");
  });
}

for (const empty of [false, true]) {
  test(`obsolete spans clear after the caret leaves (empty=${empty})`, async () => {
    mount(["wrng word", "Other line"]);
    await apply([diagnostic(0, "wrng word")]);
    editor.focus();
    const token = editor.querySelector(".vscode-diagnostic-span")!.firstChild!;
    const selection = window.getSelection()!;
    selection.setPosition(token, 1);
    document.dispatchEvent(new Event("selectionchange"));
    await apply(empty ? [] : [diagnostic(0, "wrng word", "Style advice", "textlint")]);
    expect(selection.anchorNode).toBe(token);
    expect(selection.anchorOffset).toBe(1);
    selection.setPosition(editor.children[1].firstChild!, 1);
    document.dispatchEvent(new Event("selectionchange"));
    await vi.advanceTimersByTimeAsync(300);
    const spans = editor.querySelectorAll<HTMLElement>(".vscode-diagnostic-span");
    expect(spans).toHaveLength(empty ? 0 : 1);
    if (!empty) expect(spans[0].dataset.diagnosticMessage).toBe("Style advice (textlint)");
    expect(editor.querySelector('[data-has-lightbulb="true"]')).toBeNull();
    expect(selection.anchorNode).toBe(editor.children[1].firstChild);
    expect(selection.anchorOffset).toBe(1);
    expect(editor.textContent).toBe("wrng wordOther line");
  });
}

test("partial overlaps retain first-range precedence", async () => {
  mount(["wrng word"]);
  const wider = diagnostic(0, source, "Wider advice", "textlint");
  wider.range.end.character = source.length;
  await apply([diagnostic(0, source), wider]);
  const spans = editor.querySelectorAll<HTMLElement>(".vscode-diagnostic-span");
  expect(spans).toHaveLength(1);
  expect(spans[0].textContent).toBe("wrng");
  expect(spans[0].dataset.diagnosticMessage).toBe('"wrng": Unknown word (cSpell)');
  expect(editor.textContent).toBe(source);
});

test("repeated tokens on one line keep their own messages", async () => {
  mount(["wrng then wrng"]);
  const second = diagnostic(0, source, "Second occurrence", "textlint");
  second.range.start.character = source.lastIndexOf("wrng");
  second.range.end.character = source.length;
  await apply([diagnostic(0, source), second]);
  const spans = editor.querySelectorAll<HTMLElement>(".vscode-diagnostic-span");
  expect(spans).toHaveLength(2);
  expect(spans[0].dataset.diagnosticMessage).toBe('"wrng": Unknown word (cSpell)');
  expect(spans[1].dataset.diagnosticMessage).toBe("Second occurrence (textlint)");
  expect(editor.textContent).toBe(source);
});
