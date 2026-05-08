import { getRenderedLineElements, type DomLikeElement } from "./diff-line-dom-mapper";

const ROOT_SELECTOR = ".vditor-ir > pre.vditor-reset";
const GUTTER_ATTRIBUTE = "data-vditor-line-number-gutter";
const ITEM_ATTRIBUTE = "data-vditor-line-number";
const ACTIVE_ITEM_ATTRIBUTE = "data-vditor-active-line-number";
const ANCHOR_ATTRIBUTE = "data-line-number-anchor";
const SOURCE_LINE_ATTRIBUTE = "data-source-line";
const DISPLAY_LINE_ATTRIBUTE = "data-rendered-line-number";
const DEPTH_ATTRIBUTE = "data-line-target-depth";
const ROOT_STATE_ATTRIBUTE = "data-has-line-numbers";
const STYLE_ID = "vditor-line-number-styles";
const MIN_GUTTER_WIDTH_PX = 34;
const MIN_ROOT_PADDING_LEFT_PX = 84;
const GUTTER_HORIZONTAL_PADDING_PX = 22;
const GUTTER_GAP_PX = 20;
const DIGIT_WIDTH_PX = 9;
const ROOT_CONTENT_HORIZONTAL_PADDING_PX = 16;
const GUTTER_WIDTH_CSS_VARIABLE = "--vditor-line-number-gutter-width";
const ROOT_PADDING_LEFT_CSS_VARIABLE = "--vditor-line-number-padding-left";

interface LineAnchorNode {
  nodeType?: number;
  parentElement?: LineAnchorElement | null;
  childNodes?: ArrayLike<LineAnchorNode>;
}

interface LineAnchorElement extends LineAnchorNode {
  hasAttribute?(name: string): boolean;
  getAttribute?(name: string): string | null;
}

interface SelectionLike {
  focusNode?: LineAnchorNode | null;
  focusOffset?: number;
  rangeCount?: number;
  getRangeAt?(index: number): {
    startContainer: LineAnchorNode;
    startOffset: number;
  };
}

/**
 * Keep the gutter and editor padding wide enough for the current line-count digit width.
 */
export function getLineNumberLayout(lineCount: number): {
  gutterWidth: number;
  paddingLeft: number;
} {
  const safeLineCount = Math.max(1, Math.floor(lineCount));
  const digitCount = String(safeLineCount).length;
  const gutterWidth = Math.max(
    MIN_GUTTER_WIDTH_PX,
    digitCount * DIGIT_WIDTH_PX + GUTTER_HORIZONTAL_PADDING_PX,
  );
  const paddingLeft = Math.max(
    MIN_ROOT_PADDING_LEFT_PX,
    gutterWidth + GUTTER_GAP_PX + ROOT_CONTENT_HORIZONTAL_PADDING_PX,
  );

  return { gutterWidth, paddingLeft };
}

export function getSelectedLineNumber(
  selection: SelectionLike | null | undefined,
  root: LineAnchorElement | null,
): number | null {
  if (!selection || !root || !selection.rangeCount) {
    return null;
  }

  const fallbackRange = typeof selection.getRangeAt === "function"
    ? selection.getRangeAt(0)
    : undefined;
  const focusNode = selection.focusNode ?? fallbackRange?.startContainer ?? null;
  const focusOffset = typeof selection.focusOffset === "number"
    ? selection.focusOffset
    : fallbackRange?.startOffset ?? 0;

  if (!focusNode) {
    return null;
  }

  const directLineNumber = getLineNumberFromNode(focusNode, root);
  if (directLineNumber !== null) {
    return directLineNumber;
  }

  for (const candidate of getSelectionOffsetCandidates(focusNode, focusOffset)) {
    const candidateLineNumber = getLineNumberFromDescendant(candidate, root);
    if (candidateLineNumber !== null) {
      return candidateLineNumber;
    }
  }

  return null;
}

/**
 * Preserve the active-line highlight across rerenders, even when the logical line number
 * stays the same but the underlying DOM node has been recreated.
 */
export function shouldUpdateActiveLine(
  currentLineNumber: number | null,
  nextLineNumber: number | null,
  currentElement: unknown,
  nextElement: unknown,
): boolean {
  if (currentLineNumber !== nextLineNumber) {
    return true;
  }

  if (nextLineNumber === null) {
    return false;
  }

  return currentElement !== nextElement;
}

function getLineNumberFromNode(node: LineAnchorNode | null, root: LineAnchorElement): number | null {
  let current = isLineAnchorElement(node) ? node : node?.parentElement ?? null;

  while (current) {
    if (current.hasAttribute?.(ANCHOR_ATTRIBUTE)) {
      if (!isWithinRoot(current, root)) {
        return null;
      }

      return parseLineNumber(current.getAttribute?.(SOURCE_LINE_ATTRIBUTE) ?? null);
    }

    if (current === root) {
      break;
    }

    current = current.parentElement ?? null;
  }

  return null;
}

