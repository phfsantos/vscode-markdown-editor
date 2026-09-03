import * as vscode from 'vscode';

/**
 * Provides CodeLens for markdown documents to show inline information
 */
export class MarkdownCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

    provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        if (document.languageId !== 'markdown') {
            return [];
        }

        const codeLenses: vscode.CodeLens[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        lines.forEach((line, index) => {
            // Add CodeLens for headings with word count
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const title = headingMatch[2];
                const wordCount = title.split(/\s+/).length;
                
                const range = new vscode.Range(index, 0, index, line.length);
                const codeLens = new vscode.CodeLens(range, {
                    title: `H${level} • ${wordCount} words`,
                    command: 'markdown-editor.showHeadingStats',
                    arguments: [document.uri, index, title]
                });
                codeLenses.push(codeLens);
            }

            // Add CodeLens for images with alt text status
            const imageMatch = line.match(/!\[([^\]]*)\]\(([^)]*)\)/);
            if (imageMatch) {
                const altText = imageMatch[1];
                const hasAltText = altText && altText.trim() !== '';
                
                const range = new vscode.Range(index, 0, index, line.length);
                const codeLens = new vscode.CodeLens(range, {
                    title: hasAltText ? '✓ Alt text' : '⚠ Missing alt text',
                    command: hasAltText ? '' : 'markdown-editor.addAltText',
                    arguments: [document.uri, index]
                });
                codeLenses.push(codeLens);
            }

            // Add CodeLens for tables showing column count
            if (line.includes('|') && !line.match(/^\s*\|[-:| ]+\|/)) {
                const columns = line.split('|').filter(cell => cell.trim() !== '').length;
                if (columns > 0) {
                    const range = new vscode.Range(index, 0, index, line.length);
                    const codeLens = new vscode.CodeLens(range, {
                        title: `Table: ${columns} columns`,
                        command: 'markdown-editor.formatTable',
                        arguments: [document.uri, index]
                    });
                    codeLenses.push(codeLens);
                }
            }
        });

        return codeLenses;
    }

    public refresh(): void {
        this._onDidChangeCodeLenses.fire();
    }
}

/**
 * Provides text decorations for markdown elements
 */
export class MarkdownDecorationProvider {
    private readonly disposables: vscode.Disposable[] = [];
    private decorationTypes = new Map<string, vscode.TextEditorDecorationType>();

    constructor() {
        this.initializeDecorationTypes();
        this.setupEventHandlers();
    }

    private initializeDecorationTypes(): void {
        // Decoration for emphasis
        this.decorationTypes.set('emphasis', vscode.window.createTextEditorDecorationType({
            fontStyle: 'italic',
            color: new vscode.ThemeColor('markdown.emphasis.foreground'),
        }));

        // Decoration for strong emphasis
        this.decorationTypes.set('strong', vscode.window.createTextEditorDecorationType({
            fontWeight: 'bold',
            color: new vscode.ThemeColor('markdown.strong.foreground'),
        }));

        // Decoration for inline code
        this.decorationTypes.set('code', vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('textCodeBlock.background'),
            border: '1px solid',
            borderColor: new vscode.ThemeColor('textCodeBlock.background'),
            borderRadius: '3px',
        }));

        // Decoration for links
        this.decorationTypes.set('link', vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('textLink.foreground'),
            textDecoration: 'underline',
        }));

        // Decoration for broken links
        this.decorationTypes.set('broken-link', vscode.window.createTextEditorDecorationType({
            color: new vscode.ThemeColor('errorForeground'),
            textDecoration: 'underline wavy',
        }));
    }

    private setupEventHandlers(): void {
        vscode.window.onDidChangeActiveTextEditor(this.updateDecorations, this, this.disposables);
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'markdown') {
                setTimeout(() => this.updateDecorations(vscode.window.activeTextEditor), 100);
            }
        }, this, this.disposables);
    }

    private updateDecorations(editor?: vscode.TextEditor): void {
        if (!editor || editor.document.languageId !== 'markdown') {
            return;
        }

        const text = editor.document.getText();
        const decorations = new Map<string, vscode.DecorationOptions[]>();

        // Initialize decoration arrays
        for (const [key] of this.decorationTypes) {
            decorations.set(key, []);
        }

        // Parse markdown and create decorations
        const lines = text.split('\n');
        lines.forEach((line, lineIndex) => {
            // Handle emphasis (*text* or _text_)
            const emphasisMatches = this.findMatches(line, /(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g);
            emphasisMatches.forEach(match => {
                decorations.get('emphasis')!.push({
                    range: new vscode.Range(lineIndex, match.index, lineIndex, match.index + match.length)
                });
            });

            // Handle strong emphasis (**text** or __text__)
            const strongMatches = this.findMatches(line, /\*\*([^*]+)\*\*|__([^_]+)__/g);
            strongMatches.forEach(match => {
                decorations.get('strong')!.push({
                    range: new vscode.Range(lineIndex, match.index, lineIndex, match.index + match.length)
                });
            });

            // Handle inline code (`code`)
            const codeMatches = this.findMatches(line, /`([^`]+)`/g);
            codeMatches.forEach(match => {
                decorations.get('code')!.push({
                    range: new vscode.Range(lineIndex, match.index, lineIndex, match.index + match.length)
                });
            });

            // Handle links
            const linkMatches = this.findMatches(line, /\[([^\]]*)\]\(([^)]*)\)/g);
            linkMatches.forEach(match => {
                const url = match.groups?.[1] || '';
                const decorationType = this.isValidUrl(url) ? 'link' : 'broken-link';
                
                decorations.get(decorationType)!.push({
                    range: new vscode.Range(lineIndex, match.index, lineIndex, match.index + match.length),
                    hoverMessage: new vscode.MarkdownString(`**Link:** ${url}`)
                });
            });
        });

        // Apply decorations
        for (const [type, decorationType] of this.decorationTypes) {
            editor.setDecorations(decorationType, decorations.get(type) || []);
        }
    }

    private findMatches(text: string, regex: RegExp): Array<{ index: number; length: number; groups?: RegExpExecArray['groups'] }> {
        const matches: Array<{ index: number; length: number; groups?: RegExpExecArray['groups'] }> = [];
        let match;
        
        regex.lastIndex = 0; // Reset regex state
        while ((match = regex.exec(text)) !== null) {
            matches.push({
                index: match.index,
                length: match[0].length,
                groups: match.groups
            });
        }
        
        return matches;
    }

    private isValidUrl(url: string): boolean {
        try {
            new URL(url);
            return true;
        } catch {
            return url.startsWith('#') || url.startsWith('/') || url.includes('.md');
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.decorationTypes.forEach(type => type.dispose());
    }
}