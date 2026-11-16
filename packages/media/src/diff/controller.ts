import type { DiffScrollAnchor } from "@markdown-editor/core";
import { getRenderedLineElements } from "../diff-line-dom-mapper";
import { DiffLayers } from "./layers";
import { diffKey, layoutDiff, type DiffInfo, type DiffLayout } from "./model";
import { DiffOverviewRuler, type RulerMark } from "./overview-ruler";
import { DiffScrollSync, type RowBox } from "./scroll-sync";
import { DiffStatusBar, type DiffPaneRole } from "./status-bar";
import "./diff.css";

export const DIFF_APPLIED_MARK = "markdown-diff:applied";
export const DIFF_RENDERED_MARK = "markdown-diff:rendered";
/** Quiet period after editor mutations before the diff is repainted. */
export const EDIT_SETTLE_MS = 120;

export interface DiffViewOptions {
  /** Posts this pane's scroll anchor to the host (side-by-side only). */
  postScrollAnchor(anchor: DiffScrollAnchor): void;
  /** Whether this pane's document is read-only. */
  isReadOnly(): boolean;
}

/** The visible editor's content root; the hidden diff renderer has one too. */
export function findEditorContent(): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(".vditor-ir > pre.vditor-reset");
  for (const candidate of Array.from(candidates)) {
    if (!candidate.closest("#hidden-diff-renderer, .vditor-toolbar--hide")) return candidate;
  }
  return null;
}

/**
 * Webview side of the diff view: one controller per webview, driven by the
 * typed host messages `diff-view-detected`, `diff-view-cleared` and
 * `diff-scroll-sync` (routed in main.ts). Rendering, rows, status bar, ruler
 * and scroll sync live in their own modules under ./diff.
 */
export class WebviewDiffView {
  private info: DiffInfo | null = null;
  private renderedKey = "";
  private layout: DiffLayout<HTMLElement> | null = null;
  private content: HTMLElement | null = null;
  private frame = 0;
  private editTimer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | null = null;
  private resize: ResizeObserver | null = null;
  private readonly layers = new DiffLayers();
  private readonly ruler = new DiffOverviewRuler((row) => this.reveal(row));
  private readonly statusBar = new DiffStatusBar((direction) => this.navigate(direction));
  private readonly scrollSync: DiffScrollSync;

  constructor(private readonly options: DiffViewOptions) {
    this.scrollSync = new DiffScrollSync((anchor) => this.options.postScrollAnchor(anchor));
  }

  get active(): boolean {
    return this.info !== null;
  }

  show(info: DiffInfo): void {
    this.info = info;
    this.statusBar.update({ ...this.statusFor(info), state: "loading" });
    this.schedule();
  }