function getLineNumberFromDescendant(node: LineAnchorNode | null, root: LineAnchorElement): number | null {
  const firstAnchor = getFirstAnchor(node);
  if (firstAnchor && isWithinRoot(firstAnchor, root)) {
    return parseLineNumber(firstAnchor.getAttribute?.(SOURCE_LINE_ATTRIBUTE) ?? null);
  }

  const lastAnchor = getLastAnchor(node);
  if (lastAnchor && isWithinRoot(lastAnchor, root)) {
    return parseLineNumber(lastAnchor.getAttribute?.(SOURCE_LINE_ATTRIBUTE) ?? null);
  }

  return null;
}

function getSelectionOffsetCandidates(node: LineAnchorNode, offset: number): LineAnchorNode[] {
  const childNodes = Array.from(node.childNodes ?? []);
  const candidates: LineAnchorNode[] = [];

  if (offset >= 0 && offset < childNodes.length) {
    candidates.push(childNodes[offset]);
  }

  if (offset > 0 && offset - 1 < childNodes.length) {
    candidates.push(childNodes[offset - 1]);
  }

  return candidates;
}

function getFirstAnchor(node: LineAnchorNode | null): LineAnchorElement | null {
  if (!node) {
    return null;
  }

  if (isLineAnchorElement(node) && node.hasAttribute?.(ANCHOR_ATTRIBUTE)) {
    return node;
  }

  for (const child of Array.from(node.childNodes ?? [])) {
    const anchor = getFirstAnchor(child);
    if (anchor) {
      return anchor;
    }
  }

  return null;
}

function getLastAnchor(node: LineAnchorNode | null): LineAnchorElement | null {
  if (!node) {
    return null;
  }

  const childNodes = Array.from(node.childNodes ?? []);
  for (let index = childNodes.length - 1; index >= 0; index -= 1) {
    const anchor = getLastAnchor(childNodes[index]);
    if (anchor) {
      return anchor;
    }
  }

  if (isLineAnchorElement(node) && node.hasAttribute?.(ANCHOR_ATTRIBUTE)) {
    return node;
  }

  return null;
}

function isWithinRoot(element: LineAnchorElement, root: LineAnchorElement): boolean {
  let current: LineAnchorElement | null | undefined = element;

  while (current) {
    if (current === root) {
      return true;
    }

    current = current.parentElement ?? null;
  }

  return false;
}

function isLineAnchorElement(node: LineAnchorNode | null | undefined): node is LineAnchorElement {
  return Boolean(node && typeof (node as LineAnchorElement).hasAttribute === "function");
}

function parseLineNumber(value: string | null): number | null {
  const lineNumber = Number.parseInt(value ?? "", 10);
  return Number.isInteger(lineNumber) ? lineNumber : null;
}

class VditorLineNumberRenderer {
  private scheduled = false;
  private observer: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lineMap = new Map<number, HTMLElement>();
  private lineNumberMap = new Map<number, HTMLElement>();
  private currentRoot: HTMLElement | null = null;
  private activeLineNumber: number | null = null;
  private activeLineElement: HTMLElement | null = null;

  public start(): void {
    this.injectStyles();
    this.observeDocument();
    this.scheduleRender();
    document.addEventListener("selectionchange", this.handleSelectionChange);
    window.addEventListener("resize", this.handleResize, { passive: true });
    (window as any).__vditorLineNumbers = this;
  }

  public refresh(): void {
    this.scheduleRender();
    this.updateActiveLineNumber();
  }

  public getLineElement(lineNumber: number): HTMLElement | null {
    return this.lineMap.get(lineNumber) || null;
  }

  private handleResize = () => {
    this.scheduleRender();
  };

  private handleSelectionChange = () => {
    this.updateActiveLineNumber();
  };

