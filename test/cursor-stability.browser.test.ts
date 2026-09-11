import { afterEach, beforeEach, expect, test } from "vitest";
import {
  captureSelectionBookmark,
  restoreSelectionBookmark,
} from "../packages/media/src/cursor-bookmark";
import { CursorManager } from "../packages/media/src/cursor-manager";

let editor: HTMLDivElement;

beforeEach(() => {
  editor = document.createElement("div");
  editor.className = "vditor-reset";
  editor.contentEditable = "true";
  document.body.append(editor);
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  editor.remove();
});

function setCaret(offset: number): void {
  const text = editor.firstChild!;
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function setSelection(start: number, end: number): void {
  const text = editor.firstChild!;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function selectionOffsets(): [number, number] {
  const selection = window.getSelection()!;
  const start = document.createRange();
  start.selectNodeContents(editor);
  start.setEnd(selection.anchorNode!, selection.anchorOffset);
  const end = document.createRange();
  end.selectNodeContents(editor);
  end.setEnd(selection.focusNode!, selection.focusOffset);
  return [start.toString().length, end.toString().length];
}

test("typing preserves a middle caret when the rendered DOM is replaced", () => {
  editor.textContent = "prefix typing suffix";
  setCaret("prefix ".length);
  const bookmark = captureSelectionBookmark(editor);

  editor.innerHTML = "<span>prefix </span><strong>typing</strong><span> suffix</span>";
  expect(restoreSelectionBookmark(editor, bookmark)).toBe(true);
  expect(selectionOffsets()).toEqual([7, 7]);
});

test("paste and cut preserve an end-of-document caret through rerender", () => {
  editor.textContent = "content after edit";
  setCaret(editor.textContent.length);
  const bookmark = captureSelectionBookmark(editor);

  editor.innerHTML = "<p>content after edit</p><span data-diagnostic-source=external></span>";
  expect(restoreSelectionBookmark(editor, bookmark)).toBe(true);
  expect(selectionOffsets()).toEqual([18, 18]);
});

test("diagnostic and custom-renderer DOM updates preserve a middle selection", () => {
  editor.textContent = "keep selected text stable";
  setSelection(5, 13);
  const bookmark = captureSelectionBookmark(editor);

  editor.innerHTML = "<span class=vscode-diagnostic-warning>keep </span><span class=custom-renderer>selected</span><span> text stable</span>";
  expect(restoreSelectionBookmark(editor, bookmark)).toBe(true);
  expect(selectionOffsets()).toEqual([5, 13]);
  expect(window.getSelection()!.toString()).toBe("selected");
});

test("selection restoration preserves a backwards selection", () => {
  editor.textContent = "keep selected text stable";
  const text = editor.firstChild!;
  const range = document.createRange();
  range.setStart(text, 5);
  range.setEnd(text, 13);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  selection.collapse(range.endContainer, range.endOffset);
  selection.extend(range.startContainer, range.startOffset);
  const bookmark = captureSelectionBookmark(editor);

  editor.innerHTML = "<span>keep </span><span class=custom-renderer>selected</span><span> text stable</span>";
  expect(restoreSelectionBookmark(editor, bookmark)).toBe(true);
  expect(selectionOffsets()).toEqual([13, 5]);
  expect(selection.toString()).toBe("selected");
});

test("cursor coordinates count text before a caret across multiple DOM text nodes", () => {
  const host = document.createElement("div");
  host.className = "vditor-ir";
  host.innerHTML = '<div class="vditor-reset"><span>first\n</span><strong>second line</strong></div>';
  document.body.append(host);
  const root = host.querySelector<HTMLElement>(".vditor-reset")!;
  const text = root.querySelector("strong")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 2);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);

  const manager = new CursorManager({});
  expect(manager.getCursorPosition()).toEqual({ line: 1, character: 2 });
  manager.dispose();
  host.remove();
});
