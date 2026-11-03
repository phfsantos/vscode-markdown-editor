import { handleAIMarkdownActionResult, updateAIMarkdownUI } from "./ai-markdown-ui";
import { updateChatAnchorUI } from "./chat-anchor-ui";
import { inlineSuggestionController } from "./inline-suggestion-ui";
import type { HostMessage, HostMessageRoutes } from "./host-message-router";

function insertTextAtCursor(text: string): void {
  if (!text || !(window as any).vditor || typeof (window as any).vditor.insertValue !== "function") {
    return;
  }

  (window as any).vditor.insertValue(text);
  (window as any).__vditorLineNumbers?.refresh?.();
}

function getVscodeTarget() {
  return (window as any).vscode;
}

function shouldShowAiMarkdownTools(message: HostMessage<"update">): boolean {
  const aiMarkdown = message.aiMarkdown as { isAIMarkdown?: unknown } | undefined;
  return Boolean(aiMarkdown?.isAIMarkdown) && !Boolean(message.isDiffView);
}

/**
 * Apply the AI parts of a host `update`. The document routes own `update`, so
 * main.ts calls this for each one instead of the bridge listening itself.
 */
export function syncAiMarkdownFromUpdate(message: HostMessage<"update">): void {
  const target = getVscodeTarget();
  if (target) {
    inlineSuggestionController.initialize(target);
  }

  updateAIMarkdownUI(
    shouldShowAiMarkdownTools(message) ? (message.aiMarkdown as any) : undefined,
    target
  );
  updateChatAnchorUI(message.chatAnchor as any, target);
  if (message.inlineSuggestion) {
    inlineSuggestionController.updateEligibility(message.inlineSuggestion as any);
  }
  inlineSuggestionController.handleExternalUpdate();
}

/** Host commands owned by the AI Markdown webview features. */
export const aiMarkdownRoutes: HostMessageRoutes = {
  inlineSuggestionEligibility: (message) => {
    inlineSuggestionController.updateEligibility(message);
    if (!message.enabled) {
      inlineSuggestionController.handleExternalUpdate();
    }
  },
  inlineSuggestionResult: (message) => inlineSuggestionController.handleSuggestionResponse(message),
  insertTextAtCursor: (message) => insertTextAtCursor(message.text),
  aiMarkdownActionResult: (message) => handleAIMarkdownActionResult(message),
};