  private observeDocument(): void {
    if (this.observer) {
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      if (!mutations.some((mutation) => this.isRelevantMutation(mutation))) {
        return;
      }

      this.scheduleRender();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "data-type",
        "data-block",
        "data-empty-line",
      ],
    });
  }

  private isRelevantMutation(mutation: MutationRecord): boolean {
    if (mutation.type === "attributes") {
      const target = mutation.target as HTMLElement | null;
      return !this.isLineNumberNode(target);
    }

    if (mutation.type === "characterData") {
      return !this.isLineNumberNode(mutation.target.parentElement);
    }

    const addedNodes = Array.from(mutation.addedNodes || []);
    const removedNodes = Array.from(mutation.removedNodes || []);
    return [...addedNodes, ...removedNodes].some((node) => {
      if (!(node instanceof HTMLElement)) {
        return true;
      }
      return !this.isLineNumberNode(node);
    });
  }

  private isLineNumberNode(node: HTMLElement | null): boolean {
    if (!node) {
      return false;
    }

    return Boolean(node.closest(`[${GUTTER_ATTRIBUTE}="true"]`)) ||
      node.hasAttribute(GUTTER_ATTRIBUTE) ||
      node.hasAttribute(ITEM_ATTRIBUTE) ||
      node.hasAttribute(ANCHOR_ATTRIBUTE);
  }

  private scheduleRender(): void {
    if (this.scheduled) {
      return;
    }

    this.scheduled = true;
    window.requestAnimationFrame(() => {
      this.scheduled = false;
      this.render();
    });
  }

  private render(): void {
    const root = document.querySelector(ROOT_SELECTOR) as HTMLElement | null;
    if (!root) {
      this.teardownRoot();
      return;
    }

    this.observeRootResize(root);
    this.clearExistingMarkers(root);

    const lineElements = getRenderedLineElements(root as unknown as DomLikeElement) as HTMLElement[];
    this.lineMap.clear();
    this.lineNumberMap.clear();

    if (lineElements.length === 0) {
      root.removeAttribute(ROOT_STATE_ATTRIBUTE);
      root.style.removeProperty(GUTTER_WIDTH_CSS_VARIABLE);
      root.style.removeProperty(ROOT_PADDING_LEFT_CSS_VARIABLE);
      this.setActiveLineNumber(null);
      return;
    }

    const layout = getLineNumberLayout(lineElements.length);
    root.style.setProperty(GUTTER_WIDTH_CSS_VARIABLE, `${layout.gutterWidth}px`);
    root.style.setProperty(ROOT_PADDING_LEFT_CSS_VARIABLE, `${layout.paddingLeft}px`);

    const gutter = document.createElement("div");
    gutter.className = "vditor-line-number-gutter";
    gutter.setAttribute(GUTTER_ATTRIBUTE, "true");
    gutter.setAttribute("aria-hidden", "true");
    gutter.setAttribute("contenteditable", "false");

    const rootRect = root.getBoundingClientRect();

    lineElements.forEach((element, index) => {
      this.lineMap.set(index, element);
      element.setAttribute(ANCHOR_ATTRIBUTE, "true");
      element.setAttribute(SOURCE_LINE_ATTRIBUTE, String(index));
      element.setAttribute(DISPLAY_LINE_ATTRIBUTE, String(index + 1));
      element.setAttribute(DEPTH_ATTRIBUTE, String(this.getElementDepth(element, root)));

      const lineNumber = document.createElement("span");
      lineNumber.className = "vditor-line-number";
      lineNumber.setAttribute(ITEM_ATTRIBUTE, "true");
      lineNumber.setAttribute(SOURCE_LINE_ATTRIBUTE, String(index));
      lineNumber.setAttribute("contenteditable", "false");
      lineNumber.textContent = String(index + 1);

      const rect = element.getBoundingClientRect();
      const top = Math.max(0, rect.top - rootRect.top + root.scrollTop);
      const height = Math.max(rect.height, this.getFallbackLineHeight(element));

      lineNumber.style.top = `${top}px`;
      lineNumber.style.height = `${height}px`;
      this.lineNumberMap.set(index, lineNumber);
      gutter.appendChild(lineNumber);
    });

    root.insertBefore(gutter, root.firstChild);
    root.setAttribute(ROOT_STATE_ATTRIBUTE, "true");
    this.updateActiveLineNumber();
  }

  private observeRootResize(root: HTMLElement): void {
    if (typeof ResizeObserver === "undefined") {
      this.currentRoot = root;
      return;
    }

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    }

    if (this.currentRoot && this.currentRoot !== root) {
      this.resizeObserver.unobserve(this.currentRoot);
    }

    if (this.currentRoot !== root) {
      this.resizeObserver.observe(root);
      this.currentRoot = root;
    }
  }

  private clearExistingMarkers(root: HTMLElement): void {
    root.querySelector(`:scope > [${GUTTER_ATTRIBUTE}="true"]`)?.remove();

    root.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTRIBUTE}="true"]`).forEach((element) => {
      element.removeAttribute(ANCHOR_ATTRIBUTE);
      element.removeAttribute(SOURCE_LINE_ATTRIBUTE);
      element.removeAttribute(DISPLAY_LINE_ATTRIBUTE);
      element.removeAttribute(DEPTH_ATTRIBUTE);
    });
  }

  private teardownRoot(): void {
    this.setActiveLineNumber(null);
    if (this.currentRoot) {
      this.clearExistingMarkers(this.currentRoot);
      this.currentRoot.removeAttribute(ROOT_STATE_ATTRIBUTE);
      this.currentRoot.style.removeProperty(GUTTER_WIDTH_CSS_VARIABLE);
      this.currentRoot.style.removeProperty(ROOT_PADDING_LEFT_CSS_VARIABLE);
      if (this.resizeObserver) {
        this.resizeObserver.unobserve(this.currentRoot);
      }
      this.currentRoot = null;
    }
    this.lineMap.clear();
    this.lineNumberMap.clear();
  }

  private updateActiveLineNumber(): void {
    const selectedLineNumber = getSelectedLineNumber(
      window.getSelection() as unknown as SelectionLike,
      this.currentRoot as unknown as LineAnchorElement | null,
    );
    this.setActiveLineNumber(selectedLineNumber);
  }

  private setActiveLineNumber(lineNumber: number | null): void {
    const nextLineNumber = lineNumber !== null && this.lineNumberMap.has(lineNumber)
      ? lineNumber
      : null;
    const nextLineElement = nextLineNumber !== null
      ? this.lineNumberMap.get(nextLineNumber) ?? null
      : null;

    if (!shouldUpdateActiveLine(
      this.activeLineNumber,
      nextLineNumber,
      this.activeLineElement,
      nextLineElement,
    )) {
      return;
    }

    this.activeLineElement?.removeAttribute(ACTIVE_ITEM_ATTRIBUTE);

    this.activeLineNumber = nextLineNumber;
    this.activeLineElement = nextLineElement;

    nextLineElement?.setAttribute(ACTIVE_ITEM_ATTRIBUTE, "true");
  }

  private getFallbackLineHeight(element: HTMLElement): number {
    const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight || "0");
    return Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20;
  }

  private getElementDepth(element: HTMLElement, root: HTMLElement): number {
    let depth = 0;
    let current: HTMLElement | null = element;
    while (current && current !== root) {
      current = current.parentElement;
      depth += 1;
    }
    return depth;
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .vditor-ir > pre.vditor-reset:has(> [${GUTTER_ATTRIBUTE}="true"]) {
        position: relative;
        padding-left: var(${ROOT_PADDING_LEFT_CSS_VARIABLE}, ${MIN_ROOT_PADDING_LEFT_PX}px) !important;
      }

      .vditor-ir > pre.vditor-reset:has(> [${GUTTER_ATTRIBUTE}="true"]) > [${GUTTER_ATTRIBUTE}="true"] {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        width: var(${GUTTER_WIDTH_CSS_VARIABLE}, ${MIN_GUTTER_WIDTH_PX}px);
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        z-index: 0;
      }

      .vditor-ir > pre.vditor-reset > [${GUTTER_ATTRIBUTE}="true"] > [${ITEM_ATTRIBUTE}="true"] {
        position: absolute;
        left: 0;
        width: 100%;
        padding-right: 12px;
        padding-left: 10px;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        box-sizing: border-box;
        color: var(--vscode-editorLineNumber-foreground, rgba(133, 133, 133, 0.9)) !important;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family, monospace));
        font-size: 12px;
        line-height: 1.4;
        text-align: right;
        white-space: nowrap;
      }

      .vditor-ir > pre.vditor-reset > [${GUTTER_ATTRIBUTE}="true"] > [${ITEM_ATTRIBUTE}="true"][${ACTIVE_ITEM_ATTRIBUTE}="true"] {
        color: var(
          --vscode-editorLineNumber-activeForeground,
          var(--vscode-editorLineNumber-foreground, rgba(133, 133, 133, 0.9))
        ) !important;
      }

      .vditor-ir > pre.vditor-reset [${ANCHOR_ATTRIBUTE}="true"] {
        scroll-margin-top: 72px;
      }

      .vditor-ir > pre.vditor-reset :is(blockquote, div, ul, ol, dl, table, thead, tbody, tfoot, tr, li, td, th):has(
        > :is(p, h1, h2, h3, h4, h5, h6, blockquote, pre, ul, ol, dl, table, thead, tbody, tfoot, tr, li, td, th, div)[${ANCHOR_ATTRIBUTE}="true"]
      ):not([${ANCHOR_ATTRIBUTE}="true"]) {
        --vditor-line-number-parent-block: 1;
      }
    `;

    document.head.appendChild(style);
  }
}

export function initializeLineNumbers(): void {
  if ((window as any).__vditorLineNumbers) {
    return;
  }

  const renderer = new VditorLineNumberRenderer();
  renderer.start();
}
