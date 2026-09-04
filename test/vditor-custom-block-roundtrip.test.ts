import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "vitest";
import { createWebviewContentSync } from "../packages/media/src/content-sync";

interface LuteInstance {
  Md2VditorIRDOM(markdown: string): string;
  SetVditorCodeBlockPreview(enabled: boolean): void;
  SetVditorIR(enabled: boolean): void;
  VditorIRDOM2Md(dom: string): string;
}

interface LuteBundle {
  New(): LuteInstance;
  Version: string;
}

const mediaRoot = path.join(__dirname, "..", "packages", "media");
const vditorPackage = JSON.parse(
  fs.readFileSync(path.join(mediaRoot, "node_modules", "vditor", "package.json"), "utf8"),
) as { version: string };

// Vditor ships Lute as a browser global rather than a CommonJS export. Loading
// the vendored bundle is the same parser/serializer code used by the webview.
require(path.join(mediaRoot, "node_modules", "vditor", "dist", "js", "lute", "lute.min.js"));
const Lute = (globalThis as typeof globalThis & { Lute?: LuteBundle }).Lute;

assert.ok(Lute, "expected the installed Vditor package to expose its Lute bundle");

const fixture = fs.readFileSync(
  path.join(__dirname, "fixtures", "custom-block-save.md"),
  "utf8",
);

function createVditorLute(): LuteInstance {
  const lute = Lute.New();
  lute.SetVditorIR(true);
  lute.SetVditorCodeBlockPreview(true);
  return lute;
}

function replacePreviewsWithSvg(irDom: string, cycle: number): string {
  let previewCount = 0;
  const renderedDom = irDom.replace(
    /(<pre class="vditor-ir__preview"[^>]*>)[\s\S]*?(<\/pre>)/g,
    (_match, open: string, close: string) => {
      previewCount += 1;
      return `${open}<svg data-render-cycle="${cycle}" aria-label="rendered custom block"><text>café ☕ 終わり</text></svg>${close}`;
    },
  );

  assert.strictEqual(previewCount, 3, "expected Mermaid, kanban, and table previews");
  assert.match(renderedDom, /<svg data-render-cycle=/);
  return renderedDom;
}

function assertFixtureStructure(markdown: string): void {
  assert.strictEqual(markdown, fixture);
  assert.strictEqual((markdown.match(/^```/gm) ?? []).length, 6);

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
    const index = markdown.indexOf(segment);
    assert.ok(index > previousIndex, `expected ${JSON.stringify(segment)} to remain ordered`);
    previousIndex = index;
  }

  assert.match(markdown, /café ☕/u);
  assert.match(markdown, /終わり/u);
  assert.match(markdown, /blank lines\?"}\n\n  MIDDLE/);
  assert.match(markdown, /```\n\nBetween the custom blocks\.\n\n```kanban-board/);
  assert.match(markdown, /```table[\s\S]*```\n\nAfter the custom blocks\.\n$/);
}

test("pinned Vditor converts custom blocks through IR DOM before and after SVG rendering", () => {
  assert.strictEqual(vditorPackage.version, "3.11.2");
  assert.strictEqual(Lute.Version, "1.7.6");

  const lute = createVditorLute();
  const irDom = lute.Md2VditorIRDOM(fixture);

  assert.strictEqual(lute.VditorIRDOM2Md(irDom), fixture);
  assert.strictEqual(
    lute.VditorIRDOM2Md(replacePreviewsWithSvg(irDom, 0)),
    fixture,
  );
});

test("20 edit and save cycles preserve custom block content and document structure", () => {
  const lute = createVditorLute();
  const messages: unknown[] = [];
  const sync = createWebviewContentSync((message) => messages.push(message), fixture);

  for (let cycle = 1; cycle <= 20; cycle += 1) {
    const irDom = lute.Md2VditorIRDOM(sync.getContent());
    const callbackMarkdown = lute.VditorIRDOM2Md(
      replacePreviewsWithSvg(irDom, cycle),
    );
    const edit = sync.acceptInput(callbackMarkdown);
    const save = sync.createSaveRequest();

    assert.strictEqual(edit.revision, cycle);
    assert.strictEqual(save.revision, cycle);
    assert.strictEqual(save.content, edit.content);
    assertFixtureStructure(save.content);
  }

  assert.strictEqual(messages.length, 40);
  assertFixtureStructure(sync.getContent());
});
