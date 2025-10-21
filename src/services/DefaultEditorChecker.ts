import * as vscode from 'vscode';

/**
 * Editor association information
 */
export interface EditorAssociation {
  pattern: string;
  viewType: string;
}

/**
 * Manages default editor configuration for markdown files
 */
export class DefaultEditorChecker {
  private static instance: DefaultEditorChecker;
  private readonly MARKDOWN_PATTERNS = ['*.md', '*.markdown', '*.mdown', '*.mkdn', '*.mkd'];
  private readonly EDITOR_VIEW_TYPE = 'markdown-editor';

  private constructor() {
    // Monitor configuration changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('workbench.editorAssociations')) {
        this.onConfigurationChanged();
      }
    });
  }

  public static getInstance(): DefaultEditorChecker {
    if (!DefaultEditorChecker.instance) {
      DefaultEditorChecker.instance = new DefaultEditorChecker();
    }
    return DefaultEditorChecker.instance;
  }

  /**
   * Check if this extension is the default editor for markdown files
   */
  public isDefaultEditor(): boolean {
    const associations = this.getEditorAssociations();
    
    // Check if the primary .md pattern is associated with this editor
    // This is the most common pattern users will set
    return associations['*.md'] === this.EDITOR_VIEW_TYPE;
  }

  /**
   * Check if this extension is the default editor for a specific pattern
   */
  public isDefaultForPattern(pattern: string): boolean {
    const associations = this.getEditorAssociations();
    return associations[pattern] === this.EDITOR_VIEW_TYPE;
  }

  /**
   * Set this extension as the default editor for markdown files
   */
  public async setAsDefaultEditor(
    scope: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const currentAssociations = this.getEditorAssociations();
    const newAssociations: Record<string, string> = { ...currentAssociations };

    // Set all markdown patterns
    this.MARKDOWN_PATTERNS.forEach(pattern => {
      newAssociations[pattern] = this.EDITOR_VIEW_TYPE;
    });

    await vscode.workspace
      .getConfiguration('workbench')
      .update('editorAssociations', newAssociations, scope);

    vscode.window.showInformationMessage(
      'Markdown Editor is now the default editor for markdown files'
    );
  }

  /**
   * Reset to VS Code default markdown preview
   */
  public async resetToDefault(
    scope: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const currentAssociations = this.getEditorAssociations();
    const newAssociations: Record<string, string> = { ...currentAssociations };

    // Remove markdown patterns
    this.MARKDOWN_PATTERNS.forEach(pattern => {
      delete newAssociations[pattern];
    });

    await vscode.workspace
      .getConfiguration('workbench')
      .update('editorAssociations', newAssociations, scope);

    vscode.window.showInformationMessage(
      'Reset to VS Code default markdown editor'
    );
  }

  /**
   * Get current editor associations
   */
  public getEditorAssociations(): Record<string, string> {
    const config = vscode.workspace.getConfiguration('workbench');
    return config.get<Record<string, string>>('editorAssociations', {});
  }

  /**
   * Get all markdown-related associations
   */
  public getMarkdownAssociations(): EditorAssociation[] {
    const associations = this.getEditorAssociations();
    const markdownAssociations: EditorAssociation[] = [];

    for (const [pattern, viewType] of Object.entries(associations)) {
      if (this.isMarkdownPattern(pattern)) {
        markdownAssociations.push({ pattern, viewType });
      }
    }

    return markdownAssociations;
  }

  /**
   * Check if a pattern is markdown-related
   */
  private isMarkdownPattern(pattern: string): boolean {
    const mdPatterns = ['.md', '.markdown', '.mdown', '.mkdn', '.mkd'];
    return mdPatterns.some(mdPattern => pattern.includes(mdPattern));
  }

  /**
   * Show prompt to set as default editor
   */
  public async showSetDefaultPrompt(): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      'Would you like to set Markdown Editor as the default editor for markdown files?',
      'Yes',
      'No',
      'Don\'t ask again'
    );

    if (choice === 'Yes') {
      await this.setAsDefaultEditor();
    } else if (choice === 'Don\'t ask again') {
      // Save preference to not show again
      await vscode.workspace
        .getConfiguration('markdown-editor')
        .update('dontAskDefaultEditor', true, vscode.ConfigurationTarget.Global);
    }
  }

  /**
   * Check if should show default editor prompt
   */
  public async checkAndPromptIfNeeded(): Promise<void> {
    const config = vscode.workspace.getConfiguration('markdown-editor');
    const dontAsk = config.get<boolean>('dontAskDefaultEditor', false);

    if (!dontAsk && !this.isDefaultEditor()) {
      await this.showSetDefaultPrompt();
    }
  }

  /**
   * Get editor status summary
   */
  public getStatusSummary(): {
    isDefault: boolean;
    patterns: { pattern: string; isAssociated: boolean }[];
    otherEditors: string[];
  } {
    const isDefault = this.isDefaultEditor();
    const associations = this.getEditorAssociations();
    const otherEditors = new Set<string>();

    const patterns = this.MARKDOWN_PATTERNS.map(pattern => {
      const viewType = associations[pattern];
      const isAssociated = viewType === this.EDITOR_VIEW_TYPE;

      if (viewType && viewType !== this.EDITOR_VIEW_TYPE) {
        otherEditors.add(viewType);
      }

      return {
        pattern,
        isAssociated
      };
    });

    return {
      isDefault,
      patterns,
      otherEditors: Array.from(otherEditors)
    };
  }

  /**
   * Handle configuration changes
   */
  private onConfigurationChanged(): void {
    // Could emit events or update UI here
    const status = this.getStatusSummary();
    
    if (!status.isDefault && status.otherEditors.length > 0) {
      console.log(`Markdown files are associated with: ${status.otherEditors.join(', ')}`);
    }
  }

  /**
   * Create a status bar item for default editor status
   */
  public createStatusBarItem(): vscode.StatusBarItem {
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    const updateStatusBar = () => {
      if (this.isDefaultEditor()) {
        statusBarItem.text = '$(check) MD Editor';
        statusBarItem.tooltip = 'Markdown Editor is the default editor';
        statusBarItem.command = undefined;
      } else {
        statusBarItem.text = '$(info) MD Editor';
        statusBarItem.tooltip = 'Click to set as default markdown editor';
        statusBarItem.command = 'markdown-editor.setAsDefaultEditor';
      }
    };

    updateStatusBar();

    // Update on configuration changes
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('workbench.editorAssociations')) {
        updateStatusBar();
      }
    });

    return statusBarItem;
  }
}
