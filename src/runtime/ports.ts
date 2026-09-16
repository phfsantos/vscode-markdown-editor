import * as vscode from 'vscode';

export interface DiffCoordinator {
  calculateDiffFromHTML(leftHtml: string, rightHtml: string): DiffResultLike;
  handleScrollSync(
    sourceInstanceId: string | undefined,
    sourceUri: vscode.Uri,
    targetUri: vscode.Uri,
    scrollPercentage: number,
  ): void;
}

export interface DiffPanelTarget {
  readonly instanceId: string;
  readonly uri: vscode.Uri;
  sendScrollSync(scrollPercentage: number): void;
}

export interface DiffPanelRegistry {
  findTargetPanel(
    sourceInstanceId: string | undefined,
    targetUri: vscode.Uri,
  ): DiffPanelTarget | undefined;
}

export interface DiffResultLike {
  changes: Array<{ type: string; side?: string }>;
  leftHtmlLines?: string[];
  rightHtmlLines?: string[];
}

export interface ActiveDocumentEvents extends vscode.Disposable {
  readonly activeDocument: vscode.TextDocument | undefined;
  readonly onDidChangeActiveDocument: vscode.Event<vscode.TextDocument | undefined>;
  setActiveDocument(document: vscode.TextDocument | undefined): void;
}

export interface EditorOpenOptions {
  tab?: vscode.Tab;
  webviewPanel?: vscode.WebviewPanel;
  isDiffView?: boolean;
  readOnly?: boolean;
}

export interface EditorPanelHandle {
  postMessage(message: unknown): void;
}

export interface EditorNavigationPreviewPort {
  openEditor(
    documentOrUri: vscode.Uri | vscode.TextDocument,
    options?: EditorOpenOptions,
  ): Promise<EditorPanelHandle | undefined>;
  previewEmbed(document: vscode.TextDocument, payload: unknown): Promise<boolean>;
}
