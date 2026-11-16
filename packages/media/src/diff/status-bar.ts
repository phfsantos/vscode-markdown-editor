import type { DiffStats } from "@markdown-editor/core";

export type DiffPaneRole = "original" | "modified" | "pending";
export type DiffPaneState = "loading" | "ready" | "error";

export interface DiffStatus {
  role: DiffPaneRole;
  readOnly: boolean;
  stats: DiffStats;
  state: DiffPaneState;
  message?: string;
}

const ROLE_LABEL: Record<DiffPaneRole, string> = {
  original: "Original",
  modified: "Modified",
  pending: "Pending changes",
};

const CHEVRON_UP = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5.3 3.4 9.9l.7.7L8 6.7l3.9 3.9.7-.7z"/></svg>';
const CHEVRON_DOWN = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="m8 10.7 4.6-4.6-.7-.7L8 9.3 4.1 5.4l-.7.7z"/></svg>';

/**
 * Compact diff status bar (spec: docs/testing/artifacts/diff-view/status-bar-spec.md).
 * It sits in normal flow between Vditor's toolbar and content, so it can never
 * cover the toolbar; the content height shrinks by its fixed 24px via CSS. On a
 * read-only side it also disables the toolbar (inert, dimmed) without removing it.
 */
export class DiffStatusBar {
  private element: HTMLElement | null = null;

  constructor(private readonly onNavigate: (direction: -1 | 1) => void) {}

  update(status: DiffStatus): void {
    const vditor = document.querySelector<HTMLElement>("#app .vditor, .vditor");
    if (!vditor) return;
    const bar = this.ensure(vditor);
    bar.dataset.diffRole = status.role;
    bar.dataset.diffState = status.state;
    bar.dataset.readOnly = String(status.readOnly);
    const total = status.stats.added + status.stats.deleted + status.stats.modified;
    bar.querySelector(".md-diff-statusbar__role")!.textContent = ROLE_LABEL[status.role];
    (bar.querySelector(".md-diff-statusbar__readonly") as HTMLElement).hidden = !status.readOnly;
    const message = bar.querySelector<HTMLElement>(".md-diff-statusbar__message")!;
    message.hidden = status.state === "ready";
    message.textContent = status.state === "loading" ? "Comparing…" : status.state === "error" ? status.message ?? "Diff unavailable" : "";
    message.title = message.textContent;
    const counts = bar.querySelector<HTMLElement>(".md-diff-statusbar__counts")!;
    counts.hidden = status.state !== "ready";
    for (const key of ["added", "deleted", "modified"] as const) {
      const count = counts.querySelector<HTMLElement>(`[data-count="${key}"]`)!;
      count.textContent = `${key === "added" ? "+" : key === "deleted" ? "−" : "~"}${status.stats[key]}`;
      count.setAttribute("aria-label", `${status.stats[key]} ${key}`);
      count.title = `${status.stats[key]} ${key}`;
    }
    for (const button of Array.from(bar.querySelectorAll<HTMLButtonElement>(".md-diff-statusbar__nav"))) {
      button.disabled = status.state !== "ready" || total === 0;
    }
    document.body.classList.add("md-diff-active");
    document.body.classList.toggle("md-diff-readonly", status.readOnly);
    // Disabled, not removed: inert takes the buttons out of pointer and keyboard reach.
    const toolbar = vditor.querySelector<HTMLElement>(":scope > .vditor-toolbar");
    if (toolbar) {
      toolbar.inert = status.readOnly;
      toolbar.toggleAttribute("aria-disabled", status.readOnly);
    }
  }

  remove(): void {
    const toolbar = this.element?.parentElement?.querySelector<HTMLElement>(":scope > .vditor-toolbar");
    if (toolbar) {
      toolbar.inert = false;
      toolbar.removeAttribute("aria-disabled");
    }
    this.element?.remove();
    this.element = null;
    document.body.classList.remove("md-diff-active", "md-diff-readonly");
  }

  private ensure(vditor: HTMLElement): HTMLElement {
    if (this.element?.isConnected && this.element.parentElement === vditor) return this.element;
    this.element?.remove();
    const bar = document.createElement("div");
    bar.className = "md-diff-statusbar";
    bar.setAttribute("data-diff-statusbar", "");
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.innerHTML = `
      <span class="md-diff-statusbar__role"></span>
      <span class="md-diff-statusbar__readonly" hidden>Read-only</span>
      <span class="md-diff-statusbar__message" hidden></span>
      <span class="md-diff-statusbar__counts">
        <span class="md-diff-count md-diff-count--added" data-count="added"></span>
        <span class="md-diff-count md-diff-count--deleted" data-count="deleted"></span>
        <span class="md-diff-count md-diff-count--modified" data-count="modified"></span>
      </span>
      <span class="md-diff-statusbar__nav-group">
        <button type="button" class="md-diff-statusbar__nav" data-direction="-1" aria-label="Previous change" title="Previous change">${CHEVRON_UP}</button>
        <button type="button" class="md-diff-statusbar__nav" data-direction="1" aria-label="Next change" title="Next change">${CHEVRON_DOWN}</button>
      </span>`;
    bar.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(".md-diff-statusbar__nav");
      if (button && !button.disabled) this.onNavigate(Number(button.dataset.direction) as -1 | 1);
    });
    const toolbar = vditor.querySelector(":scope > .vditor-toolbar");
    vditor.insertBefore(bar, toolbar ? toolbar.nextSibling : vditor.firstChild);
    this.element = bar;
    return bar;
  }
}
