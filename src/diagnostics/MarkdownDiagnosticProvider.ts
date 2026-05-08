import * as vscode from 'vscode';

export class MarkdownDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private readonly disposables: vscode.Disposable[] = [];

    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('markdown-editor');
        
        // Listen for text document changes to provide diagnostics
        vscode.workspace.onDidChangeTextDocument(this.onDocumentChange, this, this.disposables);
        vscode.workspace.onDidOpenTextDocument(this.analyzeDocument, this, this.disposables);
        vscode.workspace.onDidCloseTextDocument(this.clearDiagnostics, this, this.disposables);
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        if (event.document.languageId === 'markdown') {
            // Debounce rapid changes
            setTimeout(() => this.analyzeDocument(event.document), 500);
        }
    }

    private analyzeDocument(document: vscode.TextDocument): void {
        if (document.languageId !== 'markdown') return;

        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Example diagnostics - you can expand these
        lines.forEach((line, lineIndex) => {
            // Check for broken links
            const linkRegex = /\[([^\]]*)\]\(([^)]*)\)/g;
            let linkMatch;
            while ((linkMatch = linkRegex.exec(line)) !== null) {
                const match = linkMatch;
                const url = match[2];
                if (url && !this.isValidUrl(url) && !this.isValidFilePath(url, document.uri)) {
                    const startChar = match.index!;
                    const endChar = startChar + match[0].length;
                    
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(lineIndex, startChar, lineIndex, endChar),
                        `Potentially broken link: ${url}`,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'markdown-editor';
                    diagnostic.code = 'broken-link';
                    diagnostics.push(diagnostic);
                }
            }

            // Check for malformed tables
            if (line.includes('|')) {
                const cells = line.split('|').map(cell => cell.trim());
                if (cells.length < 3) { // Expecting at least | content |
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(lineIndex, 0, lineIndex, line.length),
                        'Malformed table row - tables should have at least one cell with proper | separators',
                        vscode.DiagnosticSeverity.Information
                    );
                    diagnostic.source = 'markdown-editor';
                    diagnostic.code = 'malformed-table';
                    diagnostics.push(diagnostic);
                }
            }

            // Check for missing alt text in images
            const imageRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
            let imageMatch;
            while ((imageMatch = imageRegex.exec(line)) !== null) {
                const match = imageMatch;
                const altText = match[1];
                if (!altText || altText.trim() === '') {
                    const startChar = match.index!;
                    const endChar = startChar + match[0].length;
                    
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(lineIndex, startChar, lineIndex, endChar),
                        'Image missing alt text for accessibility',
                        vscode.DiagnosticSeverity.Information
                    );
                    diagnostic.source = 'markdown-editor';
                    diagnostic.code = 'missing-alt-text';
                    diagnostics.push(diagnostic);
                }
            }
        });

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }

    private isValidFilePath(path: string, documentUri: vscode.Uri): boolean {
        if (path.startsWith('http') || path.startsWith('//')) return true;
        
        try {
            const basePath = vscode.Uri.joinPath(documentUri, '..', path);
            // You could add actual file existence check here
            return true;
        } catch {
            return false;
        }
    }

    private clearDiagnostics(document: vscode.TextDocument): void {
        if (document.languageId === 'markdown') {
            this.diagnosticCollection.delete(document.uri);
        }
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}