import * as vscode from 'vscode';
import { InlineSuggestionService } from '../services/InlineSuggestionService';
import { logger } from '../utils/Logger';

export const INLINE_SUGGESTION_LANGUAGE_IDS = [
  'markdown',
  'chatagent',
  'skill',
  'prompt',
] as const;

export class MarkdownInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private readonly suggestionService = InlineSuggestionService.getInstance();

  private isInlineSuggestionsEnabled(document: vscode.TextDocument): boolean {
    return vscode.workspace
      .getConfiguration('markdown-editor', document.uri)
      .get<boolean>('ai.enableInlineSuggestions', false);
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList> {
    if (!INLINE_SUGGESTION_LANGUAGE_IDS.includes(document.languageId as (typeof INLINE_SUGGESTION_LANGUAGE_IDS)[number])) {
      return new vscode.InlineCompletionList([]);
    }

    if (!this.isInlineSuggestionsEnabled(document)) {
      return new vscode.InlineCompletionList([]);
    }

    const content = document.getText();
    const offset = document.offsetAt(position);
    const suggestion = await this.suggestionService.getSuggestion(
      {
        document,
        content,
        beforeCursor: content.slice(0, offset),
        afterCursor: content.slice(offset),
        languageId: document.languageId,
        manual: context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke,
      },
      token
    );

    if (!suggestion) {
      return new vscode.InlineCompletionList([]);
    }

    logger.debug("suggestions + position", { suggestion, position });

    return new vscode.InlineCompletionList([
      new vscode.InlineCompletionItem(
        suggestion,
        new vscode.Range(position, position)
      ),
    ]);
  }
}
