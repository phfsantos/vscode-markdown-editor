import { afterEach, expect, test } from "vitest";
import { WebviewDiffView } from "../packages/media/src/diff/controller";

// One controller mirrors the webview lifecycle. Drive it only through the
// public API the host-message router calls.
const posted: unknown[] = [];
const view = new WebviewDiffView({ postScrollAnchor: (anchor) => posted.push(anchor), isReadOnly: () => false });
let host: HTMLDivElement;

afterEach(() => {
  view.clear();
  host?.remove();
  posted.length = 0;
});

function mount(html: string): HTMLElement {
  host = document.createElement("div");
  host.innerHTML = '<div class="vditor"><div class="vditor-ir"><pre class="vditor-reset"></pre></div></div>';
  document.body.appendChild(host);
  const content = host.querySelector<HTMLElement>("pre")!;
  content.style.cssText = "position:relative;height:180px;overflow:auto;margin:0;padding:0;white-space:normal;line-height:24px";
  content.innerHTML = html;
  return content;
}

type Change = { type: "spacer" | "modified"; lineNumber: number; content: string; side: "left" | "right" | "both" };
const spacer = (lineNumber: number): Change => ({ type: "spacer", lineNumber, content: "<p>gone</p>", side: "left" });
const modified = (lineNumber: number): Change => ({ type: "modified", lineNumber, content: "changed", side: "left" });
let version = 0;
function sendDiff(changes: Change[]): void {
  view.show({ role: "left", mode: "side-by-side", otherUri: "other.md", changes, stats: { added: 0, deleted: 0, modified: 1 }, version: ++version });
}
async function expectDecorated(target: Element, line: number): Promise<void> {
  await expect.poll(() => target.getAttribute("data-diff-line"), { timeout: 5000 }).toBe(String(line));
  expect(target.getAttribute("data-diff-type")).toBe("modified");
}

for (const [name, html] of [
  ["nested lists", '<ul><li>Parent<ul><li>Nested child</li></ul></li><li id="target">Sibling</li></ul>'],
  ["tables", '<table><tbody><tr><td>First</td><td>row</td></tr><tr id="target"><td>Second</td><td>row</td></tr></tbody></table>'],
  ["blockquotes", '<blockquote><p>First</p><p id="target">Second</p></blockquote>'],
  ["explicit blank lines", '<p data-empty-line="true"><br></p><p id="target">After blank</p>'],
]) {
  test(`a gap keeps the rendered target and stays outside the content in ${name}`, async () => {
    const content = mount(html);
    const target = content.querySelector("#target")!;
    sendDiff([spacer(1), modified(2)]);
    await expectDecorated(target, 2);
    const ghost = document.querySelector<HTMLElement>('[data-diff-previous="ghost"]')!;
    expect(ghost).not.toBeNull();
    expect(content.contains(ghost)).toBe(false);
    expect(content.querySelectorAll('[data-diff-type="modified"]')).toHaveLength(1);
    // The ghost row occupies the reserved space directly above the target's text.
    const text = document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const textTop = range.getBoundingClientRect().top;
    const ghostBottom = ghost.getBoundingClientRect().bottom;
    expect(ghostBottom).toBeLessThanOrEqual(textTop + 1);
    expect(textTop - ghostBottom).toBeLessThan(12);
  });
}

test("many consecutive gaps keep their order and later targets after the DOM re-renders", async () => {
  const content = mount('<p>First</p><p id="target">Second</p><p>Third</p>');
  const changes = [...Array.from({ length: 30 }, (_, i) => spacer(i + 1)), modified(31)];
  sendDiff(changes);
  await expectDecorated(content.querySelector("#target")!, 31);
  for (let iteration = 0; iteration < 2; iteration++) {
    content.innerHTML = content.innerHTML.replace(/ data-diff-[a-z]+="[^"]*"/g, "");
    await expectDecorated(content.querySelector("#target")!, 31);
    const rows = [...document.querySelectorAll<HTMLElement>('[data-diff-previous="ghost"]')];
    expect(rows.map((row) => Number(row.dataset.diffRowFor))).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const tops = rows.map((row) => row.getBoundingClientRect().top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(document.querySelectorAll(".md-diff-ruler__mark")).toHaveLength(31);
  }
});

test("re-sending a diff replaces paint, rows and ruler instead of stacking them", async () => {
  const content = mount('<p>First</p><blockquote><p id="target">Second</p></blockquote>');
  const changes = [spacer(1), modified(2)];
  sendDiff(changes);
  await expectDecorated(content.querySelector("#target")!, 2);
  content.innerHTML = '<p>First</p><blockquote><p id="target">Second</p></blockquote>';
  sendDiff(changes);
  await expectDecorated(content.querySelector("#target")!, 2);
  expect(document.querySelectorAll('[data-diff-previous="ghost"]')).toHaveLength(1);
  expect(document.querySelectorAll(".md-diff-ruler")).toHaveLength(1);
  expect(document.querySelectorAll(".md-diff-ruler__mark")).toHaveLength(2);
  expect(document.querySelectorAll(".md-diff-paint")).toHaveLength(1);
});

test("ruler marks use content-relative positions for nested positioned blocks", async () => {
  const content = mount('<p style="height:300px;margin:0">Before</p><blockquote style="position:relative;margin:0"><p style="margin:0" id="target">Target</p></blockquote><p style="height:700px">After</p>');
  const target = content.querySelector<HTMLElement>("#target")!;
  sendDiff([modified(1)]);
  await expectDecorated(target, 1);
  const mark = document.querySelector<HTMLElement>(".md-diff-ruler__mark--modified")!;
  const targetTop = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
  expect(parseFloat(mark.style.top)).toBeCloseTo(targetTop / content.scrollHeight * 100, 1);
});

test("a ruler click reveals the gap-shifted line and owns the scroll", async () => {
  const content = mount('<p style="height:300px;margin:0">Before</p><blockquote><p id="target">Target</p></blockquote><p style="height:700px">After</p>');
  const target = content.querySelector<HTMLElement>("#target")!;
  sendDiff([spacer(1), modified(2)]);
  await expectDecorated(target, 2);
  document.querySelector<HTMLElement>(".md-diff-ruler__mark--modified")!.click();
  await expect.poll(() => {
    const targetRect = target.getBoundingClientRect();
    const viewport = content.getBoundingClientRect();
    return targetRect.top >= viewport.top && targetRect.bottom <= viewport.bottom;
  }).toBe(true);
  expect(content.scrollTop).toBeGreaterThan(0);
  await expect.poll(() => posted.length).toBeGreaterThan(0);
});

test("a follower applies an anchor without emitting one back", async () => {
  const content = mount(Array.from({ length: 40 }, (_, i) => `<p style="margin:0;height:24px">Row ${i}</p>`).join(""));
  sendDiff([modified(5)]);
  await expectDecorated(content.querySelectorAll("p")[5], 5);
  view.applyScrollAnchor({ row: 20, offset: 0.5 });
  expect(content.scrollTop).toBe(20 * 24 + 12);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(posted).toEqual([]);
  // Local input makes this pane the owner; its scroll is then emitted once per frame.
  content.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 48 }));
  content.scrollTop = 30 * 24;
  await expect.poll(() => posted.at(-1)).toEqual({ row: 30, offset: 0 });
});

