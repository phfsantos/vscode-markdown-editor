import * as vscode from "vscode";
import { EditorPanel } from "./EditorPanel";
import { findChatEditingStateForDocument } from "./chatEditingDiff";
import { getWebviewOptions } from "./_utils";
import { logger } from "../utils/Logger";

export class PreviewCustomEditorProvider
  implements vscode.CustomTextEditorProvider
{
  constructor(private context: vscode.ExtensionContext) {}

  private getTabInputKind(tab: vscode.Tab | undefined): string {
    if (!tab?.input) {
      return "undefined";
    }

    if (tab.input instanceof vscode.TabInputTextDiff) {
      return "TabInputTextDiff";
    }

    if (tab.input instanceof vscode.TabInputText) {
      return "TabInputText";
    }

    if (tab.input instanceof vscode.TabInputNotebookDiff) {
      return "TabInputNotebookDiff";
    }

    if (tab.input instanceof vscode.TabInputNotebook) {
      return "TabInputNotebook";
    }

    if (tab.input instanceof vscode.TabInputCustom) {
      return `TabInputCustom(${tab.input.viewType})`;
    }

    if (tab.input instanceof vscode.TabInputWebview) {
      return `TabInputWebview(${tab.input.viewType})`;
    }

    if (typeof tab.input === "object" && tab.input !== null) {
      const inputWithConstructor = tab.input as {
        constructor?: { name?: string };
      };

      return inputWithConstructor.constructor?.name || "object";
    }

    return typeof tab.input;
  }

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
   * Detect real diff editors from tab input type first.
   * Label parsing is only kept as a temporary fallback for cases where VS Code
   * does not surface a typed diff tab input for the active tab.
   */
  private isActiveTabCompare(): boolean {
    const activeTab = this.getActiveTab();
    if (!activeTab) {
      return false;
    }

    const { input, label } = activeTab;

    if (
      input instanceof vscode.TabInputTextDiff ||
      input instanceof vscode.TabInputNotebookDiff
    ) {
      return true;
    }

    // Fallback for older or non-standard diff presentations.
    if (
      label.includes(".md (Working Tree)") ||
      label.includes(".md (Index)")
    ) {
      return true;
    }

    return label.includes("↔");
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    const activeTab = this.getActiveTab();
    const tabInputKind = this.getTabInputKind(activeTab);
    const isActiveTabCompare = this.isActiveTabCompare();
    const chatEditingState = findChatEditingStateForDocument(
      document,
      vscode.workspace.textDocuments
    );

    const isVirtualScheme =
      document.uri.scheme === "showModifications" ||
      document.uri.scheme === "git";

    const readOnly = isVirtualScheme;

    logger.debug(
      `[PreviewCustomEditorProvider] resolveCustomTextEditor path=${document.uri.path} scheme=${document.uri.scheme} documentDirty=${document.isDirty} tabInput=${tabInputKind} tabDirty=${activeTab?.isDirty ?? false} isDiffTab=${isActiveTabCompare} pendingChatEdits=${Boolean(
        chatEditingState
      )} readOnly=${readOnly}`
    );

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
