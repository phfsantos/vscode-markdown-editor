import * as vscode from "vscode";
import type { PendingEditProjection } from "@markdown-editor/core";
import { createChatEditingPendingEditSource } from "./chatEditingDiff";
import { createClaudeCodePendingEditSource } from "./claudeCodePendingEditSource";
import type { PendingEditDocumentLike, PendingEditSource } from "./pendingEditSource";

/**
 * `vscode.TabInputTextDiff`, read defensively: this compatibility glue must
 * never break the editor, so a host (or module double) that lacks or refuses
 * the export yields `undefined` and the Claude Code source fails closed.
 */
function readTabInputTextDiff(): typeof vscode.TabInputTextDiff | undefined {
  try {
    const value = (vscode as { TabInputTextDiff?: typeof vscode.TabInputTextDiff }).TabInputTextDiff;
    return typeof value === "function" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The pending-edit sources this extension recognises, one per host that has a pending state. */
export function createHostPendingEditSources(): {
  chatEditing: PendingEditSource;
  claudeCode: PendingEditSource;
} {
  return {
    chatEditing: createChatEditingPendingEditSource(() => vscode.workspace.textDocuments),
    claudeCode: createClaudeCodePendingEditSource({
      tabGroups: vscode.window.tabGroups,
      TabInputTextDiff: readTabInputTextDiff(),
      textDocuments: () => vscode.workspace.textDocuments,
    }),
  };
}

/**
 * The pending edits for `document` as the webview's `pending-edits` payload.
 * A source that cannot answer (an unreadable compare document, or a host
 * shape that changed and throws) is left out rather than guessed.
 */
export function collectPendingEdits<TDoc extends PendingEditDocumentLike>(
  document: TDoc,
  sources: readonly PendingEditSource<TDoc>[],
): PendingEditProjection[] {
  return sources.flatMap((source) => {
    try {
      const edit = source.findPendingEdit(document);
      const compareContent = edit?.compareDocument.getText?.();
      return edit && typeof compareContent === "string"
        ? [{ sourceLabel: edit.sourceLabel, compareContent }]
        : [];
    } catch {
      return [];
    }
  });
}
