/**
 * Real-Vditor regression tests for the diff view (plan
 * plan-diff-view-overhaul-inline-previous-version-full). Each test began as a
 * failing repro in docs/testing/diff-view-findings.md.
 */
import { afterEach, beforeAll, expect, test } from "vitest";
import { WebviewDiffView } from "../packages/media/src/diff/controller";
import { getValue } from "../packages/media/src/save-cleaning";
import { mountRealVditor, renderedLineElement, renderedLineOf } from "./helpers/realVditor";

type Change = {
  type: "added" | "deleted" | "modified" | "spacer";
  lineNumber: number;
  content: string;
  oldContent?: string;
  side: "left" | "right" | "both";
};

let mounted: Awaited<ReturnType<typeof mountRealVditor>> | undefined;
const posted: unknown[] = [];
let readOnly = false;
const diffVisualizer = new WebviewDiffView({ postScrollAnchor: (anchor) => posted.push(anchor), isReadOnly: () => readOnly });
beforeAll(() => undefined);
afterEach(() => {
  diffVisualizer.clear();
  mounted?.dispose();
  mounted = undefined;
  performance.clearMarks();
});

let version = 0;
function sendDiff(role: "left" | "right", changes: Change[], mode: "side-by-side" | "inline" = "side-by-side"): void {
  diffVisualizer.show({ role, mode, otherUri: "file:///other.md", changes, stats: { added: 0, deleted: 0, modified: 0 }, version: ++version });
}

/** Any of the diff view's rendering strategies has finished painting. */
async function diffPainted(content: HTMLElement, expected: number): Promise<void> {
  await expect.poll(() =>
    document.querySelectorAll("[data-diff-type], [data-diff-previous], .diff-spacer-block").length,
    { timeout: 5000 },
  ).toBeGreaterThanOrEqual(expected);
  expect(content.isConnected).toBe(true);
}

const SAVE_FIXTURE = [
  "# Save integrity",
  "",
  "- Parent item",
  "  - Child one",
  "- Sibling item",
  "",
  "| Check | Result |",
  "| --- | --- |",
  "| Layout | Stable |",
  "",
  "```js",
  "const kept = true;",
  "```",
  "",
  "Tail paragraph.",
  "",
].join("\n");

// Deleted blocks as the host sends them: rendered HTML from the other side.
const DELETED_NESTED_LIST = '<ul data-tight="true" data-marker="-" data-block="0"><li data-marker="-"><p>Gone parent</p><ul data-tight="true" data-marker="-" data-block="0"><li data-marker="-"><p>LEAK-nested-child</p></li></ul></li></ul>';
const DELETED_TABLE = '<table data-block="0" data-type="table"><thead><tr><th>LEAK-table-head</th></tr></thead><tbody><tr><td>LEAK-table-cell</td></tr></tbody></table>';
const DELETED_CODE = '<div class="vditor-ir__node" data-type="code-block" data-block="0" data-language="js"><span data-type="code-block-open-marker">```</span><span class="vditor-ir__marker--info" data-type="code-block-info">js</span><pre class="vditor-ir__marker--pre vditor-ir__marker"><code class="language-js">const LEAK_code = 1;\n</code></pre><span data-type="code-block-close-marker">```</span></div>';

test("save integrity: nested spacer and previous-version content never reaches getValue", async () => {
  mounted = await mountRealVditor(SAVE_FIXTURE);
  const { editor, content } = mounted;
  const before = getValue(editor.vditor);
  const childLine = renderedLineOf(content, "Child one");
  const tableLine = renderedLineOf(content, "Layout");
  const tailLine = renderedLineOf(content, "Tail paragraph.");
  sendDiff("right", [
    { type: "spacer", lineNumber: childLine + 1, content: DELETED_NESTED_LIST, side: "right" },
    { type: "spacer", lineNumber: tableLine + 2, content: DELETED_TABLE, side: "right" },
    { type: "spacer", lineNumber: tailLine + 3, content: DELETED_CODE, side: "right" },
  ]);
  await diffPainted(content, 3);

  const afterDiff = getValue(editor.vditor);
  expect(afterDiff).not.toMatch(/LEAK/);
  expect(afterDiff).toBe(before);

  // Typing next to a deleted nested block re-renders the surrounding list in Vditor.
  const child = [...content.querySelectorAll("li")].find((li) => li.textContent?.startsWith("Child one"))!;
  const text = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  while (text.nextNode()) last = text.currentNode as Text;
  const range = document.createRange();
  range.setStart(last!, last!.length);
  range.collapse(true);
  content.focus();
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  document.execCommand("insertText", false, " edited");
  await expect.poll(() => getValue(editor.vditor), { timeout: 3000 }).toContain("Child one edited");
  const afterEdit = getValue(editor.vditor);
  expect(afterEdit).not.toMatch(/LEAK/);
  expect(afterEdit).toBe(before.replace("Child one", "Child one edited"));
});

const GEOMETRY_FIXTURE = [
  "# Heading target",
  "",
  "- [ ] Task target",
  "- Parent",
  "  - Nested target",
  "",
  "| Col | Value |",
  "| --- | --- |",
  "| Row target | 1 |",
  "",
  "```js",
  "const codeTarget = 1;",
  "```",
  "",
].join("\n");

function firstTextLeft(element: Element, needle: string): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const index = node.data.indexOf(needle);
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return range.getBoundingClientRect().left;
    }
  }
  throw new Error(`text "${needle}" not found`);
}

