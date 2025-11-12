import * as vscode from "vscode";
import { EditorPanel } from "./EditorPanel";
import { getWebviewOptions } from "./_utils";
import { logger } from "../utils/Logger";

export class PreviewCustomEditorProvider
  implements vscode.CustomTextEditorProvider
{
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Let get the active tab of the active editor
   * @param document The document being edited
   */
  private getActiveTab(): vscode.Tab | undefined {
    const tabs = vscode.window.tabGroups.activeTabGroup;
    const activeTab = tabs.tabs.find((tab) => {
      return tab.isActive;
    });
    if (activeTab) {
      return activeTab;
    }
    return undefined;
  }

  /**
   * Let check if the active group is a compare group
   * @param document The document being edited
   */
  private isActiveTabCompare(): boolean {
    const activeTab = this.getActiveTab();
    if (activeTab) {
      const { label } = activeTab;

      // Let check for git compare tabs
      if (
        label.includes(".md (Working tree)") ||
        label.includes(".md (Index)")
      ) {
        return true;
      }

      return label.includes("↔");
    }
    return false;
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    logger.debug(
      `[PreviewCustomEditorProvider]  🔍 resolveCustomTextEditor called for Path: ${document.uri.path}`
    );

    // Detect if this is a virtual scheme used for diff views
    const activeTab = this.getActiveTab();
    const isActiveTabCompare = this.isActiveTabCompare();

    // Get custom scheme for file
    const isVirtualScheme =
      document.uri.scheme === "showModifications" ||
      document.uri.scheme === "git";

    // set readOnly flag based on virtual scheme
    const readOnly = isVirtualScheme;

    try {
      webviewPanel.webview.options = getWebviewOptions(
        this.context.extensionUri
      );

      // Pass document, webviewPanel, isDiffView flag, and computed diff changes
      await EditorPanel.createOrShow(
        this.context,
        document,
        activeTab,
        webviewPanel,
        isActiveTabCompare,
        readOnly
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
            "Markdown Editor",
            column || vscode.ViewColumn.One,
            getWebviewOptions(this.context.extensionUri)
          );
          await EditorPanel.createOrShow(
            this.context,
            document,
            activeTab,
            newWebviewPanel
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
