import * as vscode from 'vscode';

export class MarkdownTextSyncProvider {
    private readonly disposables: vscode.Disposable[] = [];
    private syncedDocuments = new Map<string, vscode.TextDocument>();

    constructor() {
        // Monitor webview-based editor changes and sync to hidden text document
        this.setupTextDocumentSync();
    }

    private setupTextDocumentSync(): void {
        // Listen for webview content changes and update the underlying text document
        // This allows other extensions (like spell checkers) to work with the content
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'markdown') {
                this.syncedDocuments.set(event.document.uri.toString(), event.document);
            }
        }, this, this.disposables);

        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.languageId === 'markdown') {
                this.syncedDocuments.delete(document.uri.toString());
            }
        }, this, this.disposables);
    }

    /**
     * Updates the underlying text document when webview content changes
     * This ensures spell checkers and other extensions can access the current content
     */
    public async updateTextDocument(uri: vscode.Uri, content: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const edit = new vscode.WorkspaceEdit();
            
            // Only update if content actually changed to avoid unnecessary edits
            if (document.getText() !== content) {
                edit.replace(
                    uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    content
                );
                await vscode.workspace.applyEdit(edit);
            }
        } catch (error) {
            console.error('Failed to sync text document:', error);
        }
    }

    /**
     * Creates a transparent text document that other extensions can access
     * while the user interacts with the WYSIWYG editor
     */
    public async createSyncDocument(originalUri: vscode.Uri, content: string): Promise<vscode.TextDocument> {
        // Create a temporary document that mirrors the webview content
        const tempUri = originalUri.with({ scheme: 'markdown-editor-sync' });
        const document = await vscode.workspace.openTextDocument({
            content,
            language: 'markdown'
        });
        
        this.syncedDocuments.set(originalUri.toString(), document);
        return document;
    }

    /**
     * Gets the current synced document for a given URI
     */
    public getSyncedDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
        return this.syncedDocuments.get(uri.toString());
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.syncedDocuments.clear();
    }
}