import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'ai-markdown-bridge.ts'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'preload.ts'), 'utf8');
const uiSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'ai-markdown-ui.ts'), 'utf8');
const chatAnchorSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'chat-anchor-ui.ts'), 'utf8');
const inlineSuggestionSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'inline-suggestion-ui.ts'), 'utf8');
const editorPanelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'EditorPanel.ts'), 'utf8');
const aiHandlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'AiMessageHandler.ts'), 'utf8');
const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
const inlineCompletionProviderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'MarkdownInlineCompletionProvider.ts'), 'utf8');

test('preload imports AI markdown bridge', () => {
  assert(preloadSource.includes('import "./ai-markdown-bridge";'));
});

test('bridge updates AI markdown UI from update messages', () => {
  assert(bridgeSource.includes('updateAIMarkdownUI('));
  assert(bridgeSource.includes('message.aiMarkdown'));
});

test('bridge handles insert and result messages', () => {
  assert(bridgeSource.includes('case "insertTextAtCursor":'));
  assert(bridgeSource.includes('case "aiMarkdownActionResult":'));
  assert(bridgeSource.includes('handleAIMarkdownActionResult(message);'));
});

test('bridge updates add-to-chat and inline suggestion UI', () => {
  assert(bridgeSource.includes('updateChatAnchorUI(message.chatAnchor, target);'));
  assert(bridgeSource.includes('inlineSuggestionController.updateEligibility(message.inlineSuggestion);'));
  assert(bridgeSource.includes('case "inlineSuggestionResult":'));
});

test('AI markdown UI hides when file is not eligible or affordances are disabled', () => {
  assert(uiSource.includes('if (!state?.isAIMarkdown || !state.availability?.affordancesEnabled) {'));
  assert(uiSource.includes('removeRootElement();'));
});

test('AI markdown UI renders a collapsed bottom-right launcher first', () => {
  assert(uiSource.includes('right: 20px;'));
  assert(uiSource.includes('bottom: 20px;'));
  assert(uiSource.includes('if (!isExpanded) {'));
  assert(uiSource.includes("launcher.className = 'ai-markdown-launcher';"));
  assert(uiSource.includes("launcher.setAttribute('aria-label', 'Open AI markdown tools');"));
  assert(uiSource.includes("launcher.setAttribute('aria-expanded', 'false');"));
});

test('AI markdown UI expands into the full tool shell with a collapse button', () => {
  assert(uiSource.includes("shell.className = 'ai-markdown-shell';"));
  assert(uiSource.includes("shell.setAttribute('aria-label', 'AI markdown tools');"));
  assert(uiSource.includes("closeButton.className = 'ai-markdown-close';"));
  assert(uiSource.includes("closeButton.setAttribute('aria-label', 'Collapse AI markdown tools');"));
  assert(uiSource.includes("isExpanded = false;"));
  assert(uiSource.includes("updateAIMarkdownUI(state, target);"));
});

test('AI markdown UI renders availability and pending edit state', () => {
  assert(uiSource.includes('availability.textContent = `${state.availability.statusLabel} ${state.availability.detail}`.trim();'));
  assert(uiSource.includes("pending.textContent = 'Pending AI edits detected in the current file.';"));
  assert(uiSource.includes("sections.textContent = `Suggested sections: ${state.suggestedSections.join(' · ')}`;"));
});

test('AI markdown UI posts requestAiAction messages for all buttons', () => {
  assert(uiSource.includes("target.postMessage({ command: 'requestAiAction', action });"));
  assert(uiSource.includes("actions.appendChild(createButton('Copy Context', 'copyContext', target, 'primary'));"));
  assert(uiSource.includes("actions.appendChild(createButton('Insert Context', 'insertContext', target));"));
  assert(uiSource.includes("actions.appendChild(createButton('Insert Template', 'insertTemplate', target));"));
  assert(uiSource.includes("actions.appendChild(createButton('Open Chat', 'openChat', target));"));
  assert(uiSource.includes("actions.appendChild(createButton('Open Graph', 'openGraph', target));"));
  assert(uiSource.includes("actions.appendChild(createButton('Validate', 'validate', target));"));
});

test('chat anchor UI renders a bottom-right add to chat button', () => {
  assert(chatAnchorSource.includes('right: 20px;'));
  assert(chatAnchorSource.includes('bottom: 20px;'));
  assert(chatAnchorSource.includes("button.setAttribute('aria-label', 'Add markdown file to chat');"));
  assert(chatAnchorSource.includes("target.postMessage({ command: 'requestAddToChat' });"));
});

test('inline suggestion UI supports request, accept, consume, and dismiss flows', () => {
  assert(inlineSuggestionSource.includes("command: 'requestInlineSuggestion'"));
  assert(inlineSuggestionSource.includes("if (event.key === 'Tab'"));
  assert(inlineSuggestionSource.includes("if (event.key === 'Escape')"));
  assert(inlineSuggestionSource.includes("if (event.key === this.suggestionText[0])"));
  assert(inlineSuggestionSource.includes('(window as any).vditor.insertValue(this.suggestionText);'));
});

test('extension registers inline completion provider for supported languages', () => {
  assert(extensionSource.includes('registerInlineCompletionItemProvider'));
  assert(extensionSource.includes('INLINE_SUGGESTION_LANGUAGE_IDS'));
  assert(extensionSource.includes("markdown-editor.toggleInlineSuggestions"));
  assert(inlineCompletionProviderSource.includes("ai.enableInlineSuggestions"));
});

test('EditorPanel routes requestAiAction to the AI handler which returns aiMarkdownActionResult', () => {
  assert(editorPanelSource.includes('case "requestAiAction":'));
  assert(aiHandlerSource.includes('public async handleAIMarkdownAction(message: any): Promise<void>'));
  assert(aiHandlerSource.includes('command: "aiMarkdownActionResult"'));
});

test('AI handler routes each AI action to the expected side effect', () => {
  for (const action of [
    'case "copyContext":',
    'case "insertContext":',
    'case "insertTemplate":',
    'case "openChat":',
    'case "openGraph":',
    'case "validate":',
  ]) {
    assert(aiHandlerSource.includes(action), `Expected handler branch for ${action}`);
  }

  assert(aiHandlerSource.includes('command: "insertTextAtCursor"'));
  assert(aiHandlerSource.includes('executeCommand("markdown-editor.openGraphView"'));
  assert(aiHandlerSource.includes('Unsupported AI markdown action'));
  assert(aiHandlerSource.includes('AI markdown action failed'));
});

test('AI handler suppresses add-to-chat and inline suggestions in excluded contexts', () => {
  assert(aiHandlerSource.includes('public canShowAddToChatButton(): boolean'));
  assert(aiHandlerSource.includes('return !this.host.isDiffView && !this.isAIMarkdownDocument();'));
  assert(aiHandlerSource.includes('public canShowInlineSuggestions(): boolean'));
  assert(aiHandlerSource.includes('this.host.config.get<boolean>("ai.enableInlineSuggestions", false)'));
  assert(editorPanelSource.includes('case "requestAddToChat":'));
});
