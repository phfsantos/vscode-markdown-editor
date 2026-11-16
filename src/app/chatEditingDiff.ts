import type * as vscode from "vscode";
import {
  getComparablePath,
  type PendingEditSource,
} from "./pendingEditSource";

export const CHAT_EDITING_TEXT_MODEL_SCHEME = "chat-editing-text-model";
export const CHAT_EDITING_SNAPSHOT_TEXT_MODEL_SCHEME =
  "chat-editing-snapshot-text-model";

type UriLike = Pick<vscode.Uri, "scheme" | "path" | "fsPath">;

export type ChatEditingDocumentLike = {
  uri: UriLike;
};

export interface ChatEditingState<TDoc extends ChatEditingDocumentLike> {
  baselineDocument: TDoc;
  snapshotDocuments: TDoc[];
  lastSnapshotDocument?: TDoc;
  hasPendingEdits: boolean;
  targetPath: string;
}

function getDocumentText(document: ChatEditingDocumentLike): string | undefined {
  const candidate = document as { getText?: () => string };
  if (typeof candidate.getText === "function") {
    return candidate.getText();
  }

  return undefined;
}

export function isChatEditingTextModelDocument(
  document: ChatEditingDocumentLike
): boolean {
  return document.uri.scheme === CHAT_EDITING_TEXT_MODEL_SCHEME;
}

export function isChatEditingSnapshotDocument(
  document: ChatEditingDocumentLike
): boolean {
  return document.uri.scheme === CHAT_EDITING_SNAPSHOT_TEXT_MODEL_SCHEME;
}

export function findChatEditingStateForDocument<
  TDoc extends ChatEditingDocumentLike
>(
  document: TDoc,
  textDocuments: readonly TDoc[]
): ChatEditingState<TDoc> | undefined {
  const targetPath = getComparablePath(document.uri);
  const baselineDocument = textDocuments.find((candidate) => {
    return (
      isChatEditingTextModelDocument(candidate) &&
      getComparablePath(candidate.uri) === targetPath
    );
  });

  if (!baselineDocument) {
    return undefined;
  }

  const snapshotDocuments = textDocuments.filter((candidate) => {
    return (
      isChatEditingSnapshotDocument(candidate) &&
      getComparablePath(candidate.uri) === targetPath
    );
  });

  const lastSnapshotDocument = snapshotDocuments[snapshotDocuments.length - 1];
  const baselineText = getDocumentText(baselineDocument);
  const snapshotText = lastSnapshotDocument
    ? getDocumentText(lastSnapshotDocument)
    : undefined;
  const hasPendingEdits =
    baselineText !== undefined && snapshotText !== undefined
      ? baselineText !== snapshotText
      : true;

  return {
    baselineDocument,
    snapshotDocuments,
    lastSnapshotDocument,
    hasPendingEdits,
    targetPath,
  };
}

/**
 * Copilot Chat's pending edits. VS Code applies an agent edit to the document
 * and keeps the pre-edit text in a private `chat-editing-text-model` document
 * (with `chat-editing-snapshot-text-model` checkpoints) until the user keeps or
 * undoes it. These schemes are VS Code internals, not API, so this source
 * fails closed: without a matching baseline document there is no pending edit.
 */
export function createChatEditingPendingEditSource<
  TDoc extends ChatEditingDocumentLike
>(textDocuments: () => readonly TDoc[]): PendingEditSource<TDoc> {
  return {
    id: "copilot-chat-editing",
    label: "Copilot",
    isRelevantDocument(document, candidate) {
      if (getComparablePath(candidate.uri) !== getComparablePath(document.uri)) {
        return false;
      }
      return candidate.uri.scheme.startsWith("chat-editing-");
    },
    findPendingEdit(document) {
      const state = findChatEditingStateForDocument(document, textDocuments());
      return state?.hasPendingEdits
        ? {
            sourceId: "copilot-chat-editing",
            sourceLabel: "Copilot",
            documentRole: "proposed",
            compareDocument: state.baselineDocument,
          }
        : undefined;
    },
  };
}
