import { afterEach, describe, expect, test, vi } from "vitest";
import Vditor from "vditor";
import "vditor/dist/index.css";
import "vditor/dist/js/i18n/en_US.js";
import "vditor/dist/js/lute/lute.min.js";
import fixture from "./fixtures/custom-block-save.md?raw";
import { DiagnosticVisualizer } from "../packages/media/src/diagnostic-visualizer";
import {
  createWebviewContentSync,
  dispatchVditorInput,
  synchronizeVditorInput,
  type WebviewContentRevision,
} from "../packages/media/src/content-sync";
import { VSCodeWebviewIntegrator } from "../packages/media/src/vscode-integrator";

const STARTING_GENERATION = 17;

function installBundledVditorDependencies(): HTMLScriptElement[] {
  // Vditor normally injects these scripts from its CDN. Their bundles have
  // already run through browser-compatible imports above, so the sentinel
  // elements make initialization use those exact pinned local assets.
  const sentinels: HTMLScriptElement[] = [];
  for (const id of ["vditorLuteScript", "vditorIconScript"]) {
    if (!document.getElementById(id)) {
      const script = document.createElement("script");
      script.id = id;
      document.head.appendChild(script);
      sentinels.push(script);
    }
  }
  return sentinels;
}

const RESOURCE_SELECTOR = "script[src], link[href], img[src], audio[src], video[src], source[src]";

function isCrossOriginHttpUrl(value: string): boolean {
  const url = new URL(value, window.location.href);
  return (url.protocol === "http:" || url.protocol === "https:") &&
    url.origin !== window.location.origin;
}

function trackResourceNodes(records: MutationRecord[], trackedNodes: Set<Element>): void {
  for (const record of records) {
    for (const addedNode of record.addedNodes) {
      if (!(addedNode instanceof Element)) {
        continue;
      }
      if (addedNode.matches(RESOURCE_SELECTOR)) {
        trackedNodes.add(addedNode);
      }
      addedNode.querySelectorAll(RESOURCE_SELECTOR).forEach((node) => {
        trackedNodes.add(node);
      });

    }
  }
}

function setCollapsedSelection(node: Text, offset: number): void {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);

  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  selection!.removeAllRanges();
  selection!.addRange(range);
}

function expectDocumentStructure(
  markdown: string,
  direction: "TD" | "LR",
  pastedLine?: string,
): void {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const expected = fixture.replace(
    "flowchart TD",
    `flowchart ${direction}${pastedLine ? `\n${pastedLine}` : ""}`,
  );

  // Equality proves the callback returned the complete document rather than a
  // partial serialization of the code block whose DOM was changed.
  expect(normalized).toBe(expected);
  expect(normalized).toContain('START["Unicode start: café ☕"]');
  expect(normalized).toContain('FINISH["終わり"]');
  expect(normalized).toContain('MIDDLE{"Keep blank lines?"}');
  expect(normalized).toContain('  MIDDLE -->|yes|');
  expect(normalized).toContain("<!-- file: assets/fixture-board.json -->");
  expect(normalized).toContain("<!-- table: fixture-table -->");
  expect(normalized).toContain("<!-- file: assets/fixture-table.json -->");

  const orderedSegments = [
    "Before the custom blocks.",
    "```mermaid",
    "Between the custom blocks.",
    "```kanban-board",
    "```table",
    "After the custom blocks.",
  ];
  let previousIndex = -1;
  for (const segment of orderedSegments) {
    const index = normalized.indexOf(segment);
    expect(index, `${segment} should retain its document position`).toBeGreaterThan(
      previousIndex,
    );
    previousIndex = index;
  }
}

