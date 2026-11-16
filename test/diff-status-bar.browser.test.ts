/**
 * Diff status bar layout against a real Vditor toolbar
 * (spec: docs/testing/artifacts/diff-view/status-bar-spec.md).
 */
import { afterEach, expect, test } from "vitest";
import Vditor from "vditor";
import "vditor/dist/index.css";
import "vditor/dist/js/i18n/en_US.js";
import "vditor/dist/js/lute/lute.min.js";
import { WebviewDiffView } from "../packages/media/src/diff/controller";

let readOnly = false;
const view = new WebviewDiffView({ postScrollAnchor: () => {}, isReadOnly: () => readOnly });
let host: HTMLElement | undefined;
let editor: Vditor | undefined;

afterEach(() => {
  view.clear();
  try { editor?.destroy(); } catch { /* gone */ }
  host?.remove();
  readOnly = false;
});

async function mount(width: number): Promise<HTMLElement> {
  for (const id of ["vditorLuteScript", "vditorIconScript"]) {
    if (!document.getElementById(id)) {
      const script = document.createElement("script");
      script.id = id;
      document.head.appendChild(script);
    }
  }
  host = document.createElement("div");
  host.id = "app";
  host.style.cssText = `width:${width}px;height:600px;position:relative`;
  document.body.appendChild(host);
  editor = await new Promise<Vditor>((resolve) => {
    const instance: Vditor = new Vditor(host!, {
      after: () => resolve(instance),
      cache: { enable: false }, icon: "", i18n: (window as any).VditorI18n, mode: "ir", undoDelay: 0, height: 600,
      toolbar: ["headings", "bold", "italic", "strike", "line", "quote", "list", "ordered-list", "check", "code", "inline-code", "link", "table", "undo", "redo"],
      value: Array.from({ length: 60 }, (_, i) => `Paragraph ${i}\n`).join("\n"),
    });
  });
  return host;
}

let version = 0;
const show = (mode: "side-by-side" | "inline" = "side-by-side", role: "left" | "right" = "right") =>
  view.show({
    role, mode, otherUri: "file:///o.md", version: ++version,
    changes: [{ type: "modified", lineNumber: 5, content: "x", oldContent: "y", side: "both" }, { type: "added", lineNumber: 40, content: "z", side: "right" }],
    stats: { added: 1, deleted: 0, modified: 1 },
  });

const intersects = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const width of [1280, 600]) {
  test(`at ${width}px the status bar sits under the toolbar, at most 28px tall, and the toolbar stays clickable`, async () => {
    await mount(width);
    show();
    const bar = await expect.poll(() => document.querySelector<HTMLElement>('[data-diff-statusbar][data-diff-state="ready"]')).not.toBeNull()
      .then(() => document.querySelector<HTMLElement>("[data-diff-statusbar]")!);
    const toolbar = host!.querySelector<HTMLElement>(".vditor-toolbar")!;
    const barRect = bar.getBoundingClientRect();
    expect(barRect.height).toBeLessThanOrEqual(28);
    expect(barRect.height).toBeGreaterThan(0);
    expect(intersects(barRect, toolbar.getBoundingClientRect())).toBe(false);
    expect(barRect.top).toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().bottom - 0.5);
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth + 1);
    // Every visible toolbar button is the topmost element at its centre.
    for (const button of [...toolbar.querySelectorAll<HTMLElement>("button")].filter((b) => b.getBoundingClientRect().width > 0)) {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      expect(button.contains(hit), `toolbar button ${button.dataset.type} covered`).toBe(true);
    }
    expect(bar.dataset.diffRole).toBe("modified");
    expect(bar.textContent).toContain("+1");
    expect(bar.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(bar.querySelector('[data-count="modified"]')!.getAttribute("aria-label")).toBe("1 modified");
  });
}

test("a read-only side disables its toolbar (same height, unreachable by pointer and keyboard)", async () => {
  await mount(800);
  const toolbarHeight = host!.querySelector<HTMLElement>(".vditor-toolbar")!.getBoundingClientRect().height;
  readOnly = true;
  show("side-by-side", "left");
  await expect.poll(() => document.querySelector('[data-diff-statusbar][data-diff-state="ready"]')).not.toBeNull();
  const toolbar = host!.querySelector<HTMLElement>(".vditor-toolbar")!;
  expect(toolbar.getBoundingClientRect().height).toBe(toolbarHeight);
  expect(toolbar.inert).toBe(true);
  expect(toolbar.getAttribute("aria-disabled")).not.toBeNull();
  const button = toolbar.querySelector<HTMLElement>("button")!;
  const r = button.getBoundingClientRect();
  expect(button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))).toBe(false);
  button.focus();
  expect(document.activeElement).not.toBe(button);
  const bar = document.querySelector<HTMLElement>("[data-diff-statusbar]")!;
  expect(bar.dataset.diffRole).toBe("original");
  expect(bar.querySelector<HTMLElement>(".md-diff-statusbar__readonly")!.hidden).toBe(false);
});

test("a failed diff shows its reason in the status bar instead of nothing", async () => {
  await mount(800);
  view.fail("Diff unavailable: an editor did not finish rendering");
  const bar = document.querySelector<HTMLElement>("[data-diff-statusbar]")!;
  expect(bar.dataset.diffState).toBe("error");
  expect(bar.textContent).toContain("did not finish rendering");
  expect(bar.querySelector<HTMLElement>(".md-diff-statusbar__counts")!.hidden).toBe(true);
});

test("next/previous change buttons move between changes", async () => {
  await mount(800);
  show();
  await expect.poll(() => document.querySelector('[data-diff-statusbar][data-diff-state="ready"]')).not.toBeNull();
  const content = host!.querySelector<HTMLElement>(".vditor-ir > pre.vditor-reset")!;
  const next = document.querySelector<HTMLButtonElement>('.md-diff-statusbar__nav[data-direction="1"]')!;
  content.scrollTop = 0;
  next.click();
  const first = content.scrollTop;
  next.click();
  await expect.poll(() => content.scrollTop).toBeGreaterThan(first);
  document.querySelector<HTMLButtonElement>('.md-diff-statusbar__nav[data-direction="-1"]')!.click();
  await expect.poll(() => content.scrollTop).toBeLessThan(content.scrollHeight);
});

test("clearing the diff removes the status bar and restores the toolbar", async () => {
  await mount(800);
  readOnly = true;
  show();
  await expect.poll(() => document.querySelector("[data-diff-statusbar]")).not.toBeNull();
  view.clear();
  expect(document.querySelector("[data-diff-statusbar]")).toBeNull();
  expect(document.body.classList.contains("md-diff-readonly")).toBe(false);
  expect(host!.querySelector<HTMLElement>(".vditor-toolbar")!.inert).toBe(false);
});
