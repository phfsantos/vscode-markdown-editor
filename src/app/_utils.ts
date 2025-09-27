import * as vscode from "vscode";

export function debug(...args: any[]) {
  console.log(...args)
}

export function showError(msg: string) {
  vscode.window.showErrorMessage(`[markdown-editor] ${msg}`)
}


export function getWebviewOptions(
  extensionUri: vscode.Uri
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
  return {
    // Enable javascript in the webview
    enableScripts: true,
    
    // Retain content when webview is hidden
    retainContextWhenHidden: true,
    
    // Enable finding in the webview
    enableFindWidget: true,
    
    // Allow access to local resources
    localResourceRoots: [extensionUri],
  }
}