export interface SelectionBookmark {
  startOffset: number;
  endOffset: number;
  direction: "forward" | "backward";
}

function isInside(root: Node, node: Node): boolean {
  return node === root || root.contains(node);
}

export function getTextOffset(root: Node, node: Node, offset: number): number {
  if (!isInside(root, node)) {
    return 0;
  }

  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, Math.max(0, offset));
    return range.toString().length;
  } catch {
    return 0;
  }
}

export function resolveTextOffset(root: Node, requestedOffset: number): { node: Node; offset: number } {
  const target = Math.max(0, requestedOffset);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let remaining = target;
  let lastText: Text | null = null;

  while (node) {
    const text = node as Text;
    lastText = text;
    const length = text.data.length;
    if (remaining <= length) {
      return { node: text, offset: remaining };
    }
    remaining -= length;
    node = walker.nextNode();
  }

  if (lastText) {
    return { node: lastText, offset: lastText.data.length };
  }
  return { node: root, offset: 0 };
}

export function captureSelectionBookmark(
  root: Node,
  selection: Selection | null = window.getSelection(),
): SelectionBookmark | null {
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!isInside(root, range.startContainer) || !isInside(root, range.endContainer)) {
    return null;
  }

  return {
    startOffset: getTextOffset(root, range.startContainer, range.startOffset),
    endOffset: getTextOffset(root, range.endContainer, range.endOffset),
    direction: getTextOffset(root, selection.anchorNode!, selection.anchorOffset) >
      getTextOffset(root, selection.focusNode!, selection.focusOffset)
      ? "backward"
      : "forward",
  };
}

export function restoreSelectionBookmark(
  root: Node,
  bookmark: SelectionBookmark | null,
  selection: Selection | null = window.getSelection(),
): boolean {
  if (!bookmark || !selection) {
    return false;
  }

  const start = resolveTextOffset(root, bookmark.startOffset);
  const end = resolveTextOffset(root, bookmark.endOffset);
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    selection.removeAllRanges();
    selection.addRange(range);
    if (bookmark.direction === "backward" && !range.collapsed && typeof selection.extend === "function") {
      selection.collapse(end.node, end.offset);
      selection.extend(start.node, start.offset);
    }
    return true;
  } catch {
    return false;
  }
}
