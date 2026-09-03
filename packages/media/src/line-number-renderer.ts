import { getRenderedLineElements, type DomLikeElement } from "./diff-line-dom-mapper";

const ROOT_MODE_SELECTORS = [
  ".vditor-ir > .vditor-reset",
  ".vditor-wysiwyg > .vditor-reset",
  ".vditor-sv > .vditor-reset",
];
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

interface MutableSelectionLike {
  removeAllRanges(): void;
  addRange(range: unknown): void;
}

interface MutableRangeLike {
  selectNodeContents(node: unknown): void;
  collapse(toStart: boolean): void;
}

interface NavigableRootLike {
  focus(options?: { preventScroll?: boolean }): void;
}

interface NavigableLineLike {
  scrollIntoView(options?: boolean | ScrollIntoViewOptions): void;
}

interface QuerySelectorLike {
  querySelector(selector: string): unknown;
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

export interface LineNumberPositionInput {
  rect: { top: number; height: number };
  fallbackLineHeight: number;
}

export interface LineNumberPosition {
  top: number;
  height: number;
}

/**
 * Compute absolute gutter positions for a sequence of measured line elements.
 *
 * Each item's `top` is the measured viewport offset translated into root-relative
 * scroll coordinates, but clamped to never sit above the previous item's bottom.
 * This guarantees that when a source line wraps to multiple visual rows
 * (rect.height > line-height), the next line's number cannot land inside the
 * wrap continuation — which was the observed "26 next to change." drift.
 */
export function computeLineNumberPositions(
  inputs: LineNumberPositionInput[],
  rootRectTop: number,
  scrollTop: number,
): LineNumberPosition[] {
  const positions: LineNumberPosition[] = [];
  let previousBottom = 0;

  for (const { rect, fallbackLineHeight } of inputs) {
    const measuredTop = Math.max(0, rect.top - rootRectTop + scrollTop);
    const height = Math.max(rect.height, fallbackLineHeight);
    const top = Math.max(measuredTop, previousBottom);

    positions.push({ top, height });
    previousBottom = top + height;
  }

  return positions;
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

/** Move the editable caret to a rendered line and reveal it without changing content. */
export function navigateToLineElement(
  root: NavigableRootLike,
  lineElement: NavigableLineLike,
  selection: MutableSelectionLike | null,
  createRange: () => MutableRangeLike,
): void {
  root.focus({ preventScroll: true });

  if (selection) {
    const range = createRange();
    range.selectNodeContents(lineElement);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  lineElement.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function findLineNumberRoot(scope: QuerySelectorLike): unknown {
  for (const selector of ROOT_MODE_SELECTORS) {
    const root = scope.querySelector(selector);
    if (root) {
      return root;
    }
  }

  return null;
}

export function getLineNumberTabIndex(
  lineNumber: number,
  activeLineNumber: number | null,
  lineCount: number,
): 0 | -1 {
  if (lineCount <= 0) {
    return -1;
  }

  const tabStopLine = activeLineNumber !== null && activeLineNumber < lineCount
    ? activeLineNumber
    : 0;
  return lineNumber === tabStopLine ? 0 : -1;
}

export function getLineNumberKeyboardTarget(
  currentLineNumber: number,
  key: string,
  lineCount: number,
): number | null {
  if (lineCount <= 0) {
    return null;
  }

  switch (key) {
    case "ArrowUp":
      return Math.max(0, currentLineNumber - 1);
    case "ArrowDown":
      return Math.min(lineCount - 1, currentLineNumber + 1);
    case "Home":
      return 0;
    case "End":
      return lineCount - 1;
    default:
      return null;
  }
}

function rootSelectors(suffix = ""): string {
  return ROOT_MODE_SELECTORS.map((selector) => `${selector}${suffix}`).join(",\n      ");
}

/** Styles are generated from renderer-owned attributes so they work without CSS :has(). */
export function getLineNumberStyles(): string {
  const rootsWithLines = rootSelectors(`[${ROOT_STATE_ATTRIBUTE}="true"]`);
  const gutters = rootSelectors(` > [${GUTTER_ATTRIBUTE}="true"]`);
  const items = rootSelectors(` > [${GUTTER_ATTRIBUTE}="true"] > [${ITEM_ATTRIBUTE}="true"]`);
  const activeItems = rootSelectors(
    ` > [${GUTTER_ATTRIBUTE}="true"] > [${ITEM_ATTRIBUTE}="true"][${ACTIVE_ITEM_ATTRIBUTE}="true"]`,
  );
  const hoverItems = rootSelectors(
    ` > [${GUTTER_ATTRIBUTE}="true"] > [${ITEM_ATTRIBUTE}="true"]:hover`,
  );
  const focusedItems = rootSelectors(
    ` > [${GUTTER_ATTRIBUTE}="true"] > [${ITEM_ATTRIBUTE}="true"]:focus-visible`,
  );
  const anchors = rootSelectors(` [${ANCHOR_ATTRIBUTE}="true"]`);

  return `
      ${rootsWithLines} {
        position: relative;
        padding-left: var(${ROOT_PADDING_LEFT_CSS_VARIABLE}, ${MIN_ROOT_PADDING_LEFT_PX}px) !important;
      }

      ${gutters} {
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

      ${items} {
        position: absolute;
        left: 0;
        width: 100%;
        margin: 0;
        border: 0;
        background: transparent;
        padding: 0 12px 0 10px;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        box-sizing: border-box;
        color: var(--vscode-editorLineNumber-foreground, rgba(133, 133, 133, 0.9)) !important;
        cursor: pointer;
        font-family: var(--vscode-editor-font-family, var(--vscode-font-family, monospace));
        font-size: 12px;
        line-height: 1.4;
        pointer-events: auto;
        text-align: right;
        white-space: nowrap;
      }

      ${activeItems},
      ${hoverItems},
      ${focusedItems} {
        color: var(
          --vscode-editorLineNumber-activeForeground,
          var(--vscode-editorLineNumber-foreground, rgba(133, 133, 133, 0.9))
        ) !important;
      }

      ${anchors} {
        scroll-margin-top: 72px;
      }
  `;
}

/** Remove every renderer-owned marker and layout value from a retired editor root. */
export function cleanupLineNumberRoot(root: HTMLElement): void {
  root.querySelector(`:scope > [${GUTTER_ATTRIBUTE}="true"]`)?.remove();
  root.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTRIBUTE}="true"]`).forEach((element) => {
    element.removeAttribute(ANCHOR_ATTRIBUTE);
    element.removeAttribute(SOURCE_LINE_ATTRIBUTE);
    element.removeAttribute(DISPLAY_LINE_ATTRIBUTE);
    element.removeAttribute(DEPTH_ATTRIBUTE);
  });
  root.removeAttribute(ROOT_STATE_ATTRIBUTE);
  root.style.removeProperty(GUTTER_WIDTH_CSS_VARIABLE);
  root.style.removeProperty(ROOT_PADDING_LEFT_CSS_VARIABLE);
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
    const root = findLineNumberRoot(document) as HTMLElement | null;
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
    gutter.setAttribute("role", "navigation");
    gutter.setAttribute("aria-label", "Line numbers");
    gutter.setAttribute("contenteditable", "false");
    gutter.addEventListener("click", this.handleGutterClick);
    gutter.addEventListener("keydown", this.handleGutterKeyDown);

    const rootRect = root.getBoundingClientRect();

    const positionInputs: LineNumberPositionInput[] = lineElements.map((element) => ({
      rect: element.getBoundingClientRect(),
      fallbackLineHeight: this.getFallbackLineHeight(element),
    }));
    const positions = computeLineNumberPositions(
      positionInputs,
      rootRect.top,
      root.scrollTop,
    );

    lineElements.forEach((element, index) => {
      this.lineMap.set(index, element);
      element.setAttribute(ANCHOR_ATTRIBUTE, "true");
      element.setAttribute(SOURCE_LINE_ATTRIBUTE, String(index));
      element.setAttribute(DISPLAY_LINE_ATTRIBUTE, String(index + 1));
      element.setAttribute(DEPTH_ATTRIBUTE, String(this.getElementDepth(element, root)));

      const lineNumber = document.createElement("button");
      lineNumber.className = "vditor-line-number";
      lineNumber.type = "button";
      lineNumber.setAttribute(ITEM_ATTRIBUTE, "true");
      lineNumber.setAttribute(SOURCE_LINE_ATTRIBUTE, String(index));
      lineNumber.setAttribute("aria-label", `Go to line ${index + 1}`);
      lineNumber.setAttribute("contenteditable", "false");
      lineNumber.tabIndex = getLineNumberTabIndex(
        index,
        this.activeLineNumber,
        lineElements.length,
      );
      lineNumber.textContent = String(index + 1);

      const { top, height } = positions[index];
      lineNumber.style.top = `${top}px`;
      lineNumber.style.height = `${height}px`;
      this.lineNumberMap.set(index, lineNumber);
      gutter.appendChild(lineNumber);
    });

    root.insertBefore(gutter, root.firstChild);
    root.setAttribute(ROOT_STATE_ATTRIBUTE, "true");
    this.updateActiveLineNumber();
  }

  private handleGutterClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}="true"]`)
      : null;
    const lineNumber = parseLineNumber(target?.getAttribute(SOURCE_LINE_ATTRIBUTE) ?? null);
    const lineElement = lineNumber === null ? null : this.lineMap.get(lineNumber) ?? null;

    if (!target || !lineElement || !this.currentRoot) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    navigateToLineElement(
      this.currentRoot,
      lineElement,
      window.getSelection() as unknown as MutableSelectionLike | null,
      () => document.createRange(),
    );
    this.setActiveLineNumber(lineNumber);
  };

