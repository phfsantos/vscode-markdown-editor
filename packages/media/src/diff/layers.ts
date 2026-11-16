import type { DiffLayout, LineChangeType, PreviousRow } from "./model";

/** Attributes the diff view writes onto Vditor's rendered elements; save cleaning strips them. */
export const DIFF_ROW_ATTRIBUTE = "data-diff-line";
export const DIFF_TYPE_ATTRIBUTE = "data-diff-type";
export const DIFF_GAP_ATTRIBUTE = "data-diff-gap";
export const DIFF_OWNED_ATTRIBUTES = [DIFF_ROW_ATTRIBUTE, DIFF_TYPE_ATTRIBUTE, DIFF_GAP_ATTRIBUTE] as const;

const GAP_STYLE_ID = "md-diff-gap-rules";

const ROW_LABEL: Record<PreviousRow<unknown>["kind"], string> = {
  previous: "Previous version",
  removed: "Removed line",
  ghost: "Only in the other version",
};

/** Wrap a lone row fragment so it renders on its own (an <li> needs a list, a <tr> a table). */
function standalone(html: string): string {
  const trimmed = html.trim();
  if (/^<li[\s>]/i.test(trimmed)) return `<ul>${trimmed}</ul>`;
  if (/^<tr[\s>]/i.test(trimmed)) return `<table><tbody>${trimmed}</tbody></table>`;
  if (/^<t[dh][\s>]/i.test(trimmed)) return `<table><tbody><tr>${trimmed}</tr></tbody></table>`;
  return trimmed;
}

const UNSAFE_ELEMENTS = "script, iframe, frame, frameset, object, embed, applet, form, meta, base, link, style, template, noscript";
const URL_ATTRIBUTES = ["href", "src", "xlink:href", "action", "formaction", "srcset", "poster", "data"];

/**
 * Rows show the *other* version's rendered HTML. The editor webview's CSP allows
 * inline script, so that HTML is parsed in an inert document and stripped of
 * anything executable before it is attached (red-team A2).
 */
