import { afterEach, describe, expect, test } from "vitest";
import Vditor from "vditor";
import "vditor/dist/index.css";
import "vditor/dist/js/i18n/en_US.js";
import "vditor/dist/js/lute/lute.min.js";
import fixture from "./fixtures/custom-block-save.md?raw";
import {
  createWebviewContentSync,
  dispatchVditorInput,
  synchronizeVditorInput,
  type WebviewContentRevision,
} from "../packages/media/src/content-sync";

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

function expectDocumentStructure(markdown: string, editedBoard: string): void {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const expected = fixture.replace(
    "<!-- board: fixture-board -->",
    `<!-- board: ${editedBoard} -->`,
  );

  // Equality proves the callback returned the complete document rather than a
  // partial serialization of the code block whose DOM was changed.
  expect(normalized).toBe(expected);
  expect(normalized).toContain('START["Unicode start: café ☕"]');
  expect(normalized).toContain('FINISH["終わり"]');
  expect(normalized).toContain(
    'MIDDLE{"Keep blank lines?"}\n\n  MIDDLE -->|yes|',
  );
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
  let host: HTMLDivElement | undefined;
  let dependencySentinels: HTMLScriptElement[] = [];
  let resourceNodeObserver: MutationObserver | undefined;
  let performanceResourceObserver: PerformanceObserver | undefined;
  const resourceNodesCreatedByCase = new Set<Element>();

  afterEach(() => {
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

    const editedBoard = `fixture-board-edited-${_lineEnding.toLowerCase()}`;
    let resolveInput!: (message: WebviewContentRevision) => void;
    const inputCompleted = new Promise<WebviewContentRevision>((resolve) => {
      resolveInput = resolve;
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
          if (markdown.includes(editedBoard)) {
            resolveInput(message);
          }
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

    const sourceMarker = editor!.vditor.ir.element.querySelector<HTMLElement>(
      '.vditor-ir__marker--pre > code.language-kanban-board',
    );
    expect(sourceMarker, "expected the editable kanban source marker in the real IR DOM").not.toBeNull();
    expect(sourceMarker!.closest(".vditor-ir__preview")).toBeNull();

    const sourceText = sourceMarker!.firstChild;
    expect(sourceText?.nodeType).toBe(Node.TEXT_NODE);
    const mutatedSource = sourceText!.textContent!.replace("fixture-board", editedBoard);
    sourceText!.textContent = mutatedSource;
    setCollapsedSelection(sourceText as Text, mutatedSource.indexOf(editedBoard) + editedBoard.length);

    expect(dispatchVditorInput(editor!)).toBe(true);
    const edit = await inputCompleted;

    expect(messages).toEqual([edit]);
    expect(edit.generation).toBe(STARTING_GENERATION);
    expect(edit.revision).toBe(1);
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
    expectDocumentStructure(edit.content, editedBoard);

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
