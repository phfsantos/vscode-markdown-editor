import * as vscode from 'vscode';
import { EditorPanel } from './EditorPanel';
import { getWebviewOptions } from './_utils';

export class PreviewCustomEditorProvider
  implements vscode.CustomTextEditorProvider {
  constructor(private context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken,
  ): Promise<void> {
    try {
      webviewPanel.webview.options = getWebviewOptions(this.context.extensionUri);
      await EditorPanel.createOrShow(this.context, document.uri, webviewPanel);
    } catch (error) {
      console.error(error);
      if (error instanceof Error) vscode.window.showErrorMessage(error.message);
    }
  }
}