/** The rectangle the diff paints for a decorated line: an overlay row, or the element's own background. */
function paintedRect(content: HTMLElement, line: number, element: HTMLElement): DOMRect | null {
  const overlay = document.querySelector<HTMLElement>(`[data-diff-paint-line="${line}"]`);
  if (overlay) return overlay.getBoundingClientRect();
  const background = getComputedStyle(element).backgroundColor;
  if (background && background !== "rgba(0, 0, 0, 0)" && background !== "transparent") return element.getBoundingClientRect();
  return null;
}

test("full-row highlight spans the content column for task, nested, heading, table and code lines", async () => {
  mounted = await mountRealVditor(GEOMETRY_FIXTURE);
  const { content } = mounted;
  const targets = ["Heading target", "Task target", "Nested target", "Row target", "codeTarget"].map((needle) => {
    const line = renderedLineOf(content, needle);
    const element = renderedLineElement(content, line);
    return { needle, line, element, textLeft: firstTextLeft(element, needle) };
  });
  sendDiff("right", targets.map((t) => ({ type: "modified", lineNumber: t.line, content: "x", oldContent: "y", side: "both" })));
  await diffPainted(content, targets.length);

  const column = content.getBoundingClientRect();
  const columnWidth = content.clientWidth;
  for (const target of targets) {
    const element = renderedLineElement(content, target.line);
    const painted = paintedRect(content, target.line, element);
    expect(painted, `${target.needle}: painted`).not.toBeNull();
    const list = element.closest("ul, ol");
    const checkbox = element.querySelector("input[type=checkbox]");
    const markerLeft = Math.min(
      list ? list.getBoundingClientRect().left : Infinity,
      checkbox ? checkbox.getBoundingClientRect().left : Infinity,
      element.getBoundingClientRect().left,
    );
    expect(painted!.left, `${target.needle}: left edge at/before marker`).toBeLessThanOrEqual(markerLeft + 0.5);
    expect(Math.abs(painted!.left - column.left), `${target.needle}: starts at column edge`).toBeLessThanOrEqual(1);
    expect(Math.abs(painted!.width - columnWidth), `${target.needle}: spans column`).toBeLessThanOrEqual(1);
    expect(firstTextLeft(element, target.needle), `${target.needle}: text did not move`).toBeCloseTo(target.textLeft, 0);
    expect(element.getAttribute("style") ?? "", `${target.needle}: no inline decoration style`).not.toMatch(/background|border|padding/);
  }
});

const INLINE_FIXTURE = "# Pending edit\n\nKeep this line.\n\nNew wording here.\n\nTail line.\n";

test("inline mode renders each previous version as a labelled read-only row directly above its line", async () => {
  mounted = await mountRealVditor(INLINE_FIXTURE);
  const { editor, content } = mounted;
  const before = getValue(editor.vditor);
  const modifiedLine = renderedLineOf(content, "New wording here.");
  const tailLine = renderedLineOf(content, "Tail line.");
  const current = renderedLineElement(content, modifiedLine);
  const tail = renderedLineElement(content, tailLine);
  const currentTextLeft = firstTextLeft(current, "New");
  sendDiff("right", [
    { type: "modified", lineNumber: modifiedLine, content: "<p>New wording here.</p>", oldContent: "<p>Old wording here.</p>", side: "both" },
    { type: "deleted", lineNumber: tailLine, content: "<p>This line is removed.</p>", side: "left" },
    { type: "spacer", lineNumber: tailLine, content: "<p>This line is removed.</p>", side: "right" },
  ], "inline");
  await expect.poll(() => document.querySelectorAll("[data-diff-previous]").length, { timeout: 5000 }).toBe(2);

  const rows = [...document.querySelectorAll<HTMLElement>("[data-diff-previous]")];
  const old = rows.find((row) => row.textContent?.includes("Old wording here."))!;
  const removed = rows.find((row) => row.textContent?.includes("This line is removed."))!;
  for (const row of rows) {
    expect(content.contains(row), "rows live outside the editable content").toBe(false);
    expect(row.isContentEditable).toBe(false);
    expect(row.getAttribute("role")).toBe("note");
    expect(row.getAttribute("aria-label")).toMatch(/^(Previous version|Removed line): /);
    expect(row.tabIndex).toBe(0);
  }
  const box = (el: Element) => el.getBoundingClientRect();
  const currentNow = renderedLineElement(content, modifiedLine);
  const textTop = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects()[0].top; };
  expect(box(old).bottom).toBeLessThanOrEqual(textTop(currentNow) + 1);
  expect(textTop(currentNow) - box(old).bottom).toBeLessThan(12);
  expect(box(removed).bottom).toBeLessThanOrEqual(textTop(renderedLineElement(content, tailLine)) + 1);
  expect(box(old).bottom).toBeGreaterThan(box(renderedLineElement(content, renderedLineOf(content, "Keep this line."))).bottom - 1);
  expect(firstTextLeft(currentNow, "New")).toBeCloseTo(currentTextLeft, 0);
  void tail;

  // Typing with focus on a previous-version row changes nothing.
  old.focus();
  document.execCommand("insertText", false, "TYPED");
  old.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
  expect(old.textContent).not.toContain("TYPED");
  expect(getValue(editor.vditor)).toBe(before);
});
