import type * as vscode from 'vscode';

export class ExtensionUriHandler implements vscode.UriHandler {
  constructor(
    private readonly oauthHandler: vscode.UriHandler,
    private readonly markdownHandler: vscode.UriHandler,
  ) {}

  public handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
    if (uri.path === '/oauth/callback') {
      return this.oauthHandler.handleUri(uri);
    }

    return this.markdownHandler.handleUri(uri);
  }
}