  clear(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.editTimer) clearTimeout(this.editTimer);
    this.frame = 0;
    this.editTimer = undefined;
    this.info = null;
    this.layout = null;
    this.renderedKey = "";
    this.observer?.disconnect();
    this.resize?.disconnect();
    this.observer = this.resize = null;
    this.layers.detach();
    this.ruler.remove();
    this.statusBar.remove();
    this.scrollSync.detach();
    this.content = null;
  }

  /** Host message: the diff could not be produced; say so instead of showing nothing. */
  fail(message: string, role: DiffPaneRole = "modified"): void {
    this.statusBar.update({ role, readOnly: this.options.isReadOnly(), stats: { added: 0, deleted: 0, modified: 0 }, state: "error", message });
  }

  applyScrollAnchor(anchor: DiffScrollAnchor): void {
    this.scrollSync.follow(anchor);
  }

  /** Move to the previous/next change relative to the viewport top. */
  navigate(direction: -1 | 1): void {
    const content = this.content;
    if (!content || !this.layout) return;
    const tops = this.changeTops().sort((a, b) => a - b);
    const current = content.scrollTop + 24;
    const target = direction > 0 ? tops.find((top) => top > current + 1) : [...tops].reverse().find((top) => top < current - 1);
    if (target === undefined) return;
    this.scrollSync.claim();
    content.scrollTop = Math.max(0, target - 24);
  }

  /** Repaint after the editor DOM changed (Vditor re-renders blocks and drops our attributes). */
  schedule(): void {
    if (this.frame || !this.info) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /**
   * Editor mutations come in bursts while typing; a repaint re-measures every
   * line, so wait until the burst settles instead of repainting each frame
   * (red-team A3). A new diff from the host still paints on the next frame.
   */
  private scheduleAfterEdits(): void {
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = undefined;
      this.schedule();
    }, EDIT_SETTLE_MS);
  }

  private render(): void {
    const info = this.info;
    const content = findEditorContent();
    if (!info || !content) return;
    if (content !== this.content) this.bind(content);
    const elements = getRenderedLineElements(content as any) as unknown as HTMLElement[];
    const layout = layoutDiff(elements, info);
    this.layers.attach(content);
    this.layers.render(layout);
    this.layout = layout;
    const boxes = this.rowBoxes(layout, content);
    this.scrollSync.setRows(boxes);
    if (info.mode === "side-by-side") this.scrollSync.attach(content); else this.scrollSync.detach();
    this.ruler.render(content, this.rulerMarks(layout, boxes));
    this.statusBar.update({ ...this.statusFor(info), state: "ready" });
    const key = diffKey(info);
    if (key !== this.renderedKey) {
      this.renderedKey = key;
      performance.mark(DIFF_APPLIED_MARK);
    }
  }

  private bind(content: HTMLElement): void {
    this.observer?.disconnect();
    this.resize?.disconnect();
    this.content = content;
    this.observer = new MutationObserver(() => this.scheduleAfterEdits());
    this.observer.observe(content, { childList: true, subtree: true, characterData: true });
    this.resize = new ResizeObserver(() => this.schedule());
    this.resize.observe(content);
  }

  private statusFor(info: DiffInfo) {
    const role: DiffPaneRole = info.mode === "inline" ? "pending" : info.role === "left" ? "original" : "modified";
    return { role, readOnly: this.options.isReadOnly(), stats: info.stats };
  }

  private rowBoxes(layout: DiffLayout<HTMLElement>, content: HTMLElement): RowBox[] {
    const origin = content.getBoundingClientRect().top - content.clientTop - content.scrollTop;
    const ghostTops = new Map<number, { top: number; height: number }>();
    document.querySelectorAll<HTMLElement>("[data-diff-row-for]").forEach((node) => {
      const rect = node.getBoundingClientRect();
      ghostTops.set(Number(node.dataset.diffRowFor), { top: rect.top - origin, height: rect.height });
    });
    const boxes: RowBox[] = [];
    for (const entry of layout.rows) {
      if (entry.kind === "gap") {
        const ghost = ghostTops.get(entry.row);
        if (ghost) boxes.push({ row: entry.row, ...ghost });
        continue;
      }
      const rect = entry.element.getBoundingClientRect();
      boxes.push({ row: entry.row, top: rect.top - origin, height: rect.height });
    }
    return boxes.sort((a, b) => a.top - b.top);
  }

  private rulerMarks(layout: DiffLayout<HTMLElement>, boxes: RowBox[]): RulerMark[] {
    const topOf = new Map(boxes.map((box) => [box.row, box.top]));
    const marks: RulerMark[] = layout.decorations.map((d) => ({ row: d.row, type: d.type, top: topOf.get(d.row) ?? 0 }));
    for (const entry of layout.rows) if (entry.kind === "gap") marks.push({ row: entry.row, type: "gap", top: topOf.get(entry.row) ?? 0 });
    return marks;
  }

  private changeTops(): number[] {
    if (!this.layout || !this.content) return [];
    const boxes = this.rowBoxes(this.layout, this.content);
    return this.rulerMarks(this.layout, boxes).map((mark) => mark.top);
  }

  private reveal(row: number): void {
    if (!this.layout || !this.content) return;
    const box = this.rowBoxes(this.layout, this.content).find((candidate) => candidate.row === row);
    if (!box) return;
    this.scrollSync.claim();
    this.content.scrollTop = Math.max(0, box.top - this.content.clientHeight / 3);
  }
}
