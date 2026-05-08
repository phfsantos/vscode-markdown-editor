import { handleAIMarkdownActionResult, updateAIMarkdownUI } from "./ai-markdown-ui";
import { updateChatAnchorUI } from "./chat-anchor-ui";
import { inlineSuggestionController } from "./inline-suggestion-ui";

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

function shouldShowAiMarkdownTools(message: any): boolean {
  return Boolean(message?.aiMarkdown?.isAIMarkdown) && !Boolean(message?.isDiffView);
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || typeof message.command !== "string") {
    return;
  }

  switch (message.command) {
    case "update": {
      const target = getVscodeTarget();
      if (target) {
        inlineSuggestionController.initialize(target);
      }

      updateAIMarkdownUI(
        shouldShowAiMarkdownTools(message) ? message.aiMarkdown : undefined,
        target
      );
      updateChatAnchorUI(message.chatAnchor, target);
      if (message.inlineSuggestion) {
        inlineSuggestionController.updateEligibility(message.inlineSuggestion);
      }
      inlineSuggestionController.handleExternalUpdate();
      break;
    }
    case "inlineSuggestionEligibility": {
      inlineSuggestionController.updateEligibility(message);
      if (!message.enabled) {
        inlineSuggestionController.handleExternalUpdate();
      }
      break;
    }
    case "inlineSuggestionResult": {
      inlineSuggestionController.handleSuggestionResponse(message);
      break;
    }
    case "insertTextAtCursor": {
      insertTextAtCursor(String(message.text || ""));
      break;
    }
    case "aiMarkdownActionResult": {
      handleAIMarkdownActionResult(message);
      break;
    }
    default:
      break;
  }
});
