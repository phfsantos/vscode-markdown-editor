import * as vscode from 'vscode';
import { DefaultEditorChecker } from '../services/DefaultEditorChecker';
import { logger } from '../utils/Logger';

const COMMAND_PATTERNS = ['*.md', '*.markdown'];

/**
 * Handler for `markdown-editor.setAsDefaultEditor`: merges the global Markdown
 * associations (keeping unrelated ones) and refreshes the sidebar on success.
 */
export async function setMarkdownStudioAsDefaultEditor(refresh: () => void): Promise<void> {
  try {
    await DefaultEditorChecker.getInstance().setAsDefaultEditor(
      vscode.ConfigurationTarget.Global,
      COMMAND_PATTERNS
    );
    refresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to set Markdown Studio as the default editor:', error);
    vscode.window.showErrorMessage(`Could not set Markdown Studio as the default editor: ${message}`);
  }
}