test("a scroll the pane did not cause (scrollbar drag, keyboard) is emitted even without a wheel event", async () => {
  const content = mount(Array.from({ length: 40 }, (_, i) => `<p style="margin:0;height:24px">Row ${i}</p>`).join(""));
  sendDiff([modified(5)]);
  await expectDecorated(content.querySelectorAll("p")[5], 5);
  view.applyScrollAnchor({ row: 10, offset: 0 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(posted).toEqual([]);
  content.scrollTop = 25 * 24;
  await expect.poll(() => posted.at(-1)).toEqual({ row: 25, offset: 0 });
});

test("a clamped follow at the end of the document is still recognised as the pane's own scroll", async () => {
  const content = mount(Array.from({ length: 12 }, (_, i) => `<p style="margin:0;height:24px">Row ${i}</p>`).join(""));
  sendDiff([modified(1)]);
  await expectDecorated(content.querySelectorAll("p")[1], 1);
  view.applyScrollAnchor({ row: 11, offset: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(content.scrollTop).toBe(content.scrollHeight - content.clientHeight);
  expect(posted).toEqual([]);
});

test("A2: row HTML from the other version cannot run script", async () => {
  const content = mount('<p>Kept</p><p id="target">Current</p>');
  (window as any).__pwned = undefined;
  view.show({
    role: "right", mode: "inline", otherUri: "o", version: ++version, stats: { added: 0, deleted: 0, modified: 1 },
    changes: [{
      type: "modified", lineNumber: 1, content: "<p>Current</p>", side: "both",
      oldContent: '<p>Old<img src="x:" onerror="window.__pwned=1"><script>window.__pwned=2<\/script><a href="javascript:window.__pwned=3">link</a><iframe src="about:blank"></iframe></p>',
    }],
  });
  await expect.poll(() => document.querySelector('[data-diff-previous="previous"]')).not.toBeNull();
  const row = document.querySelector<HTMLElement>('[data-diff-previous="previous"]')!;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect((window as any).__pwned).toBeUndefined();
  expect(row.querySelector("script, iframe, object, embed")).toBeNull();
  expect(row.querySelector("[onerror]")).toBeNull();
  expect(row.querySelector("a")!.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i);
  expect(row.textContent).toContain("Old");
  void content;
});

test("A3: a burst of editor mutations repaints once after it settles, not every frame", async () => {
  const content = mount(Array.from({ length: 30 }, (_, i) => `<p style="margin:0;height:24px">Row ${i}</p>`).join(""));
  sendDiff([modified(3)]);
  await expectDecorated(content.querySelectorAll("p")[3], 3);
  const paint = document.querySelector(".md-diff-paint-layer .md-diff-layer__content")!;
  let repaints = 0;
  const watcher = new MutationObserver(() => repaints++);
  watcher.observe(paint, { childList: true });
  for (let i = 0; i < 8; i++) {
    content.querySelectorAll("p")[10].textContent = `Typing ${i}`;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  watcher.disconnect();
  expect(repaints).toBeGreaterThanOrEqual(1);
  expect(repaints).toBeLessThanOrEqual(2);
});

test("A4: ghost rows are not tab stops; they keep an accessible label", async () => {
  const content = mount('<p>First</p><p id="target">Second</p>');
  sendDiff([spacer(1), modified(2)]);
  await expectDecorated(content.querySelector("#target")!, 2);
  const ghost = document.querySelector<HTMLElement>('[data-diff-previous="ghost"]')!;
  expect(ghost.tabIndex).toBe(-1);
  expect(ghost.getAttribute("aria-label")).toMatch(/^Only in the other version: /);
});
