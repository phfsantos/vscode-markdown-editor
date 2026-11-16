import type * as vscode from "vscode";

/**
 * Pending (not yet accepted) agent edits, one implementation per host.
 *
 * No host exposes a stable API for "an agent proposed this change and the user
 * has not kept it yet", so each source recognises its host's private documents
 * or tabs. Every source is compatibility glue and must fail closed: when the
 * host's private shape is absent or unrecognised it reports no pending edit,
 * never a guessed one.
 */

type UriLike = Pick<vscode.Uri, "scheme" | "path" | "fsPath">;

export type PendingEditDocumentLike = {
  uri: UriLike;
  getText?(): string;
};

export type PendingEditSourceId = "copilot-chat-editing" | "claude-code-diff";

/**
 * Which version of the change the open document holds. Copilot applies the
 * edit to the document and keeps the pre-edit text aside, so the document is
 * the proposal. Claude Code shows the proposal in a separate diff document and
 * leaves the open document untouched until the user accepts.
 */
export type PendingEditDocumentRole = "proposed" | "original";

export interface PendingEdit<TDoc extends PendingEditDocumentLike> {
  readonly sourceId: PendingEditSourceId;
  /** Human-readable host name, shown next to review markers. */
  readonly sourceLabel: string;
  /** What the open document holds; `compareDocument` holds the other version. */
  readonly documentRole: PendingEditDocumentRole;
  /**
   * The counterpart of the open document: Copilot's pre-edit baseline, or
   * Claude Code's proposed right-hand side.
   */
  readonly compareDocument: TDoc;
}

export interface PendingEditSource<TDoc extends PendingEditDocumentLike = vscode.TextDocument> {
  readonly id: PendingEditSourceId;
  readonly label: string;
  /**
   * Whether an event about `candidate` (opened, changed, closed) can change
   * this source's pending state for `document`.
   */
  isRelevantDocument(document: TDoc, candidate: TDoc): boolean;
  /** The pending edit for `document`, or `undefined` when there is none or it cannot be recognised. */
  findPendingEdit(document: TDoc): PendingEdit<TDoc> | undefined;
}

/** The path two URIs are matched on: the file system path for `file:` URIs, the URI path otherwise. */
export function getComparablePath(uri: UriLike): string {
  return uri.scheme === "file" && uri.fsPath ? uri.fsPath : uri.path;
}