export function sanitizeRowHtml(html: string): DocumentFragment {
  const inertDocument = document.implementation.createHTMLDocument("");
  const container = inertDocument.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll(UNSAFE_ELEMENTS).forEach((node) => node.remove());
  for (const element of Array.from(container.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.replace(/[\u0000-\u0020]/g, "").toLowerCase();
      if (name.startsWith("on") || name === "contenteditable" || name === "style" && /expression|url\(/.test(value)) {
        element.removeAttribute(attribute.name);
      } else if (URL_ATTRIBUTES.includes(name) && /^(javascript|vbscript|data:text\/html)/.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  const fragment = document.createDocumentFragment();
  for (const node of Array.from(container.childNodes)) fragment.appendChild(document.importNode(node, true));
  return fragment;
}

function textOf(html: string): string {
  return (sanitizeRowHtml(html).textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The two overlay layers of a diff pane.
 *
 * Both live in `.vditor-ir` *beside* the contenteditable `pre.vditor-reset`,
 * never inside it, so nothing they hold can be serialized into the document:
 * - the paint layer sits over the text (translucent, pointer-events: none) and
 *   draws full-width row highlights; the theme's opaque content, table and code
 *   backgrounds would hide anything painted underneath;
 * - the row layer sits above the text and holds previous-version / removed /
 *   ghost rows in space reserved by a generated stylesheet (never inline styles
 *   on Vditor's elements).
 * Their content is translated by the editor's scroll offset so it scrolls with
 * the text without being part of it.
 */
export class DiffLayers {
  private paint: HTMLElement | null = null;
  private rows: HTMLElement | null = null;
  private host: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private readonly onScroll = () => this.syncScroll();
  /** Rows sit above the text; a wheel over one must still scroll the editor beneath. */
  private readonly onRowWheel = (event: WheelEvent) => {
    if (!this.content) return;
    this.content.scrollBy({ left: event.deltaX, top: event.deltaY });
  };

  attach(content: HTMLElement): void {
    const host = content.parentElement;
    if (!host) return;
    if (this.content === content && this.paint?.isConnected && this.rows?.isConnected) return;
    this.detach();
    this.host = host;
    this.content = content;
    host.classList.add("md-diff-host");
    content.classList.add("md-diff-content");
    this.paint = this.createLayer("md-diff-paint-layer");
    this.rows = this.createLayer("md-diff-row-layer");
    host.insertBefore(this.paint, content);
    host.appendChild(this.rows);
    this.rows.addEventListener("wheel", this.onRowWheel, { passive: true });
    content.addEventListener("scroll", this.onScroll, { passive: true });
  }

  detach(): void {
    this.content?.removeEventListener("scroll", this.onScroll);
    this.paint?.remove();
    this.rows?.remove();
    this.host?.classList.remove("md-diff-host");
    this.content?.classList.remove("md-diff-content");
    document.getElementById(GAP_STYLE_ID)?.remove();
    if (this.content) clearOwnedAttributes(this.content);
    this.paint = this.rows = this.host = this.content = null;
  }

  /** Paint one layout. Reads layout once after writing the gap rules; never touches inline styles of Vditor nodes. */
  render(layout: DiffLayout<HTMLElement>): void {
    const content = this.content;
    const paintLayer = this.paint?.firstElementChild as HTMLElement | null;
    const rowLayer = this.rows?.firstElementChild as HTMLElement | null;
    if (!content || !paintLayer || !rowLayer) return;

    // Drop the previous gap rules before measuring anything: a stale rule with a
    // reused id would otherwise be read back as the element's own margin/padding.
    writeGapRules([]);
    clearOwnedAttributes(content);
    paintLayer.replaceChildren();
    rowLayer.replaceChildren();
    this.positionLayers();

    for (const { row, element, type } of layout.decorations) {
      element.setAttribute(DIFF_ROW_ATTRIBUTE, String(row));
      element.setAttribute(DIFF_TYPE_ATTRIBUTE, type);
    }

    // 1. Build rows at the column width and measure them.
    const columnWidth = content.clientWidth;
    const style = getComputedStyle(content);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const built = layout.previousRows.map((previous, index) => {
      const node = document.createElement("div");
      node.className = `md-diff-row md-diff-row--${previous.kind}`;
      node.setAttribute("data-diff-previous", previous.kind);
      node.setAttribute("data-diff-row-for", String(previous.row));
      node.setAttribute("role", "note");
      node.setAttribute("aria-label", `${ROW_LABEL[previous.kind]}: ${textOf(previous.html)}`);
      // Ghost rows only hold space for the other pane's line: labelled, but not a tab stop.
      node.tabIndex = previous.kind === "ghost" ? -1 : 0;
      node.style.width = `${columnWidth}px`;
      node.style.paddingLeft = `${padLeft}px`;
      node.style.paddingRight = `${padRight}px`;
      const body = document.createElement("div");
      body.className = "vditor-reset md-diff-row__body";
      body.appendChild(sanitizeRowHtml(standalone(previous.html)));
      body.inert = true;
      node.appendChild(body);
      rowLayer.appendChild(node);
      return { previous, node, index };
    });
    const heights = built.map(({ node }) => Math.ceil(node.getBoundingClientRect().height));

    // 2. Reserve the space: rows stacked before the same element share one gap.
    const gaps = new Map<HTMLElement | null, number>();
    built.forEach(({ previous }, i) => gaps.set(previous.before, (gaps.get(previous.before) ?? 0) + heights[i]));
    const rules: string[] = [];
    let gapId = 0;
    for (const [element, height] of gaps) {
      if (!element) {
        rules.push(`.md-diff-content{padding-bottom:calc(16px + ${height}px) !important}`);
        continue;
      }
      const id = String(gapId++);
      element.setAttribute(DIFF_GAP_ATTRIBUTE, id);
      rules.push(gapRule(element, id, height));
    }
    writeGapRules(rules);

    // 3. Read geometry once and place paint and rows in content coordinates.
    const contentRect = content.getBoundingClientRect();
    const toContentY = (y: number) => y - contentRect.top - content.clientTop + content.scrollTop;
    const gapTop = new Map<HTMLElement | null, number>();
    for (const [element, height] of gaps) {
      // A trailing gap is the extra bottom padding, which ends 16px above the scroll end.
      const bottom = element ? toContentY(lineTop(element)) : content.scrollHeight - 16;
      gapTop.set(element, bottom - height);
    }
    built.forEach(({ previous, node }, i) => {
      const top = gapTop.get(previous.before) ?? 0;
      node.style.transform = `translateY(${Math.round(top)}px)`;
      gapTop.set(previous.before, top + heights[i]);
    });

    for (const { row, element, type } of layout.decorations) {
      const top = toContentY(lineTop(element));
      const height = lineBottom(element) - lineTop(element);
      paintLayer.appendChild(paintRow(row, type, top, height, columnWidth));
    }
    this.syncScroll();
  }

  /** Re-place the layers over the editor viewport (on resize). */
  positionLayers(): void {
    if (!this.content || !this.paint || !this.rows) return;
    const { offsetTop, offsetLeft, clientWidth, clientHeight } = this.content;
    for (const layer of [this.paint, this.rows]) {
      layer.style.top = `${offsetTop + this.content.clientTop}px`;
      layer.style.left = `${offsetLeft + this.content.clientLeft}px`;
      layer.style.width = `${clientWidth}px`;
      layer.style.height = `${clientHeight}px`;
    }
  }

  private syncScroll(): void {
    if (!this.content) return;
    const transform = `translate(${-this.content.scrollLeft}px, ${-this.content.scrollTop}px)`;
    for (const layer of [this.paint, this.rows]) {
      const inner = layer?.firstElementChild as HTMLElement | null;
      if (inner && inner.style.transform !== transform) inner.style.transform = transform;
    }
  }

  private createLayer(className: string): HTMLElement {
    const layer = document.createElement("div");
    layer.className = `md-diff-layer ${className}`;
    layer.setAttribute("data-diff-artifact", "layer");
    const inner = document.createElement("div");
    inner.className = "md-diff-layer__content";
    layer.appendChild(inner);
    return layer;
  }
}

function paintRow(row: number, type: LineChangeType, top: number, height: number, width: number): HTMLElement {
  const paint = document.createElement("div");
  paint.className = `md-diff-paint md-diff-paint--${type}`;
  paint.setAttribute("data-diff-paint-line", String(row));
  paint.style.transform = `translateY(${Math.round(top)}px)`;
  paint.style.height = `${Math.max(1, Math.round(height))}px`;
  paint.style.width = `${width}px`;
  return paint;
}

/** Top of the line's own box, excluding a reserved gap held as cell padding (table rows). */
function lineTop(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (element.tagName === "TR" && element.hasAttribute(DIFF_GAP_ATTRIBUTE)) {
    const cell = element.firstElementChild as HTMLElement | null;
    const extra = cell ? parseFloat(getComputedStyle(cell).getPropertyValue("--md-diff-gap")) || 0 : 0;
    return rect.top + extra;
  }
  return rect.top;
}

function lineBottom(element: HTMLElement): number {
  return element.getBoundingClientRect().bottom;
}

/**
 * Space above `element` without moving its own box (line numbers and paint read
 * that box): a collapse-aware margin, or, for table rows where margins do not
 * apply, extra cell padding exposed as `--md-diff-gap`.
 */
function gapRule(element: HTMLElement, id: string, height: number): string {
  const selector = `.md-diff-content [${DIFF_GAP_ATTRIBUTE}="${id}"]`;
  if (element.tagName === "TR") {
    const cell = element.firstElementChild as HTMLElement | null;
    const base = cell ? parseFloat(getComputedStyle(cell).paddingTop) || 0 : 0;
    return `${selector} > *{padding-top:${base + height}px !important;--md-diff-gap:${height}px}`;
  }
  const own = parseFloat(getComputedStyle(element).marginTop) || 0;
  const previous = element.previousElementSibling as HTMLElement | null;
  const above = previous ? parseFloat(getComputedStyle(previous).marginBottom) || 0 : 0;
  return `${selector}{margin-top:${Math.max(own, above) + height}px !important}`;
}

function writeGapRules(rules: string[]): void {
  let style = document.getElementById(GAP_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = GAP_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = rules.join("\n");
}

function clearOwnedAttributes(root: HTMLElement): void {
  for (const attribute of DIFF_OWNED_ATTRIBUTES) {
    root.querySelectorAll(`[${attribute}]`).forEach((element) => element.removeAttribute(attribute));
  }
}
