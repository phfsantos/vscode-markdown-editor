import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import * as vscode from "vscode";

const createOrShow = vi.fn(async () => undefined);
vi.mock("../src/app/EditorPanel", () => ({ EditorPanel: { createOrShow, viewType: "markdown-editor" } }));
vi.mock("../src/app/_utils", () => ({ getWebviewOptions: () => ({}) }));

const { PreviewCustomEditorProvider } = await import("../src/app/PreviewCustomEditorProvider");
const { isDocumentWritable, isOpeningInDiff } = await import("../src/diff/diffContext");

const writable = new Set(["file", "vscode-remote"]);
const originalFs = (vscode.workspace as any).fs;
const originalGroups = { all: (vscode.window.tabGroups as any).all, active: (vscode.window.tabGroups as any).activeTabGroup };
beforeEach(() => {
  createOrShow.mockClear();
  (vscode.workspace as any).fs = { isWritableFileSystem: (scheme: string) => (writable.has(scheme) ? true : scheme === "readonly-fs" ? false : undefined) };
  (vscode.window.tabGroups as any).all = [];
  (vscode.window.tabGroups as any).activeTabGroup = { viewColumn: 1, tabs: [] };
});
afterEach(() => {
  (vscode.workspace as any).fs = originalFs;
  (vscode.window.tabGroups as any).all = originalGroups.all;
  (vscode.window.tabGroups as any).activeTabGroup = originalGroups.active;
});

describe("isDocumentWritable (findings S6)", () => {
  test.each([
    ["file", true],
    ["untitled", true],
    ["vscode-remote", true],
    ["git", false],
    ["showModifications", false],
    ["chat-editing-snapshot-text-model", false],
    ["pr", false],
    ["readonly-fs", false],
  ])("%s -> %s", (scheme, expected) => {
    expect(isDocumentWritable(vscode.Uri.parse(`${scheme}:/w/a.md`))).toBe(expected);
  });
});

describe("isOpeningInDiff", () => {
  const group = (viewColumn: number, tabs: unknown[]) => ({ viewColumn, tabs });
  test("a custom-editor diff tab (no tab input) naming the document in its column", () => {
    (vscode.window.tabGroups as any).all = [group(1, [{ label: "diff.md (Working Tree)", input: undefined, isActive: false }])];
    expect(isOpeningInDiff(vscode.Uri.file("/w/diff.md"), 1)).toBe(true);
    expect(isOpeningInDiff(vscode.Uri.file("/w/diff.md"), 2)).toBe(false);
    expect(isOpeningInDiff(vscode.Uri.file("/w/other.md"), 1)).toBe(false);
  });
  test("a plain custom editor tab is not a diff", () => {
    (vscode.window.tabGroups as any).all = [group(1, [{ label: "diff.md", input: new vscode.TabInputCustom(vscode.Uri.file("/w/diff.md"), "markdown-editor") }])];
    expect(isOpeningInDiff(vscode.Uri.file("/w/diff.md"), 1)).toBe(false);
  });
});

describe("PreviewCustomEditorProvider read-only decision (findings S6)", () => {
  const provider = new PreviewCustomEditorProvider({ extensionUri: vscode.Uri.file("/ext") } as any, {} as any);
  const resolve = (uri: vscode.Uri) => provider.resolveCustomTextEditor(
    { uri, isDirty: false, languageId: "markdown" } as any,
    { viewColumn: 1, webview: {} } as any,
    {} as any,
  );
  test.each([
    ["chat-editing-snapshot-text-model:/w/a.md", true],
    ["pr:/w/a.md", true],
    ["readonly-fs:/w/a.md", true],
    ["git:/w/a.md", true],
    ["file:///w/a.md", false],
  ])("%s opens read-only=%s", async (value, readOnly) => {
    await resolve(vscode.Uri.parse(value));
    expect(createOrShow).toHaveBeenCalledTimes(1);
    expect((createOrShow.mock.calls[0] as unknown[])[5]).toBe(readOnly);
  });
});
