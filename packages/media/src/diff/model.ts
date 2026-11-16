import type { DiffChangeProjection, DiffInfoProjection } from "@markdown-editor/core";

export type DiffInfo = DiffInfoProjection;
export type DiffChange = DiffChangeProjection;
export type LineChangeType = "added" | "deleted" | "modified";

/** One aligned display row of this pane: a rendered line, or a gap standing for the other side's line. */
export type AlignedRow<E> =
  | { row: number; kind: "line"; element: E; change?: DiffChange }
  | { row: number; kind: "gap"; change: DiffChange };

/** Content shown in the row layer, reserved as space directly above `before` (or at the end when null). */
export interface PreviousRow<E> {
  /** Aligned row the content belongs to (its own row for a gap, the line's row for a modified line). */
  row: number;
  kind: "previous" | "removed" | "ghost";
  html: string;
  before: E | null;
}

export interface DiffLayout<E> {
  rows: AlignedRow<E>[];
  decorations: Array<{ row: number; element: E; type: LineChangeType }>;
  previousRows: PreviousRow<E>[];
}

const isMine = (change: DiffChange, role: DiffInfo["role"]) => change.side === role || change.side === "both";

/**
 * Map the host's aligned changes onto this pane's rendered line elements.
 *
 * The host numbers rows after alignment: a spacer on this side occupies a row
 * of its own, so real lines after it sit one row later. Walking rows in order
 * and consuming either the next spacer or the next element rebuilds that
 * numbering without touching the DOM.
 */
export function layoutDiff<E>(elements: readonly E[], info: DiffInfo): DiffLayout<E> {
  const mine = info.changes.filter((change) => isMine(change, info.role));
  const spacers = mine.filter((change) => change.type === "spacer").sort((a, b) => a.lineNumber - b.lineNumber);
  const lineChanges = new Map<number, DiffChange>();
  for (const change of mine) if (change.type !== "spacer") lineChanges.set(change.lineNumber, change);

  const rows: AlignedRow<E>[] = [];
  let element = 0;
  let spacer = 0;
  for (let row = 0; element < elements.length || spacer < spacers.length; row++) {
    const nextSpacer = spacers[spacer];
    if (nextSpacer && (nextSpacer.lineNumber <= row || element >= elements.length)) {
      rows.push({ row, kind: "gap", change: nextSpacer });
      spacer++;
    } else {
      rows.push({ row, kind: "line", element: elements[element++], change: lineChanges.get(row) });
    }
  }

  const decorations: DiffLayout<E>["decorations"] = [];
  const previousRows: PreviousRow<E>[] = [];
  const nextLine = (from: number): E | null => {
    for (let i = from; i < rows.length; i++) {
      const candidate = rows[i];
      if (candidate.kind === "line") return candidate.element;
    }
    return null;
  };

  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i];
    if (entry.kind === "gap") {
      previousRows.push({
        row: entry.row,
        kind: info.mode === "inline" ? "removed" : "ghost",
        html: entry.change.content,
        before: nextLine(i + 1),
      });
      continue;
    }
    const change = entry.change;
    if (!change || change.type === "spacer") continue;
    decorations.push({ row: entry.row, element: entry.element, type: change.type });
    if (info.mode === "inline" && change.type === "modified" && change.oldContent) {
      previousRows.push({ row: entry.row, kind: "previous", html: change.oldContent, before: entry.element });
    }
  }
  return { rows, decorations, previousRows };
}

/** Cheap identity for a projection; the host bumps `version` on every send. */
export function diffKey(info: DiffInfo | null): string {
  return info ? `${info.instanceId ?? ""}:${info.version}:${info.role}:${info.mode}` : "";
}
