import assert from "node:assert/strict";
import { afterEach, test } from "vitest";

import { DiffVisualizer } from "../packages/media/src/diff-visualizer";

class FakeTextNode {
  readonly nodeType = 3;
  readonly childNodes: FakeNode[] = [];
  parentElement: FakeElement | null = null;

  constructor(readonly textContent: string) {}
}

type FakeNode = FakeElement | FakeTextNode;

class FakeStyle {
  backgroundColor = "";
  borderLeft = "";
  paddingLeft = "";
  paddingBottom = "";
  pointerEvents = "";
  cursor = "";
  opacity = "";
  height = "";
  top = "";
  private value = "";

  set cssText(value: string) {
    this.value = value;
    for (const declaration of value.split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 0) {
        continue;
      }
      const property = declaration.slice(0, separator).trim();
      const propertyValue = declaration.slice(separator + 1).trim();
      if (property === "top") this.top = propertyValue;
      if (property === "height") this.height = propertyValue;
      if (property === "opacity") this.opacity = propertyValue;
    }
  }

  get cssText(): string {
    return this.value;
  }
}

class FakeElement {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly childNodes: FakeNode[] = [];
  readonly style = new FakeStyle();
  readonly listeners = new Map<string, Array<() => void>>();
  parentElement: FakeElement | null = null;
  title = "";
  offsetTop = 0;
  scrollHeight = 0;
  scrollIntoViewCalls = 0;
  private attributes = new Map<string, string>();

  constructor(tagName: string, text = "") {
    this.tagName = tagName.toUpperCase();
    if (text) {
      this.appendChild(new FakeTextNode(text));
    }
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node.nodeType === 1);
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  get nextSibling(): FakeNode | null {
    if (!this.parentElement) return null;
    const index = this.parentElement.childNodes.indexOf(this);
    return this.parentElement.childNodes[index + 1] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  get className(): string {
    return this.getAttribute("class") ?? "";
  }

  set className(value: string) {
    this.setAttribute("class", value);
  }

  get classList(): { add: (...names: string[]) => void } {
    return {
      add: (...names: string[]) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach((name) => classes.add(name));
        this.className = [...classes].join(" ");
      },
    };
  }

  set innerHTML(value: string) {
    this.childNodes.splice(0);
    const match = value.match(/^\s*<([a-z][\w-]*)[^>]*>([\s\S]*)<\/\1>\s*$/i);
    if (match) {
      this.appendChild(new FakeElement(match[1], match[2].replace(/<[^>]+>/g, "")));
    }
  }

  appendChild<T extends FakeNode>(child: T): T {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore<T extends FakeNode>(child: T, reference: FakeNode | null): T {
    child.parentElement = this;
    const index = reference ? this.childNodes.indexOf(reference) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.childNodes.indexOf(this);
    if (index >= 0) this.parentElement.childNodes.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  scrollIntoView(): void {
    this.scrollIntoViewCalls += 1;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll("*")]);
    if (selector === "*") return descendants;
    return descendants.filter((element) => matches(element, selector));
  }
}

function matches(element: FakeElement, selector: string): boolean {
  const attributeMatches = [...selector.matchAll(/\[([\w-]+)="([^"]+)"\]/g)];
  const classMatch = selector.match(/\.([\w-]+)/);
  const tagMatch = selector.match(/^([a-z][\w-]*)/i);
  return (!tagMatch || element.tagName === tagMatch[1].toUpperCase()) &&
    (!classMatch || element.className.split(/\s+/).includes(classMatch[1])) &&
    attributeMatches.every((match) => element.getAttribute(match[1]) === match[2]);
}

class FakeDocument {
  readonly body = new FakeElement("body");

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === ".vditor-ir > pre.vditor-reset") {
      return this.body.querySelector("pre.vditor-reset");
    }
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.body.querySelectorAll(selector);
  }
}

