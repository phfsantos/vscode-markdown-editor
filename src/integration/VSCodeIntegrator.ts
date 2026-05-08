import * as vscode from 'vscode';
import { logger } from '../utils/Logger';

/**
 * Enhanced VS Code integration utilities for better native feature support
 */
export class VSCodeIntegrator {
  private static instance: VSCodeIntegrator;

  private constructor() {
    // Use centralized logger
  }

  public static getInstance(): VSCodeIntegrator {
    if (!VSCodeIntegrator.instance) {
      VSCodeIntegrator.instance = new VSCodeIntegrator();
    }
    return VSCodeIntegrator.instance;
  }

  /**
   * Register enhanced VS Code language features for markdown
   */
  public registerLanguageFeatures(context: vscode.ExtensionContext): void {
    // Register Code Action Provider for custom quick fixes
    const codeActionProvider = new MarkdownCodeActionProvider();
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider('markdown', codeActionProvider, {
        providedCodeActionKinds: [
          vscode.CodeActionKind.QuickFix,
          vscode.CodeActionKind.Refactor,
          vscode.CodeActionKind.Source
        ]
      })
    );

    // Register Document Formatting Provider
    const formattingProvider = new MarkdownFormattingProvider();
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider('markdown', formattingProvider)
    );

    // Register Hover Provider for enhanced diagnostics
    const hoverProvider = new MarkdownHoverProvider();
    context.subscriptions.push(
      vscode.languages.registerHoverProvider('markdown', hoverProvider)
    );

    // Removed debug log - feature registered successfully
  }

  /**
   * Enhanced clipboard operations with proper error handling
   */
  public async writeToClipboard(text: string): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(text);
      // Removed debug log - clipboard write successful
      return true;
    } catch (error) {
      logger.error('❌ Clipboard write failed:', error);
      return false;
    }
  }

  public async readFromClipboard(): Promise<string> {
    try {
      const text = await vscode.env.clipboard.readText();
      // Removed debug log - clipboard read successful
      return text;
    } catch (error) {
      logger.error('❌ Clipboard read failed:', error);
      return '';
    }
  }

  /**
   * Get available code actions for a specific document position
   */
  public async getCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): Promise<vscode.CodeAction[]> {
    try {
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        document.uri,
        range
      ) || [];

      // Removed debug log - code actions retrieved successfully
      return actions;
    } catch (error) {
      logger.error('❌ Failed to get code actions:', error);
      return [];
    }
  }

  /**
   * Execute a specific code action
   */
  public async executeCodeAction(action: vscode.CodeAction): Promise<boolean> {
    try {
      if (action.edit) {
        await vscode.workspace.applyEdit(action.edit);
      }
      if (action.command) {
        await vscode.commands.executeCommand(
          action.command.command,
          ...(action.command.arguments || [])
        );
      }

      // Removed debug log - code action executed successfully
      return true;
    } catch (error) {
      logger.error('❌ Code action failed:', error);
      return false;
    }
  }

  /**
   * Show VS Code context menu at specific position
   */
  public async showContextMenu(): Promise<void> {
    try {
      await vscode.commands.executeCommand('editor.action.showContextMenu');
      // Removed debug log - context menu shown successfully
    } catch (error) {
      logger.error('❌ Failed to show context menu:', error);
    }
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    // No resources to dispose - using centralized logger
  }
}

/**
 * Custom Code Action Provider for enhanced markdown editing
 */
class MarkdownCodeActionProvider implements vscode.CodeActionProvider {
  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    // Add custom quick fixes for common markdown issues
    const line = document.lineAt(range.start.line);
    const text = line.text;

    // Fix: Add missing alt text to images
    if (text.includes('![](') && !text.includes('![alt')) {
      const fix = new vscode.CodeAction('Add alt text to image', vscode.CodeActionKind.QuickFix);
      fix.edit = new vscode.WorkspaceEdit();
      const newText = text.replace(/!\[\]\(/g, '![alt text](');
      fix.edit.replace(document.uri, line.range, newText);
      actions.push(fix);
    }

    // Fix: Convert relative links to absolute
    const linkMatch = text.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && !linkMatch[2].startsWith('http') && !linkMatch[2].startsWith('/')) {
      const fix = new vscode.CodeAction('Convert to absolute link', vscode.CodeActionKind.QuickFix);
      fix.edit = new vscode.WorkspaceEdit();
      const newText = text.replace(linkMatch[0], `[${linkMatch[1]}](/${linkMatch[2]})`);
      fix.edit.replace(document.uri, line.range, newText);
      actions.push(fix);
    }

    // Fix: Format tables
    if (text.includes('|')) {
      const fix = new vscode.CodeAction('Format table', vscode.CodeActionKind.Source);
      fix.command = {
        title: 'Format table',
        command: 'markdown-editor.formatTable',
        arguments: [document.uri, range.start.line]
      };
      actions.push(fix);
    }

    return actions;
  }
}

/**
 * Custom Document Formatting Provider for markdown
 */
class MarkdownFormattingProvider implements vscode.DocumentFormattingEditProvider {
  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const edits: vscode.TextEdit[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // Basic markdown formatting rules
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fix: Ensure headers have proper spacing
      if (trimmed.startsWith('#')) {
        const headerMatch = trimmed.match(/^(#+)(.*)$/);
        if (headerMatch && !headerMatch[2].startsWith(' ')) {
          const newLine = `${headerMatch[1]} ${headerMatch[2].trim()}`;
          const range = new vscode.Range(i, 0, i, line.length);
          edits.push(vscode.TextEdit.replace(range, newLine));
        }
      }

      // Fix: Ensure proper list formatting
      if (trimmed.match(/^[-*+]\s*\S/)) {
        const listMatch = trimmed.match(/^([-*+])(.*)$/);
        if (listMatch && !listMatch[2].startsWith(' ')) {
          const newLine = `${listMatch[1]} ${listMatch[2].trim()}`;
          const range = new vscode.Range(i, 0, i, line.length);
          edits.push(vscode.TextEdit.replace(range, newLine));
        }
      }
    }

    return edits;
  }
}

/**
 * Custom Hover Provider for enhanced diagnostic information
 */
class MarkdownHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const line = document.lineAt(position.line);
    const text = line.text;

    // Provide hover information for links
    const linkMatch = text.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const linkText = linkMatch[1];
      const linkUrl = linkMatch[2];
      
      const hoverContent = new vscode.MarkdownString();
      hoverContent.appendMarkdown(`**Link:** ${linkText}\n\n`);
      hoverContent.appendMarkdown(`**URL:** \`${linkUrl}\`\n\n`);
      
      if (linkUrl.startsWith('http')) {
        hoverContent.appendMarkdown(`[Open in browser](${linkUrl})`);
      }

      return new vscode.Hover(hoverContent);
    }

    // Provide hover information for images
    const imageMatch = text.match(/!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      const altText = imageMatch[1];
      const imageUrl = imageMatch[2];
      
      const hoverContent = new vscode.MarkdownString();
      hoverContent.appendMarkdown(`**Image:** ${altText || 'No alt text'}\n\n`);
      hoverContent.appendMarkdown(`**URL:** \`${imageUrl}\`\n\n`);
      
      if (!altText) {
        hoverContent.appendMarkdown('⚠️ Consider adding alt text for accessibility');
      }

      return new vscode.Hover(hoverContent);
    }

    return null;
  }
}