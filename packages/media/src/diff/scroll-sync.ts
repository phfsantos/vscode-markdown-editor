import type { DiffScrollAnchor } from "@markdown-editor/core";

/** Aligned-row geometry in content scroll coordinates, sorted by `top`. */
export interface RowBox { row: number; top: number; height: number }

export function anchorAt(boxes: readonly RowBox[], scrollTop: number): DiffScrollAnchor | null {
  if (!boxes.length) return null;
  let low = 0;
  let high = boxes.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (boxes[mid].top <= scrollTop) low = mid; else high = mid - 1;
  }
  const box = boxes[low];
  const offset = box.height > 0 ? (scrollTop - box.top) / box.height : 0;
  return { row: box.row, offset: Math.min(1, Math.max(0, offset)) };
}

export function scrollTopFor(boxes: readonly RowBox[], anchor: DiffScrollAnchor): number | null {
  if (!boxes.length) return null;
  let best = boxes[0];
  for (const box of boxes) {
    if (box.row > anchor.row) break;
    best = box;
  }
  return best.row === anchor.row ? best.top + anchor.offset * best.height : best.top + best.height;
}

/** Input that means "the user is driving this pane". */
const OWNERSHIP_EVENTS = ["pointerdown", "pointermove", "wheel", "touchstart", "keydown"] as const;

/**
 * Anchor-based scroll synchronisation for one diff pane (ADR 0001 §4).
 *
 * The pane the user is driving owns scrolling and emits: it claims ownership on
 * local input (pointer, wheel, touch, keyboard) or on any scroll it did not
 * cause itself. A follower applies anchors and recognises the resulting scroll
 * by the exact position it set, so it never emits it back: no echo and no
 * timer-based suppression. Emission is coalesced to one anchor per frame.
 */
export class DiffScrollSync {
  private content: HTMLElement | null = null;
  /** Receives ownership input: the pane host, so input over overlay rows counts too. */
  private inputRoot: HTMLElement | null = null;
  private owner = false;
  private frame = 0;
  private boxes: readonly RowBox[] = [];
  private readonly onInput = (event: Event) => {
    // Chrome dispatches a motionless pointermove after a programmatic scroll; that
    // is the follower being moved, not the user, and must not steal ownership.
    if (event.type === "pointermove" && !(event as PointerEvent).movementX && !(event as PointerEvent).movementY) return;
    this.setOwner(true);
    // With passive wheel listeners Chrome scrolls on the compositor before the
    // wheel event reaches this thread, so the first scroll can precede the
    // claim. Emitting the current position on claim keeps the follower within
    // one frame of the source instead of waiting for the next scroll event.
    this.schedule();
  };
  /** scrollTop this pane last set itself while following; its own scroll event must not be re-emitted. */
  private applied: number | null = null;
  private readonly onScroll = () => {
    if (!this.content) return;
    if (this.applied !== null && Math.abs(this.content.scrollTop - this.applied) < 1) return;
    // A scroll this pane did not cause is the user's (wheel, scrollbar drag,
    // keyboard, find), even when its input event has not arrived yet.
    this.applied = null;
    if (!this.owner) this.setOwner(true);
    this.schedule();
  };
  private lastPosted = "";

  constructor(private readonly post: (anchor: DiffScrollAnchor) => void) {}

  attach(content: HTMLElement): void {
    if (this.content === content) return;
    this.detach();
    this.content = content;
    this.inputRoot = content.parentElement ?? content;
    content.addEventListener("scroll", this.onScroll, { passive: true });
    for (const type of OWNERSHIP_EVENTS) this.inputRoot.addEventListener(type, this.onInput, { passive: true });
  }

  detach(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.content?.removeEventListener("scroll", this.onScroll);
    for (const type of OWNERSHIP_EVENTS) this.inputRoot?.removeEventListener(type, this.onInput);
    this.content = this.inputRoot = null;
    this.owner = false;
  }

  setRows(boxes: readonly RowBox[]): void {
    this.boxes = boxes;
  }

  /** Post this pane's anchor on the next frame (coalesced; identical anchors are not re-sent). */
  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.content || !this.owner) return;
      const anchor = anchorAt(this.boxes, this.content.scrollTop);
      if (!anchor) return;
      const key = `${anchor.row}:${anchor.offset.toFixed(4)}`;
      if (key === this.lastPosted) return;
      this.lastPosted = key;
      this.post(anchor);
      // Test hook on the pane host (outside the saved content): emissions so far.
      if (this.inputRoot) this.inputRoot.dataset.diffScrollPosts = String(Number(this.inputRoot.dataset.diffScrollPosts ?? 0) + 1);
    });
  }

  /** A local action (change navigation, ruler click) is about to scroll this pane. */
  claim(): void {
    this.setOwner(true);
  }

  private setOwner(owner: boolean): void {
    this.owner = owner;
    if (this.inputRoot) this.inputRoot.dataset.diffScrollOwner = String(owner);
  }

  /** The other pane is driving: follow it and give up ownership. */
  follow(anchor: DiffScrollAnchor): void {
    if (!this.content) return;
    this.setOwner(false);
    this.lastPosted = "";
    const top = scrollTopFor(this.boxes, anchor);
    if (top === null) return;
    const target = Math.round(top);
    if (Math.abs(this.content.scrollTop - target) >= 1) {
      this.content.scrollTop = target;
      // Read back: the browser clamps at the ends, and that is the position the scroll event will report.
      this.applied = this.content.scrollTop;
    }
  }
}
