import * as vscode from "vscode";
import { EditorPanel } from "./EditorPanel";
import { getWebviewOptions } from "./_utils";

export class PreviewCustomEditorProvider
  implements vscode.CustomTextEditorProvider
{
  constructor(private context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    try {
      webviewPanel.webview.options = getWebviewOptions(
        this.context.extensionUri
      );
      await EditorPanel.createOrShow(this.context, document.uri, webviewPanel);
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
            "Markdown Editor",
            column || vscode.ViewColumn.One,
            getWebviewOptions(this.context.extensionUri)
          );
          await EditorPanel.createOrShow(
            this.context,
            document.uri,
            newWebviewPanel
          );
        } else {
          console.error(error);
          if (error instanceof Error)
            vscode.window.showErrorMessage(error.message);
        }
      } catch (error) {
        console.error(error);
        if (error instanceof Error)
          vscode.window.showErrorMessage(error.message);
      }
    }
  }
}