interface VisualizerHarness {
  appliedDecorations: Map<unknown, unknown>;
  diffInfo: {
    role: "left";
    otherUri: string;
    changes: Array<{
      type: "spacer" | "modified";
      lineNumber: number;
      content: string;
      side: "left";
    }>;
    stats: { added: number; deleted: number; modified: number };
  };
  applyLineDecorations(): void;
  reapplyDecorationsAfterInput(): void;
  verifyDiffDecorationsExist(): boolean;
  addScrollbarDiffIndicators(): void;
}

const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
});

function arrangeDiffWithSpacer(): {
  visualizer: VisualizerHarness;
  document: FakeDocument;
  lines: FakeElement[];
} {
  const document = new FakeDocument();
  const content = new FakeElement("pre");
  content.className = "vditor-reset";
  content.scrollHeight = 100;
  const lines = ["first", "second", "third"].map((text, index) => {
    const line = new FakeElement("p", text);
    line.offsetTop = index * 25;
    content.appendChild(line);
    return line;
  });
  document.body.appendChild(content);
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });

  const visualizer = new DiffVisualizer() as unknown as VisualizerHarness;
  visualizer.diffInfo = {
    role: "left",
    otherUri: "other.md",
    changes: [
      { type: "spacer", lineNumber: 1, content: "<div></div>", side: "left" },
      { type: "modified", lineNumber: 2, content: "second", side: "left" },
    ],
    stats: { added: 0, deleted: 0, modified: 1 },
  };
  return { visualizer, document, lines };
}

test("a spacer shifts later diff decoration onto the original rendered line", () => {
  const { visualizer, lines } = arrangeDiffWithSpacer();

  visualizer.applyLineDecorations();

  assert.equal(lines[1].getAttribute("data-diff-type"), "modified");
  assert.equal(lines[1].getAttribute("data-diff-line"), "2");
  assert.equal(lines[2].hasAttribute("data-diff-type"), false);
});

test("input reapplication preserves spacer-shifted decoration targeting", () => {
  const { visualizer, lines } = arrangeDiffWithSpacer();
  visualizer.applyLineDecorations();

  visualizer.reapplyDecorationsAfterInput();

  assert.equal(lines[1].getAttribute("data-diff-line"), "2");
  assert.equal(lines[2].hasAttribute("data-diff-type"), false);
});

test("input reapplication does not retain removed spacer decorations", () => {
  const { visualizer } = arrangeDiffWithSpacer();
  visualizer.applyLineDecorations();

  visualizer.reapplyDecorationsAfterInput();
  visualizer.reapplyDecorationsAfterInput();

  assert.equal(visualizer.appliedDecorations.size, 2);
});

test("decoration verification recognizes changes after a spacer", () => {
  const { visualizer } = arrangeDiffWithSpacer();
  visualizer.applyLineDecorations();

  assert.equal(visualizer.verifyDiffDecorationsExist(), true);
});

test("scrollbar markers use the same shifted rendered target as line decoration", () => {
  const { visualizer, document, lines } = arrangeDiffWithSpacer();
  visualizer.applyLineDecorations();

  visualizer.addScrollbarDiffIndicators();

  const marker = document.querySelector(".diff-scrollbar-marker-modified");
  assert.ok(marker);
  assert.equal(lines[1].getAttribute("data-diff-type"), "modified");
  assert.equal(marker.style.top, "25%");
});

test("scrollbar marker clicks scroll the spacer-shifted rendered target", () => {
  const { visualizer, document, lines } = arrangeDiffWithSpacer();
  visualizer.applyLineDecorations();
  visualizer.addScrollbarDiffIndicators();
  const marker = document.querySelector(".diff-scrollbar-marker-modified");
  assert.ok(marker);

  marker.listeners.get("click")?.[0]?.();

  assert.equal(lines[1].scrollIntoViewCalls, 1);
  assert.equal(lines[2].scrollIntoViewCalls, 0);
});
