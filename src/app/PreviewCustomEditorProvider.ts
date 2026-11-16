import * as vscode from "vscode";
import { EditorPanel, type EditorPanelDependencies } from "./EditorPanel";
import { isDocumentWritable, isOpeningInDiff } from "../diff/diffContext";
import { getWebviewOptions } from "./_utils";
import { logger } from "../utils/Logger";

export class PreviewCustomEditorProvider
  implements vscode.CustomTextEditorProvider
{
  constructor(
    private context: vscode.ExtensionContext,
    private readonly dependencies: EditorPanelDependencies,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Diff membership and read-only come from the document and its column,
    // never from the active tab or a parsed tab label (ADR 0001, findings S2/S6).
    const isDiff = isOpeningInDiff(document.uri, webviewPanel.viewColumn);
    const readOnly = !isDocumentWritable(document.uri);
    const navigationTarget = this.dependencies.editorNavigation?.consumePendingTarget?.(document.uri);

    logger.debug(
      `[PreviewCustomEditorProvider] resolveCustomTextEditor path=${document.uri.path} scheme=${document.uri.scheme} column=${webviewPanel.viewColumn} isDiff=${isDiff} readOnly=${readOnly}`
    );

    try {
      webviewPanel.webview.options = getWebviewOptions(
        this.context.extensionUri
      );

      // Pass document, webviewPanel, isDiffView flag, and computed diff changes
      await EditorPanel.createOrShow(
        this.context,
        document,
        undefined,
        webviewPanel,
        isDiff,
        readOnly,
        this.dependencies,
        navigationTarget,
        Boolean(navigationTarget),
      );
    } catch (error) {
      try {
        // Handle errors gracefully
        if (error instanceof Error && error.message === "Webview is disposed") {
          const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
          // create a new webview panel
          // this is a workaround for the issue where the webview panel is disposed
          // when the user switches between editors
          // and the webview panel is not recreated
          // this is a known issue in vscode
          // see
          const newWebviewPanel = vscode.window.createWebviewPanel(
            EditorPanel.viewType,
            "Markdown Studio",
            column || vscode.ViewColumn.One,
            getWebviewOptions(this.context.extensionUri)
          );
          await EditorPanel.createOrShow(
            this.context,
            document,
            undefined,
            newWebviewPanel,
            false,
            undefined,
            this.dependencies,
            navigationTarget,
            Boolean(navigationTarget),
          );
        } else {
          logger.error(error);
          if (error instanceof Error)
            vscode.window.showErrorMessage(error.message);
        }
      } catch (error) {
        logger.error(error);
        if (error instanceof Error)
          vscode.window.showErrorMessage(error.message);
      }
    }
  }
}