  private handleGutterKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>(`[${ITEM_ATTRIBUTE}="true"]`)
      : null;
    const currentLineNumber = parseLineNumber(
      target?.getAttribute(SOURCE_LINE_ATTRIBUTE) ?? null,
    );
    const nextLineNumber = currentLineNumber === null
      ? null
      : getLineNumberKeyboardTarget(currentLineNumber, event.key, this.lineNumberMap.size);
    const nextElement = nextLineNumber === null
      ? null
      : this.lineNumberMap.get(nextLineNumber) ?? null;

    if (!nextElement || nextLineNumber === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.setActiveLineNumber(nextLineNumber);
    nextElement.focus({ preventScroll: true });
    nextElement.scrollIntoView({ block: "nearest" });
  };

  private observeRootResize(root: HTMLElement): void {
    if (this.currentRoot && this.currentRoot !== root) {
      cleanupLineNumberRoot(this.currentRoot);
      this.resizeObserver?.unobserve(this.currentRoot);
      this.currentRoot = null;
    }

    if (typeof ResizeObserver === "undefined") {
      this.currentRoot = root;
      return;
    }

    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
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
      cleanupLineNumberRoot(this.currentRoot);
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
    this.updateLineNumberTabStops();
  }

  private updateLineNumberTabStops(): void {
    this.lineNumberMap.forEach((element, lineNumber) => {
      element.tabIndex = getLineNumberTabIndex(
        lineNumber,
        this.activeLineNumber,
        this.lineNumberMap.size,
      );
    });
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
    style.textContent = getLineNumberStyles();

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
