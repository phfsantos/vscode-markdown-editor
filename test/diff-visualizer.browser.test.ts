import { afterEach, beforeAll, expect, test } from "vitest";
import { DiffVisualizer } from "../packages/media/src/diff-visualizer";

// One initialized instance mirrors the webview lifecycle and avoids accumulating
// global listeners between cases. Drive it exclusively through its public API
// and the same messages/input events used by the webview.
const visualizer = new DiffVisualizer();
let host: HTMLDivElement;

beforeAll(() => visualizer.initialize());
afterEach(() => {
  window.dispatchEvent(new MessageEvent("message", { data: { type: "diff-view-cleared" } }));
  host?.remove();
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

type Change = {
  type: "spacer" | "modified";
  lineNumber: number;
  content: string;
  side: "left" | "right" | "both";
};
const spacer = (lineNumber: number): Change => ({ type: "spacer", lineNumber, content: "<div><br></div>", side: "left" });
const modified = (lineNumber: number): Change => ({ type: "modified", lineNumber, content: "changed", side: "left" });
function sendDiff(changes: Change[]): void {
  window.dispatchEvent(new MessageEvent("message", {
    data: {
      type: "diff-view-detected",
      diffInfo: { role: "left", otherUri: "other.md", changes, stats: { added: 0, deleted: 0, modified: 1 } },
    },
  }));
}
async function expectDecorated(target: Element, line: number): Promise<void> {
  await expect.poll(() => target.getAttribute("data-diff-line"), { timeout: 5000 }).toBe(String(line));
  expect(target.getAttribute("data-diff-type")).toBe("modified");
}

for (const [name, html] of [
  ["nested lists", '<ul><li>Parent<ul><li>Nested child</li></ul></li><li id="target">Sibling</li></ul>'],
  ["tables", '<table><tbody><tr><td>First</td><td id="target">Second</td></tr></tbody></table>'],
  ["blockquotes", '<blockquote><p>First</p><p id="target">Second</p></blockquote>'],
  ["explicit blank lines", '<p data-empty-line="true"><br></p><p id="target">After blank</p>'],
]) {
  test(`spacers preserve the rendered target in ${name}`, async () => {
    const content = mount(html);
    const target = content.querySelector("#target")!;
    sendDiff([spacer(1), modified(2)]);
    await expectDecorated(target, 2);
    const inserted = content.querySelector<HTMLElement>(".diff-spacer-block")!;
    expect(inserted.nextElementSibling).toBe(target);
    expect(inserted.getAttribute("contenteditable")).toBe("false");
    expect(content.querySelectorAll('[data-diff-type="modified"]')).toHaveLength(1);
  });
}

test("many consecutive spacers retain their order and later targets after input reapplication", async () => {
  const content = mount('<p>First</p><p id="target">Second</p><p>Third</p>');
  const changes = [...Array.from({ length: 30 }, (_, i) => spacer(i + 1)), modified(31)];
  sendDiff(changes);
  await expectDecorated(content.querySelector("#target")!, 31);
  for (let iteration = 0; iteration < 2; iteration++) {
    const oldSpacer = content.querySelector(".diff-spacer-block");
    content.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await expect.poll(() => oldSpacer!.isConnected).toBe(false);
    expect([...content.querySelectorAll(".diff-spacer-block")].map(node => Number(node.getAttribute("data-line-number"))))
      .toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    await expectDecorated(content.querySelector("#target")!, 31);
    expect(document.querySelectorAll(".diff-scrollbar-marker")).toHaveLength(31);
  }
});

test("the same diff redecorates replaced DOM and replaces scrollbar indicators", async () => {
  const markup = '<p>First</p><blockquote><p id="target">Second</p></blockquote>';
  const content = mount(markup);
  const changes = [spacer(1), modified(2)];
  sendDiff(changes);
  await expectDecorated(content.querySelector("#target")!, 2);
  const previousTarget = content.querySelector("#target");
  content.innerHTML = markup;
  sendDiff(changes);
  const newTarget = content.querySelector("#target")!;
  await expectDecorated(newTarget, 2);
  expect(previousTarget!.isConnected).toBe(false);
  expect(content.querySelectorAll(".diff-spacer-block")).toHaveLength(1);
  expect(document.querySelectorAll(".diff-scrollbar-indicators")).toHaveLength(1);
  expect(document.querySelectorAll(".diff-scrollbar-marker")).toHaveLength(2);
});

test("scrollbar markers use content-relative positions for nested positioned blocks", async () => {
  const content = mount('<p style="height:300px;margin:0">Before</p><blockquote style="position:relative;margin:0"><p style="margin:0" id="target">Target</p></blockquote><p style="height:700px">After</p>');
  const target = content.querySelector<HTMLElement>("#target")!;
  sendDiff([spacer(1), modified(2)]);
  await expectDecorated(target, 2);
  const marker = document.querySelector<HTMLElement>(".diff-scrollbar-marker-modified")!;
  const targetTop = target.getBoundingClientRect().top - content.getBoundingClientRect().top + content.scrollTop;
  expect(parseFloat(marker.style.top)).toBeCloseTo(targetTop / content.scrollHeight * 100, 2);
});

test("scrollbar marker clicks reveal the spacer-shifted line", async () => {
  const content = mount('<p style="height:300px;margin:0">Before</p><blockquote><p id="target">Target</p></blockquote><p style="height:700px">After</p>');
  const target = content.querySelector<HTMLElement>("#target")!;
  sendDiff([spacer(1), modified(2)]);
  await expectDecorated(target, 2);
  document.querySelector<HTMLElement>(".diff-scrollbar-marker-modified")!.click();
  await expect.poll(() => {
    const targetRect = target.getBoundingClientRect();
    const viewport = content.getBoundingClientRect();
    return targetRect.top >= viewport.top && targetRect.bottom <= viewport.bottom;
  }).toBe(true);
  expect(content.scrollTop).toBeGreaterThan(0);
});
