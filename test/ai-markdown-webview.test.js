const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'ai-markdown-bridge.ts'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'preload.ts'), 'utf8');
const uiSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'ai-markdown-ui.ts'), 'utf8');
const chatAnchorSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'chat-anchor-ui.ts'), 'utf8');
const inlineSuggestionSource = fs.readFileSync(path.join(__dirname, '..', 'packages', 'media', 'src', 'inline-suggestion-ui.ts'), 'utf8');
const editorPanelSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'EditorPanel.ts'), 'utf8');
const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
const inlineCompletionProviderSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'MarkdownInlineCompletionProvider.ts'), 'utf8');

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name} passed`);
  } catch (error) {
    console.error(`❌ ${name} failed`);
    throw error;
  }
}

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

test('EditorPanel handles requestAiAction and returns aiMarkdownActionResult', () => {
  assert(editorPanelSource.includes('case "requestAiAction":'));
  assert(editorPanelSource.includes('private async handleAIMarkdownAction(message: any): Promise<void>'));
  assert(editorPanelSource.includes('command: "aiMarkdownActionResult"'));
});

test('EditorPanel routes each AI action to the expected side effect', () => {
  for (const action of [
    'case "copyContext":',
    'case "insertContext":',
    'case "insertTemplate":',
    'case "openChat":',
    'case "openGraph":',
    'case "validate":',
  ]) {
    assert(editorPanelSource.includes(action), `Expected handler branch for ${action}`);
  }

  assert(editorPanelSource.includes('command: "insertTextAtCursor"'));
  assert(editorPanelSource.includes('executeCommand("markdown-editor.openGraphView"'));
  assert(editorPanelSource.includes('Unsupported AI markdown action'));
  assert(editorPanelSource.includes('AI markdown action failed'));
});

test('EditorPanel suppresses add-to-chat and inline suggestions in excluded contexts', () => {
  assert(editorPanelSource.includes('private _canShowAddToChatButton(): boolean'));
  assert(editorPanelSource.includes('return !this._isDiffView && !this._isAIMarkdownDocument();'));
  assert(editorPanelSource.includes('private _canShowInlineSuggestions(): boolean'));
  assert(editorPanelSource.includes('this._config.get<boolean>("ai.enableInlineSuggestions", false)'));
  assert(editorPanelSource.includes('case "requestAddToChat":'));
});

console.log('✅ All AI markdown webview tests passed');
