import * as vscode from "vscode";
import * as NodePath from "path";

/**
 * Whether the user may edit this document: an untitled buffer, or a document
 * on a writable file system. Content-provider schemes (git:, showModifications,
 * chat-editing snapshots, review schemes) have no writable file system and are
 * read-only (findings S6).
 */
export function isDocumentWritable(uri: vscode.Uri): boolean {
  if (uri.scheme === "untitled") return true;
  return vscode.workspace.fs.isWritableFileSystem(uri.scheme) === true;
}

/**
 * Whether `uri` is being opened as one side of a diff in `column`.
 *
 * A text diff reports TabInputTextDiff with both URIs. A custom-editor diff
 * reports no tab input at all (ADR 0001, N1); its tab is recognised by that
 * missing input plus the document's name in the tab title. Every tab of the
 * column is considered, not only the active one, and nothing here decides
 * which side the document is on: DiffSessionRegistry does that.
 */
export function isOpeningInDiff(uri: vscode.Uri, column: number | undefined): boolean {
  const target = uri.toString();
  const name = NodePath.basename(uri.path);
  const groups = vscode.window.tabGroups.all.filter((group) => column === undefined || group.viewColumn === column);
  return groups.some((group) => group.tabs.some((tab) => {
    const input = tab.input as unknown;
    if (input instanceof vscode.TabInputTextDiff) {
      return input.original.toString() === target || input.modified.toString() === target;
    }
    return input === undefined && tab.label.includes(name);
  }));
}