describe.each([
  ["LF", fixture],
  ["CRLF", fixture.replace(/\n/g, "\r\n")],
])("real Vditor IR synchronization with %s input", (_lineEnding, initialMarkdown) => {
  let editor: Vditor | undefined;
  let diagnosticVisualizer: DiagnosticVisualizer | undefined;
  let host: HTMLDivElement | undefined;
  let dependencySentinels: HTMLScriptElement[] = [];
  let resourceNodeObserver: MutationObserver | undefined;
  let performanceResourceObserver: PerformanceObserver | undefined;
  const resourceNodesCreatedByCase = new Set<Element>();

  afterEach(() => {
    diagnosticVisualizer?.cleanupTransientUI();
    editor?.destroy();
    resourceNodeObserver?.disconnect();
    performanceResourceObserver?.disconnect();
    resourceNodesCreatedByCase.forEach((node) => node.remove());
    resourceNodesCreatedByCase.clear();
    dependencySentinels.forEach((sentinel) => sentinel.remove());
    dependencySentinels = [];
    host?.remove();
    window.getSelection()?.removeAllRanges();
    performance.clearResourceTimings();
  });

  test("emits the complete mutated Markdown with synchronization metadata", async () => {
    performance.clearResourceTimings();
    const observedResourceEntries: PerformanceResourceTiming[] = [];
    performanceResourceObserver = new PerformanceObserver((list) => {
      observedResourceEntries.push(
        ...list.getEntries().filter(
          (entry): entry is PerformanceResourceTiming => entry.entryType === "resource",
        ),
      );
    });
    performanceResourceObserver.observe({ entryTypes: ["resource"] });

    resourceNodeObserver = new MutationObserver((records) => {
      trackResourceNodes(records, resourceNodesCreatedByCase);
    });
    resourceNodeObserver.observe(document.documentElement, { childList: true, subtree: true });

    dependencySentinels = installBundledVditorDependencies();

    host = document.createElement("div");
    document.body.appendChild(host);

    const messages: WebviewContentRevision[] = [];
    const contentSync = createWebviewContentSync(
      (message) => {
        if (message.command === "edit") {
          messages.push(message);
        }
      },
      initialMarkdown,
      STARTING_GENERATION,
    );

    const pastedLine = '  PASTED["Unicode paste: naïve 🚀"] --> START';
    let resolveNextInput: ((message: WebviewContentRevision) => void) | undefined;
    const waitForNextInput = () => new Promise<WebviewContentRevision>((resolve) => {
      resolveNextInput = resolve;
    });

    const ready = new Promise<void>((resolve) => {
      editor = new Vditor(host!, {
        after: resolve,
        cache: { enable: false },
        icon: "",
        i18n: window.VditorI18n,
        mode: "ir",
        toolbar: [],
        undoDelay: 0,
        value: initialMarkdown,
        input(markdown) {
          const message = synchronizeVditorInput(contentSync, markdown);
          resolveNextInput?.(message);
          resolveNextInput = undefined;
        },
        preview: {
          hljs: { enable: false },
          markdown: {
            codeBlockPreview: false,
            mathBlockPreview: false,
          },
          theme: {
            current: "",
            path: "",
          },
        },
      });
    });

    await ready;
    expect(editor!.version).toBe("3.11.2");
    expect(editor!.getCurrentMode()).toBe("ir");

    let sourceMarker = editor!.vditor.ir.element.querySelector<HTMLElement>(
      '.vditor-ir__marker--pre > code.language-mermaid',
    );
    expect(sourceMarker, "expected the editable Mermaid source marker in the real IR DOM").not.toBeNull();
    expect(sourceMarker!.closest(".vditor-ir__preview")).toBeNull();

    diagnosticVisualizer = new DiagnosticVisualizer(editor);
    const diagnosticLine = '  START["Unicode start: café ☕"] --> MIDDLE{"Keep blank lines?"}';
    const diagnosticStart = diagnosticLine.indexOf("START");
    diagnosticVisualizer.updateDiagnostics(
      [{
        message: '"START": Unknown word',
        source: "cSpell",
        severity: 2,
        lineText: diagnosticLine,
        range: {
          start: { line: 6, character: diagnosticStart },
          end: { line: 6, character: diagnosticStart + "START".length },
        },
      }],
      { documentText: initialMarkdown },
      true,
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const fencedBlock = sourceMarker!.closest<HTMLElement>('.vditor-ir__node[data-type="code-block"]')
      ?? sourceMarker!.closest<HTMLElement>(".vditor-ir__node");
    expect(fencedBlock, "expected the Mermaid source and preview to share a fenced block node").not.toBeNull();
    expect(sourceMarker!.querySelector(".vscode-diagnostic-span")).toBeNull();
    expect(sourceMarker!.querySelector("[data-has-lightbulb]")).toBeNull();
    expect(fencedBlock!.querySelector(".vditor-ir__preview .vscode-diagnostic-span")).toBeNull();
    expect(fencedBlock!.querySelector(".vditor-ir__preview [data-has-lightbulb]")).toBeNull();

    let sourceText = sourceMarker!.firstChild;
    expect(sourceText?.nodeType).toBe(Node.TEXT_NODE);
    const declarationEnd = sourceText!.textContent!.indexOf("flowchart TD") + "flowchart TD".length;
    const pastedSource = `${sourceText!.textContent!.slice(0, declarationEnd)}\n${pastedLine}${sourceText!.textContent!.slice(declarationEnd)}`;
    sourceText!.textContent = pastedSource;
    setCollapsedSelection(sourceText as Text, declarationEnd + 1 + pastedLine.length);

    const firstInputCompleted = waitForNextInput();
    expect(dispatchVditorInput(editor!)).toBe(true);
    const firstEdit = await firstInputCompleted;

    expect(messages).toEqual([firstEdit]);
    expect(firstEdit.generation).toBe(STARTING_GENERATION);
    expect(firstEdit.revision).toBe(1);
    expectDocumentStructure(firstEdit.content, "TD", pastedLine);

    sourceMarker = editor!.vditor.ir.element.querySelector<HTMLElement>(
      '.vditor-ir__marker--pre > code.language-mermaid',
    );
    expect(sourceMarker).not.toBeNull();
    sourceText = sourceMarker!.firstChild;
    expect(sourceText?.nodeType).toBe(Node.TEXT_NODE);
    const editedSource = sourceText!.textContent!.replace("flowchart TD", "flowchart LR");
    sourceText!.textContent = editedSource;
    setCollapsedSelection(sourceText as Text, editedSource.indexOf("flowchart LR") + "flowchart LR".length);

    const secondInputCompleted = waitForNextInput();
    expect(dispatchVditorInput(editor!)).toBe(true);
    const edit = await secondInputCompleted;

    expect(messages).toEqual([firstEdit, edit]);
    expect(edit.generation).toBe(STARTING_GENERATION);
    expect(edit.revision).toBe(2);
    expect(Object.keys(edit).sort()).toEqual([
      "command",
      "content",
      "generation",
      "revision",
    ]);
    expect(edit).not.toHaveProperty("origin");
    expect(edit).not.toHaveProperty("provenance");
    expect(contentSync.getGeneration()).toBe(STARTING_GENERATION);
    expect(contentSync.getContent()).toBe(edit.content);
    expectDocumentStructure(edit.content, "LR", pastedLine);

    performanceResourceObserver.takeRecords().forEach((entry) => {
      if (entry.entryType === "resource") {
        observedResourceEntries.push(entry as PerformanceResourceTiming);
      }
    });
    performanceResourceObserver.disconnect();
    trackResourceNodes(resourceNodeObserver.takeRecords(), resourceNodesCreatedByCase);

    const crossOriginRequests = new Set(
      [
        ...observedResourceEntries,
        ...performance.getEntriesByType("resource"),
      ]
        .map((entry) => entry.name)
        .filter(isCrossOriginHttpUrl),
    );
    const crossOriginResourceNodes = [...resourceNodesCreatedByCase]
      .map((node) => node.getAttribute("src") ?? node.getAttribute("href") ?? "")
      .filter(isCrossOriginHttpUrl);

    expect([...crossOriginRequests], "Vditor must not make cross-origin resource requests").toEqual([]);
    expect(
      crossOriginResourceNodes,
      "Vditor must not inject cross-origin resource elements",
    ).toEqual([]);
  });
});

test("preserves HTML-like text pasted into a Mermaid fenced block", async () => {
  const dependencySentinels = installBundledVditorDependencies();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const initialMarkdown = [
    "Before the diagram.",
    "",
    "```mermaid",
    "flowchart TD",
    '  START["beet pipeline"] --> AFTER["sentinel"]',
    "```",
    "",
    "After the diagram.",
    "",
  ].join("\n");
  const pastedLine = '  JEN["beet pipeline<br/>"] --> AFTER["sentinel"]';
  const messages: WebviewContentRevision[] = [];
  const contentSync = createWebviewContentSync(
    (message) => {
      if (message.command === "edit") {
        messages.push(message);
      }
    },
    initialMarkdown,
    STARTING_GENERATION,
  );
  let editor: Vditor | undefined;

  try {
    await new Promise<void>((resolve) => {
      editor = new Vditor(host, {
        after: resolve,
        cache: { enable: false },
        icon: "",
        i18n: window.VditorI18n,
        mode: "ir",
        toolbar: [],
        undoDelay: 0,
        value: initialMarkdown,
        input(markdown) {
          synchronizeVditorInput(contentSync, markdown);
        },
        preview: {
          hljs: { enable: false },
          markdown: {
            codeBlockPreview: false,
            mathBlockPreview: false,
          },
          theme: {
            current: "",
            path: "",
          },
        },
      });
    });

    const sourceMarker = editor.vditor.ir.element.querySelector<HTMLElement>(
      ".vditor-ir__marker--pre > code.language-mermaid",
    );
    expect(sourceMarker).not.toBeNull();
    const sourceText = sourceMarker!.firstChild;
    expect(sourceText?.nodeType).toBe(Node.TEXT_NODE);
    const insertionPoint = sourceText!.textContent!.indexOf("flowchart TD") + "flowchart TD".length;
    setCollapsedSelection(sourceText as Text, insertionPoint);

    const readText = vi.fn().mockResolvedValue(pastedLine);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    });
    const integrator = new VSCodeWebviewIntegrator(editor);
    await (integrator as unknown as {
      handlePaste(event: Event): Promise<void>;
    }).handlePaste(new Event("paste"));

    await vi.waitFor(() => expect(readText).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(messages).toHaveLength(1));

    expect(readText).toHaveReturnedWith(expect.any(Promise));
    expect(messages[0].content).toContain(pastedLine);
    expect(messages[0].content).toContain('AFTER["sentinel"]');
    expect(messages[0].content).not.toContain("&lt;br/&gt;");
    expect(contentSync.createSaveRequest().content).toBe(messages[0].content);
  } finally {
    editor?.destroy();
    host.remove();
    dependencySentinels.forEach((sentinel) => sentinel.remove());
  }
});
