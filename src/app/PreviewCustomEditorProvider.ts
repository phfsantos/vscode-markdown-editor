import * as vscode from "vscode";
import { EditorPanel } from "./EditorPanel";
import { getWebviewOptions } from "./_utils";
import { logger } from "../utils/Logger";

export class PreviewCustomEditorProvider
  implements vscode.CustomTextEditorProvider
{
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Extract the real file URI from virtual schemes like showModifications or git
   */
  private extractRealFileUri(uri: vscode.Uri): vscode.Uri {
    // Handle showModifications scheme (Compare with Saved)
    if (uri.scheme === 'showModifications') {
      try {
        // Parse the query parameter which contains the original URI info
        const queryObj = JSON.parse(decodeURIComponent(uri.query));
        const originalScheme = queryObj.scheme || 'file';
        const originalQuery = queryObj.query || '';
        
        // Reconstruct the original URI
        return vscode.Uri.parse(`${originalScheme}://${uri.authority}${uri.path}${originalQuery ? '?' + originalQuery : ''}`);
      } catch (err) {
        logger.warn(`[extractRealFileUri] Failed to parse showModifications URI: ${uri.toString()}`);
        return uri;
      }
    }
    
    // Handle git scheme (git diffs)
    if (uri.scheme === 'git') {
      // Git URIs point to historical versions, extract the file path
      return vscode.Uri.file(uri.path);
    }
    
    // Return as-is for normal schemes
    return uri;
  }

  /**
   * Let get the active tab of the active editor
   * @param document The document being edited
   */
  private getActiveTab(): vscode.Tab | undefined {
    const tabs = vscode.window.tabGroups.activeTabGroup;
    const activeTab = tabs.tabs.find(tab => {
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
      return activeTab.label.includes('↔');
    }
    return false;
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    const scheme = document.uri.scheme;
    const uriString = document.uri.toString();
    logger.debug(`[PreviewCustomEditorProvider] 🔍 resolveCustomTextEditor called for: ${uriString}`);
    logger.debug(`[PreviewCustomEditorProvider]   Scheme: ${scheme}`);
    logger.debug(`[PreviewCustomEditorProvider]   Path: ${document.uri.path}`);
    
    // Detect if this is a virtual scheme used for diff views
    const activeTab = this.getActiveTab();
    const isVirtualScheme = scheme === 'showModifications' || scheme === 'git';
    const isActiveTabCompare = this.isActiveTabCompare();
    logger.debug(`[PreviewCustomEditorProvider] isVirtualScheme: ${isVirtualScheme}`);
    
    try {
      webviewPanel.webview.options = getWebviewOptions(
        this.context.extensionUri
      );
      
      let savedContent: string | undefined;
      let diffChanges: any[] | undefined;
      

      if (isActiveTabCompare) {
        // For virtual schemes, we can get the original content from the document itself
        savedContent = document.getText();
        diffChanges = [];
        logger.debug(`[PreviewCustomEditorProvider] Using document content as savedContent: ${savedContent.length} bytes`);
      } else if (isVirtualScheme) {
        // Extract real file URI and read saved content from disk
        const realUri = this.extractRealFileUri(document.uri);
        logger.debug(`[PreviewCustomEditorProvider] Real URI: ${realUri.toString()}`);
        
        try {
          const fileContent = await vscode.workspace.fs.readFile(realUri);
          savedContent = Buffer.from(fileContent).toString('utf8');
          logger.debug(`[PreviewCustomEditorProvider] Read saved content: ${savedContent.length} bytes`);
          
          // Use MarkdownDiffViewSupport to calculate proper LCS-based diff
          const diffSupport = (global as any).markdownDiffViewSupport;
          if (diffSupport) {
            const currentContent = document.getText();
            diffChanges = diffSupport.calculateDiffFromContent(savedContent, currentContent);
            logger.debug(`[PreviewCustomEditorProvider] Calculated diff: ${diffChanges?.length || 0} changes`);
          } else {
            logger.warn(`[PreviewCustomEditorProvider] markdownDiffViewSupport not available`);
          }
        } catch (err) {
          logger.warn(`[PreviewCustomEditorProvider] Failed to read saved content: ${err}`);
        }
      }
      
      // Pass document, webviewPanel, savedContent, isDiffView flag, and computed diff changes
      await EditorPanel.createOrShow(this.context, document, activeTab,  webviewPanel, savedContent, isVirtualScheme || isActiveTabCompare, diffChanges, false);
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
            getWebviewOptions(this.context.extensionUri),
          );
          await EditorPanel.createOrShow(
            this.context,
            document,
            activeTab,
            newWebviewPanel,
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
