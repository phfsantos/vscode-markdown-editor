import type { LineChangeType } from "./model";

export interface RulerMark {
  row: number;
  type: LineChangeType | "gap";
  /** Top of the row in content scroll coordinates. */
  top: number;
}

/**
 * Change markers along the editor's right edge. The strip is placed over the
 * content viewport (not the window), so it follows resizes and never covers the
 * toolbar or status bar.
 */
export class DiffOverviewRuler {
  private element: HTMLElement | null = null;

  constructor(private readonly onReveal: (row: number) => void) {}

  render(content: HTMLElement, marks: RulerMark[]): void {
    const host = content.parentElement;
    if (!host) return;
    if (!this.element?.isConnected) {
      this.element = document.createElement("div");
      this.element.className = "md-diff-ruler";
      this.element.setAttribute("data-diff-artifact", "ruler");
      this.element.setAttribute("aria-hidden", "true");
      this.element.addEventListener("click", (event) => {
        const mark = (event.target as Element).closest<HTMLElement>(".md-diff-ruler__mark");
        if (mark) this.onReveal(Number(mark.dataset.row));
      });
      host.appendChild(this.element);
    }
    this.position(content);
    const height = Math.max(1, content.scrollHeight);
    this.element.replaceChildren(...marks.map((mark) => {
      const node = document.createElement("div");
      node.className = `md-diff-ruler__mark md-diff-ruler__mark--${mark.type}`;
      node.dataset.row = String(mark.row);
      node.style.top = `${Math.max(0, Math.min(100, (mark.top / height) * 100))}%`;
      return node;
    }));
  }

  position(content: HTMLElement): void {
    if (!this.element) return;
    this.element.style.top = `${content.offsetTop + content.clientTop}px`;
    this.element.style.height = `${content.clientHeight}px`;
  }

  remove(): void {
    this.element?.remove();
    this.element = null;
  }
}
