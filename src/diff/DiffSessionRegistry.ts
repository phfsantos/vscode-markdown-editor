/**
 * Pairs the two custom editors VS Code resolves for one diff tab and decides
 * which is the original (left) and which the modified (right) side.
 *
 * VS Code reports no tab input for a custom-editor diff (ADR 0001, finding N1),
 * so neither the tab label nor the active tab is consulted:
 * - membership: a diff's two sides resolve one after the other in the same
 *   editor column, so a side joins the open (one-sided) session of its column;
 * - sides: the side whose document is not writable (git:, chat-editing
 *   snapshots, read-only file systems) is the original, whatever the resolve
 *   order. Two writable files carry no document signal: VS Code focuses the
 *   modified (primary) side when it opens a diff, so the first side to become
 *   active is the modified one (`basis: "active-side"`). Until a side becomes
 *   active the first resolved side is provisionally the modified one
 *   (`basis: "resolve-order"`); resolve order alone is a race (ADR 0001).
 */
export interface DiffSideFacts {
  /** Document URI, for diagnostics only; sides are decided by `writable`. */
  readonly uri: string;
  readonly writable: boolean;
}

export type DiffRole = "left" | "right";
export type DiffSideBasis = "writability" | "active-side" | "resolve-order";

interface Side<P> {
  readonly panel: P;
  readonly facts: DiffSideFacts;
  readonly order: number;
}

export interface DiffSession<P> {
  readonly id: string;
  readonly column: number;
  left?: P;
  right?: P;
  basis?: DiffSideBasis;
}

interface SessionState<P> extends DiffSession<P> {
  sides: Side<P>[];
  /** The first side VS Code focused; decides two writable files, once. */
  activated?: P;
}

export class DiffSessionRegistry<P> {
  private readonly sessions = new Map<string, SessionState<P>>();
  private readonly byPanel = new Map<P, SessionState<P>>();
  private nextId = 1;
  private nextOrder = 1;

  get size(): number {
    return this.sessions.size;
  }

  /** Register a resolved diff side. Returns its (possibly still one-sided) session. */
  join(panel: P, column: number, facts: DiffSideFacts): DiffSession<P> {
    this.leave(panel);
    let session = [...this.sessions.values()].find((candidate) => candidate.column === column && candidate.sides.length === 1);
    if (!session) {
      session = { id: `diff-session-${this.nextId++}`, column, sides: [] };
      this.sessions.set(session.id, session);
    }
    session.sides.push({ panel, facts, order: this.nextOrder++ });
    this.byPanel.set(panel, session);
    assignSides(session);
    return session;
  }

  /** Remove only this side; the survivor keeps its session and can pair again. */
  leave(panel: P): void {
    const session = this.byPanel.get(panel);
    if (!session) return;
    this.byPanel.delete(panel);
    session.sides = session.sides.filter((side) => side.panel !== panel);
    if (session.activated === panel) session.activated = undefined;
    if (session.sides.length === 0) {
      this.sessions.delete(session.id);
      return;
    }
    assignSides(session);
  }

  /**
   * A side became the active editor. For two writable files the first such
   * side is the modified one; later focus changes are the user's and never swap.
   * Returns true when this changed the sides.
   */
  noteActivated(panel: P): boolean {
    const session = this.byPanel.get(panel);
    if (!session || session.activated !== undefined) return false;
    session.activated = panel;
    const before = session.left;
    assignSides(session);
    return session.sides.length === 2 && session.left !== before;
  }

  sessionOf(panel: P): DiffSession<P> | undefined {
    return this.byPanel.get(panel);
  }

  roleOf(panel: P): DiffRole | undefined {
    const session = this.byPanel.get(panel);
    if (!session) return undefined;
    return session.left === panel ? "left" : session.right === panel ? "right" : undefined;
  }

  partnerOf(panel: P): P | undefined {
    const session = this.byPanel.get(panel);
    if (!session?.left || !session.right) return undefined;
    return session.left === panel ? session.right : session.right === panel ? session.left : undefined;
  }
}

function assignSides<P>(session: SessionState<P>): void {
  session.left = session.right = session.basis = undefined;
  if (session.sides.length !== 2) return;
  const [first, second] = [...session.sides].sort((a, b) => a.order - b.order);
  if (first.facts.writable !== second.facts.writable) {
    const original = first.facts.writable ? second : first;
    const modified = original === first ? second : first;
    session.left = original.panel;
    session.right = modified.panel;
    session.basis = "writability";
    return;
  }
  // No document signal (ADR 0001): the side VS Code focused first is the modified one.
  const active = session.sides.find((side) => side.panel === session.activated);
  if (active) {
    const other = active === first ? second : first;
    session.left = other.panel;
    session.right = active.panel;
    session.basis = "active-side";
    return;
  }
  session.left = second.panel;
  session.right = first.panel;
  session.basis = "resolve-order";
}
