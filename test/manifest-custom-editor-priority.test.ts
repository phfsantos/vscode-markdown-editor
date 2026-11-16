import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const adr = readFileSync(join(root, "docs/adr/0001-diff-view-architecture.md"), "utf8");

// Since VS Code 1.133 a scalar priority means `explicit` for diff editors, so a
// scalar "default" silently drops Markdown Studio from Git and file diffs (findings S1).
test("Markdown Studio declares a per-mode priority that keeps it the default in diffs", () => {
  const editor = manifest.contributes.customEditors.find((entry: { viewType: string }) => entry.viewType === "markdown-editor");
  expect(editor.priority).toEqual({ textEditor: "default", diffEditor: "default" });
});

test("the ADR records the same priority the manifest declares", () => {
  expect(adr).toContain('"priority": { "textEditor": "default", "diffEditor": "default" }');
});
