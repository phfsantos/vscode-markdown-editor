import * as vscode from 'vscode';
import { AIMarkdownWorkflowService } from '../services/AIMarkdownWorkflowService';
import { EditorPanel } from '../app/EditorPanel';

/**
 * Enhanced command provider for better VS Code integration
 */
export class MarkdownCommandProvider {
    private readonly disposables: vscode.Disposable[] = [];
    private readonly aiWorkflowService = AIMarkdownWorkflowService.getInstance();

    constructor(private context: vscode.ExtensionContext) {
        this.registerCommands();
    }

    private registerCommands(): void {
        // Command to show heading statistics
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.showHeadingStats', 
                this.showHeadingStats, this)
        );

        // Command to add alt text to images
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.addAltText',
                this.addAltText, this)
        );

        // Command to format tables
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.formatTable',
                this.formatTable, this)
        );

        // Command to insert table of contents
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.insertTOC',
                this.insertTableOfContents, this)
        );

        // Command to validate document structure
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.validateDocument',
                this.validateDocument, this)
        );

        // Command to optimize images
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.optimizeImages',
                this.optimizeImages, this)
        );

        // Command to export document
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.exportDocument',
                this.exportDocument, this)
        );

        // Quick open note (fuzzy search across markdown files)
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.quickOpenNote',
                this.quickOpenNote, this)
        );

        // Open daily note (create from daily template in configured folder)
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.openDailyNote',
                this.openDailyNote, this)
        );

        // AI markdown workflow commands
        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.copyAiContext',
                this.copyAiContext, this)
        );

        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.insertAiContext',
                this.insertAiContext, this)
        );

        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.insertAiTemplate',
                this.insertAiTemplate, this)
        );

        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.openAiChat',
                this.openAiChat, this)
        );

        this.disposables.push(
            vscode.commands.registerCommand('markdown-editor.validateAiMarkdown',
                this.validateAiMarkdown, this)
        );
    }

    private async showHeadingStats(uri: vscode.Uri, lineIndex: number, title: string): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const text = document.getText();
        
        // Count words in the section under this heading
        const lines = text.split('\n');
        let sectionContent = '';
        let inSection = false;
        let currentLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            
            if (i === lineIndex) {
                inSection = true;
                currentLevel = headingMatch?.[1].length || 0;
                continue;
            }

            if (inSection) {
                if (headingMatch) {
                    const level = headingMatch[1].length;
                    if (level <= currentLevel) {
                        break; // End of section
                    }
                }
                sectionContent += line + '\n';
            }
        }

        const wordCount = sectionContent.split(/\s+/).filter(word => word.length > 0).length;
        const characterCount = sectionContent.length;
        const estimatedReadingTime = Math.ceil(wordCount / 200); // Assuming 200 WPM

        vscode.window.showInformationMessage(
            `Section "${title}": ${wordCount} words, ${characterCount} characters, ~${estimatedReadingTime}min read`
        );
    }

    private async addAltText(uri: vscode.Uri, lineIndex: number): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const line = document.lineAt(lineIndex);
        const imageMatch = line.text.match(/!\[([^\]]*)\]\(([^)]*)\)/);
        
        if (!imageMatch) return;

        const altText = await vscode.window.showInputBox({
            prompt: 'Enter alt text for the image',
            placeHolder: 'Descriptive alt text for accessibility',
            value: imageMatch[1]
        });

        if (altText !== undefined) {
            const edit = new vscode.WorkspaceEdit();
            const newImageSyntax = `![${altText}](${imageMatch[2]})`;
            edit.replace(uri, line.range, line.text.replace(imageMatch[0], newImageSyntax));
            await vscode.workspace.applyEdit(edit);
        }
    }

    private async formatTable(uri: vscode.Uri, lineIndex: number): Promise<void> {
        const document = await vscode.workspace.openTextDocument(uri);
        const lines = document.getText().split('\n');
        
        // Find the table boundaries
        let tableStart = lineIndex;
        let tableEnd = lineIndex;

        // Find start of table
        for (let i = lineIndex; i >= 0; i--) {
            if (lines[i].includes('|')) {
                tableStart = i;
            } else {
                break;
            }
        }

        // Find end of table
        for (let i = lineIndex; i < lines.length; i++) {
            if (lines[i].includes('|')) {
                tableEnd = i;
            } else {
                break;
            }
        }

        // Extract and format the table
        const tableLines = lines.slice(tableStart, tableEnd + 1);
        const formattedTable = this.formatMarkdownTable(tableLines);

        const edit = new vscode.WorkspaceEdit();
        edit.replace(
            uri,
            new vscode.Range(tableStart, 0, tableEnd + 1, 0),
            formattedTable.join('\n') + '\n'
        );
        await vscode.workspace.applyEdit(edit);
    }

    private formatMarkdownTable(lines: string[]): string[] {
        const rows = lines.map(line => 
            line.split('|').map(cell => cell.trim()).filter(cell => cell !== '')
        );

        if (rows.length === 0) return lines;

        // Calculate maximum width for each column
        const columnWidths: number[] = [];
        rows.forEach(row => {
            row.forEach((cell, colIndex) => {
                columnWidths[colIndex] = Math.max(columnWidths[colIndex] || 0, cell.length);
            });
        });

        // Format each row
        return rows.map((row, rowIndex) => {
            const formattedCells = row.map((cell, colIndex) => {
                return cell.padEnd(columnWidths[colIndex], ' ');
            });

            // Add separator row after header
            if (rowIndex === 0 && rows.length > 1) {
                const separatorRow = columnWidths.map(width => '-'.repeat(width));
                return [
                    '| ' + formattedCells.join(' | ') + ' |',
                    '| ' + separatorRow.join(' | ') + ' |'
                ];
            }

            return '| ' + formattedCells.join(' | ') + ' |';
        }).flat();
    }

    private async insertTableOfContents(uri?: vscode.Uri): Promise<void> {
        const document = uri ? 
            await vscode.workspace.openTextDocument(uri) : 
            vscode.window.activeTextEditor?.document;

        if (!document) return;

        const text = document.getText();
        const lines = text.split('\n');
        const toc: string[] = ['## Table of Contents', ''];

        lines.forEach(line => {
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const title = headingMatch[2];
                const anchor = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
                const indent = '  '.repeat(level - 1);
                toc.push(`${indent}- [${title}](#${anchor})`);
            }
        });

        toc.push('');

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            await editor.edit(editBuilder => {
                editBuilder.insert(new vscode.Position(0, 0), toc.join('\n'));
            });
        }
    }

    private async validateDocument(uri?: vscode.Uri): Promise<void> {
        const document = uri ? 
            await vscode.workspace.openTextDocument(uri) : 
            vscode.window.activeTextEditor?.document;

        if (!document) return;

        const text = document.getText();
        const issues: string[] = [];

        // Check for common issues
        const lines = text.split('\n');
        let hasH1 = false;
        const headingLevels: number[] = [];

        lines.forEach((line, index) => {
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                headingLevels.push(level);
                
                if (level === 1) hasH1 = true;

                // Check for skipped heading levels
                if (headingLevels.length > 1) {
                    const prevLevel = headingLevels[headingLevels.length - 2];
                    if (level > prevLevel + 1) {
                        issues.push(`Line ${index + 1}: Skipped heading level (from H${prevLevel} to H${level})`);
                    }
                }
            }

            // Check for long lines
            if (line.length > 120) {
                issues.push(`Line ${index + 1}: Line too long (${line.length} characters)`);
            }

            // Check for trailing whitespace
            if (line.match(/\s+$/)) {
                issues.push(`Line ${index + 1}: Trailing whitespace`);
            }
        });

        if (!hasH1) {
            issues.push('Document missing main heading (H1)');
        }

        // Show results
        if (issues.length === 0) {
            vscode.window.showInformationMessage('Document validation passed! No issues found.');
        } else {
            const choice = await vscode.window.showWarningMessage(
                `Found ${issues.length} issue(s) in document`,
                'Show Details', 'Fix Automatically'
            );

            if (choice === 'Show Details') {
                const { logger } = await import('../utils/Logger');
                logger.show();
                logger.info('Markdown Document Validation Results:');
                logger.info('='.repeat(40));
                issues.forEach(issue => logger.info(issue));
            }
        }
    }

    private async optimizeImages(uri?: vscode.Uri): Promise<void> {
        vscode.window.showInformationMessage(
            'Image optimization feature would analyze and compress images in the document'
        );
    }

    private async exportDocument(uri?: vscode.Uri): Promise<void> {
        const document = uri ? 
            await vscode.workspace.openTextDocument(uri) : 
            vscode.window.activeTextEditor?.document;

        if (!document) return;

        const format = await vscode.window.showQuickPick(['HTML', 'PDF', 'Word'], {
            placeHolder: 'Select export format'
        });

        if (format) {
            vscode.window.showInformationMessage(
                `Export to ${format} functionality would be implemented here`
            );
        }
    }

    private async quickOpenNote(): Promise<void> {
        // Find markdown files and show fuzzy quick pick
        const files = await vscode.workspace.findFiles('**/*.{md,markdown}', '**/node_modules/**');
        const picks = files.map(f => ({ label: vscode.workspace.asRelativePath(f), uri: f }));

        const choice = await vscode.window.showQuickPick(picks, { placeHolder: 'Quick open note' });
        if (choice && choice.uri) {
            const doc = await vscode.workspace.openTextDocument(choice.uri);
            await vscode.window.showTextDocument(doc);
        }
    }

    private async openDailyNote(): Promise<void> {
        const { TemplateManager } = await import('../services/TemplateManager');
        const templateManager = TemplateManager.getInstance();

        const config = vscode.workspace.getConfiguration('markdown-editor');
        const folder = config.get<string>('dailyNotesFolder', 'daily');

        // Create note content from 'daily' template
        const doc = await templateManager.createNoteFromTemplate('daily');

        // Prompt to save in workspace folder under configured daily folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Open a workspace folder to create daily notes');
            return;
        }

        const fileName = `daily-${new Date().toISOString().split('T')[0]}.md`;
        const uri = vscode.Uri.joinPath(workspaceFolder.uri, folder, fileName);

        // Ensure folder exists via workspace.fs
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceFolder.uri, folder));
        } catch {
            // ignore
        }

        const content = doc.getText();
        const bytes = Buffer.from(content, 'utf8');
        await vscode.workspace.fs.writeFile(uri, bytes);

        const savedDoc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(savedDoc);
    }

    private async copyAiContext(uri?: vscode.Uri): Promise<void> {
        const document = await this.getTargetDocument(uri);
        if (!document) {
            return;
        }

        const contextPackage = await this.aiWorkflowService.copyContextPackage(document);
        vscode.window.showInformationMessage(`AI context copied for ${contextPackage.descriptor.relativePath}`);
    }

    private async insertAiContext(uri?: vscode.Uri): Promise<void> {
        const document = await this.getTargetDocument(uri);
        if (!document) {
            return;
        }

        const contextPackage = await this.aiWorkflowService.buildContextPackage(document);
        const inserted = this.postToActiveCustomEditor('insertTextAtCursor', contextPackage.markdown);
        if (inserted) {
            vscode.window.showInformationMessage('AI context inserted into the custom markdown editor.');
            return;
        }

        await vscode.env.clipboard.writeText(contextPackage.markdown);
        vscode.window.showInformationMessage('AI context copied to the clipboard because no active custom markdown editor was found.');
    }

    private async insertAiTemplate(uri?: vscode.Uri): Promise<void> {
        const document = await this.getTargetDocument(uri);
        if (!document) {
            return;
        }

        const snippet = this.aiWorkflowService.getTemplateSnippet(document);
        const inserted = this.postToActiveCustomEditor('insertTextAtCursor', snippet);
        if (inserted) {
            vscode.window.showInformationMessage('AI markdown template inserted into the custom editor.');
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor?.document.uri.toString() === document.uri.toString()) {
            await activeEditor.edit((editBuilder) => {
                editBuilder.insert(activeEditor.selection.active, snippet);
            });
            vscode.window.showInformationMessage('AI markdown template inserted into the text editor.');
            return;
        }

        await vscode.env.clipboard.writeText(snippet);
        vscode.window.showInformationMessage('AI markdown template copied to the clipboard.');
    }

    private async openAiChat(uri?: vscode.Uri): Promise<void> {
        const document = await this.getTargetDocument(uri);
        if (!document) {
            return;
        }

        const result = await this.aiWorkflowService.openChatWorkflow(document);
        const showMessage = result.openedChat
            ? vscode.window.showInformationMessage
            : vscode.window.showWarningMessage;
        showMessage(result.message);
    }

    private async validateAiMarkdown(uri?: vscode.Uri): Promise<void> {
        const document = await this.getTargetDocument(uri);
        if (!document) {
            return;
        }

        const result = this.aiWorkflowService.validateDocument(document);
        if (!result.isAIMarkdown) {
            vscode.window.showInformationMessage('This file does not match the AI markdown naming patterns (.agent.md, .prompt.md, SKILL.md).');
            return;
        }

        if (result.isValid) {
            vscode.window.showInformationMessage('AI markdown validation passed. Recommended sections were found.');
            return;
        }

        vscode.window.showWarningMessage(`Missing AI markdown sections: ${result.missingSections.join(', ')}`);
    }

    private async getTargetDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
        if (uri) {
            return vscode.workspace.openTextDocument(uri);
        }

        const activeDocument = vscode.window.activeTextEditor?.document;
        if (activeDocument?.languageId === 'markdown') {
            return activeDocument;
        }

        const customEditorDocument = EditorPanel.currentPanel?._document;
        if (customEditorDocument?.languageId === 'markdown') {
            return customEditorDocument;
        }

        const visibleMarkdownDocument = vscode.workspace.textDocuments.find((document) => document.languageId === 'markdown');
        if (visibleMarkdownDocument) {
            return visibleMarkdownDocument;
        }

        vscode.window.showWarningMessage('Open a markdown document first.');
        return undefined;
    }

    private postToActiveCustomEditor(command: string, text: string): boolean {
        const editors = EditorPanel.editors || [];
        const targetPanel = EditorPanel.currentPanel || editors[editors.length - 1];
        if (!targetPanel) {
            return false;
        }

        targetPanel.postMessage({ command, text });
        return true;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
    }
}
