import type * as vscode from "vscode";

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

function getComparablePath(uri: UriLike): string {
  return uri.scheme === "file" && uri.fsPath ? uri.fsPath : uri.path;
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